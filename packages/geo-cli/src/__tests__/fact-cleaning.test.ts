import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { cleanProject } from "../lib/clean.js";
import { confirmClean } from "../lib/confirm.js";
import { digestObject, stableId, type FactLedger, type SourceIndex } from "../lib/fact-model.js";
import { inventory } from "../lib/inventory.js";
import { semanticFindings } from "../lib/quality.js";
import { writeCleanReview } from "../lib/review.js";
import type { SkuItem } from "../lib/skus.js";
import { readJson, writeJson } from "../lib/util.js";
import { validateProject } from "../lib/validate.js";

test("stable IDs and hashes ignore object key order", () => {
  assert.equal(digestObject({ a: 1, b: 2 }), digestObject({ b: 2, a: 1 }));
  assert.equal(stableId("fact", "subject", "field", "value"), stableId("fact", "subject", "field", "value"));
});

test("semantic checks reject hash products, empty main products and unresolved conflicts", () => {
  const sourceIndex: SourceIndex = {
    app_id: "app_test",
    generated_at: "2026-01-01T00:00:00Z",
    inputs_hash: "a".repeat(64),
    sources: [],
  };
  const sku: SkuItem = {
    sku_id: "sku_aabbccddeeff0011",
    name: "aabbccddeeff0011",
    category: "",
    selling_points: [],
    attributes: {},
    capabilities: [],
    is_main: true,
    source_refs: [],
    fact_refs: [],
    copy_brief: null,
    images: [],
  };
  const facts: FactLedger = {
    app_id: "app_test",
    generated_at: "2026-01-01T00:00:00Z",
    inputs_hash: sourceIndex.inputs_hash,
    facts_hash: "b".repeat(64),
    subjects: [],
    facts: [],
    conflicts: [{
      conflict_id: "conflict_1",
      subject_id: "company_1",
      field: "company_name",
      candidate_fact_ids: ["fact_1", "fact_2"],
      severity: "block",
      status: "unresolved",
      resolution: null,
    }],
  };
  const findings = semanticFindings({
    profile: {
      app_id: "app_test",
      intro: "介绍",
      products_services: "产品",
      advantages: "用户痛点：内容；信任背书：内容",
      trust: "",
      pain_points: [],
      source: "docx:test.docx",
    },
    skus: [sku],
    facts,
    sourceIndex,
  });
  const codes = findings.map((item) => item.code);
  assert(codes.some((code) => code.startsWith("product_hash_name:")));
  assert(codes.some((code) => code.startsWith("main_product_substance:")));
  assert(codes.includes("profile_trust_misbucket"));
  assert(codes.includes("profile_pain_points_misbucket"));
  assert(codes.some((code) => code.startsWith("unresolved_conflict:")));
});

