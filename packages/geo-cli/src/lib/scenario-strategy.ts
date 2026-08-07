import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { diagnosisGapInput } from "./diagnosis-report.js";
import { loadConfirmedDiagnosisContext } from "./diagnosis-seeds.js";
import { stableId } from "./fact-model.js";
import type { FactRecord, SubjectRecord } from "./fact-model.js";
import { parseKeywords, type KeywordsJson } from "./parse.js";
import type {
  CustomerScenario,
  LegacyKeywordAudit,
  LegacyKeywordCandidate,
  QuestionFacets,
  RepresentativeQuestion,
  ScenarioEvidenceGap,
  ScenarioLibrary,
  ScenarioPriority,
  ScenarioSourceReference,
  SemanticMergeSuggestion,
} from "./scenario-model.js";
import { pathExists, readJson, relToProject, utcNow, writeJson } from "./util.js";

type ScenarioAction = "approve" | "reject" | "defer" | "edit";
type GapAction = "accept" | "defer" | "resolve";

interface ConfirmedGapArtifact {
  schema_version: 1;
  report_id: string;
  status: "confirmed";
  confirmed_at: string;
  gaps: Array<{ gap_id: string; kind: string; severity: string; observed_issue: string }>;
}

interface OperatorInput {
  questions?: Array<{ text: string; target_customer?: string; need?: string; concerns?: string[]; fact_ids?: string[] }>;
  priority_hints?: Array<{ scenario_name: string; score: number; reason: string }>;
}

export function normalizeScenarioText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function unique<T>(values: T[]): T[] { return [...new Set(values)]; }
function stringValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "number") return [String(value)];
  if (typeof value === "boolean") return [value ? "是" : "否"];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).flatMap(stringValues);
  return [];
}

function sourceRef(args: Omit<ScenarioSourceReference, "source_ref_id">): ScenarioSourceReference {
  return { source_ref_id: stableId("scenario_source", args), ...args };
}

function factRef(fact: FactRecord): ScenarioSourceReference {
  return sourceRef({ kind: "fact", ref_id: fact.fact_id, path: null, original_bucket: null, text: stringValues(fact.value).join("；") || null, derivation: fact.derivation === "operator" ? "operator" : fact.derivation === "extracted" ? "extracted" : "derived" });
}

function tier(score: number): "high" | "medium" | "low" { return score >= 18 ? "high" : score >= 12 ? "medium" : "low"; }
function priority(args: { business: number; diagnosis: number; evidence: number; customer: number; operator?: number; rationale: string[] }): ScenarioPriority {
  const components = { business_value: args.business, diagnosis_gap: args.diagnosis, evidence_readiness: args.evidence, customer_language: args.customer, operator_judgment: args.operator ?? 0 };
  const calculated = Object.values(components).reduce((sum, value) => sum + value, 0);
  return { components, calculated_total: calculated, final_score: calculated, tier: tier(calculated), rationale: args.rationale, override: null };
}

function wording(text: string): QuestionFacets["wording_form"] {
  if (/风险|质量问题|售后问题|避雷/.test(text)) return "risk";
  if (/哪家|哪些|推荐|靠谱|厂家/.test(text)) return "recommendation";
  if (/怎么|如何|怎样/.test(text)) return "how_to";
  if (/比较|区别|还是/.test(text)) return "comparison";
  return "direct_question";
}

function question(args: { text: string; facts: FactRecord[]; targetStage: QuestionFacets["decision_stage"]; regions?: string[]; productIds?: string[]; capabilities?: string[]; constraints?: string[]; sources?: ScenarioSourceReference[] }): RepresentativeQuestion {
  const normalized = normalizeScenarioText(args.text);
  const refs = [...args.facts.map(factRef), ...(args.sources ?? [])];
  return {
    question_id: stableId("scenario_question", normalized, args.targetStage, args.regions ?? [], args.capabilities ?? [], args.constraints ?? []),
    text: args.text,
    normalized_text: normalized,
    facets: {
      wording_form: wording(args.text), regions: unique(args.regions ?? []), decision_stage: args.targetStage,
      direction: /风险|问题|避雷/.test(args.text) ? "negative" : "neutral",
      product_subject_ids: unique(args.productIds ?? []), capability_terms: unique(args.capabilities ?? []), constraints: unique(args.constraints ?? []),
    },
    fact_ids: unique(args.facts.map((fact) => fact.fact_id)), evidence_gap_ids: [], source_refs: uniqueRefs(refs),
  };
}

function uniqueRefs(refs: ScenarioSourceReference[]): ScenarioSourceReference[] {
  return [...new Map(refs.map((ref) => [ref.source_ref_id, ref])).values()];
}

function exactDedupe(questions: RepresentativeQuestion[]): RepresentativeQuestion[] {
  const out = new Map<string, RepresentativeQuestion>();
  for (const item of questions) {
    const existing = out.get(item.normalized_text);
    if (!existing) { out.set(item.normalized_text, item); continue; }
    existing.fact_ids = unique([...existing.fact_ids, ...item.fact_ids]);
    existing.source_refs = uniqueRefs([...existing.source_refs, ...item.source_refs]);
    existing.facets.regions = unique([...existing.facets.regions, ...item.facets.regions]);
    existing.facets.capability_terms = unique([...existing.facets.capability_terms, ...item.facets.capability_terms]);
    existing.facets.constraints = unique([...existing.facets.constraints, ...item.facets.constraints]);
  }
  return [...out.values()];
}

function charBigrams(text: string): Set<string> {
  const normalized = normalizeScenarioText(text); const result = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index++) result.add(normalized.slice(index, index + 2));
  return result;
}

function similarity(a: string, b: string): number {
  const left = charBigrams(a); const right = charBigrams(b);
  if (!left.size || !right.size) return normalizeScenarioText(a) === normalizeScenarioText(b) ? 1 : 0;
  const intersection = [...left].filter((item) => right.has(item)).length;
  return intersection / (left.size + right.size - intersection);
}

function meaningfulDifferences(a: CustomerScenario, b: CustomerScenario): string[] {
  const differences: string[] = [];
  if (normalizeScenarioText(a.target_customer) !== normalizeScenarioText(b.target_customer)) differences.push(`目标客户不同：${a.target_customer} / ${b.target_customer}`);
  const regionA = unique(a.representative_questions.flatMap((item) => item.facets.regions)).sort().join("|");
  const regionB = unique(b.representative_questions.flatMap((item) => item.facets.regions)).sort().join("|");
  if (regionA !== regionB) differences.push(`地区条件不同：${regionA || "全国"} / ${regionB || "全国"}`);
  const capabilityA = unique(a.representative_questions.flatMap((item) => item.facets.capability_terms)).sort().join("|");
  const capabilityB = unique(b.representative_questions.flatMap((item) => item.facets.capability_terms)).sort().join("|");
  if (capabilityA !== capabilityB) differences.push("现货/定制或供应能力条件不同");
  return differences;
}

