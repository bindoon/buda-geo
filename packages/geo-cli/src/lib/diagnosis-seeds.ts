import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { digestObject, stableId, type FactLedger, type FactRecord, type SubjectRecord } from "./fact-model.js";
import type { DiagnosisQuestion, SeedFamily, SeedSet } from "./diagnosis-model.js";
import { pathExists, readJson, relToProject, utcNow, writeJson } from "./util.js";

interface FactSnapshot {
  schema_version: number;
  fact_snapshot_id: string;
  app_id: string;
  confirmed_at: string;
  facts: FactLedger;
}

interface ManifestLike {
  app_id: string;
  gates?: { clean?: { status?: string; fact_snapshot_id?: string | null } };
}

export interface ConfirmedDiagnosisContext {
  manifest: ManifestLike;
  snapshot: FactSnapshot;
  snapshotPath: string;
}

export async function loadConfirmedDiagnosisContext(projectRoot: string): Promise<ConfirmedDiagnosisContext> {
  const manifest = await readJson<ManifestLike>(path.join(projectRoot, "manifest.json"));
  const clean = manifest.gates?.clean;
  if (clean?.status !== "confirmed" || !clean.fact_snapshot_id) {
    throw new Error("diagnosis blocked: enterprise facts are not confirmed; review clean-review.md and run confirm-clean first");
  }
  const snapshotPath = path.join(projectRoot, "knowledge", "snapshots", `${clean.fact_snapshot_id}.json`);
  if (!(await pathExists(snapshotPath))) throw new Error(`diagnosis blocked: confirmed snapshot not found: ${relToProject(projectRoot, snapshotPath)}`);
  const snapshot = await readJson<FactSnapshot>(snapshotPath);
  if (snapshot.schema_version !== 2) throw new Error(`diagnosis blocked: fact snapshot ${snapshot.fact_snapshot_id} uses unsupported schema_version ${snapshot.schema_version}; reconfirm current enterprise facts`);
  if (snapshot.fact_snapshot_id !== clean.fact_snapshot_id || snapshot.app_id !== manifest.app_id) {
    throw new Error("diagnosis blocked: manifest and fact snapshot do not match");
  }
  const unresolved = [
    ...snapshot.facts.subjects.filter((item) => item.review_status === "candidate" || item.review_status === "needs_clarification"),
    ...snapshot.facts.facts.filter((item) => item.review_status === "candidate" || item.review_status === "needs_clarification"),
  ];
  if (unresolved.length) throw new Error(`diagnosis blocked: confirmed snapshot contains ${unresolved.length} unresolved fact records`);
  return { manifest, snapshot, snapshotPath };
}

function publicFacts(snapshot: FactSnapshot): FactRecord[] {
  return snapshot.facts.facts.filter((fact) => fact.review_status === "confirmed" && fact.disclosure_level === "public");
}

function factFor(facts: FactRecord[], subjectId: string, field: string): FactRecord | undefined {
  return facts.find((fact) => fact.subject_id === subjectId && fact.field === field);
}

function companyFact(facts: FactRecord[], field: string): FactRecord | undefined {
  return facts.find((fact) => fact.field === field && typeof fact.value === "string");
}

function textValue(fact?: FactRecord): string {
  return typeof fact?.value === "string" ? fact.value.trim() : "";
}

function listValue(fact?: FactRecord): string[] {
  return Array.isArray(fact?.value) ? fact.value.filter((v): v is string => typeof v === "string" && Boolean(v.trim())) : [];
}

function addQuestion(
  target: DiagnosisQuestion[],
  family: SeedFamily,
  text: string,
  rationale: string,
  facts: FactRecord[],
  negativeRiskApproved = false,
): void {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized || target.some((question) => question.text === normalized)) return;
  const factIds = [...new Set(facts.map((fact) => fact.fact_id))];
  target.push({
    question_id: stableId("question", family, normalized, factIds),
    text: normalized,
    family,
    rationale,
    fact_ids: factIds,
    derivation: "fact_template",
    review_status: "unreviewed",
    replacement_for_question_id: null,
    negative_risk_approved: negativeRiskApproved,
  });
}

function regionFrom(address: string): string {
  const match = address.match(/(北京市|上海市|天津市|重庆市|[^省]{2,8}省[^市]{1,8}市|[^市]{2,8}市|^[^县区]{2,12}[县区])/);
  return match?.[1] ?? "";
}

