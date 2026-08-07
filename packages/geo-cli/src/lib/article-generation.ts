import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { stableId } from "./fact-model.js";
import type { FactRecord } from "./fact-model.js";
import type { ContentPlan, ProductionTask } from "./content-plan-model.js";
import type { ArticleImageView, ArticleMeta, ArticleRisk, ArticleWritingBrief } from "./article-model.js";
import type { SkuItem } from "./skus.js";
import { pathExists, readJson, relToProject, utcNow, writeJson } from "./util.js";

const SENSITIVE_FIELD = /(password|passwd|token|secret|id_card|identity_card|legal_representative_id|法人身份证|身份证|口令|密码|密钥|令牌)/i;
const SENSITIVE_BODY = /(?:\b\d{17}[\dXx]\b|(?:密码|口令|password|token|secret)\s*[:：=]\s*\S+)/i;
const MAX_ALLOWED_IMAGES = 6;
const ROLE_RANK: Record<string, number> = { main: 0, cover: 1, hero: 2, gallery: 3, detail: 4 };
const PRODUCT_FIELDS = /^(name|category|capabilities|selling_points|attributes|products_services|advantages)$/i;

function sha(text: string): string { return createHash("sha256").update(text).digest("hex"); }
function uniq(values: string[]): string[] { return [...new Set(values)]; }
function readable(value: unknown): string {
  if (Array.isArray(value)) return value.map(readable).join("；");
  if (value && typeof value === "object") return Object.entries(value as Record<string, unknown>).map(([key, child]) => `${key}: ${readable(child)}`).join("；");
  return String(value ?? "");
}

async function currentPlan(projectRoot: string): Promise<{ manifest: Record<string, any>; plan: ContentPlan; facts: FactRecord[] }> {
  const manifest = await readJson<Record<string, any>>(path.join(projectRoot, "manifest.json"));
  const gate = manifest.gates?.content_plan;
  if (gate?.status !== "confirmed" || !gate.content_plan_id) throw new Error("article generation blocked: content plan is not confirmed");
  const plan = await readJson<ContentPlan>(path.join(projectRoot, "strategy", "content-plans", `${gate.content_plan_id}.json`));
  if (plan.lifecycle !== "confirmed" || plan.content_plan_id !== gate.content_plan_id || plan.version !== gate.version || plan.fact_snapshot_id !== gate.fact_snapshot_id) {
    throw new Error("article generation blocked: content plan artifact is missing or stale");
  }
  const snapshot = await readJson<Record<string, any>>(path.join(projectRoot, "knowledge", "snapshots", `${plan.fact_snapshot_id}.json`));
  const facts = (snapshot.facts?.facts ?? []) as FactRecord[];
  return { manifest, plan, facts };
}

function eligible(task: ProductionTask): boolean {
  return task.status === "planned" && task.review_status === "approved" && ["ready", "research_only"].includes(task.readiness);
}

function markdownAssetPath(assetPath: string): string {
  return `../../${assetPath.split(path.sep).join("/")}`;
}

function normalizeAssetPath(raw: string, channel: string): string | null {
  let value = raw.trim().replace(/^<|>$/g, "").split(/\s+/)[0] ?? "";
  try { value = decodeURIComponent(value); } catch { /* keep raw */ }
  value = value.replace(/\\/g, "/");
  if (!value) return null;
  if (value.startsWith("assets/images/")) return value;
  if (value.startsWith("../../assets/images/")) return value.slice("../../".length);
  if (value.startsWith("../assets/images/") || value.startsWith("./assets/images/")) {
    const idx = value.indexOf("assets/images/");
    return value.slice(idx);
  }
  const fromArticle = path.posix.normalize(path.posix.join(`articles/${channel}`, value));
  if (fromArticle.startsWith("assets/images/")) return fromArticle;
  const idx = fromArticle.indexOf("assets/images/");
  return idx >= 0 ? fromArticle.slice(idx) : null;
}

export function extractUsedImagePaths(body: string, channel: string): string[] {
  const out: string[] = [];
  const re = /!\[[^\]]*]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body))) {
    const normalized = normalizeAssetPath(match[1] ?? "", channel);
    if (normalized) out.push(normalized);
  }
  return uniq(out);
}

