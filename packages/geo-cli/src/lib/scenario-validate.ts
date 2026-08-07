import { createRequire } from "node:module";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ScenarioLibrary } from "./scenario-model.js";
import { normalizeScenarioText } from "./scenario-strategy.js";
import { pathExists, readJson } from "./util.js";

const require = createRequire(import.meta.url);
const Ajv = require("ajv/dist/2020") as typeof import("ajv/dist/2020.js").default;
const addFormats = require("ajv-formats") as (ajv: InstanceType<typeof Ajv>) => void;
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCHEMAS_DIR = path.join(PACKAGE_ROOT, "schemas");

export interface ScenarioValidationResult { ok: boolean; errors: string[]; checked: string[] }

function schemaErrors(prefix: string, errors: Array<{ instancePath: string; message?: string }> | null | undefined): string[] { return (errors ?? []).map((error) => `${prefix}${error.instancePath || "/"} ${error.message ?? "invalid"}`); }
function keys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keys);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [key, ...keys(child)]);
}

export async function validateScenarioStrategy(projectRoot: string): Promise<ScenarioValidationResult> {
  const errors: string[] = []; const checked: string[] = [];
  const ajv = new Ajv({ allErrors: true, strict: false }); addFormats(ajv);
  const validator = ajv.compile(JSON.parse(await readFile(path.join(SCHEMAS_DIR, "scenario-library.schema.json"), "utf-8")) as object);
  const legacyValidator = ajv.compile(JSON.parse(await readFile(path.join(SCHEMAS_DIR, "legacy-keyword-audit.schema.json"), "utf-8")) as object);
  const manifest = await readJson<Record<string, any>>(path.join(projectRoot, "manifest.json"));
  const factSnapshotId = manifest.gates?.clean?.fact_snapshot_id;
  const snapshot = factSnapshotId ? await readJson<Record<string, any>>(path.join(projectRoot, "knowledge", "snapshots", `${factSnapshotId}.json`)) : null;
  const factIds = new Set<string>((snapshot?.facts?.facts ?? []).filter((fact: any) => fact.review_status === "confirmed" && fact.disclosure_level === "public").map((fact: any) => fact.fact_id));
  const reportId = manifest.gates?.diagnose?.report_id;
  const strategyRoot = path.join(projectRoot, "strategy"); const libraries: ScenarioLibrary[] = [];
  const candidates = [path.join(strategyRoot, "scenario-draft.json")];
  const libraryDir = path.join(strategyRoot, "scenario-libraries"); if (await pathExists(libraryDir)) for (const name of (await readdir(libraryDir)).filter((item) => item.endsWith(".json"))) candidates.push(path.join(libraryDir, name));
  for (const file of candidates) {
    if (!(await pathExists(file))) continue; const rel = path.relative(projectRoot, file); const library = await readJson<ScenarioLibrary>(file); checked.push(rel); libraries.push(library);
    if (!validator(library)) errors.push(...schemaErrors(`${rel}:`, validator.errors));
    if (library.app_id !== manifest.app_id) errors.push(`${rel}: app_id mismatch`);
    if (library.fact_snapshot_id !== factSnapshotId) errors.push(`${rel}: stale fact snapshot`);
    if (library.diagnosis_report_id !== reportId) errors.push(`${rel}: stale diagnosis report`);
    const scenarioIds = new Set<string>(); const questionIds = new Set<string>();
    for (const scenario of library.scenarios) {
      if (scenarioIds.has(scenario.scenario_id)) errors.push(`${rel}: duplicate scenario_id ${scenario.scenario_id}`); scenarioIds.add(scenario.scenario_id);
      for (const id of scenario.supporting_fact_ids) if (!factIds.has(id)) errors.push(`${rel}: scenario ${scenario.scenario_id} references non-confirmed fact ${id}`);
      for (const question of scenario.representative_questions) {
        if (questionIds.has(question.question_id)) errors.push(`${rel}: duplicate question_id ${question.question_id}`); questionIds.add(question.question_id);
        if (question.normalized_text !== normalizeScenarioText(question.text)) errors.push(`${rel}: question ${question.question_id} normalized_text mismatch`);
        for (const id of question.fact_ids) if (!factIds.has(id)) errors.push(`${rel}: question ${question.question_id} references non-confirmed fact ${id}`);
      }
      for (const gap of scenario.evidence_gaps) {
        if (gap.scenario_id !== scenario.scenario_id) errors.push(`${rel}: evidence gap ${gap.evidence_gap_id} scenario mismatch`);
        if (gap.status !== "open" && !gap.review_reason) errors.push(`${rel}: reviewed evidence gap ${gap.evidence_gap_id} requires reason`);
      }
    }
    const forbidden = new Set(["daze", "zhaixing", "zxingo", "huixin", "conversion_target", "scene_word", "platform_export", "platform_route"]);
    const found = keys(library).filter((key) => forbidden.has(key.toLowerCase())); if (found.length) errors.push(`${rel}: competitor-specific schema keys are forbidden: ${[...new Set(found)].join(", ")}`);
  }
  const legacyPath = path.join(strategyRoot, "legacy", "keyword-audit.json"); if (await pathExists(legacyPath)) { const value = await readJson(legacyPath); checked.push("strategy/legacy/keyword-audit.json"); if (!legacyValidator(value)) errors.push(...schemaErrors("strategy/legacy/keyword-audit.json:", legacyValidator.errors)); }
  const gate = manifest.gates?.scenario;
  if (gate?.status === "confirmed") {
    const library = libraries.find((item) => item.scenario_library_id === gate.scenario_library_id);
    if (!library || library.lifecycle !== "confirmed") errors.push("manifest scenario gate references a missing or unconfirmed library");
    if (gate.fact_snapshot_id !== factSnapshotId || gate.diagnosis_report_id !== reportId) errors.push("manifest scenario gate references stale upstream inputs");
  }
  const forbiddenNames = ["daze", "zhaixing", "zxingo", "huixin"];
  if (await pathExists(strategyRoot)) for (const name of await readdir(strategyRoot)) if (forbiddenNames.some((term) => name.toLowerCase().includes(term))) errors.push(`strategy/${name}: competitor-specific export/file is forbidden`);
  return { ok: errors.length === 0, errors, checked };
}
