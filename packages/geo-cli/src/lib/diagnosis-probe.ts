import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type AnalysisRevision,
  type DiagnosisRun,
  type ManualProbeInput,
  type ProbeAdapter,
  type ProbeAnalysis,
  type ProbeResult,
  type SeedSet,
} from "./diagnosis-model.js";
import { digestObject, stableId } from "./fact-model.js";
import { loadConfirmedDiagnosisContext } from "./diagnosis-seeds.js";
import { pathExists, readJson, relToProject, utcNow, writeJson } from "./util.js";

function domainOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
}

function urlCitations(answer: string): ProbeAnalysis["citations"] {
  const urls = answer.match(/https?:\/\/[^\s<>）)\]]+/g) ?? [];
  return [...new Set(urls)].map((url) => ({ title: null, url, domain: domainOf(url) })).filter((item) => item.domain);
}

function containsAny(answer: string, terms: string[]): boolean {
  const normalized = answer.toLowerCase();
  return terms.some((term) => term.length >= 2 && normalized.includes(term.toLowerCase()));
}

export function parseProbeAnswer(args: {
  answer: string;
  brandTerms: string[];
  competitorHints?: string[];
  manual?: Partial<ProbeAnalysis>;
}): ProbeAnalysis {
  const { answer, brandTerms, competitorHints = [], manual = {} } = args;
  const targetMentioned = manual.target_mentioned ?? containsAny(answer, brandTerms);
  const recommendedLanguage = /推荐|首选|值得选|可以考虑|优先选择|入选|候选/.test(answer);
  const negativeLanguage = /投诉|风险|故障|质量问题|售后问题|负面|不推荐|避雷|缺陷/.test(answer);
  const positionMatch = answer.match(/(?:第|排名\s*|top\s*)(\d{1,2})/i);
  const competitors = manual.competitors ?? competitorHints.filter((name) => containsAny(answer, [name]) && !brandTerms.includes(name));
  return {
    target_mentioned: targetMentioned,
    actively_recommended: manual.actively_recommended ?? (targetMentioned && recommendedLanguage && !(manual.negative_risk_mentioned ?? negativeLanguage)),
    recommendation_position: manual.recommendation_position ?? (positionMatch ? Number(positionMatch[1]) : null),
    competitors: [...new Set(competitors.map((item) => item.trim()).filter(Boolean))],
    negative_risk_mentioned: manual.negative_risk_mentioned ?? (targetMentioned && negativeLanguage),
    sentiment: manual.sentiment ?? (targetMentioned ? negativeLanguage ? "negative" : recommendedLanguage ? "positive" : "neutral" : "unknown"),
    citations: manual.citations ?? urlCitations(answer),
    analysis_method: Object.keys(manual).length ? "controlled_manual" : "heuristic_v1",
    notes: manual.notes ?? null,
  };
}

export class ControlledManualAdapter implements ProbeAdapter {
  readonly kind = "manual" as const;

  async normalize(input: unknown): Promise<ManualProbeInput[]> {
    const list = Array.isArray(input) ? input : [input];
    return list.map((value, index) => {
      if (!value || typeof value !== "object") throw new Error(`manual probe item ${index + 1} must be an object`);
      const item = value as ManualProbeInput & Record<string, unknown>;
      for (const forbidden of ["password", "token", "api_key", "apiKey", "secret"]) {
        if (forbidden in item) throw new Error(`manual probe item ${index + 1} contains forbidden credential field: ${forbidden}`);
      }
      if (!item.question_id || !item.platform || !item.status) throw new Error(`manual probe item ${index + 1} requires question_id, platform and status`);
      if (item.status === "success" && !item.answer?.trim()) throw new Error(`manual probe item ${index + 1}: success requires answer`);
      if (item.status !== "success" && !item.error?.message) throw new Error(`manual probe item ${index + 1}: ${item.status} requires error.message`);
      return item;
    });
  }
}

