import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateDiagnosis } from "../lib/diagnosis-validate.js";
import { stableId, type FactLedger, type FactRecord, type SubjectRecord } from "../lib/fact-model.js";
import { buildMissing } from "../lib/manifest.js";
import { pageMetricsFromHtml, parseRobots } from "../lib/site-audit-html.js";
import { confirmSiteAuditReport, runSiteAudit, siteAuditGaps } from "../lib/site-audit-report.js";
import { classifyPublicPresence, classifyPublicUrl, isForbiddenSsrfAddress, normalizeAndValidateWebsiteUrl } from "../lib/site-audit-url.js";
import { readJson, writeJson } from "../lib/util.js";

const HOME_HTML = `<!doctype html><html><head><title>测试品牌官方站</title>
<meta name="description" content="测试品牌生产园林工具">
<link rel="canonical" href="https://www.example.com/">
<script type="application/ld+json">{"@type":"Organization","name":"测试品牌","sameAs":["https://www.example.com"]}</script>
</head><body><header>导航</header><main>
<h1>测试品牌是做什么的</h1>
<p>${"这是一段足够长的官网介绍，说明公司主体、产品和可核验来源。".repeat(8)}</p>
<ul><li>产品一</li><li>产品二</li></ul>
<a href="/about">关于我们</a><a href="/products">产品</a>
<img src="/a.jpg" alt="产品图"><img src="/b.jpg">
</main></body></html>`;

const ABOUT_HTML = `<!doctype html><html><head><title>关于测试品牌</title></head><body><main>
<h1>关于我们</h1><p>${"公司介绍内页正文。".repeat(20)}</p><a href="/">首页</a>
</main></body></html>`;

async function fixtureProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "geo-site-audit-"));
  const appId = "app_site_audit_test";
  const companyId = stableId("sub_company", appId);
  const subjects: SubjectRecord[] = [
    { subject_id: companyId, type: "company", name: "测试工具有限公司", parent_subject_id: null, source_refs: ["src_1"], review_status: "confirmed" },
  ];
  const facts: FactRecord[] = [];
  const add = (field: string, value: unknown) => facts.push({
    fact_id: stableId("fact", companyId, field, value), subject_id: companyId, field, value, unit: null,
    source_refs: ["src_1"], derivation: "extracted", confidence: 1, review_status: "confirmed", disclosure_level: "public",
  });
  add("company_name", "测试工具有限公司");
  add("company_short_name", "测试品牌");
  add("website_or_shop_url", "https://www.example.com/");
  add("conversion", { phone: "", shop_url: "" });
  const ledger: FactLedger = {
    app_id: appId, generated_at: "2026-01-01T00:00:00Z", inputs_hash: "a".repeat(64), facts_hash: "b".repeat(64),
    subjects, facts, conflicts: [],
  };
  const snapshotId = stableId("fact_snapshot", ledger.inputs_hash, ledger.facts_hash);
  await writeJson(path.join(root, "manifest.json"), {
    app_id: appId, project_name: "测试工具有限公司",
    gates: { clean: { status: "confirmed", at: "2026-01-01T00:00:00Z", fact_snapshot_id: snapshotId }, diagnose: { status: "pending", at: null } },
    missing: [], clean_pipeline: { stage: "confirmed", inputs_hash: ledger.inputs_hash, facts_hash: ledger.facts_hash, changed_since_confirmation: false, previous_snapshot_id: null },
    clean_ready: true, review_ready: true,
  });
  await writeJson(path.join(root, "knowledge", "snapshots", `${snapshotId}.json`), {
    schema_version: 2, fact_snapshot_id: snapshotId, app_id: appId, confirmed_at: "2026-01-01T00:00:00Z",
    inputs_hash: ledger.inputs_hash, facts_hash: ledger.facts_hash,
    source_index: { app_id: appId, generated_at: "2026-01-01T00:00:00Z", inputs_hash: ledger.inputs_hash, sources: [] },
    facts: ledger,
  });
  return root;
}

