export type ScenarioLifecycle = "draft" | "review_required" | "confirmed" | "retired";
export type ScenarioReviewStatus = "unreviewed" | "approved" | "rejected" | "deferred";
export type EvidenceGapStatus = "open" | "deferred" | "accepted" | "resolved";

export interface ScenarioSourceReference {
  source_ref_id: string;
  kind: "fact" | "diagnosis_gap" | "legacy_keyword" | "customer_language" | "operator";
  ref_id: string;
  path: string | null;
  original_bucket: string | null;
  text: string | null;
  derivation: "extracted" | "derived" | "operator" | "legacy";
}

export interface QuestionFacets {
  wording_form: "direct_question" | "comparison" | "recommendation" | "how_to" | "risk";
  regions: string[];
  decision_stage: "awareness" | "consideration" | "supplier_selection" | "purchase" | "post_purchase";
  direction: "positive" | "neutral" | "negative";
  product_subject_ids: string[];
  capability_terms: string[];
  constraints: string[];
}

export interface RepresentativeQuestion {
  question_id: string;
  text: string;
  normalized_text: string;
  facets: QuestionFacets;
  fact_ids: string[];
  evidence_gap_ids: string[];
  source_refs: ScenarioSourceReference[];
}

export interface ScenarioEvidenceGap {
  evidence_gap_id: string;
  kind: "business_evidence" | "probe_coverage";
  severity: "high" | "medium" | "low";
  description: string;
  scenario_id: string;
  question_ids: string[];
  fact_ids: string[];
  source_refs: ScenarioSourceReference[];
  status: EvidenceGapStatus;
  review_reason: string | null;
}

export interface ScenarioPriority {
  components: {
    business_value: number;
    diagnosis_gap: number;
    evidence_readiness: number;
    customer_language: number;
    operator_judgment: number;
  };
  calculated_total: number;
  final_score: number;
  tier: "high" | "medium" | "low";
  rationale: string[];
  override: { score: number; actor: string; reason: string; at: string } | null;
}

export interface CustomerScenario {
  scenario_id: string;
  name: string;
  target_customer: string;
  customer_need: string;
  concerns: string[];
  representative_questions: RepresentativeQuestion[];
  supporting_fact_ids: string[];
  evidence_gaps: ScenarioEvidenceGap[];
  source_refs: ScenarioSourceReference[];
  desired_next_action: { type: "request_quote" | "visit_shop" | "contact_sales" | "learn_more"; label: string; url: string | null } | null;
  priority: ScenarioPriority;
  review_status: ScenarioReviewStatus;
  review_note: string | null;
}

export interface SemanticMergeSuggestion {
  suggestion_id: string;
  item_type: "scenario" | "question";
  item_ids: [string, string];
  reason: string;
  similarity: number;
  meaningful_differences: string[];
  status: "pending" | "approved" | "rejected";
  review_reason: string | null;
}

export interface ScenarioLibrary {
  schema_version: 1;
  scenario_library_id: string;
  app_id: string;
  fact_snapshot_id: string;
  diagnosis_report_id: string;
  diagnosis_gap_path: string;
  lifecycle: ScenarioLifecycle;
  version: number;
  based_on_scenario_library_id: string | null;
  created_at: string;
  confirmed_at: string | null;
  scenarios: CustomerScenario[];
  merge_suggestions: SemanticMergeSuggestion[];
  limitations: string[];
}

export interface LegacyKeywordCandidate {
  candidate_id: string;
  text: string;
  normalized_text: string;
  original_bucket: string;
  source_path: string;
  source_refs: ScenarioSourceReference[];
  duplicate_of_candidate_id: string | null;
  cross_bucket_with: string[];
  evidence_status: "unreviewed";
}

export interface LegacyKeywordAudit {
  schema_version: 1;
  app_id: string;
  generated_at: string;
  source_path: string;
  candidates: LegacyKeywordCandidate[];
  counts: { total: number; unique: number; exact_duplicates: number; cross_bucket: number; unsupported: number };
}