async function findSeedSet(projectRoot: string, seedSetId: string): Promise<SeedSet> {
  const file = path.join(projectRoot, "diagnosis", "seed-sets", `${seedSetId}.json`);
  if (!(await pathExists(file))) throw new Error(`confirmed seed set not found: ${seedSetId}`);
  const seedSet = await readJson<SeedSet>(file);
  if (seedSet.status !== "confirmed") throw new Error("diagnosis run requires a confirmed seed set");
  return seedSet;
}

export async function createDiagnosisRun(projectRoot: string, seedSetId: string, platforms: string[]): Promise<{ run: DiagnosisRun; path: string }> {
  const context = await loadConfirmedDiagnosisContext(projectRoot);
  const seedSet = await findSeedSet(projectRoot, seedSetId);
  if (seedSet.fact_snapshot_id !== context.snapshot.fact_snapshot_id) throw new Error("diagnosis run blocked: seed set references a stale fact snapshot");
  const requestedPlatforms = [...new Set(platforms.map((item) => item.trim()).filter(Boolean))];
  if (!requestedPlatforms.length) throw new Error("at least one platform is required");
  const createdAt = utcNow();
  const runId = stableId("diagnosis_run", seedSetId, requestedPlatforms, createdAt);
  const run: DiagnosisRun = {
    schema_version: 1,
    run_id: runId,
    app_id: context.manifest.app_id,
    fact_snapshot_id: context.snapshot.fact_snapshot_id,
    seed_set_id: seedSetId,
    created_at: createdAt,
    status: "prepared",
    requested_platforms: requestedPlatforms,
    probe_ids: [],
  };
  const out = path.join(projectRoot, "diagnosis", "runs", runId, "run.json");
  await writeJson(out, run);
  return { run, path: relToProject(projectRoot, out) };
}

function brandTermsFromSnapshot(snapshot: Awaited<ReturnType<typeof loadConfirmedDiagnosisContext>>["snapshot"]): string[] {
  const terms: string[] = [];
  for (const fact of snapshot.facts.facts) {
    if (fact.disclosure_level !== "public" || fact.review_status !== "confirmed" || typeof fact.value !== "string") continue;
    if (["company_name", "company_short_name"].includes(fact.field)) terms.push(fact.value);
    const subject = snapshot.facts.subjects.find((item) => item.subject_id === fact.subject_id);
    if (subject?.type === "brand" && fact.field === "name") terms.push(fact.value);
  }
  return [...new Set(terms)].filter(Boolean);
}

