import { createHash } from "node:crypto";

export type Severity = "block" | "recommend" | "optional";
export type Derivation = "extracted" | "inferred" | "operator" | "legacy";
export type ReviewStatus =
  | "candidate"
  | "confirmed"
  | "rejected"
  | "needs_clarification";
export type DisclosureLevel = "public" | "restricted" | "internal";
export type SubjectType =
  | "company"
  | "brand"
  | "product"
  | "product_family"
  | "capability"
  | "service"
  | "evidence"
  | "asset";

export interface SourceRecord {
  source_id: string;
  scope: "input" | "legacy_projection";
  path: string;
  name: string;
  kind: string;
  hash: string;
  size: number;
  parse_status: "discovered" | "extractable" | "indexed_only" | "ignored";
  ignored: boolean;
  ignored_reason: string | null;
}

export interface SourceIndex {
  app_id: string;
  generated_at: string;
  inputs_hash: string;
  sources: SourceRecord[];
}

export interface SubjectRecord {
  subject_id: string;
  type: SubjectType;
  name: string;
  parent_subject_id: string | null;
  source_refs: string[];
  review_status: ReviewStatus;
}

export interface FactRecord {
  fact_id: string;
  subject_id: string;
  field: string;
  value: unknown;
  unit: string | null;
  source_refs: string[];
  derivation: Derivation;
  confidence: number;
  review_status: ReviewStatus;
  disclosure_level: DisclosureLevel;
}

export interface ConflictRecord {
  conflict_id: string;
  subject_id: string;
  field: string;
  candidate_fact_ids: string[];
  severity: Severity;
  status: "unresolved" | "resolved" | "accepted";
  resolution: string | null;
}

export interface FactLedger {
  app_id: string;
  generated_at: string;
  inputs_hash: string;
  facts_hash: string;
  subjects: SubjectRecord[];
  facts: FactRecord[];
  conflicts: ConflictRecord[];
}

export interface EvidenceRecord {
  evidence_id: string;
  type: string;
  subject_refs: string[];
  source_ref: string;
  path: string | null;
  supports_fact_ids: string[];
  disclosure_level: DisclosureLevel;
  review_status: ReviewStatus;
  valid_from: string | null;
  valid_until: string | null;
  notes: string;
}

export interface EvidenceLedger {
  app_id: string;
  generated_at: string;
  items: EvidenceRecord[];
}

export interface FindingRecord {
  code: string;
  severity: Severity;
  layer: "structural" | "referential" | "semantic" | "security";
  message: string;
  refs?: string[];
}

export interface AssetOverride {
  source_path: string;
  action: "product" | "company" | "evidence" | "ignore";
  product_name?: string;
  evidence_type?: string;
  supports_fields?: string[];
  disclosure_level?: DisclosureLevel;
  reason?: string;
}

export interface ProductOverride {
  name: string;
  category: string;
  is_main: boolean;
  source_paths: string[];
  selling_points: string[];
  attributes: Record<string, string | number | boolean>;
  capabilities: string[];
  reason?: string;
}

export interface FactResolution {
  subject: "company";
  field: string;
  value: unknown;
  reason: string;
}

export interface CleanOverrides {
  app_id: string;
  assets: AssetOverride[];
  products: ProductOverride[];
  fact_resolutions?: FactResolution[];
}

export const MANUFACTURING_COMPLETENESS_PROFILE = {
  required_company_fields: ["company_name", "website_or_shop_url", "intro"],
  main_product_required: ["human_readable_name", "category", "substance"],
  recommended: ["trust_evidence", "capability_evidence", "chat_logs"],
  optional: ["video", "full_price_list", "all_sku_variants"],
} as const;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function digestObject(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export function stableId(prefix: string, ...parts: unknown[]): string {
  const hash = digestObject(parts).slice(0, 16);
  return `${prefix}_${hash}`;
}