export function semanticSuggestions(scenarios: CustomerScenario[]): SemanticMergeSuggestion[] {
  const suggestions: SemanticMergeSuggestion[] = [];
  for (let i = 0; i < scenarios.length; i++) for (let j = i + 1; j < scenarios.length; j++) {
    const left = scenarios[i]; const right = scenarios[j];
    const score = similarity(`${left.name}${left.customer_need}`, `${right.name}${right.customer_need}`);
    if (score < 0.52) continue;
    const differences = meaningfulDifferences(left, right);
    suggestions.push({ suggestion_id: stableId("merge_suggestion", "scenario", left.scenario_id, right.scenario_id), item_type: "scenario", item_ids: [left.scenario_id, right.scenario_id], reason: "名称与客户需求存在语义重叠，需运营判断是否合并。", similarity: Number(score.toFixed(4)), meaningful_differences: differences, status: "pending", review_reason: null });
  }
  for (const scenario of scenarios) for (let i = 0; i < scenario.representative_questions.length; i++) for (let j = i + 1; j < scenario.representative_questions.length; j++) {
    const left = scenario.representative_questions[i]; const right = scenario.representative_questions[j]; const score = similarity(left.text, right.text);
    if (score < 0.58 || left.normalized_text === right.normalized_text) continue;
    const differences: string[] = [];
    if (left.facets.decision_stage !== right.facets.decision_stage) differences.push(`决策阶段不同：${left.facets.decision_stage} / ${right.facets.decision_stage}`);
    if ([...left.facets.regions].sort().join("|") !== [...right.facets.regions].sort().join("|")) differences.push("地区条件不同");
    if ([...left.facets.capability_terms].sort().join("|") !== [...right.facets.capability_terms].sort().join("|")) differences.push("能力条件不同");
    suggestions.push({ suggestion_id: stableId("merge_suggestion", "question", left.question_id, right.question_id), item_type: "question", item_ids: [left.question_id, right.question_id], reason: "同一场景内的代表问题存在语义重叠，需运营判断是否合并。", similarity: Number(score.toFixed(4)), meaningful_differences: differences, status: "pending", review_reason: null });
  }
  return suggestions;
}

async function loadContext(projectRoot: string): Promise<{ context: Awaited<ReturnType<typeof loadConfirmedDiagnosisContext>>; gapPath: string; gaps: ConfirmedGapArtifact }> {
  const context = await loadConfirmedDiagnosisContext(projectRoot);
  const gate = (context.manifest as Record<string, any>).gates?.diagnose;
  if (gate?.status !== "confirmed" || !gate.report_id) throw new Error("scenario generation blocked: baseline diagnosis is not confirmed");
  if (gate.fact_snapshot_id !== context.snapshot.fact_snapshot_id) throw new Error("scenario generation blocked: diagnosis references a stale fact snapshot");
  const gapPath = await diagnosisGapInput(projectRoot);
  const gaps = await readJson<ConfirmedGapArtifact>(path.join(projectRoot, gapPath));
  if (gaps.status !== "confirmed" || gaps.report_id !== gate.report_id) throw new Error("scenario generation blocked: confirmed diagnosis gap artifact mismatch");
  return { context, gapPath, gaps };
}

function flattenLegacy(value: KeywordsJson): Array<{ bucket: string; text: string }> {
  const out: Array<{ bucket: string; text: string }> = [];
  for (const [group, data] of Object.entries(value)) {
    if (!["brand", "search", "qa", "intent"].includes(group) || !data || typeof data !== "object") continue;
    for (const [field, items] of Object.entries(data as Record<string, unknown>)) if (Array.isArray(items)) {
      for (const item of items) if (typeof item === "string" && item.trim()) out.push({ bucket: `${group}.${field}`, text: item.trim() });
    }
  }
  return out;
}

export async function importLegacyKeywords(projectRoot: string, inputPath: string): Promise<{ audit: LegacyKeywordAudit; jsonPath: string; markdownPath: string }> {
  const { context } = await loadContext(projectRoot);
  const absolute = path.resolve(inputPath);
  const value = /\.xlsx?$/i.test(absolute) ? parseKeywords(absolute, context.manifest.app_id) : await readJson<KeywordsJson>(absolute);
  if (value.app_id && value.app_id !== context.manifest.app_id) throw new Error("legacy keywords app_id mismatch");
  const rel = absolute.startsWith(projectRoot) ? relToProject(projectRoot, absolute) : absolute;
  const rows = flattenLegacy(value);
  const firstByNormalized = new Map<string, string>();
  const bucketsByNormalized = new Map<string, Set<string>>();
  for (const row of rows) {
    const normalized = normalizeScenarioText(row.text);
    if (!bucketsByNormalized.has(normalized)) bucketsByNormalized.set(normalized, new Set());
    bucketsByNormalized.get(normalized)!.add(row.bucket);
  }
  const publicFactText = context.snapshot.facts.facts.filter((fact) => fact.review_status === "confirmed" && fact.disclosure_level === "public").flatMap((fact) => stringValues(fact.value)).join(" ");
  const candidates: LegacyKeywordCandidate[] = rows.map((row) => {
    const normalized = normalizeScenarioText(row.text);
    const candidateId = stableId("legacy_candidate", rel, row.bucket, normalized);
    const duplicate = firstByNormalized.get(normalized) ?? null;
    if (!duplicate) firstByNormalized.set(normalized, candidateId);
    const ref = sourceRef({ kind: "legacy_keyword", ref_id: candidateId, path: rel, original_bucket: row.bucket, text: row.text, derivation: "legacy" });
    return { candidate_id: candidateId, text: row.text, normalized_text: normalized, original_bucket: row.bucket, source_path: rel, source_refs: [ref], duplicate_of_candidate_id: duplicate, cross_bucket_with: [...(bucketsByNormalized.get(normalized) ?? [])].filter((bucket) => bucket !== row.bucket), evidence_status: "unreviewed" };
  });
  const unsupported = candidates.filter((item) => !publicFactText.includes(item.text) && !stringValues(publicFactText).some((text) => normalizeScenarioText(text).includes(item.normalized_text))).length;
  const audit: LegacyKeywordAudit = { schema_version: 1, app_id: context.manifest.app_id, generated_at: utcNow(), source_path: rel, candidates, counts: { total: candidates.length, unique: firstByNormalized.size, exact_duplicates: candidates.filter((item) => item.duplicate_of_candidate_id).length, cross_bucket: candidates.filter((item) => item.cross_bucket_with.length).length, unsupported } };
  const json = path.join(projectRoot, "strategy", "legacy", "keyword-audit.json");
  const markdown = path.join(projectRoot, "strategy", "legacy", "keyword-audit.md");
  await writeJson(json, audit);
  await writeFile(markdown, `# 旧词库候选审计\n\n> 旧 brand/search/qa/intent 只作为未确认来源候选，不是正式场景库。\n\n- 原始条目：${audit.counts.total}\n- 规范化唯一：${audit.counts.unique}\n- 精确重复：${audit.counts.exact_duplicates}\n- 跨桶重叠：${audit.counts.cross_bucket}\n- 未直接匹配已确认事实：${audit.counts.unsupported}\n\n| 原桶 | 条目 | 重复 | 跨桶 |\n|---|---|---|---|\n${candidates.map((item) => `| ${item.original_bucket} | ${item.text.replace(/\|/g, "\\|")} | ${item.duplicate_of_candidate_id ? "是" : "否"} | ${item.cross_bucket_with.join("、") || "—"} |`).join("\n")}\n`, "utf-8");
  return { audit, jsonPath: relToProject(projectRoot, json), markdownPath: relToProject(projectRoot, markdown) };
}

