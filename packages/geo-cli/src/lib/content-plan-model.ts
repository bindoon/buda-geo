import type { ScenarioSourceReference } from "./scenario-model.js";

export type ContentPlanLifecycle = "draft" | "review_required" | "confirmed" | "retired";
export type ContentReviewStatus = "unreviewed" | "approved" | "rejected" | "deferred";
export type ContentReadiness = "ready" | "blocked" | "research_only" | "deferred";
export type ContentChannel = "social" | "media" | "b2b" | "site";

export interface ContentPriority {
  components: {
    scenario_priority: number;
    evidence_readiness: number;
    diagnosis_gap: number;
    customer_language: number;
    coverage_value: number;
    operator_judgment: number;
  };
  calculated_total: number;
  final_score: number;
  tier: "high" | "medium" | "low";
  rationale: string[];
  override: { score: number; actor: string; reason: string; at: string } | null;
}

export interface ContentBlocker {
  blocker_id: string;
  evidence_gap_id: string;
  scenario_id: string;
  question_ids: string[];
  severity: "high" | "medium" | "low";
  description: string;
  status: "open" | "deferred" | "accepted" | "resolved" | "research_only";
  review_reason: string | null;
}

export interface FaqCandidate {
  faq_id: string;
  question: string;
  normalized_question: string;
  answer_goal: string;
  target_audience: string;
  scenario_id: string;
  question_ids: string[];
  allowed_fact_ids: string[];
  evidence_gap_ids: string[];
  readiness: ContentReadiness;
  review_status: ContentReviewStatus;
  review_note: string | null;
  source_refs: ScenarioSourceReference[];
}

export interface ContentTopic {
  topic_id: string;
  name: string;
  objective: string;
  target_audience: string;
  decision_stage: string;
  faq_ids: string[];
  scenario_ids: string[];
  question_ids: string[];
  allowed_fact_ids: string[];
  evidence_gap_ids: string[];
  content_forms: string[];
  desired_next_action: { type: string; label: string; url: string | null } | null;
  readiness: ContentReadiness;
  priority: ContentPriority;
  review_status: ContentReviewStatus;
  review_note: string | null;
}

export interface PromptRecipe {
  prompt_id: string;
  topic_id: string;
  channel: ContentChannel;
  objective: string;
  audience: string;
  outline_requirements: string[];
  tone: string;
  channel_constraints: string[];
  citation_policy: string;
  allowed_fact_ids: string[];
  forbidden_claims: string[];
  review_status: ContentReviewStatus;
}

export interface ProductionTask {
  task_id: string;
  topic_id: string;
  faq_ids: string[];
  prompt_id: string;
  scenario_ids: string[];
  question_ids: string[];
  fact_snapshot_id: string;
  allowed_fact_ids: string[];
  blocked_evidence_gap_ids: string[];
  claim_boundaries: string[];
  channel: ContentChannel;
  content_format: string;
  channel_reason: string;
  batch: number;
  quantity: number;
  use_knowledge: true;
  mode: "factual" | "research_only";
  readiness: ContentReadiness;
  status: "blocked" | "planned" | "deferred" | "rejected";
  priority: ContentPriority;
  review_status: ContentReviewStatus;
  review_note: string | null;
  planning_override: { original_batch: number; original_quantity: number; batch: number; quantity: number; actor: string; reason: string; at: string } | null;
}

export interface ContentMergeSuggestion {
  suggestion_id: string;
  item_type: "faq" | "topic" | "task";
  item_ids: [string, string];
  reason: string;
  similarity: number;
  meaningful_differences: string[];
  status: "pending" | "approved" | "rejected";
  review_reason: string | null;
}

export interface ContentPlan {
  schema_version: 1;
  content_plan_id: string;
  app_id: string;
  fact_snapshot_id: string;
  diagnosis_report_id: string;
  scenario_library_id: string;
  scenario_library_version: number;
  lifecycle: ContentPlanLifecycle;
  version: number;
  based_on_content_plan_id: string | null;
  created_at: string;
  confirmed_at: string | null;
  fact_catalog: Array<{ fact_id: string; field: string; summary: string }>;
  faq_candidates: FaqCandidate[];
  topics: ContentTopic[];
  prompt_recipes: PromptRecipe[];
  production_tasks: ProductionTask[];
  blockers: ContentBlocker[];
  merge_suggestions: ContentMergeSuggestion[];
  quota: {
    requested_total: number;
    planned_total: number;
    by_channel: Record<ContentChannel, { requested: number; planned: number }>;
  };
  coverage: {
    scenario_total: number;
    scenario_planned: number;
    question_total: number;
    question_planned: number;
    uncovered_question_ids: string[];
  };
  limitations: string[];
}

export interface LegacyContentCandidate {
  candidate_id: string;
  kind: "faq" | "prompt" | "keyword" | "generation_task" | "unknown";
  text: string;
  normalized_text: string;
  source_path: string;
  original_key: string;
  duplicate_of_candidate_id: string | null;
  evidence_status: "unreviewed";
}

export interface LegacyContentAudit {
  schema_version: 1;
  app_id: string;
  generated_at: string;
  sources: string[];
  candidates: LegacyContentCandidate[];
  counts: { total: number; unique: number; exact_duplicates: number };
}
