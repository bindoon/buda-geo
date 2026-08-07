export type SeedFamily =
  | "brand_recognition"
  | "product_consideration"
  | "supplier_capability"
  | "regional_procurement"
  | "negative_risk";

export type SeedReviewStatus = "unreviewed" | "approved" | "rejected" | "replaced";

export interface DiagnosisQuestion {
  question_id: string;
  text: string;
  family: SeedFamily;
  rationale: string;
  fact_ids: string[];
  derivation: "fact_template" | "operator" | "legacy";
  review_status: SeedReviewStatus;
  replacement_for_question_id: string | null;
  negative_risk_approved: boolean;
}

export interface SeedSet {
  schema_version: 1;
  seed_set_id: string;
  app_id: string;
  fact_snapshot_id: string;
  purpose: "baseline_diagnosis_only";
  status: "draft" | "confirmed" | "legacy_candidate";
  version: number;
  based_on_seed_set_id: string | null;
  created_at: string;
  confirmed_at: string | null;
  target_size: number;
  questions: DiagnosisQuestion[];
}

export type ProbeStatus = "success" | "failed" | "timeout" | "unavailable";

export interface CitationRecord {
  title: string | null;
  url: string;
  domain: string;
}

export interface ProbeAnalysis {
  target_mentioned: boolean;
  actively_recommended: boolean;
  recommendation_position: number | null;
  competitors: string[];
  negative_risk_mentioned: boolean;
  sentiment: "positive" | "neutral" | "negative" | "mixed" | "unknown";
  citations: CitationRecord[];
  analysis_method: "heuristic_v1" | "controlled_manual";
  notes: string | null;
}

export interface ProbeResult {
  schema_version: 1;
  probe_id: string;
  run_id: string;
  seed_set_id: string;
  question_id: string;
  question_text: string;
  question_family: SeedFamily;
  platform: string;
  provider: string;
  adapter_kind: "manual" | "api" | "browser_assisted";
  model: string | null;
  attempted_at: string;
  status: ProbeStatus;
  raw_snapshot_path: string | null;
  raw_content_hash: string | null;
  error: { code: string; message: string; retryable: boolean } | null;
  analysis: ProbeAnalysis | null;
  latest_analysis_revision_id: string | null;
}

export interface DiagnosisRun {
  schema_version: 1;
  run_id: string;
  app_id: string;
  fact_snapshot_id: string;
  seed_set_id: string;
  created_at: string;
  status: "prepared" | "in_progress" | "complete_with_failures" | "complete";
  requested_platforms: string[];
  probe_ids: string[];
}

export interface AnalysisRevision {
  schema_version: 1;
  analysis_revision_id: string;
  probe_id: string;
  created_at: string;
  reason: string;
  previous_analysis: ProbeAnalysis;
  revised_analysis: ProbeAnalysis;
}

export interface RateMetric {
  numerator: number;
  denominator: number;
  rate: number | null;
  unavailable_reason: string | null;
}

export interface DistributionItem {
  name: string;
  count: number;
  denominator: number;
  rate: number | null;
}

export interface DiagnosisMetrics {
  formula_version: "transparent-rates-v1";
  composite_score: null;
  attempted_probes: number;
  valid_probes: number;
  failed_probes: number;
  valid_coverage: RateMetric;
  brand_mention_rate: RateMetric;
  active_recommendation_rate: RateMetric;
  top_n: { n: number; metric: RateMetric };
  negative_risk_mention_rate: RateMetric;
  citation_observation_rate: RateMetric;
  competitor_distribution: DistributionItem[];
  source_distribution: DistributionItem[];
  by_platform: Record<string, Omit<DiagnosisMetrics, "by_platform">>;
}

export interface DiagnosisGap {
  gap_id: string;
  kind: "visibility" | "recommendation" | "negative_risk" | "evidence" | "probe_coverage";
  severity: "high" | "medium" | "low";
  observed_issue: string;
  question_ids: string[];
  probe_ids: string[];
  platforms: string[];
  competitors: string[];
  sources: string[];
  fact_ids: string[];
  recommended_investigation: string;
}

export interface DiagnosisReport {
  schema_version: 1;
  report_id: string;
  app_id: string;
  project_name: string;
  fact_snapshot_id: string;
  seed_set_id: string;
  run_id: string;
  generated_at: string;
  status: "review_required" | "confirmed";
  confirmed_at: string | null;
  limitations_accepted: boolean;
  metrics: DiagnosisMetrics;
  probes: ProbeResult[];
  gaps: DiagnosisGap[];
  limitations: string[];
}

export interface ManualProbeInput {
  question_id: string;
  platform: string;
  provider?: string;
  model?: string | null;
  attempted_at?: string;
  status: ProbeStatus;
  answer?: string;
  error?: { code: string; message: string; retryable?: boolean };
  analysis?: Partial<ProbeAnalysis>;
}

export interface ProbeAdapter {
  readonly kind: "manual" | "api" | "browser_assisted";
  normalize(input: unknown): Promise<ManualProbeInput[]>;
}
