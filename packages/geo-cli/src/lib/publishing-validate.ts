import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { approvedArticleInput } from "./article-review.js";
import { stableId } from "./fact-model.js";
import type { PublishAttempt, PublishAuthorization, PublishPlan, PublishReceipt, PublishingDestinationRegistry } from "./publishing-model.js";
import { publishingInternals } from "./publishing.js";
import { pathExists, readJson } from "./util.js";

const require = createRequire(import.meta.url);
const Ajv = require("ajv/dist/2020") as typeof import("ajv/dist/2020.js").default;
const addFormats = require("ajv-formats") as (ajv: InstanceType<typeof Ajv>) => void;
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCHEMAS_DIR = path.join(PACKAGE_ROOT, "schemas");

function digest(text: string): string { return createHash("sha256").update(text.trim()).digest("hex"); }
function schemaErrors(prefix: string, errors: Array<{ instancePath: string; message?: string }> | null | undefined): string[] { return (errors ?? []).map((x) => `${prefix}${x.instancePath || "/"} ${x.message ?? "invalid"}`); }
async function schema(name: string): Promise<object> { return JSON.parse(await readFile(path.join(SCHEMAS_DIR, name), "utf-8")) as object; }
async function jsonEntries<T>(dir: string): Promise<Array<{ name: string; value: T }>> { if (!(await pathExists(dir))) return []; const names = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort(); return Promise.all(names.map(async (name) => ({ name, value: await readJson<T>(path.join(dir, name)) }))); }

export interface PublishingValidationResult { ok: boolean; errors: string[]; checked: string[] }