export async function ingestManualProbes(projectRoot: string, runId: string, inputPath: string): Promise<{ wrote: string[]; retryable: string[] }> {
  const context = await loadConfirmedDiagnosisContext(projectRoot);
  const runPath = path.join(projectRoot, "diagnosis", "runs", runId, "run.json");
  const run = await readJson<DiagnosisRun>(runPath);
  const seedSet = await findSeedSet(projectRoot, run.seed_set_id);
  if (run.fact_snapshot_id !== context.snapshot.fact_snapshot_id) throw new Error("probe ingestion blocked: run fact snapshot is stale");
  const adapter = new ControlledManualAdapter();
  const items = await adapter.normalize(JSON.parse(await readFile(path.resolve(inputPath), "utf-8")));
  const brandTerms = brandTermsFromSnapshot(context.snapshot);
  const wrote: string[] = [];
  for (const item of items) {
    const question = seedSet.questions.find((candidate) => candidate.question_id === item.question_id && candidate.review_status === "approved");
    if (!question) throw new Error(`manual probe references unknown or inactive question: ${item.question_id}`);
    if (!run.requested_platforms.includes(item.platform)) throw new Error(`platform ${item.platform} is not declared by run ${runId}`);
    const probeId = stableId("probe", runId, item.question_id, item.platform, item.provider ?? "manual", item.model ?? null);
    const probePath = path.join(projectRoot, "diagnosis", "runs", runId, "probes", `${probeId}.json`);
    const rawPath = path.join(projectRoot, "diagnosis", "runs", runId, "raw", `${probeId}.md`);
    const previous = await pathExists(probePath) ? await readJson<ProbeResult>(probePath) : null;
    const attemptedAt = item.attempted_at ?? previous?.attempted_at ?? utcNow();
    let rawSnapshotPath: string | null = null;
    let rawContentHash: string | null = null;
    if (item.status === "success") {
      const header = `# Probe raw answer\n\n- question_id: ${item.question_id}\n- platform: ${item.platform}\n- provider: ${item.provider ?? "controlled_manual"}\n- model: ${item.model ?? "unknown"}\n- attempted_at: ${attemptedAt}\n\n## Exact question\n\n${question.text}\n\n## Raw answer\n\n`;
      const content = `${header}${item.answer!.trim()}\n`;
      await mkdir(path.dirname(rawPath), { recursive: true });
      if (!(await pathExists(rawPath))) await writeFile(rawPath, content, "utf-8");
      rawSnapshotPath = relToProject(projectRoot, rawPath);
      rawContentHash = digestObject(content);
    }
    const analysis = item.status === "success" ? parseProbeAnswer({ answer: item.answer!, brandTerms, manual: item.analysis }) : null;
    const result: ProbeResult = {
      schema_version: 1,
      probe_id: probeId,
      run_id: runId,
      seed_set_id: run.seed_set_id,
      question_id: question.question_id,
      question_text: question.text,
      question_family: question.family,
      platform: item.platform,
      provider: item.provider ?? "controlled_manual",
      adapter_kind: "manual",
      model: item.model ?? null,
      attempted_at: attemptedAt,
      status: item.status,
      raw_snapshot_path: rawSnapshotPath,
      raw_content_hash: rawContentHash,
      error: item.status === "success" ? null : { code: item.error!.code, message: item.error!.message, retryable: item.error!.retryable ?? true },
      analysis,
      latest_analysis_revision_id: null,
    };
    if (previous) {
      if (digestObject(previous) !== digestObject(result)) throw new Error(`idempotency conflict: probe ${probeId} already exists with different evidence`);
    } else {
      await writeJson(probePath, result);
    }
    if (!run.probe_ids.includes(probeId)) run.probe_ids.push(probeId);
    wrote.push(relToProject(projectRoot, probePath));
  }
  run.status = "in_progress";
  await writeJson(runPath, run);
  return { wrote, retryable: await listRetryableProbeIds(projectRoot, runId) };
}

export async function listProbeResults(projectRoot: string, runId: string): Promise<ProbeResult[]> {
  const dir = path.join(projectRoot, "diagnosis", "runs", runId, "probes");
  if (!(await pathExists(dir))) return [];
  const names = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
  return Promise.all(names.map((name) => readJson<ProbeResult>(path.join(dir, name))));
}

export async function listRetryableProbeIds(projectRoot: string, runId: string): Promise<string[]> {
  return (await listProbeResults(projectRoot, runId)).filter((probe) => probe.error?.retryable).map((probe) => probe.probe_id);
}

export async function appendAnalysisRevision(projectRoot: string, runId: string, probeId: string, revised: ProbeAnalysis, reason: string): Promise<{ revision: AnalysisRevision; path: string }> {
  if (!reason.trim()) throw new Error("analysis revision reason is required");
  const probePath = path.join(projectRoot, "diagnosis", "runs", runId, "probes", `${probeId}.json`);
  const probe = await readJson<ProbeResult>(probePath);
  if (probe.status !== "success" || !probe.analysis || !probe.raw_snapshot_path) throw new Error("only a successful evidence-backed probe can be revised");
  const createdAt = utcNow();
  const revisionId = stableId("analysis_revision", probeId, createdAt, revised, reason);
  const revision: AnalysisRevision = {
    schema_version: 1,
    analysis_revision_id: revisionId,
    probe_id: probeId,
    created_at: createdAt,
    reason: reason.trim(),
    previous_analysis: probe.analysis,
    revised_analysis: revised,
  };
  const out = path.join(projectRoot, "diagnosis", "runs", runId, "analysis-revisions", probeId, `${revisionId}.json`);
  await writeJson(out, revision);
  probe.analysis = revised;
  probe.latest_analysis_revision_id = revisionId;
  await writeJson(probePath, probe);
  return { revision, path: relToProject(projectRoot, out) };
}
