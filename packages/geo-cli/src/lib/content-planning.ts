import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { stableId } from "./fact-model.js";
import type { FactRecord } from "./fact-model.js";
import type { CustomerScenario, RepresentativeQuestion, ScenarioEvidenceGap, ScenarioLibrary, ScenarioSourceReference } from "./scenario-model.js";
import { normalizeScenarioText } from "./scenario-strategy.js";
import type {
  ContentBlocker, ContentChannel, ContentMergeSuggestion, ContentPlan, ContentPriority, ContentReadiness,
  ContentTopic, FaqCandidate, LegacyContentAudit, LegacyContentCandidate, ProductionTask, PromptRecipe,
} from "./content-plan-model.js";
import { pathExists, readJson, relToProject, utcNow, writeJson } from "./util.js";

type TopicAction = "approve" | "reject" | "defer" | "edit";
type BlockerAction = "resolve" | "defer" | "accept" | "research-only";

interface PlanningContext {
  manifest: Record<string, any>;
  library: ScenarioLibrary;
  publicFacts: FactRecord[];
  diagnosis: Record<string, any>;
}

function unique<T>(values: T[]): T[] { return [...new Set(values)]; }
function tier(score: number): "high" | "medium" | "low" { return score >= 22 ? "high" : score >= 14 ? "medium" : "low"; }
function factSummary(value: unknown): string { const text = typeof value === "string" ? value : typeof value === "boolean" ? (value ? "是" : "否") : typeof value === "number" ? String(value) : Array.isArray(value) ? value.map(factSummary).join("；") : value && typeof value === "object" ? Object.entries(value as Record<string, unknown>).map(([key, child]) => `${key}: ${factSummary(child)}`).join("；") : ""; return text.length > 180 ? `${text.slice(0, 177)}…` : text; }
const SENSITIVE_FACT_FIELD = /(password|passwd|token|secret|id_card|identity_card|legal_representative_id|法人身份证|身份证|口令|密码|密钥|令牌)/i;
function usablePublicFact(fact: FactRecord): boolean { return fact.review_status === "confirmed" && fact.disclosure_level === "public" && !SENSITIVE_FACT_FIELD.test(fact.field); }

function priorityFor(scenario: CustomerScenario, question: RepresentativeQuestion, blocked: boolean, diagnosisUsable: boolean): ContentPriority {
  const components = {
    scenario_priority: Math.max(0, Math.min(5, Math.round(scenario.priority.final_score / 5))),
    evidence_readiness: blocked ? 0 : 5,
    diagnosis_gap: diagnosisUsable ? Math.max(0, Math.min(5, scenario.priority.components.diagnosis_gap)) : 0,
    customer_language: question.source_refs.some((ref) => ref.kind === "customer_language") ? 5 : question.source_refs.some((ref) => ref.kind === "legacy_keyword") ? 3 : 2,
    coverage_value: 5,
    operator_judgment: 0,
  };
  const calculated = Object.values(components).reduce((sum, value) => sum + value, 0);
  const rationale = ["继承已确认场景优先级", blocked ? "存在事实缺口，证据就绪分为 0" : "问题已关联公开确认事实", diagnosisUsable ? "包含有效诊断信号" : "诊断无有效回答，不增加品牌表现分", "覆盖一个尚未进入计划的代表问题"];
  return { components, calculated_total: calculated, final_score: calculated, tier: tier(calculated), rationale, override: null };
}

async function loadPlanningContext(projectRoot: string): Promise<PlanningContext> {
  const manifest = await readJson<Record<string, any>>(path.join(projectRoot, "manifest.json"));
  const clean = manifest.gates?.clean; const diagnose = manifest.gates?.diagnose; const scenario = manifest.gates?.scenario;
  if (clean?.status !== "confirmed" || !clean.fact_snapshot_id) throw new Error("content planning blocked: enterprise facts are not confirmed");
  if (diagnose?.status !== "confirmed" || !diagnose.report_id || diagnose.fact_snapshot_id !== clean.fact_snapshot_id) throw new Error("content planning blocked: diagnosis gate is missing or stale");
  if (scenario?.status !== "confirmed" || !scenario.scenario_library_id || !scenario.version) throw new Error("content planning blocked: scenario library is not confirmed");
  if (scenario.fact_snapshot_id !== clean.fact_snapshot_id || scenario.diagnosis_report_id !== diagnose.report_id) throw new Error("content planning blocked: scenario gate references stale upstream inputs");
  const libraryPath = path.join(projectRoot, "strategy", "scenario-libraries", `${scenario.scenario_library_id}.json`);
  if (!(await pathExists(libraryPath))) throw new Error("content planning blocked: confirmed scenario library artifact is missing");
  const library = await readJson<ScenarioLibrary>(libraryPath);
  if (library.lifecycle !== "confirmed" || library.scenario_library_id !== scenario.scenario_library_id || library.version !== scenario.version || library.fact_snapshot_id !== clean.fact_snapshot_id || library.diagnosis_report_id !== diagnose.report_id) throw new Error("content planning blocked: confirmed scenario artifact does not match manifest");
  const snapshot = await readJson<Record<string, any>>(path.join(projectRoot, "knowledge", "snapshots", `${clean.fact_snapshot_id}.json`));
  const publicFacts = ((snapshot.facts?.facts ?? []) as FactRecord[]).filter(usablePublicFact);
  const diagnosisPath = path.join(projectRoot, "diagnosis", "reports", `${diagnose.report_id}.json`);
  const diagnosis = await readJson<Record<string, any>>(diagnosisPath);
  if (diagnosis.status !== "confirmed" || diagnosis.fact_snapshot_id !== clean.fact_snapshot_id) throw new Error("content planning blocked: diagnosis report artifact is missing or stale");
  return { manifest, library, publicFacts, diagnosis };
}

function gapForQuestion(scenario: CustomerScenario, question: RepresentativeQuestion): ScenarioEvidenceGap[] {
  return scenario.evidence_gaps.filter((gap) => question.evidence_gap_ids.includes(gap.evidence_gap_id));
}

function blockedGap(gap: ScenarioEvidenceGap): boolean { return gap.severity === "high" && ["open", "deferred"].includes(gap.status); }