export async function validatePublishing(projectRoot: string): Promise<PublishingValidationResult> {
  const errors: string[] = [];
  const checked: string[] = [];
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validators = {
    registry: ajv.compile(await schema("publishing-destination.schema.json")),
    plan: ajv.compile(await schema("publishing-plan.schema.json")),
    authorization: ajv.compile(await schema("publishing-authorization.schema.json")),
    attempt: ajv.compile(await schema("publishing-attempt.schema.json")),
    receipt: ajv.compile(await schema("publishing-receipt.schema.json")),
  };
  const manifest = await readJson<Record<string, any>>(path.join(projectRoot, "manifest.json"));
  const registryPath = path.join(projectRoot, "publish", "destinations.json");
  if (!(await pathExists(registryPath))) return { ok: false, errors: ["publish/destinations.json is missing"], checked };
  const registry = await readJson<PublishingDestinationRegistry>(registryPath);
  checked.push("publish/destinations.json");
  if (!validators.registry(registry)) errors.push(...schemaErrors("publish/destinations.json:", validators.registry.errors));
  try { publishingInternals.assertRegistry(registry, manifest.app_id); } catch (error) { errors.push(`publish/destinations.json: ${(error as Error).message}`); }
  const destinations = new Map(registry.destinations.map((item) => [item.destination_id, item]));
  let approved: Awaited<ReturnType<typeof approvedArticleInput>> = [];
  try { approved = await approvedArticleInput(projectRoot); } catch (error) { errors.push(`approved article input: ${(error as Error).message}`); }
  const approvedById = new Map(approved.map((item) => [item.article_id, item]));
  const plans = await jsonEntries<PublishPlan>(path.join(projectRoot, "publish", "plans"));
  if (!plans.length) errors.push("no publish plans found");
  for (const { name, value: plan } of plans) {
    const planRel = `publish/plans/${name}`;
    checked.push(planRel);
    if (!validators.plan(plan)) errors.push(...schemaErrors(`${planRel}:`, validators.plan.errors));
    if (plan.app_id !== manifest.app_id) errors.push(`${planRel}: app_id mismatch`);
    if (plan.content_plan_id !== manifest.gates?.content_plan?.content_plan_id) errors.push(`${planRel}: stale content plan reference`);
    const expectedPlanId = stableId("publish_plan", plan.app_id, plan.content_plan_id, plan.items.map((item) => item.idempotency_key).sort());
    if (plan.plan_id !== expectedPlanId) errors.push(`${planRel}: invalid stable plan ID`);
    const itemIds = new Set<string>();
    const idempotencyKeys = new Set<string>();
    const authPath = path.join(projectRoot, "publish", "authorizations", `${plan.plan_id}.json`);
    let authorization: PublishAuthorization | null = null;
    if (await pathExists(authPath)) {
      authorization = await readJson<PublishAuthorization>(authPath);
      checked.push(`publish/authorizations/${plan.plan_id}.json`);
      if (!validators.authorization(authorization)) errors.push(...schemaErrors(`publish/authorizations/${plan.plan_id}.json:`, validators.authorization.errors));
      if (authorization.plan_id !== plan.plan_id || authorization.confirmed_plan_id !== plan.plan_id || authorization.authorization_id !== plan.authorization_id) errors.push(`${planRel}: authorization identity mismatch`);
      const expectedKeys = [...plan.items.map((item) => item.idempotency_key)].sort();
      if (JSON.stringify([...authorization.item_idempotency_keys].sort()) !== JSON.stringify(expectedKeys)) errors.push(`${planRel}: authorization item set mismatch`);
    } else if (plan.authorization_id || plan.status !== "prepared") {
      errors.push(`${planRel}: authorized/in-progress plan has no authorization record`);
    }
    for (const item of plan.items) {
      if (itemIds.has(item.item_id)) errors.push(`${planRel}: duplicate item ID ${item.item_id}`); else itemIds.add(item.item_id);
      if (idempotencyKeys.has(item.idempotency_key)) errors.push(`${planRel}: duplicate idempotency key ${item.idempotency_key}`); else idempotencyKeys.add(item.idempotency_key);
      const destination = destinations.get(item.destination_id);
      if (!destination || !destination.enabled) errors.push(`${planRel}:${item.item_id}: destination missing or disabled`);
      else if (destination.channel !== item.channel || destination.mode !== item.execution_mode || destination.name !== item.destination_name) errors.push(`${planRel}:${item.item_id}: destination snapshot mismatch`);
      const expectedKey = publishingInternals.publishKey(item.article_id, item.body_sha256, item.destination_id);
      if (expectedKey !== item.idempotency_key) errors.push(`${planRel}:${item.item_id}: invalid idempotency key`);
      if (item.item_id !== stableId("publish_item", item.idempotency_key)) errors.push(`${planRel}:${item.item_id}: invalid item ID`);
      const article = approvedById.get(item.article_id);
      if (!article || article.body_sha256 !== item.body_sha256) errors.push(`${planRel}:${item.item_id}: no current valid approval for body hash`);
      const bodyPath = path.join(projectRoot, item.body_path);
      if (!(await pathExists(bodyPath))) errors.push(`${planRel}:${item.item_id}: body missing`);
      else if (digest(await readFile(bodyPath, "utf-8")) !== item.body_sha256) errors.push(`${planRel}:${item.item_id}: body hash mismatch`);
      const attempts = (await jsonEntries<PublishAttempt>(path.join(projectRoot, "publish", "attempts", item.item_id))).map((entry) => entry.value).sort((a, b) => a.ordinal - b.ordinal);
      const receipts = (await jsonEntries<PublishReceipt>(path.join(projectRoot, "publish", "receipts", item.item_id))).map((entry) => entry.value).sort((a, b) => a.ordinal - b.ordinal);
      for (const attempt of attempts) {
        const attemptId = attempt.attempt_id;
        checked.push(`publish/attempts/${item.item_id}/${attemptId}.json`);
        if (!validators.attempt(attempt as unknown)) errors.push(...schemaErrors(`${item.item_id}/${attemptId}:`, validators.attempt.errors));
        if (attempt.plan_id !== plan.plan_id || attempt.item_id !== item.item_id || attempt.idempotency_key !== item.idempotency_key || attempt.mode !== item.execution_mode) errors.push(`${item.item_id}/${attempt.attempt_id}: attempt identity mismatch`);
      }
      for (const receipt of receipts) {
        const receiptId = receipt.receipt_id;
        checked.push(`publish/receipts/${item.item_id}/${receiptId}.json`);
        if (!validators.receipt(receipt as unknown)) errors.push(...schemaErrors(`${item.item_id}/${receiptId}:`, validators.receipt.errors));
        if (receipt.plan_id !== plan.plan_id || receipt.item_id !== item.item_id || receipt.article_id !== item.article_id || receipt.body_sha256 !== item.body_sha256 || receipt.destination_id !== item.destination_id || receipt.idempotency_key !== item.idempotency_key) errors.push(`${item.item_id}/${receipt.receipt_id}: receipt identity mismatch`);
        const attempt = attempts.find((candidate) => candidate.attempt_id === receipt.attempt_id);
        if (!attempt || attempt.status !== receipt.status || attempt.ordinal !== receipt.ordinal) errors.push(`${item.item_id}/${receipt.receipt_id}: receipt has no matching attempt`);
        if (receipt.evidence_path && !/^https?:\/\//i.test(receipt.evidence_path) && !(await pathExists(path.join(projectRoot, receipt.evidence_path)))) errors.push(`${item.item_id}/${receipt.receipt_id}: evidence path missing`);
      }
      if (attempts.length !== receipts.length) errors.push(`${planRel}:${item.item_id}: each attempt must have one receipt`);
      if (attempts.some((attempt, index) => attempt.ordinal !== index + 1)) errors.push(`${planRel}:${item.item_id}: attempt ordinals are not contiguous`);
      if (item.attempt_count !== attempts.length) errors.push(`${planRel}:${item.item_id}: attempt_count mismatch`);
      const latest = receipts.at(-1);
      if ((latest?.receipt_id ?? null) !== item.latest_receipt_id || (latest?.status ?? "planned") !== item.status) errors.push(`${planRel}:${item.item_id}: current status/latest receipt mismatch`);
      if (receipts.filter((receipt) => receipt.status === "published" || receipt.status === "skipped").length > 1) errors.push(`${planRel}:${item.item_id}: multiple terminal receipts`);
      if (attempts.length && !authorization) errors.push(`${planRel}:${item.item_id}: attempts exist without authorization`);
    }
    const expectedPlan = structuredClone(plan);
    publishingInternals.updatePlanStatus(expectedPlan);
    if (expectedPlan.status !== plan.status) errors.push(`${planRel}: aggregate status mismatch; expected ${expectedPlan.status}`);
  }
  return { ok: errors.length === 0, errors, checked };
}
