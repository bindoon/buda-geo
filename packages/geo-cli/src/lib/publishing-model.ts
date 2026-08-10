import type { ContentChannel } from "./content-plan-model.js";

export type PublishExecutionMode = "manual" | "adapter";
export type PublishEventStatus = "submitted" | "published" | "failed" | "skipped";
export type PublishItemStatus = "planned" | PublishEventStatus;

export interface PublishAdapterConfig {
  adapter: string;
  endpoint_env: string | null;
  token_env: string | null;
}

export interface PublishingDestination {
  destination_id: string;
  name: string;
  channel: ContentChannel;
  authority_tier: "authoritative" | "official";
  mode: PublishExecutionMode;
  enabled: boolean;
  homepage_url: string | null;
  notes: string | null;
  adapter: PublishAdapterConfig | null;
}

export interface PublishingDestinationRegistry {
  schema_version: 1;
  app_id: string;
  updated_at: string;
  destinations: PublishingDestination[];
}

export interface PublishPlanItem {
  item_id: string;
  article_id: string;
  article_title: string;
  body_path: string;
  body_sha256: string;
  channel: ContentChannel;
  destination_id: string;
  destination_name: string;
  execution_mode: PublishExecutionMode;
  idempotency_key: string;
  status: PublishItemStatus;
  attempt_count: number;
  latest_receipt_id: string | null;
}

export interface PublishPlan {
  schema_version: 1;
  plan_id: string;
  app_id: string;
  content_plan_id: string;
  created_at: string;
  status: "prepared" | "authorized" | "in_progress" | "complete" | "complete_with_failures";
  authorized_at: string | null;
  authorized_by: string | null;
  authorization_id: string | null;
  items: PublishPlanItem[];
}

export interface PublishAuthorization {
  schema_version: 1;
  authorization_id: string;
  plan_id: string;
  app_id: string;
  authorized_at: string;
  authorized_by: string;
  reason: string;
  confirmed_plan_id: string;
  item_idempotency_keys: string[];
}

export interface PublishError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface PublishAttempt {
  schema_version: 1;
  attempt_id: string;
  plan_id: string;
  item_id: string;
  idempotency_key: string;
  ordinal: number;
  mode: PublishExecutionMode;
  status: PublishEventStatus;
  recorded_at: string;
  recorded_by: string;
  external_url: string | null;
  external_id: string | null;
  evidence_path: string | null;
  error: PublishError | null;
}

export interface PublishReceipt extends PublishAttempt {
  receipt_id: string;
  article_id: string;
  body_sha256: string;
  destination_id: string;
}

export interface PublishRecordInput {
  status: PublishEventStatus;
  recorded_by: string;
  external_url?: string;
  external_id?: string;
  evidence_path?: string;
  error_code?: string;
  error_message?: string;
  retryable?: boolean;
}