function answerGoal(question: RepresentativeQuestion): string {
  switch (question.facets.wording_form) {
    case "how_to": return "给出基于已确认事实的判断步骤和选择条件";
    case "comparison": return "解释可核验的比较维度，不做无依据排名";
    case "risk": return "澄清风险边界、核验方法和需要进一步确认的信息";
    case "recommendation": return "提供供应商或产品筛选依据，不做无证据推荐";
    default: return "直接解释问题并给出可核验的企业与产品信息";
  }
}

function topicObjective(question: RepresentativeQuestion): string {
  if (question.facets.wording_form === "how_to") return `帮助客户掌握“${question.text.replace(/[？?]$/, "")}”的判断方法`;
  if (question.facets.wording_form === "risk") return `说明“${question.text.replace(/[？?]$/, "")}”的风险与核验边界`;
  if (question.facets.decision_stage === "supplier_selection") return `帮助客户基于事实筛选与核验供应能力：${question.text.replace(/[？?]$/, "")}`;
  return `围绕“${question.text.replace(/[？?]$/, "")}”提供可核验的决策信息`;
}

function topicCategory(question: RepresentativeQuestion): string {
  const text = question.text;
  if (question.evidence_gap_ids.length) return `evidence_gap:${question.evidence_gap_ids.join(",")}`;
  if (question.facets.regions.length) return "regional_supplier_selection";
  if (question.facets.direction === "negative" || question.facets.wording_form === "risk") return "risk_clarification";
  if (question.facets.decision_stage === "awareness") return "brand_overview";
  if (/厂家|工厂|供应商|靠谱/.test(text) || question.facets.decision_stage === "supplier_selection") return /怎么|怎样|如何|确认哪些|评估|筛选/.test(text) ? "supplier_evaluation" : "supplier_capability";
  if (question.facets.decision_stage === "purchase") return "purchase_guide";
  if (/怎么选|适合|材质|规格|做工/.test(text) || question.facets.wording_form === "how_to") return "selection_guide";
  return "product_or_capability_overview";
}

function topicDefinition(category: string, scenario: CustomerScenario): { name: string; objective: string } {
  if (category.startsWith("evidence_gap:")) return { name: `${scenario.name}：待核验需求`, objective: "保留客户真实需求并说明需要核验的条件，不把未确认能力写成企业事实" };
  const definitions: Record<string, [string, string]> = {
    regional_supplier_selection: ["地区供应商筛选", "帮助区域采购客户用公开事实筛选和核验供应商"], risk_clarification: ["风险与边界澄清", "解释风险、适用边界和需要进一步核验的信息"],
    brand_overview: ["企业与品牌认知", "说明企业是谁、主营什么以及哪些公开信息可核验"], supplier_evaluation: ["供应商评估与采购核验", "给出供应商评估步骤、采购条件和核验方法"],
    supplier_capability: ["供应能力与合作条件", "说明可核验的供应、定制与合作条件，不做无依据推荐"], purchase_guide: ["采购决策指南", "帮助客户确认采购前需要比较的条件和事实"],
    selection_guide: ["产品选择与适用场景", "帮助客户根据用途、材质、规格和做工选择合适产品"], product_or_capability_overview: ["产品与能力概览", "用已确认事实解释产品、能力和适用客户"],
  };
  const [label, objective] = definitions[category] ?? definitions.product_or_capability_overview; return { name: `${scenario.name}：${label}`, objective };
}

function channelsFor(question: RepresentativeQuestion): ContentChannel[] {
  const text = question.text;
  if (/厂家|工厂|供应商|采购|混批|试单|定制|供货/.test(text)) return ["b2b", "social"];
  if (/是做什么|企业|品牌|靠谱|核验/.test(text)) return ["media", "social"];
  return ["social", "b2b"];
}

function channelDetails(channel: ContentChannel): { format: string; reason: string; constraints: string[]; tone: string } {
  if (channel === "social") return { format: "问答/经验型图文", reason: "适合用客户问题组织易理解的选择与核验方法", constraints: ["不得伪装用户评价", "发布前必须人工审稿", "不使用绝对化推荐"], tone: "清晰、克制、面向实际决策" };
  if (channel === "media") return { format: "企业事实与行业解释稿", reason: "适合呈现可核验企业信息和行业判断框架", constraints: ["事实与观点分开", "关键声明需要来源", "不得写成虚假新闻"], tone: "客观、专业、证据优先" };
  if (channel === "b2b") return { format: "采购指南/供应能力说明", reason: "适合规格、采购条件、供应能力和公开业务触点", constraints: ["突出采购条件而非空泛品牌词", "能力声明只使用 allowlist facts", "不承诺未确认交期或规模"], tone: "具体、采购导向、可核验" };
  return { format: "结构化 FAQ/专题页", reason: "适合自有站沉淀结构化问题与事实", constraints: ["使用结构化标题层级", "保持长期可维护", "链接公开业务触点"], tone: "简洁、权威、便于检索" };
}

function promptFor(topic: ContentTopic, channel: ContentChannel, gaps: ScenarioEvidenceGap[]): PromptRecipe {
  const details = channelDetails(channel); const forbidden = gaps.map((gap) => `不得把“${gap.description}”改写为企业已具备的事实`);
  return {
    prompt_id: stableId("content_prompt", topic.topic_id, channel), topic_id: topic.topic_id, channel,
    objective: topic.objective, audience: topic.target_audience,
    outline_requirements: ["先回答核心问题", "再给出选择或核验维度", "只使用 allowed_fact_ids 对应的公开确认事实", "结尾给出与场景一致的下一步行动"],
    tone: details.tone, channel_constraints: details.constraints, citation_policy: "事实声明必须可追溯到 allowed_fact_ids；无法证明的信息写成待确认条件", allowed_fact_ids: topic.allowed_fact_ids, forbidden_claims: forbidden, review_status: "unreviewed",
  };
}

function buildBlockers(scenarios: CustomerScenario[]): ContentBlocker[] {
  return scenarios.flatMap((scenario) => scenario.evidence_gaps.filter(blockedGap).map((gap) => ({
    blocker_id: stableId("content_blocker", gap.evidence_gap_id, scenario.scenario_id), evidence_gap_id: gap.evidence_gap_id, scenario_id: scenario.scenario_id, question_ids: gap.question_ids, severity: gap.severity, description: gap.description, status: "open" as const, review_reason: null,
  })));
}