function findFacts(facts: FactRecord[], ...fields: string[]): FactRecord[] { return facts.filter((fact) => fields.includes(fact.field)); }
function firstString(facts: FactRecord[], field: string, fallback: string): string { return stringValues(facts.find((fact) => fact.field === field)?.value)[0] ?? fallback; }
function extractTargets(texts: string[]): string[] {
  const joined = texts.join("，");
  const matches = joined.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,12}(?:培训机构|机构|卖家|外贸客户|采购方|幼儿园|摄影|渠道|消费者|用户)/g) ?? [];
  return unique(matches.map((item) => item.replace(/^.*?面向/, "").replace(/^服务/, ""))).slice(0, 5);
}
function regionFromAddress(address: string): string[] {
  const province = address.match(/([\u4e00-\u9fa5]{2,8}省)/)?.[1]; const city = address.match(/([\u4e00-\u9fa5]{2,8}市)/)?.[1]; const county = address.match(/([\u4e00-\u9fa5]{2,8}(?:县|区))/)?.[1];
  return unique([province, city, county].filter((item): item is string => Boolean(item)));
}

async function customerLanguageQuestions(projectRoot: string, sourceIndex: Record<string, any>): Promise<Array<{ text: string; source: ScenarioSourceReference }>> {
  const out: Array<{ text: string; source: ScenarioSourceReference }> = [];
  const sources = (sourceIndex.sources ?? []).filter((item: Record<string, any>) => item.kind === "chat_logs" && !item.ignored && /\.(txt|md)$/i.test(item.path));
  for (const source of sources) {
    const absolute = path.join(projectRoot, source.path);
    if (!(await pathExists(absolute))) continue;
    const raw = await readFile(absolute, "utf-8");
    const chunks = raw.split(/[\r\n]+/).flatMap((line) => line.split(/(?<=[？?])/));
    for (const chunk of chunks) {
      const text = chunk.replace(/^(客户|买家|客服|问|问题|咨询)[：:\s-]*/i, "").trim();
      if (text.length < 4 || text.length > 120 || !/[？?]|怎么|如何|哪家|哪些|能否|可以|是否|有没有|多少|几天|多久|支持/.test(text)) continue;
      if (/1[3-9]\d{9}|\b\d{12,}\b|@[A-Za-z0-9.-]+|订单号|身份证|收货地址/.test(text)) continue;
      const ref = sourceRef({ kind: "customer_language", ref_id: stableId("customer_language", source.source_id, normalizeScenarioText(text)), path: source.path, original_bucket: null, text, derivation: "extracted" });
      out.push({ text, source: ref });
    }
  }
  return [...new Map(out.map((item) => [normalizeScenarioText(item.text), item])).values()].slice(0, 30);
}

function makeScenario(args: { key: string; name: string; target: string; need: string; concerns: string[]; questions: RepresentativeQuestion[]; facts: FactRecord[]; sources?: ScenarioSourceReference[]; actionUrl?: string | null; priority: ScenarioPriority; gaps?: ScenarioEvidenceGap[] }): CustomerScenario {
  const scenarioId = stableId("scenario", args.key, args.target, args.need);
  const questions = exactDedupe(args.questions);
  const gaps = (args.gaps ?? []).map((gap) => ({ ...gap, scenario_id: scenarioId }));
  return { scenario_id: scenarioId, name: args.name, target_customer: args.target, customer_need: args.need, concerns: unique(args.concerns.filter(Boolean)), representative_questions: questions, supporting_fact_ids: unique(args.facts.map((fact) => fact.fact_id)), evidence_gaps: gaps, source_refs: uniqueRefs([...args.facts.map(factRef), ...(args.sources ?? [])]), desired_next_action: args.actionUrl ? { type: "visit_shop", label: "查看公开店铺并进一步咨询", url: args.actionUrl } : null, priority: args.priority, review_status: "unreviewed", review_note: null };
}

function evidenceForCandidate(text: string, facts: FactRecord[]): { facts: FactRecord[]; unsupported: string[] } {
  const unsupported: string[] = [];
  const selected = new Map<string, FactRecord>();
  const addFields = (...fields: string[]) => facts.filter((fact) => fields.includes(fact.field)).forEach((fact) => selected.set(fact.fact_id, fact));
  addFields("name", "category", "company_name", "company_short_name");
  if (/定制|logo|配色|尺码|裙摆|混批|小批量|试单|起订|生产|厂家|工厂/i.test(text)) addFields("capabilities", "products_services", "advantages");
  if (/材质|面料|网纱|里衬|做工|锁边|尺码|规格|年龄/.test(text)) addFields("attributes", "selling_points");
  if (/售后|退换|补发|发货/.test(text)) addFields("products_services");
  if (/山东|菏泽|曹县|地区|本地/.test(text)) addFields("address");
  if (/公司|品牌|靠谱|核验/.test(text)) addFields("trust", "website_or_shop_url", "intro");
  if (/性价比|便宜|最低价|价格实惠|销量|复购|口碑|哪家强|最好|质量好|交货准时|快速定制|几天|多久/.test(text)) unsupported.push("问题包含当前事实无法证明的价格、排名、销量、口碑、质量结论或时效承诺");
  if (/哪家好|值得信赖|值得买|好评|信誉好|有保障|包装好|设计多样|经典款|甜美风|优雅风|做工好|设计好|款式多|颜色选择多|挺括有型|层次感好|舒适度好|实惠又好|服务好|做工精细|尺码全/.test(text)) unsupported.push("问题包含当前事实无法直接证明的主观比较或营销结论");
  if (/(单件|一件).*(定制)|定制.*(单件|一件)/.test(text) && !facts.some((fact) => stringValues(fact.value).some((value) => /(单件|一件).*(定制)|定制.*(单件|一件)/.test(value)))) unsupported.push("已确认事实分别支持一件起混批和定制，但不能据此推断支持单件定制");
  if (/多少钱|价格|报价/.test(text) && !facts.some((fact) => /price|价格|报价/.test(fact.field))) unsupported.push("缺少已确认价格事实");
  if (/几天|多久|交期|交货时间/.test(text) && !facts.some((fact) => /lead_time|交期|时效/.test(fact.field))) unsupported.push("缺少已确认交付时效事实");
  return { facts: [...selected.values()], unsupported: unique(unsupported) };
}

