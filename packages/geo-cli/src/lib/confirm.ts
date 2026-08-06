import path from "node:path";
import { stableId, type EvidenceLedger, type FactLedger, type SourceIndex } from "./fact-model.js";
import { pathExists, readJson, utcNow, writeJson } from "./util.js";
import { validateProject } from "./validate.js";

export async function confirmClean(projectRoot: string): Promise<{
  fact_snapshot_id: string;
  snapshot_path: string;
  confirmed_at: string;
}> {
  const validation = await validateProject(projectRoot, true);
  if (!validation.ok) throw new Error(`clean confirmation blocked:\n${validation.errors.join("\n")}`);
  const knowledge = path.join(projectRoot, "knowledge");
  const facts = await readJson<FactLedger>(path.join(knowledge, "company.facts.json"));
  const evidence = await readJson<EvidenceLedger>(path.join(knowledge, "company.evidence.json"));
  const sourceIndex = await readJson<SourceIndex>(path.join(knowledge, "source-index.json"));
  const manifestPath = path.join(projectRoot, "manifest.json");
  const manifest = await readJson<Record<string, any>>(manifestPath);
  for (const subject of facts.subjects) if (subject.review_status === "candidate") subject.review_status = "confirmed";
  for (const fact of facts.facts) if (fact.review_status === "candidate") fact.review_status = "confirmed";
  for (const item of evidence.items) if (item.review_status === "candidate") item.review_status = "confirmed";
  const factSnapshotId = stableId("fact_snapshot", facts.inputs_hash, facts.facts_hash);
  const confirmedAt = utcNow();
  const snapshotPath = path.join(knowledge, "snapshots", `${factSnapshotId}.json`);
  const snapshot = {
    schema_version: 1,
    fact_snapshot_id: factSnapshotId,
    app_id: facts.app_id,
    confirmed_at: confirmedAt,
    inputs_hash: facts.inputs_hash,
    facts_hash: facts.facts_hash,
    source_index: sourceIndex,
    facts,
    evidence,
  };
  if (!(await pathExists(snapshotPath))) await writeJson(snapshotPath, snapshot);
  await writeJson(path.join(knowledge, "company.facts.json"), facts);
  await writeJson(path.join(knowledge, "company.evidence.json"), evidence);
  manifest.gates = manifest.gates ?? {};
  manifest.gates.clean = {
    status: "confirmed",
    at: confirmedAt,
    fact_snapshot_id: factSnapshotId,
  };
  manifest.clean_pipeline = {
    ...(manifest.clean_pipeline ?? {}),
    stage: "confirmed",
    inputs_hash: facts.inputs_hash,
    facts_hash: facts.facts_hash,
    changed_since_confirmation: false,
    previous_snapshot_id: manifest.clean_pipeline?.previous_snapshot_id ?? null,
  };
  manifest.clean_ready = true;
  manifest.updated_at = confirmedAt;
  await writeJson(manifestPath, manifest);
  return {
    fact_snapshot_id: factSnapshotId,
    snapshot_path: path.relative(projectRoot, snapshotPath).split(path.sep).join("/"),
    confirmed_at: confirmedAt,
  };
}