function faqDedupe(items: FaqCandidate[]): FaqCandidate[] {
  const byText = new Map<string, FaqCandidate>();
  for (const item of items) {
    const prior = byText.get(item.normalized_question);
    if (!prior) { byText.set(item.normalized_question, item); continue; }
    prior.question_ids = unique([...prior.question_ids, ...item.question_ids]); prior.allowed_fact_ids = unique([...prior.allowed_fact_ids, ...item.allowed_fact_ids]); prior.evidence_gap_ids = unique([...prior.evidence_gap_ids, ...item.evidence_gap_ids]); prior.source_refs = [...new Map([...prior.source_refs, ...item.source_refs].map((ref) => [ref.source_ref_id, ref])).values()];
    if (item.readiness === "blocked") prior.readiness = "blocked";
  }
  return [...byText.values()];
}

function bigrams(text: string): Set<string> { const normalized = normalizeScenarioText(text); return new Set([...Array(Math.max(0, normalized.length - 1)).keys()].map((i) => normalized.slice(i, i + 2))); }
function similarity(a: string, b: string): number { const l = bigrams(a); const r = bigrams(b); if (!l.size || !r.size) return normalizeScenarioText(a) === normalizeScenarioText(b) ? 1 : 0; const both = [...l].filter((x) => r.has(x)).length; return both / (l.size + r.size - both); }

export function contentMergeSuggestions(faqs: FaqCandidate[], topics: ContentTopic[], tasks: ProductionTask[] = []): ContentMergeSuggestion[] {
  const out: ContentMergeSuggestion[] = [];
  for (let i = 0; i < faqs.length; i++) for (let j = i + 1; j < faqs.length; j++) {
    const score = similarity(faqs[i].question, faqs[j].question); if (score < 0.62 || faqs[i].normalized_question === faqs[j].normalized_question) continue;
    const differences = faqs[i].target_audience === faqs[j].target_audience ? [] : ["目标受众不同"];
    out.push({ suggestion_id: stableId("content_merge", "faq", faqs[i].faq_id, faqs[j].faq_id), item_type: "faq", item_ids: [faqs[i].faq_id, faqs[j].faq_id], reason: "FAQ 问法存在语义重叠，需人工判断是否合并", similarity: Number(score.toFixed(3)), meaningful_differences: differences, status: "pending", review_reason: null });
  }
  for (let i = 0; i < topics.length; i++) for (let j = i + 1; j < topics.length; j++) {
    const score = similarity(topics[i].name, topics[j].name); if (score < 0.72) continue;
    const differences = unique([topics[i].target_audience === topics[j].target_audience ? "" : "目标受众不同", topics[i].decision_stage === topics[j].decision_stage ? "" : "决策阶段不同"].filter(Boolean));
    out.push({ suggestion_id: stableId("content_merge", "topic", topics[i].topic_id, topics[j].topic_id), item_type: "topic", item_ids: [topics[i].topic_id, topics[j].topic_id], reason: "内容主题存在语义重叠，需人工判断是否合并", similarity: Number(score.toFixed(3)), meaningful_differences: differences, status: "pending", review_reason: null });
  }
  const topicById = new Map(topics.map((topic) => [topic.topic_id, topic]));
  for (let i = 0; i < tasks.length; i++) for (let j = i + 1; j < tasks.length; j++) {
    if (tasks[i].channel !== tasks[j].channel) continue; const left = topicById.get(tasks[i].topic_id); const right = topicById.get(tasks[j].topic_id); if (!left || !right) continue;
    const score = similarity(left.name, right.name); if (score < 0.78) continue;
    const differences = unique([left.target_audience === right.target_audience ? "" : "目标受众不同", left.decision_stage === right.decision_stage ? "" : "决策阶段不同"].filter(Boolean));
    out.push({ suggestion_id: stableId("content_merge", "task", tasks[i].task_id, tasks[j].task_id), item_type: "task", item_ids: [tasks[i].task_id, tasks[j].task_id], reason: "同一 channel 的生产任务存在语义重叠，需人工判断是否合并", similarity: Number(score.toFixed(3)), meaningful_differences: differences, status: "pending", review_reason: null });
  }
  return out;
}

function renderReview(plan: ContentPlan): string {
  const status: Record<string, string> = { unreviewed: "待复核", approved: "已批准", rejected: "已拒绝", deferred: "已延期", ready: "事实就绪", blocked: "被证据缺口阻断", research_only: "仅研究型", high: "高", medium: "中", low: "低" };
  const label = plan.lifecycle === "confirmed" ? "已确认内容计划" : "内容计划草稿";
  const lines = ["# 内容策略与生产计划复核", "", "> 本文件只决定写什么、为什么写、依据什么和投向哪个通道；不包含 FAQ 答案或文章正文。", "", `- ${label}：\`${plan.content_plan_id}\`（v${plan.version}）`, `- 场景库：\`${plan.scenario_library_id}\`（v${plan.scenario_library_version}）`, `- FAQ 候选：${plan.faq_candidates.length}`, `- 内容主题：${plan.topics.length}`, `- 生产任务：${plan.production_tasks.length}`, `- 计划量：${plan.quota.planned_total}/${plan.quota.requested_total}（不足时不复制近义任务凑量）`, ""];
  if (plan.limitations.length) lines.push("## 当前限制", "", ...plan.limitations.map((x) => `- ${x}`), "");
  for (const [index, topic] of plan.topics.entries()) {
    const faqs = plan.faq_candidates.filter((x) => topic.faq_ids.includes(x.faq_id)); const tasks = plan.production_tasks.filter((x) => x.topic_id === topic.topic_id); const prompts = plan.prompt_recipes.filter((x) => x.topic_id === topic.topic_id);
    const stageLabels: Record<string, string> = { awareness: "了解阶段", consideration: "比较阶段", supplier_selection: "供应商筛选", purchase: "采购阶段", post_purchase: "售后阶段" };
    const evidence = plan.fact_catalog.filter((fact) => topic.allowed_fact_ids.includes(fact.fact_id));
    lines.push(`## ${index + 1}. ${topic.name}`, "", `- Topic ID：\`${topic.topic_id}\``, `- 状态：${status[topic.review_status] ?? topic.review_status}；就绪度：${status[topic.readiness] ?? topic.readiness}`, `- 服务对象：${topic.target_audience}`, `- 单一目标：${topic.objective}`, `- 决策阶段：${stageLabels[topic.decision_stage] ?? topic.decision_stage}`, `- 优先级：${status[topic.priority.tier] ?? topic.priority.tier}（${topic.priority.final_score}/30）`, `- 下一步行动：${topic.desired_next_action?.label ?? "—"}`, "", "### 准备回答", "", ...faqs.map((x) => `- ${x.question}\n  - 回答目标：${x.answer_goal}\n  - 事实依据：${x.allowed_fact_ids.length} 条；证据缺口：${x.evidence_gap_ids.length ? x.evidence_gap_ids.join("、") : "无"}`), "", "### 可使用的公开确认事实", "", ...evidence.slice(0, 8).map((fact) => `- ${fact.field}：${fact.summary}（\`${fact.fact_id}\`）`), ...(evidence.length > 8 ? [`- 另有 ${evidence.length - 8} 条，详见 JSON`] : []), "", "### 计划任务", "", ...tasks.map((x) => `- ${x.channel} / ${x.content_format} / ${x.quantity} 条 / ${status[x.readiness] ?? x.readiness}\n  - 渠道理由：${x.channel_reason}\n  - Prompt：\`${x.prompt_id}\`；允许事实 ${x.allowed_fact_ids.length} 条；禁用声明 ${x.claim_boundaries.length} 条`));
    const forbidden = unique(prompts.flatMap((x) => x.forbidden_claims)); if (forbidden.length) lines.push("", "### 禁止越界", "", ...forbidden.map((x) => `- ${x}`)); lines.push("");
  }
  if (plan.blockers.length) lines.push("## 证据阻断项", "", ...plan.blockers.map((x) => `- \`${x.blocker_id}\`：${x.description}；状态：${x.status}`), "");
  if (plan.merge_suggestions.length) lines.push("## 语义合并建议", "", ...plan.merge_suggestions.map((x) => `- \`${x.suggestion_id}\`：${x.item_type} ${x.item_ids.join(" ↔ ")}；相似度 ${x.similarity}；差异：${x.meaningful_differences.join("；") || "未识别"}`), "");
  lines.push("## 确认规则", "", "- 每个 Topic bundle 必须批准、拒绝或延期。", "- blocker 必须解决、延期、接受为不生产，或明确改为 research-only。", "- 所有语义合并建议必须人工处理。", "- 未确认内容计划不能进入文章生成。", ""); return lines.join("\n");
}

