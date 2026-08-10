import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { approvedArticleInput } from "./article-review.js";
import { stableId } from "./fact-model.js";
import type {
  PublishAttempt,
  PublishAuthorization,
  PublishEventStatus,
  PublishPlan,
  PublishPlanItem,
  PublishReceipt,
  PublishRecordInput,
  PublishingDestinationRegistry,
} from "./publishing-model.js";
import { pathExists, readJson, relToProject, utcNow, writeJson } from "./util.js";

const CHANNELS = new Set(["social", "media", "b2b", "site"]);
const TERMINAL = new Set<PublishEventStatus>(["published", "skipped"]);

function bodyDigest(text: string): string {
  return createHash("sha256").update(text.trim()).digest("hex");
}

function assertNoSecrets(value: unknown, location = "registry"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecrets(item, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && /(?:sk-[A-Za-z0-9_-]{12,}|bearer\s+[A-Za-z0-9._-]{12,})/i.test(value)) {
      throw new Error(`${location} appears to contain a credential value; use an environment-variable name instead`);
    }
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (!key.endsWith("_env") && /password|passwd|api_?key|access_?token|secret|credential/i.test(key)) {
      throw new Error(`${location}.${key} is a forbidden credential field`);
    }
    assertNoSecrets(child, `${location}.${key}`);
  }
}

function assertRegistry(registry: PublishingDestinationRegistry, appId: string): void {
  assertNoSecrets(registry);
  if (registry.schema_version !== 1 || registry.app_id !== appId) throw new Error("destination registry app_id/schema mismatch");
  const ids = new Set<string>();
  for (const destination of registry.destinations) {
    if (ids.has(destination.destination_id)) throw new Error(`duplicate destination_id: ${destination.destination_id}`);
    ids.add(destination.destination_id);
    if (!CHANNELS.has(destination.channel)) throw new Error(`unsupported destination channel: ${destination.channel}`);
    if (!destination.authority_tier) throw new Error(`destination ${destination.destination_id} is not rated`);
    if (destination.mode === "manual" && destination.adapter) throw new Error(`manual destination ${destination.destination_id} must not define an adapter`);
    if (destination.mode === "adapter" && !destination.adapter?.adapter) throw new Error(`adapter destination ${destination.destination_id} requires adapter metadata`);
  }
}

async function loadManifest(projectRoot: string): Promise<Record<string, any>> {
  return readJson<Record<string, any>>(path.join(projectRoot, "manifest.json"));
}

export async function loadDestinationRegistry(projectRoot: string): Promise<PublishingDestinationRegistry> {
  const manifest = await loadManifest(projectRoot);
  const registryPath = path.join(projectRoot, "publish", "destinations.json");
  if (!(await pathExists(registryPath))) {
    throw new Error("destination registry missing: create publish/destinations.json from config/publishing-destinations.example.json");
  }
  const registry = await readJson<PublishingDestinationRegistry>(registryPath);
  assertRegistry(registry, manifest.app_id);
  return registry;
}

function planPath(projectRoot: string, planId: string): string {
  return path.join(projectRoot, "publish", "plans", `${planId}.json`);
}

export async function loadPublishPlan(projectRoot: string, planId: string): Promise<PublishPlan> {
  const file = planPath(projectRoot, planId);
  if (!(await pathExists(file))) throw new Error(`publish plan not found: ${planId}`);
  return readJson<PublishPlan>(file);
}

function publishKey(articleId: string, bodySha256: string, destinationId: string): string {
  return stableId("publish_key", articleId, bodySha256, destinationId);
}

function updatePlanStatus(plan: PublishPlan): void {
  if (plan.items.every((item) => TERMINAL.has(item.status as PublishEventStatus))) plan.status = "complete";
  else if (plan.items.every((item) => item.status !== "planned" && item.status !== "submitted") && plan.items.some((item) => item.status === "failed")) plan.status = "complete_with_failures";
  else if (plan.items.some((item) => item.attempt_count > 0)) plan.status = "in_progress";
  else if (plan.authorization_id) plan.status = "authorized";
  else plan.status = "prepared";
}