test("clean, validate, confirm and re-clean preserve inputs and confirmation semantics", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "geo-fact-cleaning-"));
  const inputs = path.join(projectRoot, "inputs");
  const knowledge = path.join(projectRoot, "knowledge");
  await mkdir(inputs, { recursive: true });
  await writeJson(path.join(knowledge, "clean.overrides.json"), {
    app_id: "app_test",
    assets: [],
    products: [{
      name: "测试产品",
      category: "测试品类",
      is_main: true,
      source_paths: ["产品图/**"],
      fact_source_paths: ["企业知识库.docx"],
      selling_points: ["来源明确的测试卖点"],
      attributes: { material: "测试材料" },
      capabilities: ["生产供应"],
      reason: "测试规则",
    }],
    profile: {
      source_path: "企业知识库.docx",
      intro: `测试制造有限公司是一家用于自动化测试的制造企业。${"该企业资料经过项目级语义清理。".repeat(12)}`,
      products_services: "主营测试产品，提供生产供应服务。",
      advantages: "测试产品采用测试材料，来源明确。",
      trust: "企业资料由测试原件支持。",
      pain_points: ["客户需要来源明确且可追溯的产品资料。"],
      reason: "测试项目级画像精修，不写死在 CLI。",
    },
    fact_resolutions: [{
      subject: "company",
      field: "company_short_name",
      value: "测试制造",
      reason: "以本次企业信息收集表为准",
    }],
    review_notes: [{
      code: "confirm_test_claim",
      severity: "recommend",
      message: "请确认测试资料中的业务表述。",
    }],
  });
  await writeJson(path.join(knowledge, "company.baseinfo.json"), {
    app_id: "app_test",
    company_name: "测试制造有限公司",
    company_short_name: "旧测试简称",
    contact_name: "",
    contact_phone: "",
    address: "",
    website_or_shop_url: "",
    region: "",
    media_accounts: [],
    conversion: {},
    credentials: [],
  });

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["公司名称", "测试制造有限公司", "公司简称", "测试制造"],
    ["联系人", "测试联系人", "联系方式", "13800138000"],
    ["公司地址", "测试地址"],
    ["公司官网", "https://example.com"],
    ["百家号", "账号：test 密码：never-store-this"],
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
  const xlsxBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  await writeFile(path.join(inputs, "企业信息收集表.xlsx"), xlsxBuffer);

  const zip = new JSZip();
  const paragraphs = [
    "一、公司介绍",
    `测试制造有限公司是一家用于自动化测试的制造企业。${"具备稳定生产与质量管理能力。".repeat(12)}`,
    "二、产品服务",
    "主营测试产品，提供生产供应服务。",
    "三、产品特点",
    "测试产品采用测试材料，来源明确。",
    "四、信任背书",
    "企业资料由测试原件支持。",
    "五、用户痛点",
    "客户需要来源明确且可追溯的产品资料。",
  ];
  zip.file(
    "word/document.xml",
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map((paragraph) => `<w:p><w:r><w:t>${paragraph}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`,
  );
  await writeFile(path.join(inputs, "企业知识库.docx"), await zip.generateAsync({ type: "nodebuffer" }));
  const imagePath = path.join(inputs, "产品图", "测试产品.jpg");
  await mkdir(path.dirname(imagePath), { recursive: true });
  await writeFile(imagePath, Buffer.from("fake-image-v1"));
  const legacyEvidenceAsset = path.join(projectRoot, "assets", "images", "_trust", "license.jpg");
  await mkdir(path.dirname(legacyEvidenceAsset), { recursive: true });
  await writeFile(legacyEvidenceAsset, Buffer.from("legacy-derived-copy"));
  await writeJson(path.join(knowledge, "company.evidence.json"), {
    app_id: "app_test",
    generated_at: "2026-01-01T00:00:00Z",
    items: [{ path: "assets/images/_trust/license.jpg" }],
  });

  const inputInventoryBefore = await inventory(projectRoot);
  const first = await cleanProject(projectRoot, "app_test");
  assert.equal(first.review_ready, true);
  assert.equal(first.clean_ready, false);
  assert(first.warnings.some((warning) => warning.startsWith("removed_legacy_evidence:")));
  await assert.rejects(readFile(path.join(knowledge, "company.evidence.json")));
  await assert.rejects(readFile(legacyEvidenceAsset));
  assert(!JSON.stringify(await readJson(path.join(knowledge, "company.baseinfo.json"))).includes("never-store-this"));
  const beforeConfirmation = await validateProject(projectRoot, true);
  assert.equal(beforeConfirmation.ok, true, beforeConfirmation.errors.join("\n"));
  assert.equal(beforeConfirmation.structural.length, 0);
  const resolvedFacts = await readJson<FactLedger>(path.join(knowledge, "company.facts.json"));
  const profileFacts = resolvedFacts.facts.filter((fact) => ["intro", "products_services", "advantages", "trust", "pain_points"].includes(fact.field));
  assert(profileFacts.every((fact) => fact.derivation === "operator"));
  assert.equal(resolvedFacts.subjects.some((subject) => (subject.type as string) === "asset"), false);
  assert.equal(resolvedFacts.facts.some((fact) => fact.field === "path"), false);
  const sourceIndexAfterClean = await readJson<SourceIndex>(path.join(knowledge, "source-index.json"));
  const sourceById = new Map(sourceIndexAfterClean.sources.map((source) => [source.source_id, source]));
  const productFacts = resolvedFacts.facts.filter((fact) =>
    resolvedFacts.subjects.some((subject) => subject.subject_id === fact.subject_id && subject.type === "product"),
  );
  assert(productFacts.length > 0);
  assert(productFacts.every((fact) => fact.source_refs.every((ref) =>
    !["image", "product_image", "company_asset"].includes(sourceById.get(ref)?.kind ?? ""),
  )));
  assert(resolvedFacts.conflicts.some((conflict) =>
    conflict.field === "company_short_name" &&
    conflict.status === "resolved" &&
    conflict.resolution === "以本次企业信息收集表为准"
  ));
  const review = await writeCleanReview(projectRoot);
  assert.equal(review.status, "review_required");
  const reviewMarkdown = await readFile(review.path, "utf-8");
  assert(reviewMarkdown.includes("## 1. 您现在需要做什么"));
  assert(reviewMarkdown.includes("### 重点待确认"));
  assert(reviewMarkdown.includes("图片不计入 Facts"));
  assert(reviewMarkdown.includes("确认企业事实"));
  assert(reviewMarkdown.includes("请确认测试资料中的业务表述"));

  const confirmation = await confirmClean(projectRoot);
  const snapshot = await readJson<Record<string, unknown>>(path.join(projectRoot, confirmation.snapshot_path));
  assert.equal("confirmed_by" in snapshot, false);
  assert.equal(snapshot.schema_version, 2);
  assert.equal("evidence" in snapshot, false);
  const confirmedLedger = (snapshot as { facts: FactLedger }).facts;
  const shortNameFacts = confirmedLedger.facts.filter((fact) => fact.field === "company_short_name");
  assert.equal(shortNameFacts.find((fact) => fact.value === "测试制造")?.review_status, "confirmed");
  assert.equal(shortNameFacts.find((fact) => fact.value === "旧测试简称")?.review_status, "rejected");
  const manifestAfterConfirmation = await readJson<Record<string, any>>(path.join(projectRoot, "manifest.json"));
  assert.equal(manifestAfterConfirmation.gates.clean.status, "confirmed");
  assert.equal("by" in manifestAfterConfirmation.gates.clean, false);

  const unchanged = await cleanProject(projectRoot, "app_test");
  assert.equal(unchanged.clean_status, "confirmed");
  assert.equal(unchanged.facts_hash, first.facts_hash);
  const inputInventoryAfter = await inventory(projectRoot);
  assert.equal(inputInventoryAfter.inputs_hash, inputInventoryBefore.inputs_hash);

  const factsPath = path.join(knowledge, "company.facts.json");
  const damagedFacts = await readJson<FactLedger>(factsPath);
  damagedFacts.facts[0]!.source_refs = ["src_missing"];
  await writeJson(factsPath, damagedFacts);
  const broken = await validateProject(projectRoot, true);
  assert.equal(broken.ok, false);
  assert(broken.referential.some((item) => item.code.startsWith("fact_source:")));

  await cleanProject(projectRoot, "app_test");
  await writeFile(imagePath, Buffer.from("fake-image-v2"));
  const changed = await cleanProject(projectRoot, "app_test");
  assert.equal(changed.clean_status, "review_required");
  const changedManifest = await readJson<Record<string, any>>(path.join(projectRoot, "manifest.json"));
  assert.equal(changedManifest.clean_pipeline.previous_snapshot_id, confirmation.fact_snapshot_id);
  assert.equal(changedManifest.clean_pipeline.changed_since_confirmation, true);

  const sourceIndex = await readJson<SourceIndex>(path.join(knowledge, "source-index.json"));
  assert(sourceIndex.sources.every((source) => /^[0-9a-f]{64}$/.test(source.hash)));
  assert.equal((await readFile(path.join(inputs, "企业信息收集表.xlsx"))).equals(xlsxBuffer), true);
});