function recalculatePlanStats(plan: ContentPlan): void {
  const planned = plan.production_tasks.filter((x) => x.status === "planned"); plan.quota.planned_total = planned.reduce((sum, x) => sum + x.quantity, 0);
  for (const channel of ["social", "media", "b2b", "site"] as ContentChannel[]) plan.quota.by_channel[channel].planned = planned.filter((x) => x.channel === channel).reduce((sum, x) => sum + x.quantity, 0);
  const questionIds = new Set(planned.flatMap((x) => x.question_ids)); const scenarioIds = new Set(planned.flatMap((x) => x.scenario_ids)); const allQuestionIds = unique(plan.faq_candidates.flatMap((x) => x.question_ids));
  plan.coverage.question_planned = questionIds.size; plan.coverage.scenario_planned = scenarioIds.size; plan.coverage.uncovered_question_ids = allQuestionIds.filter((id) => !questionIds.has(id));
}
async function saveDraft(projectRoot: string, plan: ContentPlan): Promise<void> { recalculatePlanStats(plan); await writeJson(path.join(projectRoot, "strategy", "content-plan-draft.json"), plan); await writeFile(path.join(projectRoot, "strategy", "content-plan-review.md"), renderReview(plan), "utf-8"); }
async function loadDraft(projectRoot: string): Promise<ContentPlan> { return readJson<ContentPlan>(path.join(projectRoot, "strategy", "content-plan-draft.json")); }