export async function generateScenarioDraft(projectRoot: string, operatorInputPath?: string): Promise<{ library: ScenarioLibrary; jsonPath: string; reviewPath: string }> {
  const { context, gapPath, gaps } = await loadContext(projectRoot);
  const allFacts = context.snapshot.facts.facts.filter((fact) => fact.review_status === "confirmed" && fact.disclosure_level === "public");
  const subjects = context.snapshot.facts.subjects.filter((subject) => subject.review_status === "confirmed");
  const productSubject = subjects.find((subject) => subject.type === "product" || subject.type === "product_family");
  const productFacts = productSubject ? allFacts.filter((fact) => fact.subject_id === productSubject.subject_id) : [];
  const companyFacts = allFacts.filter((fact) => !productSubject || fact.subject_id !== productSubject.subject_id);
  const brand = firstString(companyFacts, "company_short_name", firstString(companyFacts, "company_name", (context.manifest as Record<string, any>).project_name ?? path.basename(projectRoot)));
  const product = firstString(productFacts, "name", firstString(productFacts, "category", "主要产品"));
  const category = firstString(productFacts, "category", product);
  const address = firstString(companyFacts, "address", ""); const regions = regionFromAddress(address);
  const actionUrl = firstString(companyFacts, "website_or_shop_url", "") || null;
  const capabilities = findFacts(productFacts, "capabilities"); const capabilityTerms = capabilities.flatMap((fact) => stringValues(fact.value));
  const attributes = findFacts(productFacts, "attributes", "selling_points"); const detailTerms = attributes.flatMap((fact) => stringValues(fact.value));
  const profileFacts = findFacts(companyFacts, "intro", "products_services", "advantages", "pain_points", "trust");
  const targets = extractTargets(profileFacts.flatMap((fact) => stringValues(fact.value)));
  const primaryTarget = targets[0] ?? "目标采购客户";
  const diagnosisUsable = !gaps.gaps.some((gap) => gap.kind === "probe_coverage" && gap.severity === "high");
  const gapSources = gaps.gaps.map((gap) => sourceRef({ kind: "diagnosis_gap", ref_id: gap.gap_id, path: gapPath, original_bucket: null, text: gap.observed_issue, derivation: "derived" }));
  const productCore = [...productFacts, ...findFacts(companyFacts, "products_services", "advantages", "pain_points")];
  const scenarios: CustomerScenario[] = [];

  scenarios.push(makeScenario({ key: "product_selection", name: `${category}选购与适用场景`, target: primaryTarget, need: `根据实际使用和采购场景选择合适的${product}`, concerns: detailTerms.slice(0, 6), facts: productCore, actionUrl, sources: gapSources, priority: priority({ business: 5, diagnosis: diagnosisUsable ? 3 : 0, evidence: 5, customer: 2, rationale: ["主产品选购属于核心业务问题", diagnosisUsable ? "诊断提供可见度缺口" : "诊断无有效回答，不增加诊断分", "已有产品结构与适用场景事实"] }), questions: [
    question({ text: `${product}怎么选？`, facts: productCore, targetStage: "consideration", productIds: productSubject ? [productSubject.subject_id] : [], constraints: detailTerms.slice(0, 4), sources: gapSources }),
    question({ text: `${product}适合哪些使用和采购场景？`, facts: productCore, targetStage: "consideration", productIds: productSubject ? [productSubject.subject_id] : [], constraints: detailTerms.slice(0, 4), sources: gapSources }),
    question({ text: `采购${product}要重点比较哪些材质、规格和做工？`, facts: [...productFacts, ...attributes], targetStage: "purchase", productIds: productSubject ? [productSubject.subject_id] : [], constraints: detailTerms.slice(0, 6), sources: gapSources }),
  ] }));

  if (capabilityTerms.some((item) => /小批量|混批|试单/.test(item))) scenarios.push(makeScenario({ key: "small_batch", name: `${product}小批量试单`, target: "B端采购客户", need: `先以混批或小批量方式验证${product}的产品与供应配合`, concerns: ["起订与混批条件", "供货稳定性", "发货与售后"], facts: [...productFacts, ...findFacts(companyFacts, "products_services", "advantages")], actionUrl, sources: gapSources, priority: priority({ business: 5, diagnosis: 0, evidence: 5, customer: 3, rationale: ["小批量试单直接影响采购转化", "已确认企业支持混批与小批量试单"] }), questions: [
    question({ text: `哪些${product}厂家支持一件起混批与小批量试单？`, facts: capabilities, targetStage: "supplier_selection", productIds: productSubject ? [productSubject.subject_id] : [], capabilities: capabilityTerms, constraints: ["小批量试单", "混批"], sources: gapSources }),
    question({ text: `小批量采购${product}应该怎样评估供应商？`, facts: [...capabilities, ...profileFacts], targetStage: "supplier_selection", productIds: productSubject ? [productSubject.subject_id] : [], capabilities: capabilityTerms, constraints: ["小批量试单", "供货与售后"], sources: gapSources }),
  ] }));

  if (capabilityTerms.some((item) => /定制|OEM|ODM|logo/i.test(item))) scenarios.push(makeScenario({ key: "customization", name: `${product}机构定制`, target: targets.find((item) => /机构|幼儿园/.test(item)) ?? "机构采购客户", need: `按机构活动、课程或演出需要定制${product}`, concerns: capabilityTerms.filter((item) => /定制|LOGO|配色|尺码|裙摆|饰品/i.test(item)), facts: [...capabilities, ...findFacts(companyFacts, "products_services", "advantages")], actionUrl, sources: gapSources, priority: priority({ business: 5, diagnosis: 0, evidence: 5, customer: 3, rationale: ["定制是已确认的差异化供应能力", "机构采购具有明确转化意图"] }), questions: [
    question({ text: `哪些${product}厂家支持机构 LOGO、配色、规格和尺码定制？`, facts: capabilities, targetStage: "supplier_selection", productIds: productSubject ? [productSubject.subject_id] : [], capabilities: capabilityTerms, constraints: capabilityTerms, sources: gapSources }),
    question({ text: `定制${product}要向厂家确认哪些条件？`, facts: [...capabilities, ...profileFacts], targetStage: "purchase", productIds: productSubject ? [productSubject.subject_id] : [], capabilities: capabilityTerms, constraints: ["款式", "配色", "尺码", "交付", "售后"], sources: gapSources }),
  ] }));

  if (regions.length) scenarios.push(makeScenario({ key: "regional_supplier", name: `${regions.join("")} ${product}供应商筛选`, target: "区域采购与渠道客户", need: `在${regions.join("")}筛选具备事实依据的${product}供应商`, concerns: ["是否为生产供应主体", "产品与定制能力", "公开经营触点"], facts: [...productFacts, ...findFacts(companyFacts, "address", "website_or_shop_url", "trust", "advantages")], actionUrl, sources: gapSources, priority: priority({ business: 4, diagnosis: 0, evidence: 4, customer: 2, rationale: ["地区采购问法有地址事实支持", "区域限定与全国推荐场景保持独立"] }), questions: [
    question({ text: `${regions.join("")}${product}供应商有哪些？`, facts: [...productFacts, ...findFacts(companyFacts, "address")], targetStage: "supplier_selection", regions, productIds: productSubject ? [productSubject.subject_id] : [], sources: gapSources }),
    question({ text: `${regions.join("")}采购${product}怎么筛选源头厂家？`, facts: [...productFacts, ...findFacts(companyFacts, "address", "advantages", "trust")], targetStage: "supplier_selection", regions, productIds: productSubject ? [productSubject.subject_id] : [], capabilities: capabilityTerms, sources: gapSources }),
  ] }));

  scenarios.push(makeScenario({ key: "brand_verification", name: `${brand}企业与供应能力核验`, target: "首次接触品牌的采购客户", need: `核验${brand}的企业身份、主营产品、供应能力和公开经营触点`, concerns: ["企业与品牌是否对应", "主营产品", "供应与定制能力", "可核验来源"], facts: [...companyFacts, ...productFacts], actionUrl, sources: gapSources, priority: priority({ business: 4, diagnosis: 0, evidence: 5, customer: 2, rationale: ["品牌核验影响供应商信任", diagnosisUsable ? "诊断可辅助排序" : "当前诊断仅有探测覆盖缺口，不能推断品牌表现"] }), questions: [
    question({ text: `${brand}是做什么的？`, facts: [...findFacts(companyFacts, "company_name", "company_short_name", "intro"), ...findFacts(productFacts, "name", "category")], targetStage: "awareness", productIds: productSubject ? [productSubject.subject_id] : [], sources: gapSources }),
    question({ text: `${brand}靠谱吗？有哪些可核验依据？`, facts: [...findFacts(companyFacts, "company_name", "website_or_shop_url", "trust"), ...productFacts], targetStage: "supplier_selection", productIds: productSubject ? [productSubject.subject_id] : [], sources: gapSources }),
  ] }));

  const legacyPath = path.join(projectRoot, "strategy", "legacy", "keyword-audit.json");
  if (await pathExists(legacyPath)) {
    const audit = await readJson<LegacyKeywordAudit>(legacyPath);
    const active = audit.candidates.filter((item) => !item.duplicate_of_candidate_id && /[?？吗呢]|怎么|如何|哪家|哪些|推荐|靠谱|采购|定制|供应/.test(item.text)).slice(0, 60);
    const legacyCounts = new Map<string, number>();
    for (const candidate of active) {
      const match = /小批量|混批|起订|试单/.test(candidate.text) ? scenarios.find((scenario) => scenario.name.includes("试单"))
        : /定制|LOGO|配色|尺寸|尺码|裙摆/.test(candidate.text) ? scenarios.find((scenario) => scenario.name.includes("定制"))
          : regions.some((region) => candidate.text.includes(region.replace(/[省市县区]$/, ""))) ? scenarios.find((scenario) => scenario.name.includes("供应商筛选"))
            : candidate.text.includes(brand) ? scenarios.find((scenario) => scenario.name.includes("企业与供应能力核验"))
              : scenarios.find((scenario) => scenario.name.includes("选购与适用场景"));
      if (!match) continue;
      if ((legacyCounts.get(match.scenario_id) ?? 0) >= 2) continue;
      const evidence = evidenceForCandidate(candidate.text, allFacts.filter((fact) => match.supporting_fact_ids.includes(fact.fact_id)));
      if (evidence.unsupported.length || !evidence.facts.length) continue;
      const legacyQuestion = question({ text: candidate.text, facts: evidence.facts, targetStage: /采购|厂家|供应/.test(candidate.text) ? "supplier_selection" : "consideration", regions: regions.filter((region) => candidate.text.includes(region.replace(/[省市县区]$/, ""))), productIds: productSubject ? [productSubject.subject_id] : [], sources: candidate.source_refs });
      match.representative_questions = exactDedupe([...match.representative_questions, legacyQuestion]);
      match.source_refs = uniqueRefs([...match.source_refs, ...candidate.source_refs]);
      match.priority.components.customer_language = Math.max(match.priority.components.customer_language, 4);
      match.priority.calculated_total = Object.values(match.priority.components).reduce((sum, value) => sum + value, 0);
      match.priority.final_score = match.priority.calculated_total; match.priority.tier = tier(match.priority.final_score);
      if (!match.priority.rationale.includes("关联了客户提供的旧问题/词表候选；仍需人工复核")) match.priority.rationale.push("关联了客户提供的旧问题/词表候选；仍需人工复核");
      legacyCounts.set(match.scenario_id, (legacyCounts.get(match.scenario_id) ?? 0) + 1);
    }
  }

  if (operatorInputPath) {
    const operator = await readJson<OperatorInput>(path.resolve(operatorInputPath));
    for (const item of operator.questions ?? []) {
      const facts = allFacts.filter((fact) => item.fact_ids?.includes(fact.fact_id));
      const target = item.target_customer ?? "运营指定客户群体"; const need = item.need ?? item.text;
      const source = sourceRef({ kind: "operator", ref_id: stableId("operator_input", item), path: path.resolve(operatorInputPath), original_bucket: null, text: item.text, derivation: "operator" });
      const gapId = facts.length ? null : stableId("evidence_gap", item.text);
      const draftQuestion = question({ text: item.text, facts, targetStage: "consideration", productIds: productSubject ? [productSubject.subject_id] : [], sources: [source] });
      if (gapId) draftQuestion.evidence_gap_ids.push(gapId);
      const scenarioId = stableId("scenario", "operator", target, need);
      const evidenceGaps: ScenarioEvidenceGap[] = gapId ? [{ evidence_gap_id: gapId, kind: "business_evidence", severity: "high", description: "运营提出的问题尚未关联任何已确认企业事实。", scenario_id: scenarioId, question_ids: [draftQuestion.question_id], fact_ids: [], source_refs: [source], status: "open", review_reason: null }] : [];
      scenarios.push(makeScenario({ key: "operator", name: need.slice(0, 30), target, need, concerns: item.concerns ?? [], questions: [draftQuestion], facts, sources: [source], actionUrl, gaps: evidenceGaps, priority: priority({ business: 4, diagnosis: 0, evidence: facts.length ? 4 : 0, customer: 0, operator: 5, rationale: ["运营显式输入", facts.length ? "已关联确认事实" : "存在高优先级事实缺口"] }) }));
    }
  }

  const customerQuestions = await customerLanguageQuestions(projectRoot, (context.snapshot as Record<string, any>).source_index ?? { sources: [] });
  for (const candidate of customerQuestions) {
    const match = scenarios.find((scenario) => candidate.text.includes(product) || candidate.text.includes(category) || scenario.concerns.some((term) => term.length >= 2 && candidate.text.includes(term)) || (/定制/.test(candidate.text) && scenario.name.includes("定制")) || (/混批|起订|试单/.test(candidate.text) && scenario.name.includes("试单")));
    if (!match) continue;
    const availableFacts = allFacts.filter((fact) => match.supporting_fact_ids.includes(fact.fact_id)); const evidence = evidenceForCandidate(candidate.text, availableFacts);
    const customerQuestion = question({ text: candidate.text, facts: evidence.facts, targetStage: /下单|价格|起订|几件|交期|发货/.test(candidate.text) ? "purchase" : /厂家|供应商|定制/.test(candidate.text) ? "supplier_selection" : "consideration", regions: regions.filter((region) => candidate.text.includes(region.replace(/[省市县区]$/, ""))), productIds: productSubject ? [productSubject.subject_id] : [], capabilities: capabilityTerms.filter((term) => candidate.text.includes(term) || (/定制/.test(candidate.text) && /定制/.test(term))), sources: [candidate.source] });
    if (evidence.unsupported.length) {
      const gapId = stableId("evidence_gap", match.scenario_id, customerQuestion.question_id, evidence.unsupported);
      customerQuestion.evidence_gap_ids.push(gapId);
      match.evidence_gaps.push({ evidence_gap_id: gapId, kind: "business_evidence", severity: "high", description: evidence.unsupported.join("；"), scenario_id: match.scenario_id, question_ids: [customerQuestion.question_id], fact_ids: customerQuestion.fact_ids, source_refs: [candidate.source], status: "open", review_reason: null });
    }
    match.representative_questions = exactDedupe([...match.representative_questions, customerQuestion]); match.source_refs = uniqueRefs([...match.source_refs, candidate.source]); match.priority.components.customer_language = 5; match.priority.calculated_total = Object.values(match.priority.components).reduce((sum, value) => sum + value, 0); match.priority.final_score = match.priority.calculated_total; match.priority.tier = tier(match.priority.final_score); match.priority.rationale.push("包含脱敏后的客服/询盘原话");
  }

  const limitations: string[] = [];
  if (!diagnosisUsable) limitations.push("基线诊断仅有 provider/API 不可用记录；场景优先级未使用品牌提及、推荐、竞品或引用数据，只能使用“探测覆盖不足”这一诊断缺口。");
  if (!customerQuestions.length) limitations.push("未提供可用询盘/客服问题，或现有记录无法安全提取；场景可继续确认，但客户原话支持分较低，后续补充时应创建新版本。");
  const createdAt = utcNow();
  const provisionalId = stableId("scenario_library_draft", context.snapshot.fact_snapshot_id, gaps.report_id, scenarios.map((item) => item.scenario_id), createdAt);
  const library: ScenarioLibrary = { schema_version: 1, scenario_library_id: provisionalId, app_id: context.manifest.app_id, fact_snapshot_id: context.snapshot.fact_snapshot_id, diagnosis_report_id: gaps.report_id, diagnosis_gap_path: gapPath, lifecycle: "review_required", version: 1, based_on_scenario_library_id: null, created_at: createdAt, confirmed_at: null, scenarios, merge_suggestions: semanticSuggestions(scenarios), limitations };
  const jsonPath = path.join(projectRoot, "strategy", "scenario-draft.json"); const reviewPath = path.join(projectRoot, "strategy", "scenario-review.md");
  await writeJson(jsonPath, library); await writeFile(reviewPath, scenarioReviewMarkdown(library), "utf-8");
  const manifestPath = path.join(projectRoot, "manifest.json"); const manifest = await readJson<Record<string, any>>(manifestPath);
  manifest.gates = manifest.gates ?? {}; manifest.gates.scenario = { status: "review_required", at: null, fact_snapshot_id: library.fact_snapshot_id, diagnosis_report_id: library.diagnosis_report_id, scenario_library_id: null, version: null }; manifest.updated_at = createdAt; await writeJson(manifestPath, manifest);
  return { library, jsonPath: relToProject(projectRoot, jsonPath), reviewPath: relToProject(projectRoot, reviewPath) };
}

