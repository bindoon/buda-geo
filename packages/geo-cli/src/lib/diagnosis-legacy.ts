import path from "node:path";
import type { DiagnosisQuestion, SeedFamily, SeedSet } from "./diagnosis-model.js";
import { stableId } from "./fact-model.js";
import { readJson, relToProject, utcNow, writeJson } from "./util.js";

function legacyFamily(group: string): SeedFamily {
  if (group === "brand") return "brand_recognition";
  if (group === "intent") return "supplier_capability";
  if (group === "search") return "product_consideration";
  return "product_consideration";
}

export async function importLegacyDiagnosis(projectRoot: string, questionsPath: string, reportPath: string): Promise<{ seedPath: string; evidencePath: string }> {
  const legacyQuestions = await readJson<{ app_id: string; created_at?: string; questions: Array<{ q: string; group?: string }> }>(path.resolve(questionsPath));
  const legacyReport = await readJson<Record<string, any>>(path.resolve(reportPath));
  const questions: DiagnosisQuestion[] = legacyQuestions.questions.map((item) => {
    const family = legacyFamily(item.group ?? "");
    return {
      question_id: stableId("question", "legacy", item.q), text: item.q, family,
      rationale: "从旧问题批次迁移，仅供对照；缺少已确认事实引用，不能执行正式基线。", fact_ids: [], derivation: "legacy",
      review_status: "unreviewed", replacement_for_question_id: null, negative_risk_approved: false,
    };
  });
  const seedSet: SeedSet = {
    schema_version: 1, seed_set_id: stableId("seed_set", "legacy", legacyQuestions.app_id, questions.map((item) => item.question_id)), app_id: legacyQuestions.app_id,
    fact_snapshot_id: "fact_snapshot_legacy_unconfirmed", purpose: "baseline_diagnosis_only", status: "legacy_candidate", version: 0,
    based_on_seed_set_id: null, created_at: legacyQuestions.created_at ?? utcNow(), confirmed_at: null, target_size: questions.length, questions,
  };
  const root = path.join(projectRoot, "diagnosis", "legacy");
  const seedPath = path.join(root, "seed-candidate.v0.json");
  const evidencePath = path.join(root, "spot-checks.unconfirmed.json");
  await writeJson(seedPath, seedSet);
  await writeJson(evidencePath, {
    schema_version: 1, status: "unconfirmed_legacy_evidence", imported_at: utcNow(),
    warning: "这些网页摸底没有统一平台/模型/精确回答快照，不能计入正式诊断指标。",
    source_batch_id: legacyReport.batch_id ?? null, spot_checks: legacyReport.spot_checks ?? [], legacy_summary: legacyReport.summary ?? null,
  });
  return { seedPath: relToProject(projectRoot, seedPath), evidencePath: relToProject(projectRoot, evidencePath) };
}