async function assertItemBodyCurrent(projectRoot: string, item: PublishPlanItem): Promise<void> {
  const body = path.join(projectRoot, item.body_path);
  if (!(await pathExists(body))) throw new Error(`article body missing: ${item.body_path}`);
  if (bodyDigest(await readFile(body, "utf-8")) !== item.body_sha256) throw new Error(`article ${item.article_id} body hash changed; revise and approve before publishing`);
  const approved = await approvedArticleInput(projectRoot);
  if (!approved.some((meta) => meta.article_id === item.article_id && meta.body_sha256 === item.body_sha256)) {
    throw new Error(`article ${item.article_id} no longer has a valid approval for this body hash`);
  }
}

export async function preparePublishPlan(projectRoot: string, destinationIds: string[] = []): Promise<{ plan: PublishPlan; path: string; review_path: string }> {
  const manifest = await loadManifest(projectRoot);
  const contentPlanId = manifest.gates?.content_plan?.content_plan_id;
  if (manifest.gates?.content_plan?.status !== "confirmed" || !contentPlanId) throw new Error("publish prepare blocked: content plan is not confirmed");
  const articles = await approvedArticleInput(projectRoot);
  if (!articles.length) throw new Error("publish prepare blocked: no currently approved articles");
  const registry = await loadDestinationRegistry(projectRoot);
  const selected = new Set(destinationIds.map((item) => item.trim()).filter(Boolean));
  if (selected.size) {
    for (const id of selected) {
      const destination = registry.destinations.find((item) => item.destination_id === id);
      if (!destination) throw new Error(`unknown destination: ${id}`);
      if (!destination.enabled) throw new Error(`destination is disabled: ${id}`);
    }
  }
  const destinations = registry.destinations.filter((item) => item.enabled && (!selected.size || selected.has(item.destination_id)));
  const items: PublishPlanItem[] = [];
  for (const article of articles) {
    for (const destination of destinations.filter((item) => item.channel === article.channel)) {
      const idempotencyKey = publishKey(article.article_id, article.body_sha256, destination.destination_id);
      items.push({
        item_id: stableId("publish_item", idempotencyKey),
        article_id: article.article_id,
        article_title: article.title,
        body_path: article.body_path,
        body_sha256: article.body_sha256,
        channel: article.channel,
        destination_id: destination.destination_id,
        destination_name: destination.name,
        execution_mode: destination.mode,
        idempotency_key: idempotencyKey,
        status: "planned",
        attempt_count: 0,
        latest_receipt_id: null,
      });
    }
  }
  if (!items.length) throw new Error("no approved article matches the enabled destination channels");
  items.sort((a, b) => a.idempotency_key.localeCompare(b.idempotency_key));
  const planId = stableId("publish_plan", manifest.app_id, contentPlanId, items.map((item) => item.idempotency_key));
  const out = planPath(projectRoot, planId);
  if (await pathExists(out)) {
    const existing = await readJson<PublishPlan>(out);
    await renderPublishPlanReview(projectRoot, existing);
    return { plan: existing, path: relToProject(projectRoot, out), review_path: "publish/plan-review.md" };
  }
  const plan: PublishPlan = {
    schema_version: 1,
    plan_id: planId,
    app_id: manifest.app_id,
    content_plan_id: contentPlanId,
    created_at: utcNow(),
    status: "prepared",
    authorized_at: null,
    authorized_by: null,
    authorization_id: null,
    items,
  };
  await writeJson(out, plan);
  await renderPublishPlanReview(projectRoot, plan);
  return { plan, path: relToProject(projectRoot, out), review_path: "publish/plan-review.md" };
}

export async function renderPublishPlanReview(projectRoot: string, plan: PublishPlan): Promise<string> {
  const lines = [
    "# 发布计划复核（Dry-run）",
    "",
    "> 本文件不会执行外部发布。approved 仅表示稿件可进入发布准备；只有显式 authorize 后才能记录 submitted/published。",
    "",
    `- Plan ID：\`${plan.plan_id}\``,
    `- 状态：${plan.status}`,
    `- 发布项：${plan.items.length}`,
    "",
  ];
  for (const item of plan.items) {
    lines.push(
      `## ${item.article_title}`,
      "",
      `- Item ID：\`${item.item_id}\``,
      `- 文章：\`${item.article_id}\`；正文：\`${item.body_path}\``,
      `- 正文 SHA-256：\`${item.body_sha256}\``,
      `- 目标：${item.destination_name}（\`${item.destination_id}\` / ${item.channel} / ${item.execution_mode}）`,
      `- 幂等键：\`${item.idempotency_key}\``,
      `- 当前状态：${item.status}`,
      "",
    );
  }
  lines.push("## 授权命令", "", "```bash", `geo-cli publish authorize --project \"${projectRoot}\" --plan ${plan.plan_id} --confirm ${plan.plan_id} --by \"操作人\" --reason \"已核对文章、目标和费用\"`, "```", "");
  const out = path.join(projectRoot, "publish", "plan-review.md");
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, lines.join("\n"), "utf-8");
  return relToProject(projectRoot, out);
}

