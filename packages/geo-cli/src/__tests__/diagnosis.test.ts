import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createSeedDraft, approveAllNonRiskSeeds, confirmSeedSet, loadConfirmedDiagnosisContext, reviewSeed } from "../lib/diagnosis-seeds.js";
import { appendAnalysisRevision, createDiagnosisRun, ingestManualProbes, listProbeResults, parseProbeAnswer } from "../lib/diagnosis-probe.js";
import { calculateMetrics, confirmDiagnosisReport, generateDiagnosisReport } from "../lib/diagnosis-report.js";
import { validateDiagnosis } from "../lib/diagnosis-validate.js";
import { stableId, type FactLedger, type FactRecord, type SubjectRecord } from "../lib/fact-model.js";
import { readJson, writeJson } from "../lib/util.js";

async function fixtureProject(confirmed = true): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "geo-diagnosis-"));
  const appId = "app_diagnosis_test";
  const companyId = stableId("sub_company", appId);
  const brandId = stableId("sub_brand", appId, "测试品牌");
  const productIds = [stableId("sub_product", appId, "电动剪"), stableId("sub_product", appId, "水管剪")];
  const subjects: SubjectRecord[] = [
    { subject_id: companyId, type: "company", name: "测试工具有限公司", parent_subject_id: null, source_refs: ["src_1"], review_status: "confirmed" },
    { subject_id: brandId, type: "brand", name: "测试品牌", parent_subject_id: companyId, source_refs: ["src_1"], review_status: "confirmed" },
    ...productIds.map((id, index): SubjectRecord => ({ subject_id: id, type: "product", name: index ? "水管剪" : "电动剪", parent_subject_id: companyId, source_refs: ["src_1"], review_status: "confirmed" })),
  ];
  const facts: FactRecord[] = [];
  const add = (subjectId: string, field: string, value: unknown) => facts.push({ fact_id: stableId("fact", subjectId, field, value), subject_id: subjectId, field, value, unit: null, source_refs: ["src_1"], derivation: "extracted", confidence: 1, review_status: "confirmed", disclosure_level: "public" });
  add(companyId, "company_name", "测试工具有限公司"); add(companyId, "company_short_name", "错误广告语"); add(companyId, "company_short_name", "测试品牌"); add(companyId, "address", "江苏省南通市测试区");
  add(companyId, "products_services", "生产园林剪切工具并支持 OEM/ODM 定制"); add(companyId, "advantages", "源头制造、质量检测和售后服务"); add(companyId, "trust", "通过产品认证"); add(brandId, "name", "测试品牌");
  for (const [index, productId] of productIds.entries()) {
    add(productId, "name", index ? "水管剪" : "电动剪"); add(productId, "category", index ? "管材剪切工具" : "园林电动工具"); add(productId, "capabilities", ["生产供应", "OEM/ODM定制"]); add(productId, "is_main", true);
  }
  const ledger: FactLedger = { app_id: appId, generated_at: "2026-01-01T00:00:00Z", inputs_hash: "a".repeat(64), facts_hash: "b".repeat(64), subjects, facts, conflicts: [] };
  const snapshotId = stableId("fact_snapshot", ledger.inputs_hash, ledger.facts_hash);
  await writeJson(path.join(root, "manifest.json"), {
    app_id: appId, project_name: "测试工具有限公司", gates: { clean: { status: confirmed ? "confirmed" : "review_required", at: confirmed ? "2026-01-01T00:00:00Z" : null, fact_snapshot_id: confirmed ? snapshotId : null }, diagnose: { status: "pending", at: null } },
    missing: [], clean_pipeline: { stage: confirmed ? "confirmed" : "review", inputs_hash: ledger.inputs_hash, facts_hash: ledger.facts_hash, changed_since_confirmation: !confirmed, previous_snapshot_id: null }, clean_ready: confirmed, review_ready: true,
  });
  await writeJson(path.join(root, "knowledge", "snapshots", `${snapshotId}.json`), {
    schema_version: 2, fact_snapshot_id: snapshotId, app_id: appId, confirmed_at: "2026-01-01T00:00:00Z", inputs_hash: ledger.inputs_hash, facts_hash: ledger.facts_hash,
    source_index: { app_id: appId, generated_at: "2026-01-01T00:00:00Z", inputs_hash: ledger.inputs_hash, sources: [] }, facts: ledger,
  });
  return root;
}

test("diagnosis refuses unconfirmed enterprise facts", async () => {
  const root = await fixtureProject(false);
  await assert.rejects(loadConfirmedDiagnosisContext(root), /enterprise facts are not confirmed/);
  await assert.rejects(createSeedDraft(root), /enterprise facts are not confirmed/);
});

test("probe parser distinguishes recommendation, plain mention, negative risk and citations", () => {
  const recommended = parseProbeAnswer({ answer: "推荐测试品牌，排名第2。https://example.com/a", brandTerms: ["测试品牌"] });
  assert.equal(recommended.target_mentioned, true); assert.equal(recommended.actively_recommended, true); assert.equal(recommended.recommendation_position, 2); assert.equal(recommended.citations[0]?.domain, "example.com");
  const plain = parseProbeAnswer({ answer: "测试品牌是候选之一。", brandTerms: ["测试品牌"], manual: { actively_recommended: false } });
  assert.equal(plain.target_mentioned, true); assert.equal(plain.actively_recommended, false);
  const negative = parseProbeAnswer({ answer: "测试品牌有售后问题，建议核验。", brandTerms: ["测试品牌"] });
  assert.equal(negative.negative_risk_mentioned, true); assert.equal(negative.actively_recommended, false);
});