function reviewLabel(value: string): string {
  const labels: Record<string, string> = {
    unreviewed: "待复核", approved: "已批准", rejected: "已拒绝", deferred: "已延期",
    high: "高", medium: "中", low: "低", open: "待处理", accepted: "已接受", resolved: "已解决",
    awareness: "了解阶段", consideration: "比较阶段", supplier_selection: "供应商筛选", purchase: "采购阶段", post_purchase: "售后阶段",
    direct_question: "直接提问", comparison: "比较提问", recommendation: "推荐提问", how_to: "方法提问", risk: "风险提问",
    scenario: "场景", question: "问题",
  };
  return labels[value] ?? value;
}

function readableFactRefs(refs: ScenarioSourceReference[], factIds: string[], limit = 4): string[] {
  const selected = uniqueRefs(refs.filter((ref) => ref.kind === "fact" && factIds.includes(ref.ref_id)));
  const readable = selected.map((ref) => {
    const raw = ref.text?.replace(/\s+/g, " ").trim();
    const summary = raw ? (raw.length > 120 ? `${raw.slice(0, 117)}…` : raw) : "该事实无单独文本值，请按 ID 回查事实底账";
    return `${summary}（\`${ref.ref_id}\`）`;
  });
  if (readable.length > limit) return [...readable.slice(0, limit), `另有 ${readable.length - limit} 条已确认事实，详见场景 JSON`];
  return readable;
}