test("project fact resolution may normalize a value missing from raw candidates", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "geo-normalized-resolution-"));
  const inputs = path.join(projectRoot, "inputs");
  const knowledge = path.join(projectRoot, "knowledge");
  await mkdir(inputs, { recursive: true });
  await writeJson(path.join(knowledge, "clean.overrides.json"), {
    app_id: "app_resolution",
    assets: [],
    products: [],
    fact_resolutions: [{
      subject: "company",
      field: "company_short_name",
      value: "规范简称",
      reason: "原表误填经营描述，由 Skill 根据企业全称规范化，等待人工确认",
    }],
  });

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["公司名称", "规范简称有限公司", "公司简称", "经营多年，专注测试产品的厂家"],
    ["公司官网", "https://example.com"],
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
  await writeFile(
    path.join(inputs, "企业信息收集表.xlsx"),
    XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
  );

  const first = await cleanProject(projectRoot, "app_resolution");
  const baseinfo = await readJson<Record<string, unknown>>(path.join(knowledge, "company.baseinfo.json"));
  assert.equal(baseinfo.company_short_name, "规范简称");
  const facts = await readJson<FactLedger>(path.join(knowledge, "company.facts.json"));
  assert(facts.facts.some((fact) =>
    fact.field === "company_short_name" &&
    fact.value === "规范简称" &&
    fact.derivation === "operator" &&
    fact.review_status === "candidate"
  ));
  assert(facts.conflicts.some((conflict) =>
    conflict.field === "company_short_name" &&
    conflict.status === "resolved" &&
    conflict.resolution === "原表误填经营描述，由 Skill 根据企业全称规范化，等待人工确认"
  ));
  const second = await cleanProject(projectRoot, "app_resolution");
  assert.equal(second.facts_hash, first.facts_hash);
});
