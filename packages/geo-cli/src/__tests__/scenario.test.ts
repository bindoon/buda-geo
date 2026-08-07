import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { stableId, type FactLedger, type FactRecord, type SubjectRecord } from "../lib/fact-model.js";
import {
  approveReadyScenarios,
  confirmScenarioLibrary,
  generateScenarioDraft,
  importLegacyKeywords,
  normalizeScenarioText,
  overrideScenarioPriority,
  reviewEvidenceGap,
  reviewScenario,
  scenarioLibraryInput,
  semanticSuggestions,
} from "../lib/scenario-strategy.js";
import { validateScenarioStrategy } from "../lib/scenario-validate.js";
import { readJson, writeJson } from "../lib/util.js";

async function fixtureProject(diagnosisConfirmed = true): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "geo-scenario-")); const appId = "app_scenario_test";
  const companyId = stableId("sub_company", appId); const brandId = stableId("sub_brand", appId, "测试服饰"); const productId = stableId("sub_product", appId, "儿童演出服");
  const subjects: SubjectRecord[] = [
    { subject_id: companyId, type: "company", name: "测试服饰有限公司", parent_subject_id: null, source_refs: ["src_form"], review_status: "confirmed" },
    { subject_id: brandId, type: "brand", name: "测试服饰", parent_subject_id: companyId, source_refs: ["src_form"], review_status: "confirmed" },
    { subject_id: productId, type: "product", name: "儿童演出服", parent_subject_id: companyId, source_refs: ["src_profile"], review_status: "confirmed" },
  ];
  const facts: FactRecord[] = []; const add = (subjectId: string, field: string, value: unknown) => facts.push({ fact_id: stableId("fact", subjectId, field, value), subject_id: subjectId, field, value, unit: null, source_refs: ["src_profile"], derivation: "operator", confidence: 0.9, review_status: "confirmed", disclosure_level: "public" });
  add(companyId, "company_name", "测试服饰有限公司"); add(companyId, "company_short_name", "测试服饰"); add(companyId, "address", "山东省测试市测试县"); add(companyId, "website_or_shop_url", "https://example.com/shop");
  add(companyId, "intro", "面向舞蹈培训机构、电商卖家和外贸客户提供儿童演出服生产供应。"); add(companyId, "products_services", "支持一件起混批、小批量试单、机构 LOGO 与配色定制，并提供发货和售后支持。"); add(companyId, "pain_points", ["机构采购关注尺码、面料、交付与售后"]);
  add(brandId, "name", "测试服饰"); add(productId, "name", "儿童演出服"); add(productId, "category", "儿童舞蹈服饰"); add(productId, "attributes", { size: "100-160", material: "网纱与棉里衬", scenes: "练功、考级、汇演" }); add(productId, "capabilities", ["生产供应", "一件起混批与小批量试单", "机构 LOGO、配色和尺码定制"]); add(productId, "is_main", true);
  const ledger: FactLedger = { app_id: appId, generated_at: "2026-01-01T00:00:00Z", inputs_hash: "a".repeat(64), facts_hash: "b".repeat(64), subjects, facts, conflicts: [] };
  const snapshotId = stableId("fact_snapshot", ledger.inputs_hash, ledger.facts_hash); const reportId = "diagnosis_report_test";
  await writeJson(path.join(root, "manifest.json"), { app_id: appId, project_name: "测试服饰", gates: { clean: { status: "confirmed", at: "2026-01-01T00:00:00Z", fact_snapshot_id: snapshotId }, diagnose: { status: diagnosisConfirmed ? "confirmed" : "pending", at: diagnosisConfirmed ? "2026-01-02T00:00:00Z" : null, fact_snapshot_id: diagnosisConfirmed ? snapshotId : null, seed_set_id: diagnosisConfirmed ? "seed_set_test" : null, run_id: diagnosisConfirmed ? "diagnosis_run_test" : null, report_id: diagnosisConfirmed ? reportId : null, limitations_accepted: true } }, missing: [{ code: "chat_logs", severity: "recommend", message: "未提供询盘" }], clean_pipeline: { stage: "confirmed", inputs_hash: ledger.inputs_hash, facts_hash: ledger.facts_hash, changed_since_confirmation: false, previous_snapshot_id: null }, clean_ready: true, review_ready: true });
  await writeJson(path.join(root, "knowledge", "snapshots", `${snapshotId}.json`), { schema_version: 2, fact_snapshot_id: snapshotId, app_id: appId, confirmed_at: "2026-01-01T00:00:00Z", inputs_hash: ledger.inputs_hash, facts_hash: ledger.facts_hash, source_index: { app_id: appId, generated_at: "2026-01-01T00:00:00Z", inputs_hash: ledger.inputs_hash, sources: [] }, facts: ledger });
  if (diagnosisConfirmed) {
    await writeJson(path.join(root, "diagnosis", "reports", `${reportId}.json`), { schema_version: 1, report_id: reportId, app_id: appId, project_name: "测试服饰", fact_snapshot_id: snapshotId, seed_set_id: "seed_set_test", run_id: "diagnosis_run_test", generated_at: "2026-01-02T00:00:00Z", status: "confirmed", confirmed_at: "2026-01-02T00:00:00Z", limitations_accepted: true, metrics: {}, probes: [], gaps: [], limitations: [] });
    await writeJson(path.join(root, "diagnosis", "gaps", `${reportId}.json`), { schema_version: 1, report_id: reportId, status: "confirmed", confirmed_at: "2026-01-02T00:00:00Z", gaps: [{ gap_id: "gap_probe_coverage", kind: "probe_coverage", severity: "high", observed_issue: "API 未配置" }] });
  }
  return root;
}

