import { stat } from "node:fs/promises";
import path from "node:path";
import type { BaseInfo } from "./parse.js";
import type { SkuItem } from "./skus.js";
import {
  digestObject,
  stableId,
  type CleanOverrides,
  type ConflictRecord,
  type Derivation,
  type DisclosureLevel,
  type FactLedger,
  type FactRecord,
  type SourceIndex,
  type SourceRecord,
  type SubjectRecord,
} from "./fact-model.js";
import { pathExists, readJson, utcNow } from "./util.js";

export interface ProfileView {
  app_id: string;
  intro: string;
  products_services: string;
  advantages: string;
  trust: string;
  pain_points: string[];
  source: string;
  fact_refs?: Record<string, string[]>;
}

export interface BaseInfoView extends BaseInfo {
  fact_refs?: Record<string, string[]>;
}

export interface PreviousCleanViews {
  baseinfo?: BaseInfoView;
  profile?: ProfileView;
  skus?: { app_id: string; items: SkuItem[] };
  facts?: FactLedger;
}

export async function loadCleanOverrides(
  projectRoot: string,
  appId: string,
): Promise<CleanOverrides> {
  const overridePath = path.join(projectRoot, "knowledge", "clean.overrides.json");
  if (!(await pathExists(overridePath))) return { app_id: appId, assets: [], products: [] };
  const overrides = await readJson<CleanOverrides>(overridePath);
  if (overrides.app_id !== appId) {
    throw new Error(`clean.overrides.json app_id mismatch (${overrides.app_id} != ${appId})`);
  }
  return overrides;
}

export async function addLegacyProjectionSources(
  projectRoot: string,
  sourceIndex: SourceIndex,
  previous: PreviousCleanViews,
): Promise<SourceIndex> {
  const candidates: [keyof PreviousCleanViews, string][] = [
    ["baseinfo", "company.baseinfo.json"],
    ["profile", "company.profile.json"],
    ["skus", "company.skus.json"],
  ];
  const legacySources: SourceRecord[] = [];
  for (const [key, name] of candidates) {
    const value = previous[key];
    if (!value) continue;
    const json = JSON.stringify(value);
    legacySources.push({
      source_id: stableId("src_legacy", name),
      scope: "legacy_projection",
      path: `knowledge/${name}`,
      name,
      kind: "legacy_projection",
      hash: digestObject(value),
      size: Buffer.byteLength(json),
      parse_status: "indexed_only",
      ignored: false,
      ignored_reason: null,
    });
  }
  return { ...sourceIndex, sources: [...sourceIndex.sources, ...legacySources] };
}

function sourceRefsForDescriptor(sourceIndex: SourceIndex, descriptor?: string): string[] {
  if (!descriptor) return [];
  const name = descriptor.replace(/^[^:]+:/, "");
  return sourceIndex.sources.filter((source) => source.name === name).map((source) => source.source_id);
}

function addFact(
  facts: FactRecord[],
  subjectId: string,
  field: string,
  value: unknown,
  sourceRefs: string[],
  derivation: Derivation,
  disclosureLevel: DisclosureLevel = "public",
  confidence = 0.95,
): FactRecord | null {
  if (value == null || value === "" || Array.isArray(value) && value.length === 0) return null;
  const fact: FactRecord = {
    fact_id: stableId("fact", subjectId, field, value),
    subject_id: subjectId,
    field,
    value,
    unit: null,
    source_refs: [...new Set(sourceRefs)],
    derivation,
    confidence,
    review_status: "candidate",
    disclosure_level: disclosureLevel,
  };
  if (!facts.some((item) => item.fact_id === fact.fact_id)) facts.push(fact);
  return fact;
}

function semanticLedgerHash(ledger: Pick<FactLedger, "subjects" | "facts" | "conflicts">): string {
  return digestObject({
    subjects: ledger.subjects.map(({ review_status: _status, ...subject }) => subject),
    facts: ledger.facts.map(({ review_status: _status, ...fact }) => fact),
    conflicts: ledger.conflicts,
  });
}

