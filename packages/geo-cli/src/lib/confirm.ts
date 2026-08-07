import path from "node:path";
import { stableId, type FactLedger, type SourceIndex } from "./fact-model.js";
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
  const sourceIndex = await readJson<SourceIndex>(path.join(knowledge, "source-index.json"));
  const baseinfo = await readJson<{ fact_refs?: Record<string, string[]> }>(path.join(knowledge, "company.baseinfo.json"));
  const profile = await readJson<{ fact_refs?: Record<string, string[]> }>(path.join(knowledge, "company.profile.json"));
  const skus = await readJson<{ items?: Array<{ fact_refs?: string[] }> }>(path.join(knowledge, "company.skus.json"));
  const manifestPath = path.join(projectRoot, "manifest.json");
  const manifest = await readJson<Record<string, any>>(manifestPath);
  const activeFactIds = new Set<string>([
    ...Object.values(baseinfo.fact_refs ?? {}).flat(),
    ...Object.values(profile.fact_refs ?? {}).flat(),
    ...(skus.items ?? []).flatMap((item) => item.fact_refs ?? []),
  ]);
  for (const fact of facts.facts) {
    const subject = facts.subjects.find((item) => item.subject_id === fact.subject_id);
    if (subject?.type === "brand" && fact.field === "name") activeFactIds.add(fact.fact_id);
    fact.review_status = activeFactIds.has(fact.fact_id) ? "confirmed" : "rejected";
  }
  const activeSubjectIds = new Set(facts.facts.filter((fact) => fact.review_status === "confirmed").map((fact) => fact.subject_id));
  let addedParent = true;
  while (addedParent) {
    addedParent = false;
    for (const subject of facts.subjects) {
      if (!activeSubjectIds.has(subject.subject_id) || !subject.parent_subject_id || activeSubjectIds.has(subject.parent_subject_id)) continue;
      activeSubjectIds.add(subject.parent_subject_id);
      addedParent = true;
    }
  }
  for (const subject of facts.subjects) subject.review_status = activeSubjectIds.has(subject.subject_id) ? "confirmed" : "rejected";
  const factSnapshotId = stableId("fact_snapshot", facts.inputs_hash, facts.facts_hash, [...activeFactIds].sort());
  const confirmedAt = utcNow();
  const snapshotPath = path.join(knowledge, "snapshots", `${factSnapshotId}.json`);
  const snapshot = {
    schema_version: 2,
    fact_snapshot_id: factSnapshotId,
    app_id: facts.app_id,
    confirmed_at: confirmedAt,
    inputs_hash: facts.inputs_hash,
    facts_hash: facts.facts_hash,
    source_index: sourceIndex,
    facts,
  };
  if (!(await pathExists(snapshotPath))) await writeJson(snapshotPath, snapshot);
  await writeJson(path.join(knowledge, "company.facts.json"), facts);
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
