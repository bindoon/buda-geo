import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ArticleMeta } from "../lib/article-model.js";
import { authorizePublishPlan, preparePublishPlan, recordPublishResult } from "../lib/publishing.js";
import { validatePublishing } from "../lib/publishing-validate.js";
import { writeJson } from "../lib/util.js";

function sha(body: string): string { return createHash("sha256").update(body.trim()).digest("hex"); }

async function publishingFixture(): Promise<{ root: string; articleId: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "buda-publishing-"));
  const articleId = "article_publish_test";
  const body = "这是一篇经过五项人工审稿并绑定正文哈希的本地测试文章。内容只使用公开事实，明确说明采购条件需要按实际订单继续核验，不作销量、排名、产能或交期承诺。为了满足发布流程的正文长度要求，这里补充说明：发布前应核对目标渠道、文章版本、费用和授权人；发布后应记录外部链接、平台记录编号与证据，确保每一次状态变化都可以审计，也不会把批准误写成已经发布。";
  const bodyPath = `articles/social/${articleId}.md`;
  await mkdir(path.join(root, "articles", "social"), { recursive: true });
  await writeFile(path.join(root, bodyPath), body, "utf-8");
  const bodySha = sha(body);
  const checks = {
    factual_accuracy: { pass: true, note: "事实可追溯" },
    claim_boundaries: { pass: true, note: "没有越界" },
    channel_fit: { pass: true, note: "适合渠道" },
    compliance: { pass: true, note: "合规" },
    originality: { pass: true, note: "原创" },
  };
  const meta: ArticleMeta = {
    schema_version: 1, article_id: articleId, app_id: "app_publish", content_plan_id: "content_plan_publish", content_plan_version: 1,
    task_id: "task_publish", topic_id: "topic_publish", faq_ids: [], scenario_ids: [], question_ids: [], fact_snapshot_id: "fact_snapshot_publish",
    channel: "social", title: "本地发布审计测试", body_path: bodyPath, body_sha256: bodySha, chars: body.length, used_fact_ids: ["fact_publish"], used_image_paths: [],
    mode: "factual", claim_boundaries: [], status: "approved", requires_human_review: true, current_revision: 1,
    revisions: [{ revision: 1, path: bodyPath, sha256: bodySha, chars: body.length, at: "2026-08-10T00:00:00Z", reason: null, based_on_revision: null }],
    risks: [], review_history: [{ review_id: "article_review_publish", action: "approve", reason: "五项通过", assessment: { schema_version: 1, article_id: articleId, body_sha256: bodySha, checks, summary: "通过" }, body_sha256: bodySha, at: "2026-08-10T00:00:00Z" }],
    created_at: "2026-08-10T00:00:00Z", updated_at: "2026-08-10T00:00:00Z",
  };
  await writeJson(path.join(root, "articles", "social", `${articleId}.meta.json`), meta);
  await writeJson(path.join(root, "manifest.json"), {
    app_id: "app_publish", project_name: "发布测试", gates: { clean: { status: "confirmed", fact_snapshot_id: "fact_snapshot_publish" }, content_plan: { status: "confirmed", content_plan_id: "content_plan_publish" } }, missing: [],
    clean_pipeline: { stage: "confirmed", inputs_hash: "a", facts_hash: "b", changed_since_confirmation: false, previous_snapshot_id: null }, clean_ready: true, review_ready: true,
  });
  await writeJson(path.join(root, "publish", "destinations.json"), {
    schema_version: 1, app_id: "app_publish", updated_at: "2026-08-10T00:00:00Z",
    destinations: [{ destination_id: "destination_social_test", name: "测试自媒体", channel: "social", authority_tier: "official", mode: "manual", enabled: true, homepage_url: null, notes: null, adapter: null }],
  });
  return { root, articleId };
}

test("publishing requires authorization, preserves failed retries, and protects terminal receipts", async () => {
  const { root } = await publishingFixture();
  const prepared = await preparePublishPlan(root);
  assert.equal(prepared.plan.status, "prepared");
  assert.equal(prepared.plan.items.length, 1);
  const item = prepared.plan.items[0];
  await assert.rejects(recordPublishResult(root, prepared.plan.plan_id, item.item_id, { status: "published", recorded_by: "测试员", external_url: "https://example.com/post" }), /not authorized/);
  await assert.rejects(authorizePublishPlan(root, prepared.plan.plan_id, "wrong-plan", "测试员", "已核对"), /exactly match/);
  const authorized = await authorizePublishPlan(root, prepared.plan.plan_id, prepared.plan.plan_id, "测试员", "已核对正文、目标与费用");
  assert.equal(authorized.authorization.plan_id, prepared.plan.plan_id);
  const failed = await recordPublishResult(root, prepared.plan.plan_id, item.item_id, { status: "failed", recorded_by: "测试员", error_message: "平台临时失败" });
  assert.equal(failed.plan.status, "complete_with_failures");
  const published = await recordPublishResult(root, prepared.plan.plan_id, item.item_id, { status: "published", recorded_by: "测试员", external_url: "https://example.com/post", external_id: "external-1" });
  assert.equal(published.plan.status, "complete");
  assert.equal(published.attempt.ordinal, 2);
  await assert.rejects(recordPublishResult(root, prepared.plan.plan_id, item.item_id, { status: "published", recorded_by: "测试员", external_url: "https://example.com/post-2" }), /already terminal/);
  const validation = await validatePublishing(root);
  assert.deepEqual(validation.errors, []);
  assert.equal(validation.ok, true);
  assert((await readFile(path.join(root, "publish", "status.md"), "utf-8")).includes("published"));
});

test("publishing rejects credential fields and detects stale approved bodies", async () => {
  const { root, articleId } = await publishingFixture();
  const registryPath = path.join(root, "publish", "destinations.json");
  const unsafe = JSON.parse(await readFile(registryPath, "utf-8"));
  unsafe.destinations[0].password = "do-not-store";
  await writeJson(registryPath, unsafe);
  await assert.rejects(preparePublishPlan(root), /forbidden credential field/);
  delete unsafe.destinations[0].password;
  await writeJson(registryPath, unsafe);
  const prepared = await preparePublishPlan(root);
  await authorizePublishPlan(root, prepared.plan.plan_id, prepared.plan.plan_id, "测试员", "已核对");
  await writeFile(path.join(root, "articles", "social", `${articleId}.md`), "正文被绕过 revision 直接修改，旧批准必须失效。".repeat(8));
  const validation = await validatePublishing(root);
  assert.equal(validation.ok, false);
  assert(validation.errors.some((error) => /body hash|valid approval/.test(error)));
});
