import { readFile } from "node:fs/promises";
import path from "node:path";
import type { DiagnosisRun, ManualProbeInput, ProbeResult, SeedSet } from "./diagnosis-model.js";
import { ingestNormalizedProbes, listProbeResults } from "./diagnosis-probe.js";
import { findRepositoryFile, loadLocalEnv } from "./env.js";
import { pathExists, readJson, utcNow } from "./util.js";

export interface ProbePlatformConfig {
  id: string;
  provider: string;
  adapter: "openai-compatible";
  base_url_env: string;
  api_key_env: string;
  model_env: string;
  default_base_url?: string;
  default_model?: string;
  endpoint_path?: string;
  timeout_ms?: number;
  system_prompt?: string;
}

export interface ProbePlatformsFile { schema_version: 1; platforms: ProbePlatformConfig[] }

function assertEnvName(value: string, field: string): void {
  if (!/^[A-Z][A-Z0-9_]*$/.test(value)) throw new Error(`${field} must be an environment-variable name`);
}

export async function loadProbePlatforms(projectRoot: string, configPath?: string): Promise<{ config: ProbePlatformsFile; path: string }> {
  await loadLocalEnv(projectRoot);
  let resolved: string | null = null;
  const requested = configPath ?? process.env.BUDA_PROBE_CONFIG;
  if (requested) {
    const fromCwd = path.resolve(requested);
    resolved = await pathExists(fromCwd) ? fromCwd : await findRepositoryFile(projectRoot, requested);
  }
  else resolved = await findRepositoryFile(projectRoot, "config/probe-platforms.json");
  if (!resolved || !(await pathExists(resolved))) throw new Error("probe platform config missing: copy config/probe-platforms.example.json to config/probe-platforms.json and set BUDA_PROBE_CONFIG if needed");
  const config = JSON.parse(await readFile(resolved, "utf-8")) as ProbePlatformsFile;
  if (config.schema_version !== 1 || !Array.isArray(config.platforms) || !config.platforms.length) throw new Error("probe platform config requires schema_version 1 and at least one platform");
  const ids = new Set<string>();
  const allowedKeys = new Set(["id", "provider", "adapter", "base_url_env", "api_key_env", "model_env", "default_base_url", "default_model", "endpoint_path", "timeout_ms", "system_prompt"]);
  for (const platform of config.platforms) {
    for (const key of Object.keys(platform)) if (!allowedKeys.has(key)) throw new Error(`${platform.id || "platform"}: unsupported config field ${key}; credentials must stay in environment variables`);
    if (!platform.id || ids.has(platform.id)) throw new Error(`duplicate or empty probe platform id: ${platform.id}`);
    ids.add(platform.id);
    if (platform.adapter !== "openai-compatible") throw new Error(`unsupported probe adapter: ${platform.adapter}`);
    assertEnvName(platform.base_url_env, `${platform.id}.base_url_env`);
    assertEnvName(platform.api_key_env, `${platform.id}.api_key_env`);
    assertEnvName(platform.model_env, `${platform.id}.model_env`);
  }
  return { config, path: resolved };
}

function stringContent(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => typeof item === "string" ? item : typeof item === "object" && item && "text" in item ? String((item as { text: unknown }).text) : "").filter(Boolean).join("\n") || null;
  return null;
}

