import { createRequire } from "node:module";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ContentPlan, LegacyContentAudit } from "./content-plan-model.js";
import type { ScenarioLibrary } from "./scenario-model.js";
import { normalizeScenarioText } from "./scenario-strategy.js";
import { pathExists, readJson } from "./util.js";

const require = createRequire(import.meta.url);
const Ajv = require("ajv/dist/2020") as typeof import("ajv/dist/2020.js").default;
const addFormats = require("ajv-formats") as (ajv: InstanceType<typeof Ajv>) => void;
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCHEMAS_DIR = path.join(PACKAGE_ROOT, "schemas");
export interface ContentPlanValidationResult { ok: boolean; errors: string[]; checked: string[] }

function schemaErrors(prefix: string, errors: Array<{ instancePath: string; message?: string }> | null | undefined): string[] { return (errors ?? []).map((error) => `${prefix}${error.instancePath || "/"} ${error.message ?? "invalid"}`); }
function objectKeys(value: unknown): string[] { if (Array.isArray(value)) return value.flatMap(objectKeys); if (!value || typeof value !== "object") return []; return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [key, ...objectKeys(child)]); }
const SENSITIVE_FACT_FIELD = /(password|passwd|token|secret|id_card|identity_card|legal_representative_id|法人身份证|身份证|口令|密码|密钥|令牌)/i;