export async function generateContentPlan(projectRoot: string, requestedTotal = 30): Promise<{ plan: ContentPlan; jsonPath: string; reviewPath: string }> {
  if (!Number.isInteger(requestedTotal) || requestedTotal < 1) throw new Error("requested quota must be a positive integer");
  const context = await loadPlanningContext(projectRoot); const publicIds = new Set(context.publicFacts.map((fact) => fact.fact_id)); const diagnosisUsable = Number(context.diagnosis.metrics?.valid_probes ?? 0) > 0;
  const activeScenarios = context.library.scenarios.filter((scenario) => scenario.review_status === "approved"); const blockers = buildBlockers(activeScenarios); const faqs: FaqCandidate[] = [];
  for (const scenario of activeScenarios) for (const question of scenario.representative_questions) {
    const gaps = gapForQuestion(scenario, question); const blocked = gaps.some(blockedGap); const allowed = unique(question.fact_ids.filter((id) => publicIds.has(id)));
    faqs.push({ faq_id: stableId("faq_candidate", question.normalized_text, scenario.scenario_id), question: question.text, normalized_question: normalizeScenarioText(question.text), answer_goal: answerGoal(question), target_audience: scenario.target_customer, scenario_id: scenario.scenario_id, question_ids: [question.question_id], allowed_fact_ids: allowed, evidence_gap_ids: gaps.map((gap) => gap.evidence_gap_id), readiness: blocked ? "blocked" : allowed.length ? "ready" : "blocked", review_status: "unreviewed", review_note: null, source_refs: question.source_refs });
  }
  const dedupedFaqs = faqDedupe(faqs); const topics: ContentTopic[] = []; const prompts: PromptRecipe[] = []; const tasks: ProductionTask[] = []; const groups = new Map<string, FaqCandidate[]>();
  for (const faq of dedupedFaqs) { const scenario = activeScenarios.find((x) => x.scenario_id === faq.scenario_id)!; const question = scenario.representative_questions.find((x) => faq.question_ids.includes(x.question_id))!; const key = `${scenario.scenario_id}:${topicCategory(question)}`; groups.set(key, [...(groups.get(key) ?? []), faq]); }
  for (const [key, groupFaqs] of groups) {
    const scenario = activeScenarios.find((item) => item.scenario_id === groupFaqs[0].scenario_id)!; const questions = scenario.representative_questions.filter((question) => groupFaqs.some((faq) => faq.question_ids.includes(question.question_id))); const category = key.slice(scenario.scenario_id.length + 1); const definition = topicDefinition(category, scenario); const gaps = scenario.evidence_gaps.filter((gap) => groupFaqs.some((faq) => faq.evidence_gap_ids.includes(gap.evidence_gap_id))); const blocked = groupFaqs.some((faq) => faq.readiness === "blocked"); const priorities = questions.map((question) => priorityFor(scenario, question, blocked, diagnosisUsable)).sort((a, b) => b.final_score - a.final_score); const priority = priorities[0]; const channels = unique(questions.flatMap(channelsFor)); const allowedFacts = unique(groupFaqs.flatMap((faq) => faq.allowed_fact_ids)); const questionIds = unique(groupFaqs.flatMap((faq) => faq.question_ids)); const evidenceGapIds = unique(groupFaqs.flatMap((faq) => faq.evidence_gap_ids));
    const topic: ContentTopic = { topic_id: stableId("content_topic", scenario.scenario_id, category), name: definition.name, objective: definition.objective, target_audience: scenario.target_customer, decision_stage: questions[0].facets.decision_stage, faq_ids: groupFaqs.map((faq) => faq.faq_id), scenario_ids: [scenario.scenario_id], question_ids: questionIds, allowed_fact_ids: allowedFacts, evidence_gap_ids: evidenceGapIds, content_forms: channels.map((channel) => channelDetails(channel).format), desired_next_action: scenario.desired_next_action, readiness: blocked ? "blocked" : "ready", priority, review_status: "unreviewed", review_note: null }; topics.push(topic);
    for (const channel of channels) { const prompt = promptFor(topic, channel, gaps); prompts.push(prompt); const details = channelDetails(channel); const readiness: ContentReadiness = blocked ? "blocked" : "ready"; tasks.push({ task_id: stableId("production_task", topic.topic_id, channel, 1), topic_id: topic.topic_id, faq_ids: topic.faq_ids, prompt_id: prompt.prompt_id, scenario_ids: topic.scenario_ids, question_ids: topic.question_ids, fact_snapshot_id: context.library.fact_snapshot_id, allowed_fact_ids: allowedFacts, blocked_evidence_gap_ids: evidenceGapIds, claim_boundaries: gaps.map((gap) => gap.description), channel, content_format: details.format, channel_reason: details.reason, batch: 1, quantity: 1, use_knowledge: true, mode: "factual", readiness, status: blocked ? "blocked" : "planned", priority: structuredClone(priority), review_status: "unreviewed", review_note: null, planning_override: null }); }
  }
  topics.sort((a, b) => b.priority.final_score - a.priority.final_score || a.topic_id.localeCompare(b.topic_id));
  const taskOrder = [...tasks].sort((a, b) => b.priority.final_score - a.priority.final_score || a.task_id.localeCompare(b.task_id)); const selectedIds = new Set(taskOrder.slice(0, requestedTotal).map((task) => task.task_id));
  for (const task of tasks) if (!selectedIds.has(task.task_id) && task.status === "planned") { task.status = "deferred"; task.readiness = "deferred"; task.review_status = "deferred"; task.review_note = "超出本批请求配额，未通过复制内容凑量"; }
  const plannedTasks = tasks.filter((task) => task.status === "planned"); const byChannel = (channel: ContentChannel) => ({ requested: Math.min(requestedTotal, tasks.filter((task) => task.channel === channel).length), planned: plannedTasks.filter((task) => task.channel === channel).reduce((sum, task) => sum + task.quantity, 0) });
  const plannedQuestions = new Set(plannedTasks.flatMap((task) => task.question_ids)); const plannedScenarios = new Set(plannedTasks.flatMap((task) => task.scenario_ids)); const createdAt = utcNow(); const limitations = [...context.library.limitations];
  if (!diagnosisUsable && !limitations.some((item) => /诊断.*(不可用|无有效|没有有效|provider|API)/i.test(item))) limitations.push("基线诊断没有有效回答；内容优先级未使用品牌提及、推荐、竞品或引用表现，只继承探测覆盖不足限制。");
  const usedFactIds = new Set(dedupedFaqs.flatMap((faq) => faq.allowed_fact_ids));
  const plan: ContentPlan = { schema_version: 1, content_plan_id: stableId("content_plan_draft", context.library.scenario_library_id, createdAt), app_id: context.manifest.app_id, fact_snapshot_id: context.library.fact_snapshot_id, diagnosis_report_id: context.library.diagnosis_report_id, scenario_library_id: context.library.scenario_library_id, scenario_library_version: context.library.version, lifecycle: "review_required", version: 1, based_on_content_plan_id: null, created_at: createdAt, confirmed_at: null, fact_catalog: context.publicFacts.filter((fact) => usedFactIds.has(fact.fact_id)).map((fact) => ({ fact_id: fact.fact_id, field: fact.field, summary: factSummary(fact.value) })), faq_candidates: dedupedFaqs, topics, prompt_recipes: prompts, production_tasks: tasks, blockers, merge_suggestions: contentMergeSuggestions(dedupedFaqs, topics, tasks), quota: { requested_total: requestedTotal, planned_total: plannedTasks.length, by_channel: { social: byChannel("social"), media: byChannel("media"), b2b: byChannel("b2b"), site: byChannel("site") } }, coverage: { scenario_total: activeScenarios.length, scenario_planned: plannedScenarios.size, question_total: dedupedFaqs.length, question_planned: plannedQuestions.size, uncovered_question_ids: dedupedFaqs.flatMap((faq) => faq.question_ids).filter((id) => !plannedQuestions.has(id)) }, limitations };
  await saveDraft(projectRoot, plan); const manifestPath = path.join(projectRoot, "manifest.json"); const manifest = await readJson<Record<string, any>>(manifestPath); manifest.gates = manifest.gates ?? {}; manifest.gates.content_plan = { status: "review_required", at: null, fact_snapshot_id: plan.fact_snapshot_id, diagnosis_report_id: plan.diagnosis_report_id, scenario_library_id: plan.scenario_library_id, scenario_library_version: plan.scenario_library_version, content_plan_id: null, version: null }; manifest.updated_at = createdAt; await writeJson(manifestPath, manifest);
  return { plan, jsonPath: "strategy/content-plan-draft.json", reviewPath: "strategy/content-plan-review.md" };
}

function childObjects(plan: ContentPlan, topicId: string) { const topic = plan.topics.find((x) => x.topic_id === topicId); if (!topic) throw new Error(`content topic not found: ${topicId}`); return { topic, faqs: plan.faq_candidates.filter((x) => topic.faq_ids.includes(x.faq_id)), prompts: plan.prompt_recipes.filter((x) => x.topic_id === topicId), tasks: plan.production_tasks.filter((x) => x.topic_id === topicId) }; }

