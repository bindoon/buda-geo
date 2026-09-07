import type { DiagnosisGap } from "./diagnosis-model.js";
import type { PublicPresence } from "./site-audit-url.js";

export const SITE_AUDIT_GAP_KINDS = [
  "site_access",
  "site_render",
  "site_structure",
  "site_content",
  "site_entity",
] as const;

export type SiteAuditGapKind = (typeof SITE_AUDIT_GAP_KINDS)[number];

export interface SitePageMetrics {
  url: string;
  final_url: string;
  status: number;
  ok: boolean;
  error: string;
  elapsed_ms: number;
  bytes: number;
  encoding: string;
  title: string;
  meta_description: string;
  canonical: string;
  h1: string[];
  heading_sequence: string[];
  raw_visible_text_characters: number;
  main_text_characters: number;
  paragraph_count: number;
  long_paragraph_count: number;
  list_count: number;
  table_count: number;
  image_count: number;
  images_missing_alt: number;
  question_heading_count: number;
  schema_types: string[];
  dates_found: string[];
  challenge: boolean;
  challenge_marker: string;
  internal_links: number;
  csr_heuristic: boolean;
  csr_reason: string;
}

export interface SiteUaProbeRow {
  bot: string;
  page: "首页" | "内页";
  url: string;
  status: number;
  text_characters: number;
  blocked: boolean;
  challenge: boolean;
  challenge_marker: string;
  error: string;
}

export interface SiteRedCard {
  triggered: boolean;
  evidence: unknown;
}

export interface SiteAuditResult {
  schema_version: 1;
  audit_id: string;
  app_id: string;
  fact_snapshot_id: string;
  collected_at: string;
  collector_version: "site-audit-v1";
  method: string;
  presence: PublicPresence;
  request: {
    url: string;
    brand: string;
    sample_pages: number;
    url_override: boolean;
  };
  meta: {
    target_url: string;
    final_home_url: string;
    requested_sample_pages: number;
    sampled_pages: number;
    successful_pages: number;
  };
  data_quality: {
    reliable: boolean;
    warnings: string[];
    homepage_challenge: boolean;
    homepage_challenge_marker: string;
  };
  red_card_facts: {
    R1_CSR_shell: SiteRedCard;
    R2_robots_all_blocked: SiteRedCard;
    R3_three_or_more_bots_blocked: SiteRedCard;
    R4_no_sitemap_and_few_home_links: SiteRedCard;
    R5_transport_failure: SiteRedCard;
  };
  summary: {
    home_status: number;
    home_internal_links: number;
    sitemap_present: boolean;
    blocked_ai_bots: string[];
    schema_types: string[];
    csr_heuristic: boolean;
    llms_txt_present: boolean;
    red_cards_triggered: string[];
    scoring_note: string;
  };
  access: {
    homepage: {
      url: string;
      final_url: string;
      status: number;
      ok: boolean;
      elapsed_ms: number;
      bytes: number;
      encoding: string;
      redirects: string[];
      error: string;
    };
    https_validated_by_request: boolean;
    robots: {
      url: string;
      status: number;
      present: boolean;
      error: string;
      global_root_disallow: boolean;
      bot_root_disallow: Record<string, boolean>;
      raw_excerpt: string;
    };
    sitemap: {
      present: boolean;
      url_count: number;
      probes: Array<{ url: string; status: number; ok: boolean; error: string }>;
    };
    llms_txt: {
      url: string;
      status: number;
      present: boolean;
      error: string;
    };
    ua_probe: {
      rows: SiteUaProbeRow[];
      blocked_bots: string[];
      blocked_bot_count: number;
    };
  };
  render: {
    available: boolean;
    method: "html_heuristic_v1";
    reason: string;
    csr_suspected_pages: string[];
  };
  structure: {
    sampled_ok_pages: number;
    schema_types: string[];
    schema_type_page_counts: Record<string, number>;
    pages_with_json_ld: number;
    organization_pages: number;
    faq_pages: number;
    article_pages: number;
    breadcrumb_pages: number;
  };
  content: {
    sampled_ok_pages: number;
    title_duplicates: Record<string, number>;
    h1_duplicates: Record<string, number>;
    pages_without_title: number;
    pages_without_h1: number;
    pages_with_multiple_h1: number;
    pages_with_question_headings: number;
    pages_with_lists: number;
    pages_with_tables: number;
    images_total: number;
    images_missing_alt: number;
    pages_with_dates: number;
    median_main_text_characters: number;
  };
  entity: {
    brand_input: string;
    brand_mentioned_in_sample_titles_or_h1: boolean;
    organization_schema_count: number;
    organization_names: string[];
    same_as: string[];
    manual_checks_required: string[];
  };
  pages: SitePageMetrics[];
}

export interface SiteAuditReport {
  schema_version: 1;
  report_id: string;
  app_id: string;
  project_name: string;
  fact_snapshot_id: string;
  audit_id: string;
  generated_at: string;
  status: "review_required" | "confirmed";
  confirmed_at: string | null;
  target_url: string;
  composite_score: null;
  data_quality: SiteAuditResult["data_quality"];
  red_cards_triggered: string[];
  checklist: Array<{
    id: string;
    dimension: "access" | "render" | "structure" | "content" | "entity";
    label: string;
    status: "pass" | "warn" | "fail" | "undetected";
    observed: string;
  }>;
  gaps: DiagnosisGap[];
  limitations: string[];
  result_path: string;
}

export interface ConfirmedSiteAuditGaps {
  schema_version: 1;
  report_id: string;
  audit_id: string;
  status: "confirmed";
  confirmed_at: string;
  gaps: DiagnosisGap[];
}