async function resolveAllowedImages(projectRoot: string, allowedFactIds: string[], allowedFacts: Array<{ fact_id: string; field: string; value: unknown }>): Promise<ArticleImageView[]> {
  const skusPath = path.join(projectRoot, "knowledge", "company.skus.json");
  if (!(await pathExists(skusPath))) return [];
  const skus = await readJson<{ items?: SkuItem[] }>(skusPath);
  const allowed = new Set(allowedFactIds);
  let matched = (skus.items ?? []).filter((item) => (item.fact_refs ?? []).some((id) => allowed.has(id)) && (item.images?.length ?? 0) > 0);
  if (!matched.length && allowedFacts.some((fact) => PRODUCT_FIELDS.test(fact.field))) {
    matched = (skus.items ?? []).filter((item) => item.is_main && (item.images?.length ?? 0) > 0);
    if (!matched.length) matched = (skus.items ?? []).filter((item) => (item.images?.length ?? 0) > 0).slice(0, 1);
  }
  const ranked = matched
    .flatMap((item) => (item.images ?? []).map((image, index) => ({
      path: image.path.split(path.sep).join("/"),
      role: image.role || "detail",
      sku_id: item.sku_id,
      sku_name: item.name,
      markdown_path: markdownAssetPath(image.path.split(path.sep).join("/")),
      alt: `${item.name}${image.role ? `（${image.role}）` : ""}`,
      rank: ROLE_RANK[image.role] ?? 50,
      index,
      mainBoost: item.is_main ? 0 : 1,
    })))
    .filter((image) => image.path.startsWith("assets/images/"))
    .sort((a, b) => a.mainBoost - b.mainBoost || a.rank - b.rank || a.index - b.index);

  const seen = new Set<string>();
  const selected: ArticleImageView[] = [];
  for (const image of ranked) {
    if (seen.has(image.path)) continue;
    if (!(await pathExists(path.join(projectRoot, image.path)))) continue;
    seen.add(image.path);
    selected.push({ path: image.path, role: image.role, sku_id: image.sku_id, sku_name: image.sku_name, markdown_path: image.markdown_path, alt: image.alt });
    if (selected.length >= MAX_ALLOWED_IMAGES) break;
  }
  return selected;
}

function promptText(brief: ArticleWritingBrief): string {
  const facts = brief.allowed_facts.map((f) => `- [${f.fact_id}] ${f.field}: ${typeof f.value === "string" ? f.value : JSON.stringify(f.value)}`).join("\n");
  const images = brief.allowed_images.length
    ? brief.allowed_images.map((image) => `- ${image.sku_name}｜${image.role}｜\`${image.path}\`\n  Markdown：\`![${image.alt ?? image.sku_name}](${image.markdown_path})\``).join("\n")
    : "- （当前任务没有可关联的本地配图；不要虚构外链图片）";
  const imageRules = brief.allowed_images.length
    ? [
      "正文必须插入至少 1 张、最多 3 张 allowlist 配图",
      "只用上面列出的 markdown_path，不要改文件名、不要外链、不要上传 OSS",
      "配图放在首段回答之后或对应产品说明附近，alt 用中文简述",
      "生成后声明实际使用的 Fact IDs；配图以正文 Markdown 引用为准",
    ]
    : ["当前无配图 allowlist，不要插入外部图片 URL"];
  return `# 文章写作包：${brief.article_id}

只生成 Markdown 草稿，不发布、不上传、不声称已审核。

## 目标

- 题目方向：${brief.title_direction}
- 服务对象：${brief.audience}
- 内容目标：${brief.objective}
- 渠道/形式：${brief.channel} / ${brief.content_format}
- 模式：${brief.mode}

## 准备回答

${brief.questions.map((q) => `- ${q}`).join("\n")}

## 只允许使用的事实

${facts}

## 允许使用的配图

${images}

## 结构与表达

${brief.outline_requirements.map((x) => `- ${x}`).join("\n")}
- 语气：${brief.tone}
${brief.channel_constraints.map((x) => `- ${x}`).join("\n")}
- 引用策略：${brief.citation_policy}
${imageRules.map((x) => `- ${x}`).join("\n")}

## 禁止越界

${[...brief.forbidden_claims, ...brief.claim_boundaries].map((x) => `- ${x}`).join("\n") || "- 不添加 allowlist 外的企业事实、数字、排名或承诺"}

生成后必须同时声明实际使用的 Fact IDs，并通过 geo-cli article ingest。
`;
}