export async function reviewContentTopic(projectRoot: string, topicId: string, action: TopicAction, note?: string, patchPath?: string): Promise<ContentPlan> {
  const plan = await loadDraft(projectRoot); const child = childObjects(plan, topicId);
  if (action === "edit") { if (!patchPath) throw new Error("edit requires --input JSON patch"); const patch = await readJson<Partial<Pick<ContentTopic, "name" | "objective" | "target_audience" | "content_forms" | "desired_next_action">>>(path.resolve(patchPath)); Object.assign(child.topic, patch); }
  const status = action === "approve" || action === "edit" ? "approved" : action === "reject" ? "rejected" : "deferred"; child.topic.review_status = status; child.topic.review_note = note?.trim() || null;
  for (const item of [...child.faqs, ...child.prompts, ...child.tasks]) item.review_status = status;
  for (const task of child.tasks) { if (status === "rejected") task.status = "rejected"; else if (status === "deferred") task.status = "deferred"; else if (task.readiness === "ready" || task.readiness === "research_only") task.status = "planned"; }
  await saveDraft(projectRoot, plan); return plan;
}

export async function approveReadyContentTopics(projectRoot: string): Promise<ContentPlan> { const plan = await loadDraft(projectRoot); for (const topic of plan.topics) if (topic.review_status === "unreviewed" && topic.readiness === "ready") { const child = childObjects(plan, topic.topic_id); topic.review_status = "approved"; for (const x of [...child.faqs, ...child.prompts, ...child.tasks]) x.review_status = "approved"; } await saveDraft(projectRoot, plan); return plan; }

export async function reviewContentBlocker(projectRoot: string, blockerId: string, action: BlockerAction, reason: string): Promise<ContentPlan> {
  if (!reason.trim()) throw new Error("blocker review requires a reason"); const plan = await loadDraft(projectRoot); const blocker = plan.blockers.find((x) => x.blocker_id === blockerId); if (!blocker) throw new Error(`content blocker not found: ${blockerId}`);
  blocker.status = action === "research-only" ? "research_only" : action === "accept" ? "accepted" : action === "defer" ? "deferred" : "resolved"; blocker.review_reason = reason.trim();
  const faqIds = plan.faq_candidates.filter((x) => x.evidence_gap_ids.includes(blocker.evidence_gap_id)).map((x) => x.faq_id); const topics = plan.topics.filter((x) => x.evidence_gap_ids.includes(blocker.evidence_gap_id));
  for (const faq of plan.faq_candidates.filter((x) => faqIds.includes(x.faq_id))) faq.readiness = action === "research-only" ? "research_only" : action === "resolve" ? "ready" : "deferred";
  for (const topic of topics) topic.readiness = action === "research-only" ? "research_only" : action === "resolve" ? "ready" : "deferred";
  for (const task of plan.production_tasks.filter((x) => x.blocked_evidence_gap_ids.includes(blocker.evidence_gap_id))) { task.readiness = action === "research-only" ? "research_only" : action === "resolve" ? "ready" : "deferred"; task.mode = action === "research-only" ? "research_only" : "factual"; task.status = action === "research-only" || action === "resolve" ? "planned" : "deferred"; task.claim_boundaries = unique([...task.claim_boundaries, blocker.description]); }
  await saveDraft(projectRoot, plan); return plan;
}

export async function overrideContentPriority(projectRoot: string, topicId: string, score: number, actor: string, reason: string): Promise<ContentPlan> { if (!Number.isInteger(score) || score < 0 || score > 30) throw new Error("priority score must be between 0 and 30"); if (!actor.trim() || !reason.trim()) throw new Error("priority override requires actor and reason"); const plan = await loadDraft(projectRoot); const topic = plan.topics.find((x) => x.topic_id === topicId); if (!topic) throw new Error(`content topic not found: ${topicId}`); const override = { score, actor: actor.trim(), reason: reason.trim(), at: utcNow() }; topic.priority.override = override; topic.priority.final_score = score; topic.priority.tier = tier(score); for (const task of plan.production_tasks.filter((x) => x.topic_id === topicId)) { task.priority.override = override; task.priority.final_score = score; task.priority.tier = tier(score); } await saveDraft(projectRoot, plan); return plan; }

export async function overrideProductionTask(projectRoot: string, taskId: string, batch: number, quantity: number, actor: string, reason: string): Promise<ContentPlan> {
  if (!Number.isInteger(batch) || batch < 1 || !Number.isInteger(quantity) || quantity < 1) throw new Error("batch and quantity must be positive integers"); if (!actor.trim() || !reason.trim()) throw new Error("task override requires actor and reason"); const plan = await loadDraft(projectRoot); const task = plan.production_tasks.find((x) => x.task_id === taskId); if (!task) throw new Error(`production task not found: ${taskId}`); const originalBatch = task.batch; const originalQuantity = task.quantity; task.batch = batch; task.quantity = quantity; task.planning_override = { original_batch: originalBatch, original_quantity: originalQuantity, batch, quantity, actor: actor.trim(), reason: reason.trim(), at: utcNow() };
  const planned = plan.production_tasks.filter((x) => x.status === "planned").reduce((sum, x) => sum + x.quantity, 0); if (planned > plan.quota.requested_total) { task.batch = originalBatch; task.quantity = originalQuantity; task.planning_override = null; throw new Error("task override would exceed requested quota; increase the requested plan in a new draft instead of silently overfilling"); }
  plan.quota.planned_total = planned; for (const channel of ["social", "media", "b2b", "site"] as ContentChannel[]) { const channelPlanned = plan.production_tasks.filter((x) => x.status === "planned" && x.channel === channel).reduce((sum, x) => sum + x.quantity, 0); plan.quota.by_channel[channel].planned = channelPlanned; plan.quota.by_channel[channel].requested = Math.max(plan.quota.by_channel[channel].requested, channelPlanned); } await saveDraft(projectRoot, plan); return plan;
}

