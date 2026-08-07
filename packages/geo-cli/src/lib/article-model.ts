import type { ContentChannel } from "./content-plan-model.js";

export interface ArticleFactView { fact_id: string; field: string; value: unknown }
export interface ArticleWritingBrief {
  schema_version: 1; article_id: string; slot: number; app_id: string; content_plan_id: string; content_plan_version: number; task_id: string; topic_id: string; faq_ids: string[]; scenario_ids: string[]; question_ids: string[]; fact_snapshot_id: string; channel: ContentChannel; content_format: string; mode: "factual" | "research_only"; title_direction: string; objective: string; audience: string; questions: string[]; desired_next_action: Record<string, unknown> | null; outline_requirements: string[]; tone: string; channel_constraints: string[]; citation_policy: string; allowed_facts: ArticleFactView[]; forbidden_claims: string[]; claim_boundaries: string[]; created_at: string;
}
export interface ArticleRisk { code: string; severity: "block" | "review"; message: string }
export interface ArticleRevision { revision: number; path: string; sha256: string; chars: number; at: string; reason: string | null; based_on_revision: number | null }
export type ArticleReviewAction = "request_changes" | "approve" | "reject" | "defer";
export type ArticleReviewStatus = "draft" | "pending_review" | "changes_requested" | "approved" | "rejected" | "deferred";
export interface ArticleReviewCheck { pass: boolean; note: string }
export interface ArticleReviewAssessment { schema_version: 1; article_id: string; body_sha256: string; checks: { factual_accuracy: ArticleReviewCheck; claim_boundaries: ArticleReviewCheck; channel_fit: ArticleReviewCheck; compliance: ArticleReviewCheck; originality: ArticleReviewCheck }; summary: string }
export interface ArticleReviewRecord { review_id: string; action: ArticleReviewAction; reason: string; assessment: ArticleReviewAssessment; body_sha256: string; at: string }
export interface ArticleMeta {
  schema_version: 1; article_id: string; app_id: string; content_plan_id: string; content_plan_version: number; task_id: string; topic_id: string; faq_ids: string[]; scenario_ids: string[]; question_ids: string[]; fact_snapshot_id: string; channel: ContentChannel; title: string; body_path: string; body_sha256: string; chars: number; used_fact_ids: string[]; mode: "factual" | "research_only"; claim_boundaries: string[]; status: ArticleReviewStatus; requires_human_review: true; current_revision: number; revisions: ArticleRevision[]; risks: ArticleRisk[]; review_history: ArticleReviewRecord[]; created_at: string; updated_at: string;
}