export async function prepareArticles(projectRoot: string, taskId?: string, limit?: number, force = false): Promise<{ prepared: string[]; existing: string[]; refreshed: string[]; review_path: string }> {
  const { manifest, plan, facts } = await currentPlan(projectRoot);
  let tasks = plan.production_tasks.filter(eligible);
  if (taskId) tasks = tasks.filter((x) => x.task_id === taskId);
  if (taskId && !tasks.length) throw new Error(`eligible production task not found: ${taskId}`);
  const slots = tasks.flatMap((task) => Array.from({ length: task.quantity }, (_, index) => ({ task, slot: index + 1 })));
  const chosen = Number.isInteger(limit) && Number(limit) > 0 ? slots.slice(0, Number(limit)) : slots;
  const prepared: string[] = [];
  const existing: string[] = [];
  const refreshed: string[] = [];
  await mkdir(path.join(projectRoot, "articles", "work"), { recursive: true });
  for (const { task, slot } of chosen) {
    const articleId = stableId("article", plan.content_plan_id, task.task_id, slot);
    const briefPath = path.join(projectRoot, "articles", "work", `${articleId}.brief.json`);
    const topic = plan.topics.find((x) => x.topic_id === task.topic_id)!;
    const prompt = plan.prompt_recipes.find((x) => x.prompt_id === task.prompt_id)!;
    const faqs = plan.faq_candidates.filter((x) => task.faq_ids.includes(x.faq_id));
    const allowed = new Set(task.allowed_fact_ids);
    const allowedFacts = facts
      .filter((f) => allowed.has(f.fact_id) && f.review_status === "confirmed" && f.disclosure_level === "public" && !SENSITIVE_FIELD.test(f.field))
      .map((f) => ({ fact_id: f.fact_id, field: f.field, value: f.value }));
    if (allowedFacts.length !== allowed.size) throw new Error(`task ${task.task_id} contains missing, non-public, or sensitive facts`);
    const allowedImages = await resolveAllowedImages(projectRoot, task.allowed_fact_ids, allowedFacts);
    const brief: ArticleWritingBrief = {
      schema_version: 1,
      article_id: articleId,
      slot,
      app_id: plan.app_id,
      content_plan_id: plan.content_plan_id,
      content_plan_version: plan.version,
      task_id: task.task_id,
      topic_id: task.topic_id,
      faq_ids: task.faq_ids,
      scenario_ids: task.scenario_ids,
      question_ids: task.question_ids,
      fact_snapshot_id: task.fact_snapshot_id,
      channel: task.channel,
      content_format: task.content_format,
      mode: task.mode,
      title_direction: topic.name,
      objective: topic.objective,
      audience: topic.target_audience,
      questions: faqs.map((x) => x.question),
      desired_next_action: topic.desired_next_action,
      outline_requirements: prompt.outline_requirements,
      tone: prompt.tone,
      channel_constraints: prompt.channel_constraints,
      citation_policy: prompt.citation_policy,
      allowed_facts: allowedFacts,
      allowed_images: allowedImages,
      forbidden_claims: prompt.forbidden_claims,
      claim_boundaries: task.claim_boundaries,
      created_at: utcNow(),
    };
    const exists = await pathExists(briefPath);
    if (exists && !force) {
      existing.push(articleId);
      continue;
    }
    if (exists && force) {
      const prior = await readJson<ArticleWritingBrief>(briefPath);
      brief.created_at = prior.created_at ?? brief.created_at;
      refreshed.push(articleId);
    } else {
      prepared.push(articleId);
    }
    await writeJson(briefPath, brief);
    await writeFile(path.join(projectRoot, "articles", "work", `${articleId}.prompt.md`), promptText(brief), "utf-8");
  }
  manifest.article_generation = {
    content_plan_id: plan.content_plan_id,
    fact_snapshot_id: plan.fact_snapshot_id,
    planned: plan.production_tasks.filter(eligible).reduce((sum, x) => sum + x.quantity, 0),
    drafted: await countDrafts(projectRoot, plan.content_plan_id),
    updated_at: utcNow(),
  };
  manifest.updated_at = manifest.article_generation.updated_at;
  await writeJson(path.join(projectRoot, "manifest.json"), manifest);
  await renderDraftReview(projectRoot);
  return { prepared, existing, refreshed, review_path: "articles/draft-review.md" };
}

function researchRisks(brief: ArticleWritingBrief, text: string): ArticleRisk[] {
  if (brief.mode !== "research_only") return [];
  const claimsSupport = /(?:晶铭服饰|公司|企业|厂家).{0,10}(?:支持|可以|可做).{0,10}单件定制|支持单件定制/i.test(text);
  const hedged = /(?:是否|需|需要|核验|确认|未确认|不能|不代表).{0,18}(?:支持|单件定制)|(?:支持|单件定制).{0,18}(?:需|需要|核验|确认|未确认|不能|不代表)/i.test(text);
  return claimsSupport && !hedged ? [{ code: "research_only_claim", severity: "block", message: "research-only 草稿把待核验能力写成了企业事实" }] : [];
}