function audienceHints(facts: FactRecord[]): Array<{ text: string; fact: FactRecord }> {
  const hints: Array<{ text: string; fact: FactRecord }> = [];
  for (const fact of facts.filter((item) => item.field === "pain_points" || item.field === "products_services")) {
    const values = Array.isArray(fact.value) ? fact.value : [fact.value];
    for (const value of values) {
      if (typeof value !== "string") continue;
      const match = value.match(/针对(.{2,36}?)(?:等[^，。；]{0,12})?(?:的)?(?:需求|场景|作业)/) ?? value.match(/面向(.{2,24}?)(?:客户|用户|人群)/);
      const hint = match?.[1]?.replace(/[：:，,；;。]/g, "、").replace(/、+/g, "、").replace(/^、|、$/g, "").trim();
      if (hint && hint.length <= 30 && !hints.some((item) => item.text === hint)) hints.push({ text: hint, fact });
    }
  }
  return hints.slice(0, 3);
}

function selectedProducts(subjects: SubjectRecord[], facts: FactRecord[]): Array<{ subject: SubjectRecord; name: FactRecord; category?: FactRecord; capabilities?: FactRecord }> {
  const products = subjects.filter((subject) => subject.type === "product" || subject.type === "product_family");
  const main = products.filter((subject) => factFor(facts, subject.subject_id, "is_main")?.value === true);
  const selected = main.length ? main : products.slice(0, 3);
  return selected.slice(0, 5).flatMap((subject) => {
    const name = factFor(facts, subject.subject_id, "name");
    return name ? [{ subject, name, category: factFor(facts, subject.subject_id, "category"), capabilities: factFor(facts, subject.subject_id, "capabilities") }] : [];
  });
}