function scenarioReviewMarkdown(library: ScenarioLibrary): string {
  const libraryLabel = library.lifecycle === "confirmed" ? "已确认场景库版本" : "场景库草稿";
  const lines = [`# 客户问题与购买场景复核`, "", "> 一个场景是一种客户决策情境，不是一篇文章模板。代表问题可分别用于 FAQ、诊断或未来选题。", "", `- 事实快照：\`${library.fact_snapshot_id}\``, `- 诊断报告：\`${library.diagnosis_report_id}\``, `- ${libraryLabel}：\`${library.scenario_library_id}\``, `- 场景数：${library.scenarios.length}`, ""];
  if (library.limitations.length) lines.push("## 当前限制", "", ...library.limitations.map((item) => `- ${item}`), "");
  for (const [index, scenario] of library.scenarios.entries()) {
    lines.push(`## ${index + 1}. ${scenario.name}`, "", `- 场景 ID：\`${scenario.scenario_id}\``, `- 状态：${reviewLabel(scenario.review_status)}`, `- 优先级：${reviewLabel(scenario.priority.tier)}（${scenario.priority.final_score}/25）`, `- 目标客户：${scenario.target_customer}`, `- 客户需求：${scenario.customer_need}`, `- 关注条件：${scenario.concerns.join("；") || "—"}`, `- 希望下一步：${scenario.desired_next_action?.label ?? "—"}`, "", "### 客户可能会问", "");
    for (const item of scenario.representative_questions) {
      const evidence = readableFactRefs(item.source_refs, item.fact_ids, 3);
      lines.push(`- ${item.text}`, `  - 问法：${reviewLabel(item.facets.decision_stage)} / ${reviewLabel(item.facets.wording_form)}${item.facets.regions.length ? ` / 地区：${item.facets.regions.join("、")}` : ""}`, `  - 回答依据：${evidence.length ? evidence.join("；") : "暂无已确认事实"}`);
      if (item.evidence_gap_ids.length) lines.push(`  - 待确认缺口：${item.evidence_gap_ids.map((id) => `\`${id}\``).join("、")}`);
    }
    lines.push("", "### 企业凭什么回答", "", ...readableFactRefs(scenario.source_refs, scenario.supporting_fact_ids, 8).map((item) => `- ${item}`));
    if (scenario.evidence_gaps.length) lines.push("", "### 事实/证据缺口", "", ...scenario.evidence_gaps.map((gap) => `- ${reviewLabel(gap.severity)} / ${reviewLabel(gap.status)}：${gap.description}（\`${gap.evidence_gap_id}\`）`));
    lines.push("");
  }
  if (library.merge_suggestions.length) lines.push("## 语义重叠建议（不会自动合并）", "", ...library.merge_suggestions.map((item) => `- \`${item.suggestion_id}\`：${reviewLabel(item.item_type)} ${item.item_ids.join(" ↔ ")}；相似度 ${item.similarity}；差异：${item.meaningful_differences.join("；") || "未识别"}`), "");
  lines.push("## 确认规则", "", "- 每个场景需 approve、reject 或 defer；edit 会保留 ID 并更新业务字段。", "- 高优先级 open evidence gap 必须 resolve、defer 或 accept。", "- 未确认场景库不能进入内容规划。", "");
  return lines.join("\n");
}