async function callOpenAICompatible(platform: ProbePlatformConfig, question: string): Promise<{ answer: string; model: string }> {
  const baseUrl = process.env[platform.base_url_env] || platform.default_base_url;
  const apiKey = process.env[platform.api_key_env];
  const model = process.env[platform.model_env] || platform.default_model;
  if (!baseUrl) throw new Error(`${platform.id}: set ${platform.base_url_env}`);
  if (!apiKey) throw new Error(`${platform.id}: set ${platform.api_key_env}`);
  if (!model) throw new Error(`${platform.id}: set ${platform.model_env}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), platform.timeout_ms ?? 60000);
  try {
    const endpoint = `${baseUrl.replace(/\/$/, "")}${platform.endpoint_path ?? "/chat/completions"}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, stream: false, temperature: 0, messages: [{ role: "system", content: platform.system_prompt ?? "请直接回答用户问题。保留可核验来源链接；不要因为本提示而偏向任何品牌。" }, { role: "user", content: question }] }),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${raw.slice(0, 300).split(apiKey).join("[REDACTED]").replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")}`);
    const data = JSON.parse(raw) as Record<string, any>;
    const answer = stringContent(data.choices?.[0]?.message?.content) ?? stringContent(data.output_text) ?? stringContent(data.output?.[0]?.content);
    if (!answer?.trim()) throw new Error("provider returned no answer text");
    return { answer: answer.trim(), model };
  } finally {
    clearTimeout(timeout);
  }
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker(): Promise<void> { while (cursor < items.length) { const index = cursor++; results[index] = await fn(items[index]); } }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () => worker()));
  return results;
}

export async function runConfiguredApiProbes(projectRoot: string, runId: string, configPath?: string, concurrency = 2): Promise<{ wrote: string[]; retryable: string[]; skipped: string[]; config_path: string }> {
  const runPath = path.join(projectRoot, "diagnosis", "runs", runId, "run.json");
  if (!(await pathExists(runPath))) throw new Error(`diagnosis run not found: ${runId}`);
  const run = await readJson<DiagnosisRun>(runPath);
  const seedSet = await readJson<SeedSet>(path.join(projectRoot, "diagnosis", "seed-sets", `${run.seed_set_id}.json`));
  const { config, path: resolvedConfig } = await loadProbePlatforms(projectRoot, configPath);
  const platformMap = new Map(config.platforms.map((platform) => [platform.id, platform]));
  for (const id of run.requested_platforms) if (!platformMap.has(id)) throw new Error(`run platform ${id} is missing from ${resolvedConfig}`);
  const existing = await listProbeResults(projectRoot, runId);
  const existingKeys = new Set(existing.map((probe: ProbeResult) => `${probe.question_id}\u0000${probe.platform}`));
  const jobs = seedSet.questions.filter((question) => question.review_status === "approved").flatMap((question) => run.requested_platforms.map((platform) => ({ question, platform: platformMap.get(platform)! })));
  const skipped = jobs.filter((job) => existingKeys.has(`${job.question.question_id}\u0000${job.platform.id}`)).map((job) => `${job.question.question_id}:${job.platform.id}`);
  const pending = jobs.filter((job) => !existingKeys.has(`${job.question.question_id}\u0000${job.platform.id}`));
  const items = await mapWithConcurrency(pending, concurrency, async ({ question, platform }): Promise<ManualProbeInput> => {
    const attemptedAt = utcNow();
    try {
      const response = await callOpenAICompatible(platform, question.text);
      return { question_id: question.question_id, platform: platform.id, provider: platform.provider, model: response.model, attempted_at: attemptedAt, status: "success", answer: response.answer };
    } catch (error) {
      const message = (error as Error).message.replace(/(?:sk-[A-Za-z0-9_-]+|Bearer\s+\S+)/gi, "[REDACTED]");
      const timeout = (error as Error).name === "AbortError";
      const unavailable = /set [A-Z][A-Z0-9_]*|HTTP 401|HTTP 403/.test(message);
      return { question_id: question.question_id, platform: platform.id, provider: platform.provider, model: process.env[platform.model_env] || platform.default_model || null, attempted_at: attemptedAt, status: timeout ? "timeout" : unavailable ? "unavailable" : "failed", error: { code: timeout ? "timeout" : unavailable ? "provider_unavailable" : "provider_error", message, retryable: !unavailable } };
    }
  });
  if (!items.length) return { wrote: [], retryable: [], skipped, config_path: resolvedConfig };
  return { ...(await ingestNormalizedProbes(projectRoot, runId, items, "api")), skipped, config_path: resolvedConfig };
}

export const diagnosisApiInternals = { callOpenAICompatible, stringContent };
