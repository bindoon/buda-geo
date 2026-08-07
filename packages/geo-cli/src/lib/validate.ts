import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KNOWLEDGE_FILES, LEGAL_ID_RE } from "./constants.js";
import { factsContentHash, type BaseInfoView, type ProfileView } from "./fact-layer.js";
import type { CleanOverrides, FactLedger, FindingRecord, SourceIndex } from "./fact-model.js";
import type { MissingItem } from "./manifest.js";
import { operatorReviewFindings, semanticFindings } from "./quality.js";
import type { SkuItem } from "./skus.js";
import { pathExists, readJson } from "./util.js";

const require = createRequire(import.meta.url);
const Ajv = require("ajv/dist/2020") as typeof import("ajv/dist/2020.js").default;
const addFormats = require("ajv-formats") as (ajv: InstanceType<typeof Ajv>) => void;
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCHEMAS_DIR = path.join(PACKAGE_ROOT, "schemas");

async function loadSchema(name: string): Promise<object> {
  return JSON.parse(await readFile(path.join(SCHEMAS_DIR, name), "utf-8")) as object;
}

function formatAjvErrors(errors: { instancePath: string; message?: string }[]): string[] {
  return errors.map((error) => `${error.instancePath || "/"} ${error.message ?? "invalid"}`);
}

function finding(
  code: string,
  layer: FindingRecord["layer"],
  message: string,
  refs?: string[],
): FindingRecord {
  return { code, severity: "block", layer, message, refs };
}

export interface ValidateResult {
  ok: boolean;
  errors: string[];
  missing: MissingItem[];
  structural: FindingRecord[];
  referential: FindingRecord[];
  semantic: FindingRecord[];
  security: FindingRecord[];
}