async function loadDraft(projectRoot: string): Promise<ScenarioLibrary> { return readJson<ScenarioLibrary>(path.join(projectRoot, "strategy", "scenario-draft.json")); }
async function saveDraft(projectRoot: string, library: ScenarioLibrary): Promise<void> { await writeJson(path.join(projectRoot, "strategy", "scenario-draft.json"), library); await writeFile(path.join(projectRoot, "strategy", "scenario-review.md"), scenarioReviewMarkdown(library), "utf-8"); }

export async function reviewScenario(projectRoot: string, scenarioId: string, action: ScenarioAction, note?: string, patchPath?: string): Promise<ScenarioLibrary> {
  const library = await loadDraft(projectRoot); const scenario = library.scenarios.find((item) => item.scenario_id === scenarioId);
  if (!scenario) throw new Error(`scenario not found: ${scenarioId}`);
  if (action === "edit") {
    if (!patchPath) throw new Error("edit requires --input JSON patch");
    const patch = await readJson<Partial<Pick<CustomerScenario, "name" | "target_customer" | "customer_need" | "concerns" | "desired_next_action">>>(path.resolve(patchPath));
    Object.assign(scenario, patch); scenario.review_status = "approved"; scenario.review_note = note?.trim() || "edited and approved";
  } else { scenario.review_status = action === "approve" ? "approved" : action === "reject" ? "rejected" : "deferred"; scenario.review_note = note?.trim() || null; }
  await saveDraft(projectRoot, library); return library;
}

export async function approveReadyScenarios(projectRoot: string): Promise<ScenarioLibrary> {
  const library = await loadDraft(projectRoot);
  for (const scenario of library.scenarios) if (scenario.review_status === "unreviewed" && !scenario.evidence_gaps.some((gap) => gap.severity === "high" && gap.status === "open")) scenario.review_status = "approved";
  await saveDraft(projectRoot, library); return library;
}

export async function reviewEvidenceGap(projectRoot: string, gapId: string, action: GapAction, reason: string): Promise<ScenarioLibrary> {
  if (!reason.trim()) throw new Error("evidence gap review requires a reason");
  const library = await loadDraft(projectRoot); const gap = library.scenarios.flatMap((item) => item.evidence_gaps).find((item) => item.evidence_gap_id === gapId);
  if (!gap) throw new Error(`evidence gap not found: ${gapId}`);
  gap.status = action === "accept" ? "accepted" : action === "defer" ? "deferred" : "resolved"; gap.review_reason = reason.trim(); await saveDraft(projectRoot, library); return library;
}

export async function overrideScenarioPriority(projectRoot: string, scenarioId: string, score: number, actor: string, reason: string): Promise<ScenarioLibrary> {
  if (!Number.isFinite(score) || score < 0 || score > 25) throw new Error("priority score must be between 0 and 25");
  if (!actor.trim() || !reason.trim()) throw new Error("priority override requires actor and reason");
  const library = await loadDraft(projectRoot); const scenario = library.scenarios.find((item) => item.scenario_id === scenarioId); if (!scenario) throw new Error(`scenario not found: ${scenarioId}`);
  scenario.priority.override = { score, actor: actor.trim(), reason: reason.trim(), at: utcNow() }; scenario.priority.final_score = score; scenario.priority.tier = tier(score); await saveDraft(projectRoot, library); return library;
}

