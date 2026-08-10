import assert from "node:assert/strict";
import { access, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { stableId, type FactRecord } from "../lib/fact-model.js";
import type { ScenarioLibrary, ScenarioSourceReference } from "../lib/scenario-model.js";
import {
  approveReadyContentTopics, confirmContentPlan, contentMergeSuggestions, contentPlanInput, generateContentPlan, importLegacyContent,
  overrideContentPriority, overrideProductionTask, reviseContentPlan, reviewContentBlocker, reviewContentMerge, reviewContentTopic,
} from "../lib/content-planning.js";
import { validateContentPlanning } from "../lib/content-plan-validate.js";
import { readJson, writeJson } from "../lib/util.js";

async function contentFixture(scenarioConfirmed = true): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "geo-content-plan-")); const appId = "app_content_test"; const snapshotId = "fact_snapshot_content"; const reportId = "diagnosis_report_content"; const libraryId = "scenario_library_content";
  const publicFact: FactRecord = { fact_id: "fact_public", subject_id: "subject_product", field: "capabilities", value: ["支持小批量试单", "支持机构配色定制"], unit: null, source_refs: ["src_profile"], derivation: "operator", confidence: 0.9, review_status: "confirmed", disclosure_level: "public" };
  const restrictedFact: FactRecord = { ...publicFact, fact_id: "fact_restricted", field: "contact_phone", value: "13800000000", disclosure_level: "restricted" };
  const sensitivePublicFact: FactRecord = { ...publicFact, fact_id: "fact_sensitive_public", field: "account_password", value: "must-never-leak", disclosure_level: "public" };
  const ref = (id: string, text: string): ScenarioSourceReference => ({ source_ref_id: stableId("scenario_source", id), kind: "fact", ref_id: id, path: null, original_bucket: null, text, derivation: "operator" });
  const gapId = "evidence_gap_single_custom"; const scenarioId = "scenario_custom";
  const library: ScenarioLibrary = {
    schema_version: 1, scenario_library_id: libraryId, app_id: appId, fact_snapshot_id: snapshotId, diagnosis_report_id: reportId, diagnosis_gap_path: `diagnosis/gaps/${reportId}.json`, lifecycle: "confirmed", version: 1, based_on_scenario_library_id: null, created_at: "2026-01-01T00:00:00Z", confirmed_at: "2026-01-02T00:00:00Z",
    scenarios: [{ scenario_id: scenarioId, name: "儿童演出服采购与定制", target_customer: "舞蹈培训机构", customer_need: "选择适合小批量采购的儿童演出服", concerns: ["起订量", "配色定制"], representative_questions: [
      { question_id: "question_ready", text: "儿童演出服小批量采购怎么选？", normalized_text: "儿童演出服小批量采购怎么选", facets: { wording_form: "how_to", regions: [], decision_stage: "supplier_selection", direction: "neutral", product_subject_ids: ["subject_product"], capability_terms: ["小批量"], constraints: [] }, fact_ids: ["fact_public", "fact_restricted"], evidence_gap_ids: [], source_refs: [ref("fact_public", "支持小批量试单"), ref("fact_restricted", "13800000000")] },
      { question_id: "question_ready_duplicate", text: "儿童演出服小批量采购怎么选？", normalized_text: "儿童演出服小批量采购怎么选", facets: { wording_form: "how_to", regions: [], decision_stage: "supplier_selection", direction: "neutral", product_subject_ids: ["subject_product"], capability_terms: ["小批量"], constraints: [] }, fact_ids: ["fact_public", "fact_sensitive_public"], evidence_gap_ids: [], source_refs: [ref("fact_public", "支持小批量试单"), ref("fact_sensitive_public", "敏感内容不得进入计划")] },
      { question_id: "question_blocked", text: "可以单件定制吗？", normalized_text: "可以单件定制吗", facets: { wording_form: "direct_question", regions: [], decision_stage: "supplier_selection", direction: "neutral", product_subject_ids: ["subject_product"], capability_terms: ["定制"], constraints: [] }, fact_ids: ["fact_public"], evidence_gap_ids: [gapId], source_refs: [{ source_ref_id: "customer_ref", kind: "customer_language", ref_id: "customer_question", path: "inputs/chat.txt", original_bucket: null, text: "可以单件定制吗？", derivation: "extracted" }, ref("fact_public", "支持机构配色定制")] },
    ], supporting_fact_ids: ["fact_public"], evidence_gaps: [{ evidence_gap_id: gapId, kind: "business_evidence", severity: "high", description: "支持小批量和机构定制不能证明支持单件定制", scenario_id: scenarioId, question_ids: ["question_blocked"], fact_ids: ["fact_public"], source_refs: [], status: "deferred", review_reason: "待企业确认" }], source_refs: [ref("fact_public", "支持小批量试单和机构定制")], desired_next_action: { type: "contact_sales", label: "咨询采购条件", url: null }, priority: { components: { business_value: 5, diagnosis_gap: 0, evidence_readiness: 5, customer_language: 5, operator_judgment: 0 }, calculated_total: 15, final_score: 15, tier: "medium", rationale: ["采购问题"], override: null }, review_status: "approved", review_note: null }], merge_suggestions: [], limitations: ["基线诊断仅有 API 不可用记录"]
  };
  await writeJson(path.join(root, "manifest.json"), { app_id: appId, project_name: "内容规划测试", gates: { clean: { status: "confirmed", at: "2026-01-01T00:00:00Z", fact_snapshot_id: snapshotId }, diagnose: { status: "confirmed", at: "2026-01-02T00:00:00Z", fact_snapshot_id: snapshotId, report_id: reportId }, scenario: { status: scenarioConfirmed ? "confirmed" : "review_required", at: scenarioConfirmed ? "2026-01-02T00:00:00Z" : null, fact_snapshot_id: snapshotId, diagnosis_report_id: reportId, scenario_library_id: scenarioConfirmed ? libraryId : null, version: scenarioConfirmed ? 1 : null } }, missing: [], clean_pipeline: { stage: "confirmed", inputs_hash: "a".repeat(64), facts_hash: "b".repeat(64), changed_since_confirmation: false, previous_snapshot_id: null }, clean_ready: true, review_ready: true });
  await writeJson(path.join(root, "knowledge", "snapshots", `${snapshotId}.json`), { fact_snapshot_id: snapshotId, facts: { facts: [publicFact, restrictedFact, sensitivePublicFact] } });
  await writeJson(path.join(root, "diagnosis", "reports", `${reportId}.json`), { status: "confirmed", fact_snapshot_id: snapshotId, metrics: { valid_probes: 0 }, limitations: ["API 未配置"] });
  await writeJson(path.join(root, "strategy", "scenario-libraries", `${libraryId}.json`), library); return root;
}