export async function validateContentPlanning(projectRoot: string): Promise<ContentPlanValidationResult> {
  const errors: string[] = []; const checked: string[] = []; const ajv = new Ajv({ allErrors: true, strict: false }); addFormats(ajv);
  const planValidator = ajv.compile(JSON.parse(await readFile(path.join(SCHEMAS_DIR, "content-plan.schema.json"), "utf-8")) as object);
  const legacyValidator = ajv.compile(JSON.parse(await readFile(path.join(SCHEMAS_DIR, "legacy-content-audit.schema.json"), "utf-8")) as object);
  const manifest = await readJson<Record<string, any>>(path.join(projectRoot, "manifest.json")); const clean = manifest.gates?.clean; const diagnose = manifest.gates?.diagnose; const scenarioGate = manifest.gates?.scenario;
  const snapshot = clean?.fact_snapshot_id ? await readJson<Record<string, any>>(path.join(projectRoot, "knowledge", "snapshots", `${clean.fact_snapshot_id}.json`)) : null;
  const publicFactIds = new Set<string>((snapshot?.facts?.facts ?? []).filter((fact: any) => fact.review_status === "confirmed" && fact.disclosure_level === "public" && !SENSITIVE_FACT_FIELD.test(String(fact.field ?? ""))).map((fact: any) => fact.fact_id));
  const scenarioPath = scenarioGate?.scenario_library_id ? path.join(projectRoot, "strategy", "scenario-libraries", `${scenarioGate.scenario_library_id}.json`) : "";
  const library = scenarioPath && await pathExists(scenarioPath) ? await readJson<ScenarioLibrary>(scenarioPath) : null;
  const scenarioIds = new Set(library?.scenarios.map((x) => x.scenario_id) ?? []); const questionIds = new Set(library?.scenarios.flatMap((x) => x.representative_questions.map((q) => q.question_id)) ?? []); const evidenceGapIds = new Set(library?.scenarios.flatMap((x) => x.evidence_gaps.map((g) => g.evidence_gap_id)) ?? []);
  const strategyRoot = path.join(projectRoot, "strategy"); const candidates = [path.join(strategyRoot, "content-plan-draft.json")]; const confirmedDir = path.join(strategyRoot, "content-plans"); if (await pathExists(confirmedDir)) for (const name of (await readdir(confirmedDir)).filter((x) => x.endsWith(".json"))) candidates.push(path.join(confirmedDir, name));
  const plans: ContentPlan[] = [];
  for (const file of candidates) {
    if (!(await pathExists(file))) continue; const rel = path.relative(projectRoot, file); const plan = await readJson<ContentPlan>(file); plans.push(plan); checked.push(rel);
    if (!planValidator(plan)) errors.push(...schemaErrors(`${rel}:`, planValidator.errors));
    if (plan.app_id !== manifest.app_id) errors.push(`${rel}: app_id mismatch`);
    if (plan.fact_snapshot_id !== clean?.fact_snapshot_id || plan.diagnosis_report_id !== diagnose?.report_id || plan.scenario_library_id !== scenarioGate?.scenario_library_id || plan.scenario_library_version !== scenarioGate?.version) errors.push(`${rel}: stale or mismatched upstream versions`);
    const faqIds = new Set<string>(); const topicIds = new Set<string>(); const promptIds = new Set<string>(); const taskIds = new Set<string>();
    for (const fact of plan.fact_catalog) if (!publicFactIds.has(fact.fact_id)) errors.push(`${rel}: fact catalog contains non-public/non-confirmed fact ${fact.fact_id}`);
    for (const faq of plan.faq_candidates) { if (faqIds.has(faq.faq_id)) errors.push(`${rel}: duplicate faq_id ${faq.faq_id}`); faqIds.add(faq.faq_id); if (faq.normalized_question !== normalizeScenarioText(faq.question)) errors.push(`${rel}: FAQ normalization mismatch ${faq.faq_id}`); if (!scenarioIds.has(faq.scenario_id)) errors.push(`${rel}: FAQ references missing scenario ${faq.scenario_id}`); for (const id of faq.question_ids) if (!questionIds.has(id)) errors.push(`${rel}: FAQ references missing question ${id}`); for (const id of faq.allowed_fact_ids) if (!publicFactIds.has(id)) errors.push(`${rel}: FAQ references non-public/non-confirmed fact ${id}`); for (const id of faq.evidence_gap_ids) if (!evidenceGapIds.has(id)) errors.push(`${rel}: FAQ references missing evidence gap ${id}`); }
    for (const topic of plan.topics) { if (topicIds.has(topic.topic_id)) errors.push(`${rel}: duplicate topic_id ${topic.topic_id}`); topicIds.add(topic.topic_id); for (const id of topic.faq_ids) if (!faqIds.has(id)) errors.push(`${rel}: topic references missing FAQ ${id}`); for (const id of topic.scenario_ids) if (!scenarioIds.has(id)) errors.push(`${rel}: topic references missing scenario ${id}`); for (const id of topic.question_ids) if (!questionIds.has(id)) errors.push(`${rel}: topic references missing question ${id}`); for (const id of topic.allowed_fact_ids) if (!publicFactIds.has(id)) errors.push(`${rel}: topic references non-public/non-confirmed fact ${id}`); if (!topic.objective.trim()) errors.push(`${rel}: topic ${topic.topic_id} has no single objective`); }
    for (const prompt of plan.prompt_recipes) { if (promptIds.has(prompt.prompt_id)) errors.push(`${rel}: duplicate prompt_id ${prompt.prompt_id}`); promptIds.add(prompt.prompt_id); if (!topicIds.has(prompt.topic_id)) errors.push(`${rel}: prompt references missing topic ${prompt.topic_id}`); for (const id of prompt.allowed_fact_ids) if (!publicFactIds.has(id)) errors.push(`${rel}: prompt references non-public/non-confirmed fact ${id}`); }
    for (const task of plan.production_tasks) { if (taskIds.has(task.task_id)) errors.push(`${rel}: duplicate task_id ${task.task_id}`); taskIds.add(task.task_id); if (!topicIds.has(task.topic_id) || !promptIds.has(task.prompt_id)) errors.push(`${rel}: task ${task.task_id} references missing topic/prompt`); if (task.fact_snapshot_id !== plan.fact_snapshot_id) errors.push(`${rel}: task ${task.task_id} has stale fact snapshot`); for (const id of task.allowed_fact_ids) if (!publicFactIds.has(id)) errors.push(`${rel}: task references non-public/non-confirmed fact ${id}`); if (task.status === "planned" && !["ready", "research_only"].includes(task.readiness)) errors.push(`${rel}: planned task ${task.task_id} is not evidence-ready`); if (task.mode === "research_only" && !task.claim_boundaries.length) errors.push(`${rel}: research-only task ${task.task_id} needs claim boundaries`); if (task.use_knowledge !== true) errors.push(`${rel}: task ${task.task_id} must use knowledge`); }
    for (const blocker of plan.blockers) { if (!scenarioIds.has(blocker.scenario_id) || !evidenceGapIds.has(blocker.evidence_gap_id)) errors.push(`${rel}: blocker ${blocker.blocker_id} has broken source reference`); if (blocker.status !== "open" && !blocker.review_reason) errors.push(`${rel}: reviewed blocker ${blocker.blocker_id} requires reason`); }
    const planned = plan.production_tasks.filter((x) => x.status === "planned").reduce((sum, x) => sum + x.quantity, 0); if (plan.quota.planned_total !== planned) errors.push(`${rel}: planned quota does not match planned tasks`); if (plan.quota.planned_total > plan.quota.requested_total) errors.push(`${rel}: planned quota exceeds requested quota`);
    const forbidden = new Set(["daze", "zhaixing", "zxingo", "huixin", "conversion_target", "scene_word", "platform_export", "platform_route"]); const found = objectKeys(plan).filter((key) => forbidden.has(key.toLowerCase())); if (found.length) errors.push(`${rel}: competitor-specific schema keys are forbidden: ${unique(found).join(", ")}`);
  }
  const legacyPath = path.join(strategyRoot, "legacy", "content-audit.json"); if (await pathExists(legacyPath)) { const audit = await readJson<LegacyContentAudit>(legacyPath); checked.push("strategy/legacy/content-audit.json"); if (!legacyValidator(audit)) errors.push(...schemaErrors("strategy/legacy/content-audit.json:", legacyValidator.errors)); }
  const gate = manifest.gates?.content_plan; if (gate?.status === "confirmed") { const plan = plans.find((x) => x.content_plan_id === gate.content_plan_id); if (!plan || plan.lifecycle !== "confirmed") errors.push("manifest content_plan gate references a missing or unconfirmed plan"); if (gate.fact_snapshot_id !== clean?.fact_snapshot_id || gate.diagnosis_report_id !== diagnose?.report_id || gate.scenario_library_id !== scenarioGate?.scenario_library_id || gate.scenario_library_version !== scenarioGate?.version) errors.push("manifest content_plan gate references stale upstream inputs"); }
  if (await pathExists(strategyRoot)) for (const name of await readdir(strategyRoot)) if (["daze", "zhaixing", "zxingo", "huixin"].some((x) => name.toLowerCase().includes(x))) errors.push(`strategy/${name}: competitor-specific export/file is forbidden`);
  return { ok: errors.length === 0, errors, checked };
}

function unique(values: string[]): string[] { return [...new Set(values)]; }