export async function authorizePublishPlan(projectRoot: string, planId: string, confirmedPlanId: string, by: string, reason: string): Promise<{ authorization: PublishAuthorization; path: string }> {
  if (confirmedPlanId !== planId) throw new Error("authorization confirmation must exactly match the plan ID");
  if (!by.trim() || !reason.trim()) throw new Error("authorization requires --by and --reason");
  const plan = await loadPublishPlan(projectRoot, planId);
  if (plan.status !== "prepared" && !plan.authorization_id) throw new Error(`plan cannot be authorized from status ${plan.status}`);
  for (const item of plan.items) await assertItemBodyCurrent(projectRoot, item);
  const authPath = path.join(projectRoot, "publish", "authorizations", `${planId}.json`);
  if (await pathExists(authPath)) {
    const existing = await readJson<PublishAuthorization>(authPath);
    if (existing.authorized_by !== by.trim() || existing.reason !== reason.trim()) throw new Error("publish plan already has a different immutable authorization");
    return { authorization: existing, path: relToProject(projectRoot, authPath) };
  }
  const authorizedAt = utcNow();
  const authorization: PublishAuthorization = {
    schema_version: 1,
    authorization_id: stableId("publish_authorization", planId, by.trim(), reason.trim(), authorizedAt),
    plan_id: planId,
    app_id: plan.app_id,
    authorized_at: authorizedAt,
    authorized_by: by.trim(),
    reason: reason.trim(),
    confirmed_plan_id: confirmedPlanId,
    item_idempotency_keys: plan.items.map((item) => item.idempotency_key),
  };
  await writeJson(authPath, authorization);
  plan.authorization_id = authorization.authorization_id;
  plan.authorized_at = authorizedAt;
  plan.authorized_by = by.trim();
  updatePlanStatus(plan);
  await writeJson(planPath(projectRoot, planId), plan);
  await renderPublishPlanReview(projectRoot, plan);
  return { authorization, path: relToProject(projectRoot, authPath) };
}