export async function buildFactLayer(args: {
  projectRoot: string;
  appId: string;
  sourceIndex: SourceIndex;
  baseinfo: BaseInfoView;
  profile: ProfileView;
  skus: { app_id: string; items: SkuItem[] };
  factResolutions?: CleanOverrides["fact_resolutions"];
  profileDerivation?: Derivation;
  previous: PreviousCleanViews;
}): Promise<{
  baseinfo: BaseInfoView;
  profile: ProfileView;
  skus: { app_id: string; items: SkuItem[] };
  facts: FactLedger;
}> {
  const {
    projectRoot,
    appId,
    sourceIndex,
    baseinfo,
    profile,
    skus,
    factResolutions = [],
    profileDerivation = "extracted",
    previous,
  } = args;
  const subjects: SubjectRecord[] = [];
  const facts: FactRecord[] = [];
  const conflicts: ConflictRecord[] = [];
  const companySubject = stableId("sub_company", appId);
  const baseRefs = sourceRefsForDescriptor(sourceIndex, baseinfo.source);
  const profileRefs = sourceRefsForDescriptor(sourceIndex, profile.source);
  subjects.push({
    subject_id: companySubject,
    type: "company",
    name: baseinfo.company_name || path.basename(projectRoot),
    parent_subject_id: null,
    source_refs: [...new Set([...baseRefs, ...profileRefs])],
    review_status: "candidate",
  });

  const baseFactRefs: Record<string, string[]> = {};
  for (const [field, disclosure] of [
    ["company_name", "public"],
    ["company_short_name", "public"],
    ["contact_name", "restricted"],
    ["contact_phone", "restricted"],
    ["address", "public"],
    ["website_or_shop_url", "public"],
    ["region", "public"],
    ["media_accounts", "restricted"],
    ["conversion", "restricted"],
  ] as [keyof BaseInfo, DisclosureLevel][]) {
    const fact = addFact(facts, companySubject, String(field), baseinfo[field], baseRefs, "extracted", disclosure);
    if (fact) baseFactRefs[String(field)] = [fact.fact_id];
  }

  const profileFactRefs: Record<string, string[]> = {};
  for (const field of ["intro", "products_services", "advantages", "trust", "pain_points"] as const) {
    const fact = addFact(facts, companySubject, field, profile[field], profileRefs, profileDerivation);
    if (fact) profileFactRefs[field] = [fact.fact_id];
  }

  const resolvedBrandName = factResolutions?.find(
    (resolution) =>
      resolution.subject === "company" &&
      resolution.field === "company_short_name" &&
      typeof resolution.value === "string",
  )?.value as string | undefined;
  const brandName = resolvedBrandName ?? baseinfo.company_short_name;
  if (brandName) {
    const brandId = stableId("sub_brand", appId, brandName);
    subjects.push({
      subject_id: brandId,
      type: "brand",
      name: brandName,
      parent_subject_id: companySubject,
      source_refs: baseRefs,
      review_status: "candidate",
    });
    addFact(facts, brandId, "name", brandName, baseRefs, "extracted");
  }

  for (const item of skus.items) {
    const productId = stableId("sub_product", appId, item.name);
    const productRefs = item.source_refs.length ? item.source_refs : profileRefs;
    item.source_refs = [...new Set(productRefs)];
    subjects.push({
      subject_id: productId,
      type: "product",
      name: item.name,
      parent_subject_id: companySubject,
      source_refs: productRefs,
      review_status: "candidate",
    });
    item.fact_refs = [];
    for (const [field, value, derivation, confidence] of [
      ["name", item.name, "operator", 0.9],
      ["category", item.category, "inferred", 0.72],
      ["selling_points", item.selling_points, "inferred", 0.7],
      ["attributes", item.attributes, "inferred", 0.7],
      ["capabilities", item.capabilities, "inferred", 0.72],
      ["is_main", item.is_main, "operator", 0.9],
    ] as [string, unknown, Derivation, number][]) {
      const fact = addFact(facts, productId, field, value, productRefs, derivation, "public", confidence);
      if (fact) item.fact_refs.push(fact.fact_id);
    }
  }

  // Import legacy values only when deterministic extraction left a field empty.
  const legacyBaseRef = sourceIndex.sources.find((source) => source.name === "company.baseinfo.json")?.source_id;
  if (previous.baseinfo && legacyBaseRef) {
    for (const field of ["company_name", "company_short_name", "contact_name", "contact_phone", "address", "website_or_shop_url", "region"] as const) {
      const current = baseinfo[field];
      const oldValue = previous.baseinfo[field];
      if (!current && oldValue) {
        (baseinfo[field] as string) = oldValue;
        const fact = addFact(facts, companySubject, field, oldValue, [legacyBaseRef], "legacy", /contact/.test(field) ? "restricted" : "public", 0.65);
        if (fact) baseFactRefs[field] = [fact.fact_id];
      }
      if (current && oldValue && current !== oldValue) {
        const oldFact = addFact(facts, companySubject, field, oldValue, [legacyBaseRef], "legacy", /contact/.test(field) ? "restricted" : "public", 0.65);
        const newFact = facts.find((fact) => fact.subject_id === companySubject && fact.field === field && fact.value === current);
        if (oldFact && newFact) {
          conflicts.push({
            conflict_id: stableId("conflict", companySubject, field, current, oldValue),
            subject_id: companySubject,
            field,
            candidate_fact_ids: [newFact.fact_id, oldFact.fact_id],
            severity: "block",
            status: "unresolved",
            resolution: null,
          });
        }
      }
    }
  }

  // A first migration can discover a conflict between the raw inputs and the
  // pre-migration A-C projections. After clean rewrites those projections, the
  // old candidate is no longer readable from company.baseinfo.json. Preserve
  // the already-ledgered legacy candidate while the raw input set is unchanged
  // so re-clean remains idempotent and the resolution audit trail is not lost.
  if (previous.facts?.inputs_hash === sourceIndex.inputs_hash) {
    const sourceIds = new Set(sourceIndex.sources.map((source) => source.source_id));
    for (const legacyFact of previous.facts.facts.filter(
      (fact) =>
        fact.derivation === "legacy" &&
        fact.source_refs.every((sourceRef) => sourceIds.has(sourceRef)),
    )) {
      if (facts.some((fact) => fact.fact_id === legacyFact.fact_id)) continue;
      facts.push({ ...legacyFact, review_status: "candidate" });
    }
    const factIds = new Set(facts.map((fact) => fact.fact_id));
    for (const previousConflict of previous.facts.conflicts) {
      if (
        conflicts.some((conflict) => conflict.conflict_id === previousConflict.conflict_id) ||
        !previousConflict.candidate_fact_ids.every((factId) => factIds.has(factId))
      ) continue;
      conflicts.push({ ...previousConflict });
    }
  }

  for (const resolution of factResolutions ?? []) {
    if (resolution.subject !== "company") continue;
    let selected = facts.find(
      (fact) =>
        fact.subject_id === companySubject &&
        fact.field === resolution.field &&
        JSON.stringify(fact.value) === JSON.stringify(resolution.value),
    );
    const fieldCandidates = facts.filter(
      (fact) => fact.subject_id === companySubject && fact.field === resolution.field,
    );
    if (!selected) {
      const sourceRefs = [...new Set(fieldCandidates.flatMap((fact) => fact.source_refs))];
      selected = addFact(
        facts,
        companySubject,
        resolution.field,
        resolution.value,
        sourceRefs.length ? sourceRefs : baseRefs,
        "operator",
        fieldCandidates[0]?.disclosure_level ?? "public",
        0.8,
      ) ?? undefined;
    }
    if (!selected) continue;
    if (selected.derivation === "legacy") {
      selected.derivation = "operator";
      selected.confidence = 0.8;
      selected.source_refs = [
        ...new Set(
          fieldCandidates
            .filter(
              (fact) =>
                fact.fact_id !== selected!.fact_id && fact.derivation !== "legacy",
            )
            .flatMap((fact) => fact.source_refs),
        ),
      ];
      if (selected.source_refs.length === 0) selected.source_refs = baseRefs;
    }
    if (resolution.field in baseinfo && resolution.field !== "app_id") {
      (baseinfo as unknown as Record<string, unknown>)[resolution.field] = resolution.value;
      baseFactRefs[resolution.field] = [selected.fact_id];
    }
    const fieldConflicts = conflicts.filter((item) => item.field === resolution.field);
    if (
      fieldConflicts.length === 0 &&
      fieldCandidates.some((fact) => fact.fact_id !== selected!.fact_id)
    ) {
      conflicts.push({
        conflict_id: stableId(
          "conflict",
          companySubject,
          resolution.field,
          ...fieldCandidates.map((fact) => fact.value),
          resolution.value,
        ),
        subject_id: companySubject,
        field: resolution.field,
        candidate_fact_ids: [
          ...fieldCandidates.map((fact) => fact.fact_id),
          selected.fact_id,
        ],
        severity: "block",
        status: "resolved",
        resolution: resolution.reason,
      });
    }
    for (const conflict of fieldConflicts) {
      if (!conflict.candidate_fact_ids.includes(selected.fact_id)) {
        conflict.candidate_fact_ids.push(selected.fact_id);
      }
      conflict.status = "resolved";
      conflict.resolution = resolution.reason;
    }
  }

  const draftLedger: FactLedger = {
    app_id: appId,
    generated_at: utcNow(),
    inputs_hash: sourceIndex.inputs_hash,
    facts_hash: "",
    subjects,
    facts,
    conflicts,
  };
  draftLedger.facts_hash = semanticLedgerHash(draftLedger);
  baseinfo.fact_refs = baseFactRefs;
  profile.fact_refs = profileFactRefs;
  return { baseinfo, profile, skus, facts: draftLedger };
}

export function factsContentHash(ledger: FactLedger): string {
  return semanticLedgerHash(ledger);
}