test("scenario generation requires confirmed fact and diagnosis gates", async () => {
  const root = await fixtureProject(false); await assert.rejects(generateScenarioDraft(root), /baseline diagnosis is not confirmed/);
});

test("legacy audit preserves original buckets and exact duplicate provenance", async () => {
  const root = await fixtureProject(); const input = path.join(root, "legacy-keywords.json");
  await writeJson(input, { app_id: "app_scenario_test", brand: { terms: ["测试服饰"] }, search: { terms: ["儿童演出服"], questions: ["儿童演出服怎么选？"] }, qa: { questions: ["儿童演出服怎么选"] }, intent: { questions: ["测试县儿童演出服厂家有哪些？"] }, source: "fixture" });
  const result = await importLegacyKeywords(root, input); assert.equal(result.audit.counts.total, 5); assert.equal(result.audit.counts.unique, 4); assert.equal(result.audit.counts.exact_duplicates, 1); assert(result.audit.candidates.some((item) => item.original_bucket === "qa.questions"));
});

test("scenario library keeps independent facets, evidence links, priority history and confirmation gate", async () => {
  const root = await fixtureProject(); const input = path.join(root, "legacy-keywords.json");
  await writeJson(input, { app_id: "app_scenario_test", brand: { terms: [] }, search: { terms: [], questions: [] }, qa: { questions: ["儿童演出服怎么选？"] }, intent: { questions: ["测试县儿童演出服厂家有哪些？"] }, source: "fixture" });
  await importLegacyKeywords(root, input); const generated = await generateScenarioDraft(root);
  assert(generated.library.scenarios.length >= 4); assert(generated.library.limitations.some((item) => item.includes("未提供可用询盘"))); assert(generated.library.limitations.some((item) => item.includes("诊断")));
  const questionTexts = generated.library.scenarios.flatMap((scenario) => scenario.representative_questions.map((question) => question.text)); assert(questionTexts.includes("儿童演出服怎么选？"));
  for (const scenario of generated.library.scenarios) for (const question of scenario.representative_questions) { assert.equal(question.normalized_text, normalizeScenarioText(question.text)); assert(question.fact_ids.length > 0); assert(question.source_refs.length > 0); }
  assert(generated.library.scenarios.some((scenario) => scenario.target_customer.includes("机构"))); assert(generated.library.scenarios.some((scenario) => scenario.target_customer.includes("B端"))); assert(generated.library.scenarios.some((scenario) => scenario.representative_questions.some((question) => question.facets.regions.length > 0)));
  const overlap = structuredClone(generated.library.scenarios[0]); overlap.scenario_id = "scenario_overlap_fixture"; overlap.name = `${overlap.name}机构版`; overlap.target_customer = "舞蹈机构采购客户";
  const suggestions = semanticSuggestions([generated.library.scenarios[0], overlap]); const scenarioSuggestion = suggestions.find((item) => item.item_type === "scenario")!; assert(scenarioSuggestion); assert.equal(scenarioSuggestion.status, "pending"); assert(scenarioSuggestion.meaningful_differences.some((item) => item.includes("目标客户不同")));
  const first = generated.library.scenarios[0]; const calculated = first.priority.calculated_total; await overrideScenarioPriority(root, first.scenario_id, 24, "tester", "business priority");
  let draft = await readJson<typeof generated.library>(path.join(root, "strategy", "scenario-draft.json")); assert.equal(draft.scenarios[0].priority.calculated_total, calculated); assert.equal(draft.scenarios[0].priority.override?.actor, "tester");
  await approveReadyScenarios(root); const confirmed = await confirmScenarioLibrary(root); assert.equal(confirmed.library.lifecycle, "confirmed"); assert.equal(await scenarioLibraryInput(root), confirmed.path);
  const validation = await validateScenarioStrategy(root); assert.deepEqual(validation.errors, []); assert.equal(validation.ok, true);
  assert.equal(await readFile(path.join(root, "strategy", "scenario-review.md"), "utf-8").then((value) => value.includes("不是一篇文章模板")), true);
});