async function assertEvidence(projectRoot: string, evidence?: string): Promise<string | null> {
  if (!evidence?.trim()) return null;
  const value = evidence.trim();
  if (/^https?:\/\//i.test(value)) return value;
  if (path.isAbsolute(value) || value.split(/[\\/]/).includes("..")) throw new Error("evidence path must be a project-relative path without ..");
  if (!(await pathExists(path.join(projectRoot, value)))) throw new Error(`evidence path not found: ${value}`);
  return value.split(path.sep).join("/");
}

async function entries<T>(dir: string): Promise<Array<{ file: string; value: T }>> {
  if (!(await pathExists(dir))) return [];
  const names = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
  return Promise.all(names.map(async (name) => ({ file: path.join(dir, name), value: await readJson<T>(path.join(dir, name)) })));
}

export async function recordPublishResult(projectRoot: string, planId: string, itemId: string, input: PublishRecordInput): Promise<{ attempt: PublishAttempt; receipt: PublishReceipt; plan: PublishPlan }> {
  const plan = await loadPublishPlan(projectRoot, planId);
  if (!plan.authorization_id) throw new Error("publish record blocked: plan is not authorized");
  if (!input.recorded_by?.trim()) throw new Error("publish record requires --by");
  if (!["submitted", "published", "failed", "skipped"].includes(input.status)) throw new Error("invalid publish status");
  const item = plan.items.find((candidate) => candidate.item_id === itemId);
  if (!item) throw new Error(`publish item not found: ${itemId}`);
  if (TERMINAL.has(item.status as PublishEventStatus)) throw new Error(`publish item is already terminal: ${item.status}`);
  await assertItemBodyCurrent(projectRoot, item);
  if (input.status === "published" && !input.external_url?.trim()) throw new Error("published receipt requires --external-url");
  if (input.status === "failed" && !input.error_message?.trim()) throw new Error("failed receipt requires --error-message");
  const evidencePath = await assertEvidence(projectRoot, input.evidence_path);
  const attemptDir = path.join(projectRoot, "publish", "attempts", item.item_id);
  const previousAttempts = await entries<PublishAttempt>(attemptDir);
  const ordinal = previousAttempts.length + 1;
  const recordedAt = utcNow();
  const error = input.status === "failed" ? { code: input.error_code?.trim() || "publish_failed", message: input.error_message!.trim(), retryable: input.retryable ?? true } : null;
  const attempt: PublishAttempt = {
    schema_version: 1,
    attempt_id: stableId("publish_attempt", item.idempotency_key, ordinal, input.status, recordedAt),
    plan_id: planId,
    item_id: item.item_id,
    idempotency_key: item.idempotency_key,
    ordinal,
    mode: item.execution_mode,
    status: input.status,
    recorded_at: recordedAt,
    recorded_by: input.recorded_by.trim(),
    external_url: input.external_url?.trim() || null,
    external_id: input.external_id?.trim() || null,
    evidence_path: evidencePath,
    error,
  };
  const receipt: PublishReceipt = {
    ...attempt,
    receipt_id: stableId("publish_receipt", attempt.attempt_id),
    article_id: item.article_id,
    body_sha256: item.body_sha256,
    destination_id: item.destination_id,
  };
  const attemptPath = path.join(attemptDir, `${attempt.attempt_id}.json`);
  const receiptPath = path.join(projectRoot, "publish", "receipts", item.item_id, `${receipt.receipt_id}.json`);
  if (await pathExists(attemptPath) || await pathExists(receiptPath)) throw new Error("attempt/receipt idempotency conflict");
  await writeJson(attemptPath, attempt);
  await writeJson(receiptPath, receipt);
  item.status = input.status;
  item.attempt_count = ordinal;
  item.latest_receipt_id = receipt.receipt_id;
  updatePlanStatus(plan);
  await writeJson(planPath(projectRoot, planId), plan);
  await renderPublishPlanReview(projectRoot, plan);
  await renderPublishingStatus(projectRoot, planId);
  return { attempt, receipt, plan };
}

export async function listPublishPlans(projectRoot: string): Promise<PublishPlan[]> {
  return (await entries<PublishPlan>(path.join(projectRoot, "publish", "plans"))).map((entry) => entry.value);
}

export async function publishingStatus(projectRoot: string, planId?: string): Promise<Record<string, unknown>> {
  const plans = planId ? [await loadPublishPlan(projectRoot, planId)] : await listPublishPlans(projectRoot);
  const counts: Record<string, number> = { prepared: 0, authorized: 0, in_progress: 0, complete: 0, complete_with_failures: 0, planned_items: 0, submitted: 0, published: 0, failed: 0, skipped: 0 };
  for (const plan of plans) {
    counts[plan.status] = (counts[plan.status] ?? 0) + 1;
    for (const item of plan.items) counts[item.status === "planned" ? "planned_items" : item.status] = (counts[item.status === "planned" ? "planned_items" : item.status] ?? 0) + 1;
  }
  return { plans: plans.map((plan) => ({ plan_id: plan.plan_id, status: plan.status, items: plan.items.length })), counts };
}

export async function renderPublishingStatus(projectRoot: string, planId?: string): Promise<string> {
  const plans = planId ? [await loadPublishPlan(projectRoot, planId)] : await listPublishPlans(projectRoot);
  const summary = await publishingStatus(projectRoot, planId);
  const lines = ["# 发布进度", "", "> approved、submitted 与 published 是三个独立状态。只有 published receipt 才计为已发布。", "", "```json", JSON.stringify(summary, null, 2), "```", ""];
  for (const plan of plans) {
    lines.push(`## ${plan.plan_id}`, "", `- 计划状态：${plan.status}；授权人：${plan.authorized_by ?? "—"}`, "");
    for (const item of plan.items) lines.push(`- ${item.article_title} → ${item.destination_name}：${item.status}（attempts ${item.attempt_count}）`);
    lines.push("");
  }
  const out = path.join(projectRoot, "publish", "status.md");
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, lines.join("\n"), "utf-8");
  return relToProject(projectRoot, out);
}

export const publishingInternals = { assertNoSecrets, assertRegistry, assertEvidence, publishKey, updatePlanStatus };