async function loadBrief(projectRoot: string, articleId: string): Promise<ArticleWritingBrief> {
  const brief = await readJson<ArticleWritingBrief>(path.join(projectRoot, "articles", "work", `${articleId}.brief.json`));
  const { plan } = await currentPlan(projectRoot);
  if (brief.content_plan_id !== plan.content_plan_id || brief.fact_snapshot_id !== plan.fact_snapshot_id || !plan.production_tasks.some((x) => x.task_id === brief.task_id && eligible(x))) {
    throw new Error("article brief is stale or no longer eligible");
  }
  if (!Array.isArray(brief.allowed_images)) brief.allowed_images = [];
  return brief;
}

export async function ingestArticle(projectRoot: string, articleId: string, inputPath: string, title: string, usedFactIds: string[], usedImagePaths?: string[]): Promise<{ article_id: string; path: string; idempotent: boolean }> {
  const brief = await loadBrief(projectRoot, articleId);
  const body = (await readFile(path.resolve(inputPath), "utf-8")).trim();
  if (!title.trim() || body.length < 120) throw new Error("article title is required and body must contain at least 120 characters");
  const used = uniq(usedFactIds.filter(Boolean));
  if (!used.length) throw new Error("at least one used fact ID is required");
  const allowed = new Set(brief.allowed_facts.map((x) => x.fact_id));
  const outside = used.filter((id) => !allowed.has(id));
  if (outside.length) throw new Error(`article uses facts outside task allowlist: ${outside.join(", ")}`);
  const allowedImages = new Set((brief.allowed_images ?? []).map((x) => x.path));
  const extracted = extractUsedImagePaths(body, brief.channel);
  const usedImages = uniq((usedImagePaths?.length ? usedImagePaths : extracted).map((x) => normalizeAssetPath(x, brief.channel)).filter((x): x is string => Boolean(x)));
  const outsideImages = usedImages.filter((imagePath) => !allowedImages.has(imagePath));
  if (outsideImages.length) throw new Error(`article uses images outside task allowlist: ${outsideImages.join(", ")}`);
  if (allowedImages.size && !usedImages.length) throw new Error("article must embed at least one allowlisted local image when allowed_images is non-empty");
  if (usedImages.length > 3) throw new Error("article may embed at most 3 allowlisted images");
  if (SENSITIVE_BODY.test(`${title}\n${body}`)) throw new Error("article contains password, token, secret, or identity-card content");
  const risks = researchRisks(brief, `${title}\n${body}`);
  if (risks.some((x) => x.severity === "block")) throw new Error(risks.map((x) => x.message).join("; "));
  const bodyPath = path.join(projectRoot, "articles", brief.channel, `${articleId}.md`);
  const metaPath = path.join(projectRoot, "articles", brief.channel, `${articleId}.meta.json`);
  const digest = sha(body);
  if (await pathExists(metaPath)) {
    const existing = await readJson<ArticleMeta>(metaPath);
    if (existing.body_sha256 === digest && existing.title === title.trim()) return { article_id: articleId, path: relToProject(projectRoot, bodyPath), idempotent: true };
    throw new Error("article draft already exists; use article revise instead of overwriting it");
  }
  for (const file of await metaFiles(projectRoot)) {
    const prior = await readJson<ArticleMeta>(file);
    if (prior.content_plan_id !== brief.content_plan_id) continue;
    if (prior.body_sha256 === digest) risks.push({ code: "duplicate_body", severity: "review", message: `正文与 ${prior.article_id} 完全重复` });
    else if (prior.title.replace(/\s+/g, "").toLowerCase() === title.replace(/\s+/g, "").toLowerCase()) risks.push({ code: "duplicate_title", severity: "review", message: `标题与 ${prior.article_id} 重复` });
  }
  const now = utcNow();
  const revision = { revision: 1, path: relToProject(projectRoot, bodyPath), sha256: digest, chars: body.length, at: now, reason: null, based_on_revision: null };
  const meta: ArticleMeta = {
    schema_version: 1,
    article_id: articleId,
    app_id: brief.app_id,
    content_plan_id: brief.content_plan_id,
    content_plan_version: brief.content_plan_version,
    task_id: brief.task_id,
    topic_id: brief.topic_id,
    faq_ids: brief.faq_ids,
    scenario_ids: brief.scenario_ids,
    question_ids: brief.question_ids,
    fact_snapshot_id: brief.fact_snapshot_id,
    channel: brief.channel,
    title: title.trim(),
    body_path: revision.path,
    body_sha256: digest,
    chars: body.length,
    used_fact_ids: used,
    used_image_paths: usedImages,
    mode: brief.mode,
    claim_boundaries: brief.claim_boundaries,
    status: "draft",
    requires_human_review: true,
    current_revision: 1,
    revisions: [revision],
    risks,
    review_history: [],
    created_at: now,
    updated_at: now,
  };
  await mkdir(path.dirname(bodyPath), { recursive: true });
  await writeFile(bodyPath, `${body}\n`, "utf-8");
  await writeJson(metaPath, meta);
  await updateGeneration(projectRoot);
  return { article_id: articleId, path: revision.path, idempotent: false };
}