function buildCandidates(snapshot: FactSnapshot): DiagnosisQuestion[] {
  const facts = publicFacts(snapshot);
  const subjects = snapshot.facts.subjects.filter((subject) => subject.review_status === "confirmed");
  const companyNameFact = companyFact(facts, "company_name");
  const shortNameFact = companyFact(facts, "company_short_name");
  const brandFact = facts.find((fact) => subjects.some((subject) => subject.subject_id === fact.subject_id && subject.type === "brand") && fact.field === "name");
  const brand = textValue(brandFact) || textValue(shortNameFact) || textValue(companyNameFact);
  const addressFact = companyFact(facts, "address");
  const region = regionFrom(textValue(addressFact));
  const profileCapabilityFacts = facts.filter((fact) => ["advantages", "trust", "products_services"].includes(fact.field));
  const products = selectedProducts(subjects, facts);
  const audiences = audienceHints(facts);
  const questions: DiagnosisQuestion[] = [];

  if (brand) {
    const refs = [shortNameFact, brandFact, companyNameFact].filter((fact): fact is FactRecord => Boolean(fact));
    addQuestion(questions, "brand_recognition", `${brand}是做什么的？`, "检查 AI 是否能正确识别企业/品牌主体。", refs);
    addQuestion(questions, "brand_recognition", `${brand}有哪些主要产品？`, "检查 AI 是否能把品牌与已确认主产品关联。", [...refs, ...products.map((item) => item.name)]);
    addQuestion(questions, "brand_recognition", `${brand}是生产厂家还是贸易商？`, "检查 AI 对企业经营角色的理解是否准确。", [...refs, ...profileCapabilityFacts]);
    addQuestion(questions, "brand_recognition", `${brand}靠谱吗？有哪些可核验依据？`, "检查 AI 是否能给出有来源的品牌信任说明。", [...refs, ...profileCapabilityFacts]);
    addQuestion(questions, "brand_recognition", `${brand}主要服务哪些客户和采购场景？`, "检查 AI 是否理解企业服务对象，而不只认识品牌名称。", [...refs, ...facts.filter((fact) => fact.field === "pain_points")]);
    addQuestion(questions, "brand_recognition", `${brand}有哪些生产、供应或定制能力？`, "检查 AI 是否能把品牌与已确认企业能力关联。", [...refs, ...profileCapabilityFacts]);
  }

  for (const product of products) {
    const productName = textValue(product.name);
    const category = textValue(product.category) || productName;
    const refs = [product.name, product.category].filter((fact): fact is FactRecord => Boolean(fact));
    addQuestion(questions, "product_consideration", `${category}怎么选？`, "检查通用品类选购回答中是否出现目标企业。", refs);
    addQuestion(questions, "product_consideration", `${productName}有哪些靠谱厂家或品牌？`, "检查目标产品的推荐可见度与竞品占位。", refs);
    addQuestion(questions, "product_consideration", `采购${productName}要重点比较哪些参数和服务？`, "检查 AI 对采购决策要素的覆盖。", [...refs, ...(product.capabilities ? [product.capabilities] : [])]);
    addQuestion(questions, "product_consideration", `${productName}适合哪些使用和采购场景？`, "检查 AI 对产品适用场景与采购对象的理解。", [...refs, ...facts.filter((fact) => fact.field === "pain_points")]);
    addQuestion(questions, "product_consideration", `${productName}的材质、规格和做工应该怎么比较？`, "检查产品细节型选购回答及目标品牌可见度。", [...refs, ...[factFor(facts, product.subject.subject_id, "attributes"), factFor(facts, product.subject.subject_id, "selling_points")].filter((fact): fact is FactRecord => Boolean(fact))]);
    for (const audience of audiences.slice(0, 1)) addQuestion(questions, "product_consideration", `${audience.text}适合选什么样的${productName}？`, "检查有企业事实线索支持的使用人群/场景问法。", [...refs, audience.fact]);
    addQuestion(questions, "supplier_capability", `能生产${productName}的源头厂家有哪些？`, "检查供应商能力型问法中的目标企业推荐情况。", [...refs, ...profileCapabilityFacts]);
    for (const capability of listValue(product.capabilities).slice(0, 4)) {
      const capabilityPhrase = capability.startsWith("支持") ? capability : `支持${capability}`;
      addQuestion(questions, "supplier_capability", `哪些${productName}厂家${capabilityPhrase}？`, "检查已确认生产/服务能力能否被 AI 找到。", [...refs, product.capabilities!]);
    }
    addQuestion(questions, "supplier_capability", `小批量采购${productName}应该怎样评估供应商？`, "检查小批量采购决策中的供应商比较与目标企业露出。", [...refs, ...(product.capabilities ? [product.capabilities] : [])]);
    addQuestion(questions, "supplier_capability", `定制${productName}要向厂家确认哪些条件？`, "检查定制能力型问题中的目标企业与竞品推荐。", [...refs, ...(product.capabilities ? [product.capabilities] : [])]);
    if (region && addressFact) {
      addQuestion(questions, "regional_procurement", `${region}${productName}供应商有哪些？`, "检查有事实支持的区域采购可见度。", [...refs, addressFact]);
      addQuestion(questions, "regional_procurement", `${region}采购${productName}怎么筛选源头厂家？`, "检查区域与供应能力组合问法。", [...refs, addressFact, ...profileCapabilityFacts]);
    }
    if (brand) {
      const brandRefs = [shortNameFact, brandFact, companyNameFact].filter((fact): fact is FactRecord => Boolean(fact));
      addQuestion(questions, "negative_risk", `${brand}的${productName}有哪些质量或售后风险？`, "经人工批准后检查 AI 是否传播与目标产品有关的负面风险。", [...brandRefs, ...refs], false);
    }
  }
  return questions;
}

function balancedSample(candidates: DiagnosisQuestion[], size: number): DiagnosisQuestion[] {
  const order: SeedFamily[] = ["brand_recognition", "product_consideration", "supplier_capability", "regional_procurement", "negative_risk"];
  const buckets = new Map(order.map((family) => [family, candidates.filter((question) => question.family === family)]));
  const selected: DiagnosisQuestion[] = [];
  while (selected.length < size) {
    let added = false;
    for (const family of order) {
      const next = buckets.get(family)?.shift();
      if (next && selected.length < size) {
        selected.push(next);
        added = true;
      }
    }
    if (!added) break;
  }
  return selected;
}

async function nextSeedVersion(projectRoot: string): Promise<number> {
  const dir = path.join(projectRoot, "diagnosis", "seed-sets");
  if (!(await pathExists(dir))) return 1;
  const files = await readdir(dir);
  let max = 0;
  for (const name of files.filter((name) => name.endsWith(".json"))) {
    try {
      const value = JSON.parse(await readFile(path.join(dir, name), "utf-8")) as { version?: number };
      max = Math.max(max, value.version ?? 0);
    } catch { /* ignore malformed historical files here; diagnosis validate reports them */ }
  }
  return max + 1;
}