test("content planning requires an exact confirmed scenario gate", async () => { const root = await contentFixture(false); await assert.rejects(generateContentPlan(root), /scenario library is not confirmed/); });

test("content plan keeps four objects separate, excludes restricted facts, and generates no article", async () => {
  const root = await contentFixture(); const generated = await generateContentPlan(root, 10); assert.equal(generated.plan.faq_candidates.length, 2); assert.equal(generated.plan.topics.length, 2); assert.equal(generated.plan.prompt_recipes.length, 4); assert.equal(generated.plan.production_tasks.length, 4);
  assert(generated.plan.faq_candidates.every((x) => !x.allowed_fact_ids.includes("fact_restricted") && !x.allowed_fact_ids.includes("fact_sensitive_public"))); assert.deepEqual(generated.plan.fact_catalog.map((x) => x.fact_id), ["fact_public"]); assert(generated.plan.faq_candidates.find((x) => x.question_ids.includes("question_ready"))?.question_ids.includes("question_ready_duplicate")); assert(generated.plan.production_tasks.every((x) => x.use_knowledge)); assert.equal(generated.plan.limitations.filter((x) => /API.*不可用|没有有效回答/.test(x)).length, 1);
  assert(Object.values(generated.plan.quota.by_channel).every((quota) => quota.planned <= quota.requested));
  const blocked = generated.plan.production_tasks.filter((x) => x.question_ids.includes("question_blocked")); assert(blocked.every((x) => x.status === "blocked" && x.readiness === "blocked")); assert(blocked.every((x) => x.claim_boundaries.some((claim) => claim.includes("单件定制"))));
  await assert.rejects(access(path.join(root, "articles"))); const validation = await validateContentPlanning(root); assert.deepEqual(validation.errors, []);
});