export async function reviewContentMerge(projectRoot: string, suggestionId: string, action: "approve" | "reject", reason: string): Promise<ContentPlan> {
  if (!reason.trim()) throw new Error("merge review requires a reason"); const plan = await loadDraft(projectRoot); const suggestion = plan.merge_suggestions.find((x) => x.suggestion_id === suggestionId); if (!suggestion) throw new Error(`content merge suggestion not found: ${suggestionId}`); suggestion.status = action === "approve" ? "approved" : "rejected"; suggestion.review_reason = reason.trim();
  if (action === "approve") { const [targetId, sourceId] = suggestion.item_ids; if (suggestion.item_type === "faq") { const target = plan.faq_candidates.find((x) => x.faq_id === targetId); const source = plan.faq_candidates.find((x) => x.faq_id === sourceId); if (!target || !source) throw new Error("merge references missing FAQ"); target.question_ids = unique([...target.question_ids, ...source.question_ids]); target.allowed_fact_ids = unique([...target.allowed_fact_ids, ...source.allowed_fact_ids]); target.evidence_gap_ids = unique([...target.evidence_gap_ids, ...source.evidence_gap_ids]); for (const topic of plan.topics) topic.faq_ids = unique(topic.faq_ids.map((id) => id === sourceId ? targetId : id)); plan.faq_candidates = plan.faq_candidates.filter((x) => x.faq_id !== sourceId); } else if (suggestion.item_type === "topic") { const target = plan.topics.find((x) => x.topic_id === targetId); const source = plan.topics.find((x) => x.topic_id === sourceId); if (!target || !source) throw new Error("merge references missing topic"); target.faq_ids = unique([...target.faq_ids, ...source.faq_ids]); target.question_ids = unique([...target.question_ids, ...source.question_ids]); target.allowed_fact_ids = unique([...target.allowed_fact_ids, ...source.allowed_fact_ids]); for (const task of plan.production_tasks.filter((x) => x.topic_id === sourceId)) task.status = "rejected"; source.review_status = "rejected"; source.review_note = `merged into ${targetId}: ${reason.trim()}`; } else { const target = plan.production_tasks.find((x) => x.task_id === targetId); const source = plan.production_tasks.find((x) => x.task_id === sourceId); if (!target || !source) throw new Error("merge references missing task"); target.faq_ids = unique([...target.faq_ids, ...source.faq_ids]); target.scenario_ids = unique([...target.scenario_ids, ...source.scenario_ids]); target.question_ids = unique([...target.question_ids, ...source.question_ids]); target.allowed_fact_ids = unique([...target.allowed_fact_ids, ...source.allowed_fact_ids]); target.blocked_evidence_gap_ids = unique([...target.blocked_evidence_gap_ids, ...source.blocked_evidence_gap_ids]); source.status = "rejected"; source.review_status = "rejected"; source.review_note = `merged into ${targetId}: ${reason.trim()}`; } }
  await saveDraft(projectRoot, plan); return plan;
}

export async function confirmContentPlan(projectRoot: string): Promise<{ plan: ContentPlan; path: string }> {
  const context = await loadPlanningContext(projectRoot); const draft = await loadDraft(projectRoot);
  if (draft.fact_snapshot_id !== context.library.fact_snapshot_id || draft.diagnosis_report_id !== context.library.diagnosis_report_id || draft.scenario_library_id !== context.library.scenario_library_id || draft.scenario_library_version !== context.library.version) throw new Error("content plan confirmation blocked: draft references stale upstream inputs");
  const unreviewed = draft.topics.filter((x) => x.review_status === "unreviewed"); if (unreviewed.length) throw new Error(`content plan confirmation blocked: ${unreviewed.length} topics remain unreviewed`);
  const pendingMerges = draft.merge_suggestions.filter((x) => x.status === "pending"); if (pendingMerges.length) throw new Error(`content plan confirmation blocked: ${pendingMerges.length} merge suggestions remain pending`);
  const openBlockers = draft.blockers.filter((x) => x.status === "open"); if (openBlockers.length) throw new Error(`content plan confirmation blocked: ${openBlockers.length} evidence blockers remain open`);
  const approvedTopics = draft.topics.filter((x) => x.review_status === "approved"); if (!approvedTopics.length) throw new Error("content plan confirmation blocked: no approved topics");
  for (const topic of approvedTopics) for (const task of draft.production_tasks.filter((x) => x.topic_id === topic.topic_id && x.status === "planned")) { if (!task.allowed_fact_ids.length || !task.channel_reason.trim() || !topic.objective.trim()) throw new Error(`content plan confirmation blocked: task ${task.task_id} is missing fact allowlist, channel reason, or objective`); if (!["ready", "research_only"].includes(task.readiness)) throw new Error(`content plan confirmation blocked: task ${task.task_id} is not evidence-ready`); }
  const activeTopicIds = new Set(approvedTopics.map((x) => x.topic_id)); const approvedFaqs = draft.faq_candidates.filter((x) => approvedTopics.some((topic) => topic.faq_ids.includes(x.faq_id))); const approvedPrompts = draft.prompt_recipes.filter((x) => activeTopicIds.has(x.topic_id)); const approvedTasks = draft.production_tasks.filter((x) => activeTopicIds.has(x.topic_id) && x.status === "planned");
  const fingerprint = { topics: approvedTopics, faqs: approvedFaqs, prompts: approvedPrompts, tasks: approvedTasks, blockers: draft.blockers, merges: draft.merge_suggestions, quota: draft.quota, coverage: draft.coverage, limitations: draft.limitations }; const contentPlanId = stableId("content_plan", draft.fact_snapshot_id, draft.diagnosis_report_id, draft.scenario_library_id, draft.scenario_library_version, draft.version, fingerprint); const out = path.join(projectRoot, "strategy", "content-plans", `${contentPlanId}.json`);
  let plan: ContentPlan; let confirmedAt: string;
  if (await pathExists(out)) { plan = await readJson<ContentPlan>(out); confirmedAt = plan.confirmed_at ?? utcNow(); }
  else { confirmedAt = utcNow(); const usedFactIds = new Set(approvedTasks.flatMap((task) => task.allowed_fact_ids)); plan = { ...draft, content_plan_id: contentPlanId, lifecycle: "confirmed", confirmed_at: confirmedAt, fact_catalog: draft.fact_catalog.filter((fact) => usedFactIds.has(fact.fact_id)), topics: approvedTopics, faq_candidates: approvedFaqs, prompt_recipes: approvedPrompts, production_tasks: approvedTasks }; plan.quota.planned_total = plan.production_tasks.reduce((sum, x) => sum + x.quantity, 0); for (const channel of ["social", "media", "b2b", "site"] as ContentChannel[]) plan.quota.by_channel[channel].planned = plan.production_tasks.filter((x) => x.channel === channel).reduce((sum, x) => sum + x.quantity, 0); await writeJson(out, plan); }
  await writeFile(path.join(projectRoot, "strategy", "content-plan.md"), renderReview(plan), "utf-8"); const manifestPath = path.join(projectRoot, "manifest.json"); const manifest = await readJson<Record<string, any>>(manifestPath); manifest.gates.content_plan = { status: "confirmed", at: confirmedAt, fact_snapshot_id: plan.fact_snapshot_id, diagnosis_report_id: plan.diagnosis_report_id, scenario_library_id: plan.scenario_library_id, scenario_library_version: plan.scenario_library_version, content_plan_id: contentPlanId, version: plan.version }; manifest.updated_at = confirmedAt; await writeJson(manifestPath, manifest); return { plan, path: relToProject(projectRoot, out) };
}