export async function createSeedDraft(projectRoot: string, targetSize = 25): Promise<{ seedSet: SeedSet; path: string; reviewPath: string }> {
  if (targetSize < 5 || targetSize > 50) throw new Error("target seed size must be between 5 and 50");
  const { manifest, snapshot } = await loadConfirmedDiagnosisContext(projectRoot);
  const candidates = buildCandidates(snapshot);
  const questions = balancedSample(candidates, targetSize);
  if (questions.length < Math.min(targetSize, 20)) {
    throw new Error(`diagnosis blocked: confirmed facts only support ${questions.length} distinct seed questions; enrich or review facts before probing`);
  }
  const version = await nextSeedVersion(projectRoot);
  const createdAt = utcNow();
  const seedSetId = stableId("seed_set", manifest.app_id, snapshot.fact_snapshot_id, version, questions.map((question) => question.question_id));
  const seedSet: SeedSet = {
    schema_version: 1,
    seed_set_id: seedSetId,
    app_id: manifest.app_id,
    fact_snapshot_id: snapshot.fact_snapshot_id,
    purpose: "baseline_diagnosis_only",
    status: "draft",
    version,
    based_on_seed_set_id: null,
    created_at: createdAt,
    confirmed_at: null,
    target_size: targetSize,
    questions,
  };
  const draftPath = path.join(projectRoot, "diagnosis", "seed-draft.json");
  await writeJson(draftPath, seedSet);
  const reviewPath = await writeSeedReview(projectRoot, seedSet);
  return { seedSet, path: relToProject(projectRoot, draftPath), reviewPath: relToProject(projectRoot, reviewPath) };
}

export async function reviewSeed(projectRoot: string, questionId: string, action: "approve" | "reject" | "replace" | "edit", replacementText?: string): Promise<SeedSet> {
  const draftPath = path.join(projectRoot, "diagnosis", "seed-draft.json");
  const seedSet = await readJson<SeedSet>(draftPath);
  if (seedSet.status !== "draft") throw new Error("only a draft seed set can be reviewed");
  const question = seedSet.questions.find((item) => item.question_id === questionId);
  if (!question) throw new Error(`question not found: ${questionId}`);
  if (action === "approve") {
    question.review_status = "approved";
    if (question.family === "negative_risk") question.negative_risk_approved = true;
  } else if (action === "reject") {
    question.review_status = "rejected";
  } else {
    const text = replacementText?.trim();
    if (!text) throw new Error("replacement text is required");
    question.review_status = "replaced";
    const replacement: DiagnosisQuestion = {
      ...question,
      question_id: stableId("question", question.family, text, question.fact_ids),
      text,
      derivation: "operator",
      review_status: "approved",
      replacement_for_question_id: question.question_id,
      negative_risk_approved: question.family === "negative_risk",
    };
    seedSet.questions.push(replacement);
  }
  await writeJson(draftPath, seedSet);
  await writeSeedReview(projectRoot, seedSet);
  return seedSet;
}

export async function approveAllNonRiskSeeds(projectRoot: string): Promise<SeedSet> {
  const draftPath = path.join(projectRoot, "diagnosis", "seed-draft.json");
  const seedSet = await readJson<SeedSet>(draftPath);
  for (const question of seedSet.questions) {
    if (question.review_status === "unreviewed" && question.family !== "negative_risk") question.review_status = "approved";
  }
  await writeJson(draftPath, seedSet);
  await writeSeedReview(projectRoot, seedSet);
  return seedSet;
}

export async function confirmSeedSet(projectRoot: string): Promise<{ seedSet: SeedSet; path: string }> {
  const context = await loadConfirmedDiagnosisContext(projectRoot);
  const draftPath = path.join(projectRoot, "diagnosis", "seed-draft.json");
  const seedSet = await readJson<SeedSet>(draftPath);
  if (seedSet.fact_snapshot_id !== context.snapshot.fact_snapshot_id) throw new Error("seed draft is stale: confirmed fact snapshot changed; generate a new draft");
  const active = seedSet.questions.filter((question) => question.review_status !== "rejected" && question.review_status !== "replaced");
  const unresolved = active.filter((question) => question.review_status !== "approved" || (question.family === "negative_risk" && !question.negative_risk_approved));
  if (unresolved.length) throw new Error(`seed confirmation blocked: ${unresolved.length} active questions still require review`);
  if (active.length < 5) throw new Error("seed confirmation blocked: fewer than 5 approved questions");
  seedSet.status = "confirmed";
  seedSet.confirmed_at = utcNow();
  seedSet.seed_set_id = stableId("seed_set", seedSet.app_id, seedSet.fact_snapshot_id, seedSet.version, digestObject(active));
  const out = path.join(projectRoot, "diagnosis", "seed-sets", `${seedSet.seed_set_id}.json`);
  if (!(await pathExists(out))) await writeJson(out, seedSet);
  await writeJson(draftPath, seedSet);
  await writeSeedReview(projectRoot, seedSet);
  return { seedSet, path: relToProject(projectRoot, out) };
}