export async function reviseArticle(projectRoot: string, articleId: string, inputPath: string, reason: string): Promise<ArticleMeta> {
  if (!reason.trim()) throw new Error("article revision requires a reason");
  const brief = await loadBrief(projectRoot, articleId);
  const metaPath = path.join(projectRoot, "articles", brief.channel, `${articleId}.meta.json`);
  const meta = await readJson<ArticleMeta>(metaPath);
  const body = (await readFile(path.resolve(inputPath), "utf-8")).trim();
  if (body.length < 120 || SENSITIVE_BODY.test(body)) throw new Error("revised body is too short or contains sensitive content");
  const allowedImages = new Set((brief.allowed_images ?? []).map((x) => x.path));
  const usedImages = extractUsedImagePaths(body, brief.channel);
  const outsideImages = usedImages.filter((imagePath) => !allowedImages.has(imagePath));
  if (outsideImages.length) throw new Error(`revised article uses images outside task allowlist: ${outsideImages.join(", ")}`);
  if (allowedImages.size && !usedImages.length) throw new Error("revised article must embed at least one allowlisted local image when allowed_images is non-empty");
  if (usedImages.length > 3) throw new Error("revised article may embed at most 3 allowlisted images");
  const risks = researchRisks(brief, `${meta.title}\n${body}`);
  if (risks.some((x) => x.severity === "block")) throw new Error(risks.map((x) => x.message).join("; "));
  const revision = meta.current_revision + 1;
  const revisionPath = path.join(projectRoot, "articles", "revisions", articleId, `v${revision}.md`);
  const digest = sha(body);
  await mkdir(path.dirname(revisionPath), { recursive: true });
  await writeFile(revisionPath, `${body}\n`, "utf-8");
  meta.revisions.push({ revision, path: relToProject(projectRoot, revisionPath), sha256: digest, chars: body.length, at: utcNow(), reason: reason.trim(), based_on_revision: meta.current_revision });
  meta.current_revision = revision;
  meta.body_path = relToProject(projectRoot, revisionPath);
  meta.body_sha256 = digest;
  meta.chars = body.length;
  meta.used_image_paths = usedImages;
  meta.risks = risks;
  if (meta.review_history.length) meta.status = "pending_review";
  meta.updated_at = utcNow();
  await writeJson(metaPath, meta);
  await renderDraftReview(projectRoot);
  return meta;
}

async function metaFiles(projectRoot: string): Promise<string[]> {
  const out: string[] = [];
  for (const channel of ["social", "media", "b2b", "site"]) {
    const dir = path.join(projectRoot, "articles", channel);
    if (!(await pathExists(dir))) continue;
    for (const name of await readdir(dir)) if (name.endsWith(".meta.json")) out.push(path.join(dir, name));
  }
  return out;
}

async function countDrafts(projectRoot: string, contentPlanId: string): Promise<number> {
  let count = 0;
  for (const file of await metaFiles(projectRoot)) {
    const meta = await readJson<ArticleMeta>(file);
    if (meta.content_plan_id === contentPlanId) count++;
  }
  return count;
}

async function updateGeneration(projectRoot: string): Promise<void> {
  const { manifest, plan } = await currentPlan(projectRoot);
  manifest.article_generation = {
    content_plan_id: plan.content_plan_id,
    fact_snapshot_id: plan.fact_snapshot_id,
    planned: plan.production_tasks.filter(eligible).reduce((sum, x) => sum + x.quantity, 0),
    drafted: await countDrafts(projectRoot, plan.content_plan_id),
    updated_at: utcNow(),
  };
  manifest.updated_at = manifest.article_generation.updated_at;
  await writeJson(path.join(projectRoot, "manifest.json"), manifest);
  await renderDraftReview(projectRoot);
}