test("research-only handling, human review, immutable confirmation and downstream gate form an auditable chain", async () => {
  const root = await contentFixture(); const generated = await generateContentPlan(root, 10); await approveReadyContentTopics(root); await assert.rejects(confirmContentPlan(root), /topics remain unreviewed/);
  const blocker = generated.plan.blockers[0]; await reviewContentBlocker(root, blocker.blocker_id, "research-only", "只写需要向厂家核验哪些条件，不声明企业支持单件定制"); const draft = await readJson<typeof generated.plan>(path.join(root, "strategy", "content-plan-draft.json")); const blockedTopic = draft.topics.find((x) => x.question_ids.includes("question_blocked"))!; await reviewContentTopic(root, blockedTopic.topic_id, "approve", "批准为非声明型研究内容");
  const confirmed = await confirmContentPlan(root); assert.equal(confirmed.plan.lifecycle, "confirmed"); const repeated = await confirmContentPlan(root); assert.deepEqual(repeated.plan, confirmed.plan); const input = await contentPlanInput(root); assert(input.tasks.some((x) => x.mode === "research_only")); assert(input.tasks.filter((x) => x.mode === "research_only").every((x) => x.claim_boundaries.length > 0));
  const manifest = await readJson<Record<string, any>>(path.join(root, "manifest.json")); assert.equal(manifest.gates.content_plan.content_plan_id, confirmed.plan.content_plan_id); const validation = await validateContentPlanning(root); assert.deepEqual(validation.errors, []);
  await generateContentPlan(root, 10); const preserved = await readJson<typeof confirmed.plan>(path.join(root, "strategy", "content-plans", `${confirmed.plan.content_plan_id}.json`)); assert.deepEqual(preserved, confirmed.plan);
  const revision = await reviseContentPlan(root, confirmed.plan.content_plan_id); assert.equal(revision.plan.version, 2); assert.equal(revision.plan.based_on_content_plan_id, confirmed.plan.content_plan_id); assert.equal(revision.plan.lifecycle, "review_required");
});

test("priority and batch/quantity overrides preserve original values and never overfill quota", async () => {
  const root = await contentFixture(); const generated = await generateContentPlan(root, 6); const topic = generated.plan.topics[0]; const task = generated.plan.production_tasks.find((x) => x.topic_id === topic.topic_id)!; const calculated = topic.priority.calculated_total;
  await overrideContentPriority(root, topic.topic_id, 28, "tester", "首批重点主题"); await overrideProductionTask(root, task.task_id, 2, 2, "tester", "第二批增加一个渠道变体"); const draft = await readJson<typeof generated.plan>(path.join(root, "strategy", "content-plan-draft.json")); const updatedTopic = draft.topics.find((x) => x.topic_id === topic.topic_id)!; const updatedTask = draft.production_tasks.find((x) => x.task_id === task.task_id)!; assert.equal(updatedTopic.priority.calculated_total, calculated); assert.equal(updatedTopic.priority.override?.actor, "tester"); assert.equal(updatedTask.planning_override?.original_quantity, 1); assert.equal(updatedTask.batch, 2); await assert.rejects(overrideProductionTask(root, task.task_id, 2, 99, "tester", "不应允许凑量"), /exceed requested quota/);
});

test("legacy content import preserves source keys and exact-duplicate provenance without becoming a plan", async () => {
  const root = await contentFixture(); const input = path.join(root, "legacy.json"); await writeJson(input, { faq: ["儿童演出服怎么选？", "儿童演出服怎么选"], prompts: ["请写一篇销量第一的文章"], generation_plan: { tasks: [{ keyword: "儿童演出服", limit: 10 }] } }); const result = await importLegacyContent(root, [input]); assert(result.audit.counts.total >= 4); assert(result.audit.counts.exact_duplicates >= 1); assert(result.audit.candidates.some((x) => x.kind === "prompt")); await assert.rejects(access(path.join(root, "strategy", "content-plan-draft.json")));
});

test("runtime content contract stays platform-independent and uses only Buda channels", async () => {
  const root = await contentFixture(); const generated = await generateContentPlan(root, 10); assert(generated.plan.production_tasks.every((x) => ["social", "media", "b2b", "site"].includes(x.channel))); const raw = JSON.stringify(generated.plan).toLowerCase(); for (const forbidden of ["daze", "zhaixing", "zxingo", "huixin", "platform_export"]) assert.equal(raw.includes(forbidden), false);
});

test("semantic overlap remains a human-reviewed suggestion and an approved FAQ merge keeps provenance", async () => {
  const root = await contentFixture(); const generated = await generateContentPlan(root, 10); const source = generated.plan.faq_candidates[0]; const near = { ...structuredClone(source), faq_id: "faq_near", question: "儿童演出服小批量采购应该怎么选？", normalized_question: "儿童演出服小批量采购应该怎么选", question_ids: ["question_ready_duplicate"] };
  const suggestions = contentMergeSuggestions([source, near], [], []); assert.equal(suggestions.length, 1); const suggestion = suggestions[0]; generated.plan.faq_candidates.push(near); generated.plan.topics.find((x) => x.faq_ids.includes(source.faq_id))!.faq_ids.push(near.faq_id); generated.plan.merge_suggestions = [suggestion]; await writeJson(path.join(root, "strategy", "content-plan-draft.json"), generated.plan);
  const reviewed = await reviewContentMerge(root, suggestion.suggestion_id, "approve", "同一采购问题只保留一种标准问法"); assert.equal(reviewed.merge_suggestions[0].status, "approved"); assert.equal(reviewed.faq_candidates.some((x) => x.faq_id === near.faq_id), false); assert(reviewed.faq_candidates.find((x) => x.faq_id === source.faq_id)!.question_ids.includes("question_ready_duplicate"));
});