export async function reviseSeedSet(projectRoot: string, seedSetId: string): Promise<{ seedSet: SeedSet; path: string; reviewPath: string }> {
  const context = await loadConfirmedDiagnosisContext(projectRoot);
  const sourcePath = path.join(projectRoot, "diagnosis", "seed-sets", `${seedSetId}.json`);
  const source = await readJson<SeedSet>(sourcePath);
  if (source.status !== "confirmed") throw new Error("only a confirmed seed set can start a revision");
  if (source.fact_snapshot_id !== context.snapshot.fact_snapshot_id) throw new Error("seed revision blocked: source seed set uses a stale fact snapshot; generate a fresh draft instead");
  const version = await nextSeedVersion(projectRoot);
  const questions = source.questions
    .filter((question) => question.review_status !== "rejected" && question.review_status !== "replaced")
    .map((question) => ({ ...question, review_status: "unreviewed" as const, negative_risk_approved: false }));
  const seedSet: SeedSet = {
    ...source,
    seed_set_id: stableId("seed_set", source.app_id, source.fact_snapshot_id, version, "draft-revision", seedSetId),
    status: "draft",
    version,
    based_on_seed_set_id: seedSetId,
    created_at: utcNow(),
    confirmed_at: null,
    questions,
  };
  const draftPath = path.join(projectRoot, "diagnosis", "seed-draft.json");
  await writeJson(draftPath, seedSet);
  const reviewPath = await writeSeedReview(projectRoot, seedSet);
  return { seedSet, path: relToProject(projectRoot, draftPath), reviewPath: relToProject(projectRoot, reviewPath) };
}

export async function writeSeedReview(projectRoot: string, seedSet?: SeedSet): Promise<string> {
  const value = seedSet ?? await readJson<SeedSet>(path.join(projectRoot, "diagnosis", "seed-draft.json"));
  const labels: Record<SeedFamily, string> = {
    brand_recognition: "品牌/主体认知",
    product_consideration: "产品选择",
    supplier_capability: "供应商能力",
    regional_procurement: "地区/采购",
    negative_risk: "负面风险（必须单题批准）",
  };
  const lines = [
    `# ${path.basename(projectRoot)} · 基线诊断种子题复核`,
    "",
    "> 这些问题只用于测试 AI 当前如何理解和推荐企业，不是关键词库，也不会自动生成文章。",
    "",
    `- 事实快照：\`${value.fact_snapshot_id}\``,
    `- 种子版本：v${value.version}（${value.status}）`,
    `- 题目：${value.questions.filter((q) => !["rejected", "replaced"].includes(q.review_status)).length} 条有效候选`,
    "",
    "复核动作：逐题 approve / reject / edit / replace；edit/replace 都会保留原题并新增替代题，负面风险题必须逐题明确批准。",
  ];
  for (const family of Object.keys(labels) as SeedFamily[]) {
    const questions = value.questions.filter((question) => question.family === family);
    if (!questions.length) continue;
    lines.push("", `## ${labels[family]}`, "", "| 状态 | 问题 | 为什么测 | 事实依据 | ID |", "|---|---|---|---|---|");
    for (const q of questions) lines.push(`| ${q.review_status} | ${q.text.replace(/\|/g, "\\|")} | ${q.rationale.replace(/\|/g, "\\|")} | ${q.fact_ids.join("、")} | \`${q.question_id}\` |`);
  }
  lines.push("", "## 确认条件", "", "- 所有保留题必须为 `approved`。", "- 负面风险题还必须是 `negative_risk_approved=true`。", "- 确认后生成不可变 seed set；之后修改会产生新版本。", "");
  const out = path.join(projectRoot, "diagnosis", "seed-review.md");
  await mkdir(path.dirname(out), { recursive: true });
  await import("node:fs/promises").then(({ writeFile }) => writeFile(out, lines.join("\n"), "utf-8"));
  return out;
}