function mockResponse(url: string, html: string, status = 200): Response {
  const response = new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

const mockFetch: typeof fetch = async (input) => {
  const url = String(input);
  if (url.includes("localhost") || url.includes("127.0.0.1")) throw new Error("ssrf");
  if (url.endsWith("/robots.txt")) return mockResponse(url, "User-agent: *\nAllow: /\nSitemap: https://www.example.com/sitemap.xml\n");
  if (url.endsWith("/sitemap.xml")) return mockResponse(url, "<urlset><loc>https://www.example.com/</loc><loc>https://www.example.com/about</loc></urlset>", 200);
  if (url.endsWith("/llms.txt")) return mockResponse(url, "", 404);
  if (url.includes("/about")) return mockResponse("https://www.example.com/about", ABOUT_HTML);
  return mockResponse("https://www.example.com/", HOME_HTML);
};

test("classifies owned websites and marketplace shops", () => {
  assert.equal(classifyPublicUrl("https://www.zhiyu.hk").kind, "owned_website");
  assert.equal(classifyPublicUrl("https://jm15965827526.1688.com/").kind, "marketplace_shop");
  assert.equal(classifyPublicUrl("https://shop.example.1688.com/offer").marketplace, "1688.com");
  const shopOnly = classifyPublicPresence("https://foo.1688.com/", "https://foo.1688.com/");
  assert.equal(shopOnly.audit_eligible, false);
  assert.match(shopOnly.skip_reason ?? "", /1688/);
  const mixed = classifyPublicPresence("https://www.zhiyu.hk", "https://foo.1688.com/");
  assert.equal(mixed.audit_eligible, true);
  assert.equal(mixed.owned_website_url, "https://www.zhiyu.hk/");
});

test("URL policy rejects localhost and private hosts", async () => {
  await assert.rejects(normalizeAndValidateWebsiteUrl("http://localhost"), /本机或内网/);
  await assert.rejects(normalizeAndValidateWebsiteUrl("http://127.0.0.1"), /内网/);
  await assert.rejects(normalizeAndValidateWebsiteUrl("https://user:pass@example.com"), /用户名或密码/);
  assert.equal(isForbiddenSsrfAddress("192.168.1.1"), true);
  assert.equal(isForbiddenSsrfAddress("198.18.0.30"), false);
  assert.equal(isForbiddenSsrfAddress("fdfe:dcba:9876::1d"), false);
});

test("HTML metrics extract title, schema, question headings and challenge pages", () => {
  const metrics = pageMetricsFromHtml(HOME_HTML, "https://www.example.com/");
  assert.equal(metrics.title, "测试品牌官方站");
  assert.ok(metrics.schemaTypes.includes("Organization"));
  assert.ok(metrics.questionHeadingCount >= 1);
  assert.equal(metrics.challenge, false);
  assert.ok(metrics.mainTextCharacters > 80);
  const challenge = pageMetricsFromHtml("<html><body>正在验证您的浏览器</body></html>", "https://www.example.com/");
  assert.equal(challenge.challenge, true);
  const robots = parseRobots("User-agent: *\nDisallow: /\n");
  assert.equal(robots.globalRootDisallow, true);
});

test("clean missing marks shop-only sites as optional owned_website", () => {
  const missing = buildMissing({
    app_id: "app_x", company_name: "测试", company_short_name: "测试", contact_name: "", contact_phone: "",
    address: "", website_or_shop_url: "https://foo.1688.com/", region: "", media_accounts: [],
    conversion: { shop_url: "https://foo.1688.com/" }, credentials: [],
  }, { intro: "x".repeat(120), products_services: "产品", advantages: "优势", trust: "背书" }, [{ name: "产品" } as any], true);
  assert.ok(missing.some((item) => item.code === "owned_website" && item.severity === "optional"));
  assert.ok(!missing.some((item) => item.code === "shop_or_website"));
});

test("site-audit collect, report, confirm and validate form a complementary chain", async () => {
  const root = await fixtureProject();
  await assert.rejects(runSiteAudit(root, { url: "https://demo.1688.com/", fetchImpl: mockFetch, delayMs: 0, samplePages: 5, skipAddressLookup: true }), /店铺页/);
  const rendered = await runSiteAudit(root, { url: "https://www.example.com/", fetchImpl: mockFetch, delayMs: 0, samplePages: 5, skipAddressLookup: true });
  assert.equal(rendered.report.composite_score, null);
  assert.equal(rendered.report.status, "review_required");
  assert.ok(rendered.audit.data_quality.reliable);
  assert.ok(rendered.audit.structure.organization_pages >= 1);
  assert.ok(rendered.audit.pages.some((page) => page.url.includes("/about") || page.final_url.includes("/about")));
  const markdown = await readFile(path.join(root, rendered.markdownPath), "utf-8");
  assert.match(markdown, /官网技术审计报告/);
  assert.match(markdown, /不设综合分/);
  assert.match(markdown, /采样的/);
  const confirmed = await confirmSiteAuditReport(root, rendered.report.report_id);
  assert.equal(confirmed.status, "confirmed");
  const validation = await validateDiagnosis(root);
  assert.deepEqual(validation.errors, [], validation.errors.join("\n"));
  const manifest = await readJson<Record<string, any>>(path.join(root, "manifest.json"));
  assert.equal(manifest.gates.site_audit.report_id, rendered.report.report_id);
  assert.equal(manifest.gates.diagnose.status, "pending");
  const gaps = siteAuditGaps(rendered.audit, []);
  assert.ok(gaps.every((gap) => gap.kind.startsWith("site_")));
});