export async function reviseContentPlan(projectRoot: string, contentPlanId: string): Promise<{ plan: ContentPlan; path: string }> { const source = await readJson<ContentPlan>(path.join(projectRoot, "strategy", "content-plans", `${contentPlanId}.json`)); if (source.lifecycle !== "confirmed") throw new Error("content plan revision requires a confirmed plan"); const createdAt = utcNow(); const plan: ContentPlan = { ...source, content_plan_id: stableId("content_plan_draft", contentPlanId, source.version + 1, createdAt), lifecycle: "review_required", version: source.version + 1, based_on_content_plan_id: contentPlanId, created_at: createdAt, confirmed_at: null, topics: source.topics.map((x) => ({ ...x, review_status: "unreviewed", review_note: null })), faq_candidates: source.faq_candidates.map((x) => ({ ...x, review_status: "unreviewed", review_note: null })), prompt_recipes: source.prompt_recipes.map((x) => ({ ...x, review_status: "unreviewed" })), production_tasks: source.production_tasks.map((x) => ({ ...x, review_status: "unreviewed", review_note: null })) }; await saveDraft(projectRoot, plan); return { plan, path: "strategy/content-plan-draft.json" }; }

export async function contentPlanInput(projectRoot: string): Promise<{ content_plan_id: string; fact_snapshot_id: string; tasks: ProductionTask[] }> { const manifest = await readJson<Record<string, any>>(path.join(projectRoot, "manifest.json")); const gate = manifest.gates?.content_plan; if (gate?.status !== "confirmed" || !gate.content_plan_id) throw new Error("article generation blocked: content plan is not confirmed"); const plan = await readJson<ContentPlan>(path.join(projectRoot, "strategy", "content-plans", `${gate.content_plan_id}.json`)); if (plan.lifecycle !== "confirmed" || plan.content_plan_id !== gate.content_plan_id || plan.fact_snapshot_id !== gate.fact_snapshot_id || plan.scenario_library_id !== gate.scenario_library_id) throw new Error("article generation blocked: confirmed content plan artifact is missing or stale"); return { content_plan_id: plan.content_plan_id, fact_snapshot_id: plan.fact_snapshot_id, tasks: plan.production_tasks.filter((x) => x.status === "planned" && ["ready", "research_only"].includes(x.readiness) && x.review_status === "approved") }; }

function collectStrings(value: unknown, key = "$", out: Array<{ key: string; text: string }> = []): Array<{ key: string; text: string }> { if (typeof value === "string" && value.trim()) out.push({ key, text: value.trim() }); else if (Array.isArray(value)) value.forEach((x, i) => collectStrings(x, `${key}[${i}]`, out)); else if (value && typeof value === "object") for (const [k, child] of Object.entries(value as Record<string, unknown>)) collectStrings(child, `${key}.${k}`, out); return out; }
function legacyKind(key: string): LegacyContentCandidate["kind"] { if (/faq|question/i.test(key)) return "faq"; if (/prompt/i.test(key)) return "prompt"; if (/keyword|term/i.test(key)) return "keyword"; if (/generation|task|plan/i.test(key)) return "generation_task"; return "unknown"; }

export async function importLegacyContent(projectRoot: string, inputPaths: string[]): Promise<{ audit: LegacyContentAudit; jsonPath: string; markdownPath: string }> {
  if (!inputPaths.length) throw new Error("legacy content import requires at least one input file"); const manifest = await readJson<Record<string, any>>(path.join(projectRoot, "manifest.json")); const candidates: LegacyContentCandidate[] = []; const firstByText = new Map<string, string>();
  for (const input of inputPaths) { const absolute = path.resolve(input); const raw = JSON.parse(await readFile(absolute, "utf-8")) as unknown; for (const item of collectStrings(raw)) { const normalized = normalizeScenarioText(item.text); const candidateId = stableId("legacy_content", relToProject(projectRoot, absolute), item.key, item.text); const prior = firstByText.get(normalized) ?? null; if (!prior) firstByText.set(normalized, candidateId); candidates.push({ candidate_id: candidateId, kind: legacyKind(item.key), text: item.text, normalized_text: normalized, source_path: relToProject(projectRoot, absolute), original_key: item.key, duplicate_of_candidate_id: prior, evidence_status: "unreviewed" }); } }
  const audit: LegacyContentAudit = { schema_version: 1, app_id: manifest.app_id, generated_at: utcNow(), sources: unique(candidates.map((x) => x.source_path)), candidates, counts: { total: candidates.length, unique: firstByText.size, exact_duplicates: candidates.filter((x) => x.duplicate_of_candidate_id).length } }; const jsonPath = path.join(projectRoot, "strategy", "legacy", "content-audit.json"); const mdPath = path.join(projectRoot, "strategy", "legacy", "content-audit.md"); await writeJson(jsonPath, audit); await writeFile(mdPath, ["# 旧内容资产审计", "", "> 这些内容只是未确认候选，不是企业事实、正式内容计划或文章。", "", `- 来源文件：${audit.sources.length}`, `- 文本候选：${audit.counts.total}`, `- 精确唯一：${audit.counts.unique}`, `- 精确重复：${audit.counts.exact_duplicates}`, "", ...audit.sources.map((x) => `- \`${x}\``), ""].join("\n"), "utf-8"); return { audit, jsonPath: relToProject(projectRoot, jsonPath), markdownPath: relToProject(projectRoot, mdPath) };
}