export async function articleStatus(projectRoot: string): Promise<{ content_plan_id: string; planned: number; prepared: number; drafted: number; missing: number }> {
  const { plan } = await currentPlan(projectRoot);
  const planned = plan.production_tasks.filter(eligible).reduce((sum, x) => sum + x.quantity, 0);
  const workDir = path.join(projectRoot, "articles", "work");
  let prepared = 0;
  if (await pathExists(workDir)) {
    for (const name of (await readdir(workDir)).filter((x) => x.endsWith(".brief.json"))) {
      if ((await readJson<ArticleWritingBrief>(path.join(workDir, name))).content_plan_id === plan.content_plan_id) prepared++;
    }
  }
  const drafted = await countDrafts(projectRoot, plan.content_plan_id);
  return { content_plan_id: plan.content_plan_id, planned, prepared, drafted, missing: Math.max(0, planned - drafted) };
}

export async function renderDraftReview(projectRoot: string): Promise<string> {
  const status = await articleStatus(projectRoot);
  const files = await metaFiles(projectRoot);
  const metas = await Promise.all(files.map((x) => readJson<ArticleMeta>(x)));
  const current = metas.filter((x) => x.content_plan_id === status.content_plan_id).sort((a, b) => a.channel.localeCompare(b.channel) || a.article_id.localeCompare(b.article_id));
  const lines = [
    "# 文章草稿生成清单",
    "",
    "> 这里只统计 draft；没有稿件被批准、排队或发布。",
    "",
    `- 内容计划：\`${status.content_plan_id}\``,
    `- 计划 ${status.planned} 篇；已准备 ${status.prepared} 个写作包；已生成 ${status.drafted} 篇；仍缺 ${status.missing} 篇`,
    "",
  ];
  for (const meta of current) {
    const brief = await loadBrief(projectRoot, meta.article_id);
    const facts = brief.allowed_facts.filter((x) => meta.used_fact_ids.includes(x.fact_id));
    const images = (meta.used_image_paths ?? []).length
      ? meta.used_image_paths.map((imagePath) => `  - \`${imagePath}\``)
      : ["  - （未记录配图）"];
    lines.push(
      `## ${meta.title}`,
      "",
      `- Article ID：\`${meta.article_id}\``,
      `- channel：${meta.channel}；状态：draft；模式：${meta.mode}`,
      `- 字符数：${meta.chars}；当前修订：v${meta.current_revision}`,
      `- 正文：\`${meta.body_path}\``,
      "- 实际使用事实：",
      ...facts.map((x) => `  - ${x.field}：${readable(x.value)}（\`${x.fact_id}\`）`),
      "- 实际使用配图：",
      ...images,
      `- 风险：${meta.risks.map((x) => x.message).join("；") || "未发现确定性阻断；仍需人工语义审稿"}`,
      "",
    );
  }
  const draftedIds = new Set(current.map((x) => x.article_id));
  const work = path.join(projectRoot, "articles", "work");
  const missing: ArticleWritingBrief[] = [];
  if (await pathExists(work)) {
    for (const name of (await readdir(work)).filter((x) => x.endsWith(".brief.json"))) {
      const brief = await readJson<ArticleWritingBrief>(path.join(work, name));
      if (brief.content_plan_id === status.content_plan_id && !draftedIds.has(brief.article_id)) missing.push(brief);
    }
  }
  if (missing.length) {
    lines.push(
      "## 尚未生成的计划稿件",
      "",
      ...missing
        .sort((a, b) => a.channel.localeCompare(b.channel) || a.article_id.localeCompare(b.article_id))
        .map((x) => `- ${x.title_direction}｜${x.channel}｜${x.mode}｜配图 ${(x.allowed_images ?? []).length}｜\`${x.article_id}\``),
      "",
    );
  }
  await writeFile(path.join(projectRoot, "articles", "draft-review.md"), lines.join("\n"), "utf-8");
  return "articles/draft-review.md";
}

export async function draftReviewInput(projectRoot: string): Promise<ArticleMeta[]> {
  const { plan } = await currentPlan(projectRoot);
  const metas = await Promise.all((await metaFiles(projectRoot)).map((x) => readJson<ArticleMeta>(x)));
  return metas.filter((x) => x.content_plan_id === plan.content_plan_id && x.status === "draft");
}