export async function reviewMergeSuggestion(projectRoot: string, suggestionId: string, action: "approve" | "reject", reason: string): Promise<ScenarioLibrary> {
  if (!reason.trim()) throw new Error("merge review requires a reason");
  const library = await loadDraft(projectRoot); const suggestion = library.merge_suggestions.find((item) => item.suggestion_id === suggestionId); if (!suggestion) throw new Error(`merge suggestion not found: ${suggestionId}`);
  suggestion.status = action === "approve" ? "approved" : "rejected"; suggestion.review_reason = reason.trim();
  if (action === "approve") {
    const [targetId, sourceId] = suggestion.item_ids;
    if (suggestion.item_type === "scenario") {
      const target = library.scenarios.find((item) => item.scenario_id === targetId); const source = library.scenarios.find((item) => item.scenario_id === sourceId);
      if (!target || !source) throw new Error("merge suggestion references missing scenario");
      target.representative_questions = exactDedupe([...target.representative_questions, ...source.representative_questions]); target.supporting_fact_ids = unique([...target.supporting_fact_ids, ...source.supporting_fact_ids]); target.source_refs = uniqueRefs([...target.source_refs, ...source.source_refs]); target.concerns = unique([...target.concerns, ...source.concerns]); target.evidence_gaps.push(...source.evidence_gaps.map((gap) => ({ ...gap, scenario_id: target.scenario_id }))); source.review_status = "rejected"; source.review_note = `merged into ${target.scenario_id}: ${reason.trim()}`;
    } else {
      const owner = library.scenarios.find((scenario) => scenario.representative_questions.some((item) => item.question_id === targetId) && scenario.representative_questions.some((item) => item.question_id === sourceId));
      if (!owner) throw new Error("question merge is allowed only within the same scenario");
      const target = owner.representative_questions.find((item) => item.question_id === targetId)!; const source = owner.representative_questions.find((item) => item.question_id === sourceId)!;
      target.fact_ids = unique([...target.fact_ids, ...source.fact_ids]); target.source_refs = uniqueRefs([...target.source_refs, ...source.source_refs]); target.evidence_gap_ids = unique([...target.evidence_gap_ids, ...source.evidence_gap_ids]); owner.representative_questions = owner.representative_questions.filter((item) => item.question_id !== sourceId);
    }
  }
  await saveDraft(projectRoot, library); return library;
}

export async function confirmScenarioLibrary(projectRoot: string): Promise<{ library: ScenarioLibrary; path: string }> {
  const { context, gaps } = await loadContext(projectRoot); const draft = await loadDraft(projectRoot);
  if (draft.fact_snapshot_id !== context.snapshot.fact_snapshot_id || draft.diagnosis_report_id !== gaps.report_id) throw new Error("scenario confirmation blocked: draft references stale upstream inputs");
  const unreviewed = draft.scenarios.filter((item) => item.review_status === "unreviewed"); if (unreviewed.length) throw new Error(`scenario confirmation blocked: ${unreviewed.length} scenarios remain unreviewed`);
  if (!draft.scenarios.some((item) => item.review_status === "approved")) throw new Error("scenario confirmation blocked: no approved scenarios");
  const blockingGaps = draft.scenarios.filter((scenario) => scenario.review_status === "approved").flatMap((scenario) => scenario.evidence_gaps).filter((gap) => gap.severity === "high" && gap.status === "open"); if (blockingGaps.length) throw new Error(`scenario confirmation blocked: ${blockingGaps.length} high-priority evidence gaps remain open`);
  const confirmedAt = utcNow(); const active = draft.scenarios.filter((item) => item.review_status !== "rejected"); const libraryId = stableId("scenario_library", draft.fact_snapshot_id, draft.diagnosis_report_id, draft.version, active.map((item) => [item.scenario_id, item.review_status, item.priority.final_score, item.evidence_gaps.map((gap) => [gap.evidence_gap_id, gap.status])]));
  const library: ScenarioLibrary = { ...draft, scenario_library_id: libraryId, lifecycle: "confirmed", confirmed_at: confirmedAt, scenarios: active };
  const out = path.join(projectRoot, "strategy", "scenario-libraries", `${libraryId}.json`); await writeJson(out, library); await writeFile(path.join(projectRoot, "strategy", "scenario-library.md"), scenarioReviewMarkdown(library), "utf-8");
  const manifestPath = path.join(projectRoot, "manifest.json"); const manifest = await readJson<Record<string, any>>(manifestPath); manifest.gates = manifest.gates ?? {}; manifest.gates.scenario = { status: "confirmed", at: confirmedAt, fact_snapshot_id: library.fact_snapshot_id, diagnosis_report_id: library.diagnosis_report_id, scenario_library_id: libraryId, version: library.version }; manifest.updated_at = confirmedAt; await writeJson(manifestPath, manifest);
  return { library, path: relToProject(projectRoot, out) };
}

export async function reviseScenarioLibrary(projectRoot: string, libraryId: string): Promise<{ library: ScenarioLibrary; path: string }> {
  const sourcePath = path.join(projectRoot, "strategy", "scenario-libraries", `${libraryId}.json`); const source = await readJson<ScenarioLibrary>(sourcePath); if (source.lifecycle !== "confirmed") throw new Error("scenario revision requires a confirmed library");
  const createdAt = utcNow(); const library: ScenarioLibrary = { ...source, scenario_library_id: stableId("scenario_library_draft", libraryId, source.version + 1, createdAt), lifecycle: "review_required", version: source.version + 1, based_on_scenario_library_id: libraryId, created_at: createdAt, confirmed_at: null, scenarios: source.scenarios.map((scenario) => ({ ...scenario, review_status: "unreviewed", review_note: null })) };
  await saveDraft(projectRoot, library); return { library, path: "strategy/scenario-draft.json" };
}

export async function scenarioLibraryInput(projectRoot: string): Promise<string> {
  const manifest = await readJson<Record<string, any>>(path.join(projectRoot, "manifest.json")); const gate = manifest.gates?.scenario;
  if (gate?.status !== "confirmed" || !gate.scenario_library_id) throw new Error("content planning blocked: scenario library is not confirmed");
  const libraryPath = path.join(projectRoot, "strategy", "scenario-libraries", `${gate.scenario_library_id}.json`); if (!(await pathExists(libraryPath))) throw new Error("content planning blocked: confirmed scenario library artifact is missing"); return relToProject(projectRoot, libraryPath);
}
