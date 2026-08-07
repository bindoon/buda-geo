import { createRequire } from "node:module";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DiagnosisReport, DiagnosisRun, ProbeResult, SeedSet } from "./diagnosis-model.js";
import { pathExists, readJson } from "./util.js";

const require = createRequire(import.meta.url);
const Ajv = require("ajv/dist/2020") as typeof import("ajv/dist/2020.js").default;
const addFormats = require("ajv-formats") as (ajv: InstanceType<typeof Ajv>) => void;
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCHEMAS_DIR = path.join(PACKAGE_ROOT, "schemas");

export interface DiagnosisValidationResult { ok: boolean; errors: string[]; checked: string[] }

async function schema(name: string): Promise<object> {
  return JSON.parse(await readFile(path.join(SCHEMAS_DIR, name), "utf-8")) as object;
}

function ajvErrors(prefix: string, errors: Array<{ instancePath: string; message?: string }> | null | undefined): string[] {
  return (errors ?? []).map((error) => `${prefix}${error.instancePath || "/"} ${error.message ?? "invalid"}`);
}

export async function validateDiagnosis(projectRoot: string): Promise<DiagnosisValidationResult> {
  const errors: string[] = [];
  const checked: string[] = [];
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  for (const name of ["diagnosis-question.schema.json", "diagnosis-probe-result.schema.json", "diagnosis-gap.schema.json", "diagnosis-metric.schema.json", "diagnosis-analysis-revision.schema.json"]) ajv.addSchema(await schema(name));
  const validators = {
    seed: ajv.compile(await schema("diagnosis-seed-set.schema.json")),
    run: ajv.compile(await schema("diagnosis-run.schema.json")),
    probe: ajv.getSchema("geo-diagnosis-probe-result")!,
    revision: ajv.getSchema("geo-diagnosis-analysis-revision")!,
    report: ajv.compile(await schema("diagnosis-report.schema.json")),
  };
  const manifest = await readJson<Record<string, any>>(path.join(projectRoot, "manifest.json"));
  const diagnosisRoot = path.join(projectRoot, "diagnosis");
  const seedDir = path.join(diagnosisRoot, "seed-sets");
  const seedSets = new Map<string, SeedSet>();
  if (await pathExists(seedDir)) for (const name of (await readdir(seedDir)).filter((name) => name.endsWith(".json"))) {
    const rel = `diagnosis/seed-sets/${name}`; const value = await readJson<SeedSet>(path.join(seedDir, name)); checked.push(rel);
    if (!validators.seed(value)) errors.push(...ajvErrors(`${rel}:`, validators.seed.errors));
    if (value.status !== "confirmed") errors.push(`${rel}: versioned seed set must be confirmed`);
    if (value.app_id !== manifest.app_id) errors.push(`${rel}: app_id mismatch`);
    seedSets.set(value.seed_set_id, value);
  }
  const runsDir = path.join(diagnosisRoot, "runs");
  const reports = new Map<string, DiagnosisReport>();
  if (await pathExists(runsDir)) for (const runName of await readdir(runsDir)) {
    const runPath = path.join(runsDir, runName, "run.json"); if (!(await pathExists(runPath))) continue;
    const rel = `diagnosis/runs/${runName}/run.json`; const run = await readJson<DiagnosisRun>(runPath); checked.push(rel);
    if (!validators.run(run)) errors.push(...ajvErrors(`${rel}:`, validators.run.errors));
    const seed = seedSets.get(run.seed_set_id); if (!seed) errors.push(`${rel}: seed set not found`); else if (seed.fact_snapshot_id !== run.fact_snapshot_id) errors.push(`${rel}: seed/run fact snapshot mismatch`);
    const probeDir = path.join(runsDir, runName, "probes");
    if (await pathExists(probeDir)) for (const probeName of (await readdir(probeDir)).filter((name) => name.endsWith(".json"))) {
      const probeRel = `diagnosis/runs/${runName}/probes/${probeName}`; const probe = await readJson<ProbeResult>(path.join(probeDir, probeName)); checked.push(probeRel);
      if (!validators.probe(probe)) errors.push(...ajvErrors(`${probeRel}:`, validators.probe.errors));
      if (probe.run_id !== run.run_id || probe.seed_set_id !== run.seed_set_id) errors.push(`${probeRel}: probe/run identity mismatch`);
      if (probe.status === "success" && probe.raw_snapshot_path && !(await pathExists(path.join(projectRoot, probe.raw_snapshot_path)))) errors.push(`${probeRel}: raw snapshot missing`);
      if (probe.status !== "success" && probe.analysis) errors.push(`${probeRel}: failed probe must not carry non-mention analysis`);
    }
    const revisionRoot = path.join(runsDir, runName, "analysis-revisions");
    if (await pathExists(revisionRoot)) for (const probeId of await readdir(revisionRoot)) {
      const revisionDir = path.join(revisionRoot, probeId);
      for (const revisionName of (await readdir(revisionDir)).filter((name) => name.endsWith(".json"))) {
        const revisionRel = `diagnosis/runs/${runName}/analysis-revisions/${probeId}/${revisionName}`;
        const revision = await readJson<Record<string, unknown>>(path.join(revisionDir, revisionName)); checked.push(revisionRel);
        if (!validators.revision(revision)) errors.push(...ajvErrors(`${revisionRel}:`, validators.revision.errors));
        if (revision.probe_id !== probeId) errors.push(`${revisionRel}: revision/probe identity mismatch`);
      }
    }
  }
  const reportDir = path.join(diagnosisRoot, "reports");
  if (await pathExists(reportDir)) for (const name of (await readdir(reportDir)).filter((name) => name.endsWith(".json"))) {
    const rel = `diagnosis/reports/${name}`; const report = await readJson<DiagnosisReport>(path.join(reportDir, name)); checked.push(rel);
    if (!validators.report(report)) errors.push(...ajvErrors(`${rel}:`, validators.report.errors));
    reports.set(report.report_id, report);
  }
  const gate = manifest.gates?.diagnose;
  if (gate?.status === "confirmed") {
    const report = reports.get(gate.report_id);
    if (!report || report.status !== "confirmed") errors.push("manifest diagnose gate references a missing or unconfirmed report");
    if (gate.fact_snapshot_id !== manifest.gates?.clean?.fact_snapshot_id) errors.push("manifest diagnose gate references a stale fact snapshot");
  }
  return { ok: errors.length === 0, errors, checked };
}