test("unsupported operator scenario creates a blocking evidence gap until explicitly accepted", async () => {
  const root = await fixtureProject(); const operator = path.join(root, "operator.json"); await writeFile(operator, JSON.stringify({ questions: [{ text: "是否支持尚未确认的极速当日交付？", target_customer: "紧急采购客户", need: "当日交付" }] }, null, 2));
  const generated = await generateScenarioDraft(root, operator); const scenario = generated.library.scenarios.find((item) => item.customer_need === "当日交付")!; const gap = scenario.evidence_gaps[0]; assert.equal(gap.severity, "high");
  await approveReadyScenarios(root); await reviewScenario(root, scenario.scenario_id, "approve", "保留重要问题待核验"); await assert.rejects(confirmScenarioLibrary(root), /high-priority evidence gaps remain open/);
  await reviewEvidenceGap(root, gap.evidence_gap_id, "accept", "仅保留为研究问题，不用于事实内容"); const confirmed = await confirmScenarioLibrary(root); assert.equal(confirmed.library.lifecycle, "confirmed");
});

test("competitor research concepts map to Zichi fields without competitor exports or schema keys", async () => {
  const fixture = JSON.parse(await readFile(path.resolve(process.cwd(), "test-fixtures", "scenario-concept-coverage.json"), "utf-8")) as Array<{ research_concept: string; canonical_field: string }>;
  assert.deepEqual(fixture.map((item) => item.research_concept), ["产品词", "客户问题/关键词", "场景词", "画像设置", "转换目标"]);
  assert(fixture.every((item) => /^(representative_questions|scenario)\./.test(item.canonical_field)));
  const schema = await readFile(path.resolve(process.cwd(), "schemas", "scenario-library.schema.json"), "utf-8");
  for (const forbidden of ["daze", "zhaixing", "zxingo", "huixin", "platform_export", "conversion_target"]) assert.equal(schema.toLowerCase().includes(forbidden), false);
});