export async function validateProject(
  projectRoot: string,
  strictClean = true,
): Promise<ValidateResult> {
  const structural: FindingRecord[] = [];
  const referential: FindingRecord[] = [];
  const semantic: FindingRecord[] = [];
  const security: FindingRecord[] = [];
  const knowledge = path.join(projectRoot, "knowledge");
  const manifestPath = path.join(projectRoot, "manifest.json");
  if (!(await pathExists(manifestPath))) {
    const item = finding("missing_manifest", "structural", "missing manifest.json");
    return { ok: false, errors: [item.message], missing: [], structural: [item], referential, semantic, security };
  }

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const manifest = await readJson<Record<string, any>>(manifestPath);
  const missing = (manifest.missing ?? []) as MissingItem[];
  const appId = manifest.app_id as string;
  const loaded = new Map<string, any>();
  let cleanOverrides: CleanOverrides | undefined;

  const validateManifest = ajv.compile(await loadSchema("manifest.schema.json"));
  if (!validateManifest(manifest)) {
    for (const message of formatAjvErrors(validateManifest.errors ?? [])) {
      structural.push(finding("manifest_schema", "structural", `manifest: ${message}`));
    }
  }
  for (const [name, schemaName] of Object.entries(KNOWLEDGE_FILES)) {
    const filePath = path.join(knowledge, name);
    if (!(await pathExists(filePath))) {
      structural.push(finding(`missing_file:${name}`, "structural", `missing ${name}`));
      continue;
    }
    const data = await readJson<Record<string, unknown>>(filePath);
    loaded.set(name, data);
    if (data.app_id !== appId) structural.push(finding(`app_id_mismatch:${name}`, "structural", `${name}: app_id mismatch (${data.app_id} != ${appId})`));
    const validate = ajv.compile(await loadSchema(schemaName));
    if (!validate(data)) {
      for (const message of formatAjvErrors(validate.errors ?? [])) structural.push(finding(`schema:${name}`, "structural", `${name}: ${message}`));
    }
  }
  const overridePath = path.join(knowledge, "clean.overrides.json");
  if (await pathExists(overridePath)) {
    const overrides = await readJson<CleanOverrides>(overridePath);
    cleanOverrides = overrides;
    const validate = ajv.compile(await loadSchema("clean-overrides.schema.json"));
    if (!validate(overrides)) for (const message of formatAjvErrors(validate.errors ?? [])) structural.push(finding("schema:clean.overrides.json", "structural", `clean.overrides.json: ${message}`));
  }

  const sourceIndex = loaded.get("source-index.json") as SourceIndex | undefined;
  const facts = loaded.get("company.facts.json") as FactLedger | undefined;
  const skusData = loaded.get("company.skus.json") as { app_id: string; items: SkuItem[] } | undefined;
  const profile = loaded.get("company.profile.json") as ProfileView | undefined;
  const baseinfo = loaded.get("company.baseinfo.json") as BaseInfoView | undefined;
  if (sourceIndex && facts && skusData && profile && baseinfo) {
    const sourceIds = new Set(sourceIndex.sources.map((source) => source.source_id));
    const ignoredSourceIds = new Set(sourceIndex.sources.filter((source) => source.ignored).map((source) => source.source_id));
    const subjectIds = new Set(facts.subjects.map((subject) => subject.subject_id));
    const factIds = new Set(facts.facts.map((fact) => fact.fact_id));
    for (const subject of facts.subjects) {
      if (subject.parent_subject_id && !subjectIds.has(subject.parent_subject_id)) referential.push(finding(`parent_subject:${subject.subject_id}`, "referential", `subject parent not found: ${subject.parent_subject_id}`));
      for (const sourceRef of subject.source_refs) if (!sourceIds.has(sourceRef)) referential.push(finding(`subject_source:${subject.subject_id}`, "referential", `subject source not found: ${sourceRef}`));
    }
    for (const fact of facts.facts) {
      if (!subjectIds.has(fact.subject_id)) referential.push(finding(`fact_subject:${fact.fact_id}`, "referential", `fact subject not found: ${fact.subject_id}`));
      if (!fact.source_refs.length) referential.push(finding(`fact_without_source:${fact.fact_id}`, "referential", `fact has no source: ${fact.fact_id}`));
      for (const sourceRef of fact.source_refs) {
        if (!sourceIds.has(sourceRef)) referential.push(finding(`fact_source:${fact.fact_id}`, "referential", `fact source not found: ${sourceRef}`));
        if (ignoredSourceIds.has(sourceRef)) security.push(finding(`ignored_source_fact:${fact.fact_id}`, "security", `fact references ignored sensitive source: ${sourceRef}`));
      }
    }
    for (const conflict of facts.conflicts) for (const factRef of conflict.candidate_fact_ids) if (!factIds.has(factRef)) referential.push(finding(`conflict_fact:${conflict.conflict_id}`, "referential", `conflict fact not found: ${factRef}`));
    for (const item of skusData.items) {
      for (const sourceRef of item.source_refs) {
        if (!sourceIds.has(sourceRef)) referential.push(finding(`sku_source:${item.sku_id}`, "referential", `SKU source not found: ${sourceRef}`));
        if (ignoredSourceIds.has(sourceRef)) security.push(finding(`ignored_source_sku:${item.sku_id}`, "security", `SKU references ignored sensitive source: ${sourceRef}`));
      }
      for (const factRef of item.fact_refs) if (!factIds.has(factRef)) referential.push(finding(`sku_fact:${item.sku_id}`, "referential", `SKU fact not found: ${factRef}`));
      for (const image of item.images) {
        if (LEGAL_ID_RE.test(image.path)) security.push(finding(`legal_id_sku:${item.sku_id}`, "security", `legal ID must not be copied to SKU assets: ${image.path}`));
        if (!(await pathExists(path.join(projectRoot, image.path)))) referential.push(finding(`sku_path:${item.sku_id}`, "referential", `SKU image path not found: ${image.path}`));
      }
    }
    for (const refs of Object.values(baseinfo.fact_refs ?? {})) for (const ref of refs) if (!factIds.has(ref)) referential.push(finding(`baseinfo_fact:${ref}`, "referential", `baseinfo fact not found: ${ref}`));
    for (const refs of Object.values(profile.fact_refs ?? {})) for (const ref of refs) if (!factIds.has(ref)) referential.push(finding(`profile_fact:${ref}`, "referential", `profile fact not found: ${ref}`));
    if (facts.inputs_hash !== sourceIndex.inputs_hash) referential.push(finding("inputs_hash_mismatch", "referential", "fact ledger inputs_hash differs from source index"));
    if (facts.facts_hash !== factsContentHash(facts)) referential.push(finding("facts_hash_mismatch", "referential", "fact ledger facts_hash does not match its semantic content"));
    semantic.push(...semanticFindings({ profile, skus: skusData.items, facts, sourceIndex }));
    if (cleanOverrides) semantic.push(...operatorReviewFindings(cleanOverrides));
  }

  const serializedKnowledge = [...loaded.entries()].map(([name, value]) => `${name}\n${JSON.stringify(value)}`).join("\n");
  if (/"password"\s*:|"密码"\s*:/.test(serializedKnowledge)) security.push(finding("password_in_knowledge", "security", "password field is forbidden in knowledge JSON"));
  const blockMissing = missing.filter((item) => item.severity === "block");
  if (manifest.gates?.clean?.status === "confirmed" && blockMissing.length) semantic.push(finding("confirmed_with_blocks", "semantic", "gates.clean=confirmed but block findings remain"));
  if (manifest.gates?.clean?.status === "confirmed" && !manifest.gates.clean.fact_snapshot_id) structural.push(finding("confirmed_without_snapshot", "structural", "confirmed clean gate requires fact_snapshot_id"));

  const hard = [...structural, ...referential, ...security, ...(strictClean ? semantic.filter((item) => item.severity === "block") : [])];
  if (strictClean) for (const item of blockMissing) if (!hard.some((findingItem) => findingItem.code === item.code)) hard.push(finding(item.code, "semantic", item.message));
  const errors = hard.map((item) => `[${item.layer}] ${item.code}: ${item.message}`);
  return { ok: errors.length === 0, errors, missing, structural, referential, semantic, security };
}

export function printValidate(result: ValidateResult): void {
  console.log(result.ok ? "VALIDATE OK" : "VALIDATE FAIL");
  for (const [name, items] of [
    ["STRUCTURAL", result.structural],
    ["REFERENTIAL", result.referential],
    ["SEMANTIC", result.semantic],
    ["SECURITY", result.security],
  ] as const) {
    console.log(`${name}: ${items.length ? "" : "OK"}`);
    for (const item of items) console.log(`  [${item.severity}] ${item.code}: ${item.message}`);
  }
  if (result.missing.length) {
    console.log("MISSING:");
    for (const item of result.missing) console.log(`  [${item.severity}] ${item.code}: ${item.message}`);
  }
}