test("metrics exclude provider failures from non-mention denominators", async () => {
  const fixturePath = path.resolve(process.cwd(), "test-fixtures", "diagnosis-probes.json");
  const fixture = JSON.parse(await readFile(fixturePath, "utf-8")) as Array<any>;
  const probes = fixture.map((item, index) => ({
    schema_version: 1 as const, probe_id: `probe_${index}`, run_id: "diagnosis_run_test", seed_set_id: "seed_set_test", question_id: `question_${index}`,
    question_text: item.case, question_family: item.case === "negative_mention" ? "negative_risk" as const : "product_consideration" as const,
    platform: "test-ai", provider: "fixture", adapter_kind: "manual" as const, model: "fixture-model", attempted_at: "2026-01-01T00:00:00Z", status: item.status,
    raw_snapshot_path: item.status === "success" ? `raw/${index}.md` : null, raw_content_hash: item.status === "success" ? `hash-${index}` : null,
    error: item.error ?? null, analysis: item.status === "success" ? parseProbeAnswer({ answer: item.answer, brandTerms: ["测试品牌"], manual: item.analysis }) : null, latest_analysis_revision_id: null,
  }));
  const metrics = calculateMetrics(probes);
  assert.equal(metrics.attempted_probes, 6); assert.equal(metrics.valid_probes, 5); assert.equal(metrics.brand_mention_rate.denominator, 5); assert.equal(metrics.brand_mention_rate.numerator, 4);
  assert.equal(metrics.valid_coverage.numerator, 5); assert.equal(metrics.valid_coverage.denominator, 6); assert.equal(metrics.negative_risk_mention_rate.denominator, 1);
});

test("seed review, manual evidence, report, limitations gate and validation form an auditable chain", async () => {
  const root = await fixtureProject(true);
  const draft = await createSeedDraft(root, 20);
  assert.equal(draft.seedSet.questions.length, 20);
  assert(draft.seedSet.questions.every((question) => !question.text.includes("错误广告语")));
  assert(draft.seedSet.questions.every((question) => question.fact_ids.length > 0));
  await approveAllNonRiskSeeds(root);
  let current = await readJson<typeof draft.seedSet>(path.join(root, "diagnosis", "seed-draft.json"));
  for (const risk of current.questions.filter((question) => question.family === "negative_risk")) await reviewSeed(root, risk.question_id, "approve");
  const confirmed = await confirmSeedSet(root);
  const run = await createDiagnosisRun(root, confirmed.seedSet.seed_set_id, ["test-ai"]);
  const active = confirmed.seedSet.questions.filter((question) => question.review_status === "approved");
  const manual = active.map((question, index) => index === active.length - 1 ? {
    question_id: question.question_id, platform: "test-ai", provider: "controlled_manual", model: "fixture-model", status: "timeout", error: { code: "timeout", message: "provider timed out", retryable: true },
  } : {
    question_id: question.question_id, platform: "test-ai", provider: "controlled_manual", model: "fixture-model", status: "success", answer: index % 2 ? "推荐竞品甲。" : "推荐测试品牌，排名第2。https://example.com/evidence", analysis: { competitors: index % 2 ? ["竞品甲"] : [] },
  });
  const input = path.join(root, "manual-probes.json"); await writeFile(input, `${JSON.stringify(manual, null, 2)}\n`, "utf-8");
  const ingestion = await ingestManualProbes(root, run.run.run_id, input); assert.equal(ingestion.wrote.length, active.length); assert.equal(ingestion.retryable.length, 1);
  const repeated = await ingestManualProbes(root, run.run.run_id, input); assert.equal(repeated.wrote.length, active.length);
  const successful = (await listProbeResults(root, run.run.run_id)).find((probe) => probe.status === "success")!;
  const revision = await appendAnalysisRevision(root, run.run.run_id, successful.probe_id, { ...successful.analysis!, notes: "人工复核后补充说明", analysis_method: "controlled_manual" }, "人工核对原始回答");
  assert(revision.path.includes("analysis-revisions"));
  const rendered = await generateDiagnosisReport(root, run.run.run_id); assert.equal(rendered.report.metrics.failed_probes, 1); assert.equal(rendered.report.metrics.brand_mention_rate.denominator, active.length - 1);
  const reviewMarkdown = await readFile(path.join(root, rendered.markdownPath), "utf-8");
  assert(reviewMarkdown.includes("超时")); assert(reviewMarkdown.includes("provider timed out"));
  await assert.rejects(confirmDiagnosisReport(root, rendered.report.report_id), /accept-limitations/);
  const confirmedReport = await confirmDiagnosisReport(root, rendered.report.report_id, true); assert.equal(confirmedReport.status, "confirmed");
  const validation = await validateDiagnosis(root); assert.deepEqual(validation.errors, []); assert.equal(validation.ok, true);
  const manifest = await readJson<Record<string, any>>(path.join(root, "manifest.json")); assert.equal(manifest.gates.diagnose.report_id, rendered.report.report_id);
  assert(await readFile(path.join(root, rendered.markdownPath), "utf-8").then((text) => text.includes("失败、超时和不可用不进入")));
});
