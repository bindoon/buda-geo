import path from "node:path";
import { stableId } from "./fact-model.js";
import { loadConfirmedDiagnosisContext } from "./diagnosis-seeds.js";
import type { SiteAuditResult, SitePageMetrics, SiteUaProbeRow } from "./site-audit-model.js";
import { extractLinks, pageMetricsFromHtml, parseRobots, sitemapLocs, textLength, visibleText } from "./site-audit-html.js";
import { classifyPublicPresence, classifyPublicUrl, normalizeAndValidateWebsiteUrl } from "./site-audit-url.js";
import { pathExists, readJson, relToProject, utcNow, writeJson } from "./util.js";

const COLLECTOR_VERSION = "site-audit-v1";
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const BLOCK_STATUS = new Set([401, 403, 405, 406, 418, 429, 451, 503]);
const BASELINE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";
export const AI_BOTS: Record<string, string> = {
  GPTBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot",
  "ChatGPT-User": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
  "OAI-SearchBot": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot",
  ClaudeBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ClaudeBot/1.0; +https://anthropic.com/claudebot",
  "Claude-SearchBot": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; Claude-SearchBot/1.0; +https://anthropic.com/claude-search-bot",
  PerplexityBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot",
  Bytespider: "Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 Mobile Safari/537.36; compatible; Bytespider; spider-feedback@bytedance.com",
  "Google-Extended": "Mozilla/5.0 (compatible; Google-Extended)",
};

export interface SiteAuditCollectOptions {
  url?: string;
  samplePages?: number;
  delayMs?: number;
  fetchImpl?: typeof fetch;
  skipAddressLookup?: boolean;
  progress?: (percent: number, stage: string, message: string) => void;
}

interface FetchRow {
  url: string;
  final_url: string;
  status: number;
  ok: boolean;
  elapsed_ms: number;
  bytes: number;
  encoding: string;
  redirects: string[];
  html: string;
  error: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function duplicates(values: string[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries([...counts.entries()].filter(([, count]) => count > 1));
}

async function fetchPage(url: string, ua: string, fetchImpl: typeof fetch, timeoutMs = 20000): Promise<FetchRow> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: {
        "User-Agent": ua,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_BODY_BYTES) throw new Error("响应体超过2MiB限制");
    const encoding = /charset=([\w-]+)/i.exec(response.headers.get("content-type") ?? "")?.[1] ?? "utf-8";
    const html = buffer.toString("utf8");
    return {
      url,
      final_url: response.url || url,
      status: response.status,
      ok: response.ok,
      elapsed_ms: Date.now() - started,
      bytes: buffer.length,
      encoding,
      redirects: response.redirected && response.url && response.url !== url ? [url] : [],
      html,
      error: "",
    };
  } catch (error) {
    return {
      url,
      final_url: "",
      status: 0,
      ok: false,
      elapsed_ms: Date.now() - started,
      bytes: 0,
      encoding: "",
      redirects: [],
      html: "",
      error: error instanceof Error ? `${error.name}: ${error.message.slice(0, 300)}` : "fetch failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

function toPageMetrics(response: FetchRow): SitePageMetrics {
  const parsed = pageMetricsFromHtml(response.html, response.final_url || response.url);
  return {
    url: response.url,
    final_url: response.final_url,
    status: response.status,
    ok: response.ok,
    error: response.error,
    elapsed_ms: response.elapsed_ms,
    bytes: response.bytes,
    encoding: response.encoding,
    title: parsed.title,
    meta_description: parsed.metaDescription,
    canonical: parsed.canonical,
    h1: parsed.h1,
    heading_sequence: parsed.headingSequence,
    raw_visible_text_characters: parsed.rawVisibleTextCharacters,
    main_text_characters: parsed.mainTextCharacters,
    paragraph_count: parsed.paragraphCount,
    long_paragraph_count: parsed.longParagraphCount,
    list_count: parsed.listCount,
    table_count: parsed.tableCount,
    image_count: parsed.imageCount,
    images_missing_alt: parsed.imagesMissingAlt,
    question_heading_count: parsed.questionHeadingCount,
    schema_types: parsed.schemaTypes,
    dates_found: parsed.datesFound,
    challenge: parsed.challenge,
    challenge_marker: parsed.challengeMarker,
    internal_links: parsed.internalLinks,
    csr_heuristic: parsed.csrSuspected,
    csr_reason: parsed.csrReason,
  };
}

function brandFromSnapshot(facts: Array<{ field: string; value: unknown }>): string {
  const shortName = facts.find((fact) => fact.field === "company_short_name" && typeof fact.value === "string");
  if (typeof shortName?.value === "string" && shortName.value.trim()) return shortName.value.trim();
  const name = facts.find((fact) => fact.field === "company_name" && typeof fact.value === "string");
  return typeof name?.value === "string" ? name.value.trim() : "";
}

function websiteFromSnapshot(facts: Array<{ field: string; value: unknown }>): { website: string; shop: string } {
  const website = facts.find((fact) => fact.field === "website_or_shop_url" && typeof fact.value === "string");
  const conversion = facts.find((fact) => fact.field === "conversion" && fact.value && typeof fact.value === "object");
  const shop = conversion && typeof conversion.value === "object"
    ? String((conversion.value as { shop_url?: string }).shop_url ?? "")
    : "";
  return { website: typeof website?.value === "string" ? website.value : "", shop };
}

export async function collectSiteAudit(
  projectRoot: string,
  options: SiteAuditCollectOptions = {},
): Promise<{ audit: SiteAuditResult; jsonPath: string }> {
  const context = await loadConfirmedDiagnosisContext(projectRoot);
  const facts = context.snapshot.facts.facts.filter((fact) => fact.review_status === "confirmed");
  const { website, shop } = websiteFromSnapshot(facts);
  const presence = classifyPublicPresence(website, shop);
  const samplePages = Math.max(5, Math.min(30, options.samplePages ?? 12));
  const delayMs = Math.max(0, options.delayMs ?? 400);
  const fetchImpl = options.fetchImpl ?? fetch;
  const emit = options.progress ?? (() => undefined);
  const brand = brandFromSnapshot(facts);

  let target = options.url?.trim() || presence.owned_website_url;
  if (!target) {
    throw new Error(
      presence.skip_reason
        ? `site-audit skipped: ${presence.skip_reason}。只有自有官网才采集；店铺页请跳过，或用 --url 指定已获授权的官网。`
        : "site-audit blocked: no owned website URL; pass --url for an authorized official site",
    );
  }
  if (options.url?.trim()) {
    const classified = classifyPublicUrl(options.url);
    if (classified.kind === "marketplace_shop") {
      throw new Error(`site-audit blocked: ${classified.marketplace} 店铺页不是自有官网，拒绝采集`);
    }
  }
  target = await normalizeAndValidateWebsiteUrl(target, { skipAddressLookup: options.skipAddressLookup });

  emit(3, "homepage", "抓取首页基线");
  const home = await fetchPage(target, BASELINE_UA, fetchImpl);
  const rootFinal = home.final_url || target;
  const homeMetrics = toPageMetrics(home);
  const homeLinks = extractLinks(home.html, rootFinal);

  emit(8, "robots", "读取 robots.txt");
  const robotsUrl = new URL("/robots.txt", rootFinal).toString();
  const robotsResponse = await fetchPage(robotsUrl, BASELINE_UA, fetchImpl);
  const robotsText = robotsResponse.ok ? robotsResponse.html : "";
  const robotsParsed = parseRobots(robotsText);
  const botRootDisallow = Object.fromEntries(
    Object.keys(AI_BOTS).map((bot) => {
      const applicable = robotsParsed.groups.filter((group) => group.agents.includes(bot.toLowerCase()));
      const used = applicable.length ? applicable : robotsParsed.groups.filter((group) => group.agents.includes("*"));
      const blocked = used.some((group) => group.rules.some((rule) => rule.type === "disallow" && rule.value.trim() === "/"));
      return [bot, blocked];
    }),
  );

  emit(11, "sitemap", "读取 sitemap");
  const sitemapCandidates = [...robotsText.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map((match) => match[1]);
  if (!sitemapCandidates.length) sitemapCandidates.push(new URL("/sitemap.xml", rootFinal).toString());
  const sitemapProbes: Array<{ url: string; status: number; ok: boolean; error: string }> = [];
  const sitemapUrls: string[] = [];
  for (const candidate of sitemapCandidates.slice(0, 5)) {
    const probe = await fetchPage(candidate, BASELINE_UA, fetchImpl);
    sitemapProbes.push({ url: candidate, status: probe.status, ok: probe.ok, error: probe.error });
    if (probe.ok && probe.html) sitemapUrls.push(...sitemapLocs(probe.html, rootFinal));
  }

  emit(14, "llms", "检查 llms.txt");
  const llmsUrl = new URL("/llms.txt", rootFinal).toString();
  const llms = await fetchPage(llmsUrl, BASELINE_UA, fetchImpl);

  const candidates = [...new Set([...sitemapUrls, ...homeLinks])];
  let inner: string | null = null;
  for (const candidate of candidates.slice(0, 12)) {
    const probe = await fetchPage(candidate, BASELINE_UA, fetchImpl);
    if (probe.ok && textLength(visibleText(probe.html)) >= 150 && !pageMetricsFromHtml(probe.html, probe.final_url || candidate).challenge) {
      inner = candidate;
      break;
    }
    if (delayMs) await sleep(delayMs);
  }

  emit(18, "ua_probe", "AI 爬虫 UA 实测");
  const uaRows: SiteUaProbeRow[] = [];
  const targets: Array<["首页" | "内页", string]> = [["首页", rootFinal]];
  if (inner) targets.push(["内页", inner]);
  const totalUa = Object.keys(AI_BOTS).length * targets.length;
  let doneUa = 0;
  for (const [bot, ua] of Object.entries(AI_BOTS)) {
    for (const [label, url] of targets) {
      const response = await fetchPage(url, ua, fetchImpl);
      const chars = textLength(visibleText(response.html));
      const challenge = pageMetricsFromHtml(response.html, response.final_url || url);
      uaRows.push({
        bot,
        page: label,
        url,
        status: response.status,
        text_characters: chars,
        blocked: BLOCK_STATUS.has(response.status) || challenge.challenge || (response.ok && chars < 150),
        challenge: challenge.challenge,
        challenge_marker: challenge.challengeMarker,
        error: response.error,
      });
      doneUa += 1;
      emit(18 + Math.round((doneUa / totalUa) * 20), "ua_probe", `AI爬虫实测 ${doneUa}/${totalUa}`);
      if (delayMs) await sleep(Math.max(delayMs, 800));
    }
  }
  const blockedBots = [...new Set(uaRows.filter((row) => row.page === "首页" && row.blocked).map((row) => row.bot))].sort();

  const selected = [rootFinal, ...candidates.filter((url) => url !== rootFinal)].slice(0, samplePages);
  const uniqueSelected = [...new Set(selected)];
  const pageRows: SitePageMetrics[] = [];
  emit(40, "pages", `开始采样 ${uniqueSelected.length} 个页面`);
  for (const [index, url] of uniqueSelected.entries()) {
    const response = index === 0 && url === rootFinal ? home : await fetchPage(url, BASELINE_UA, fetchImpl);
    pageRows.push(toPageMetrics(response));
    emit(40 + Math.round(((index + 1) / uniqueSelected.length) * 35), "pages", `页面采样 ${index + 1}/${uniqueSelected.length}`);
    if (index + 1 < uniqueSelected.length && delayMs) await sleep(delayMs);
  }

  const okPages = pageRows.filter((page) => page.ok && !page.challenge);
  const schemaTypes = [...new Set(okPages.flatMap((page) => page.schema_types))].sort();
  const schemaCounts: Record<string, number> = {};
  for (const type of okPages.flatMap((page) => page.schema_types)) schemaCounts[type] = (schemaCounts[type] ?? 0) + 1;
  const csrPages = pageRows.filter((page) => page.csr_heuristic).map((page) => page.url);
  const homepageHttps = rootFinal.startsWith("https:") && home.ok;
  const organizationNames = [...new Set(
    pageRows.flatMap((page) => page.schema_types.includes("Organization") || page.schema_types.includes("Corporation") || page.schema_types.includes("LocalBusiness") ? page.h1 : []),
  )];
  const titleH1Text = pageRows.map((page) => `${page.title} ${page.h1.join(" ")}`).join(" ");
  const redCards = {
    R1_CSR_shell: { triggered: Boolean(homeMetrics.csr_heuristic), evidence: { pages: csrPages, reason: homeMetrics.csr_reason } },
    R2_robots_all_blocked: { triggered: robotsParsed.globalRootDisallow, evidence: robotsParsed.globalRootDisallow },
    R3_three_or_more_bots_blocked: { triggered: blockedBots.length >= 3, evidence: blockedBots },
    R4_no_sitemap_and_few_home_links: { triggered: !sitemapUrls.length && homeLinks.length < 10, evidence: { sitemap: Boolean(sitemapUrls.length), home_internal_links: homeLinks.length } },
    R5_transport_failure: { triggered: !homepageHttps, evidence: { final_url: rootFinal, status: home.status, error: home.error } },
  };
  const warnings: string[] = [];
  if (homeMetrics.challenge) warnings.push(`首页疑似安全挑战页：${homeMetrics.challenge_marker}`);
  if (pageRows.length < samplePages) warnings.push(`发现的可采样 URL 不足：计划 ${samplePages} 页，实际 ${pageRows.length} 页`);
  warnings.push("浏览器渲染未执行；CSR 仅按原始 HTML 启发式判断，不把未检测写成通过。");
  if (llms.ok) warnings.push("已检查 llms.txt，只记录有无，不计入红牌或优先整改。");

  const auditId = stableId("site_audit", context.snapshot.fact_snapshot_id, target, pageRows.map((page) => [page.url, page.status, page.main_text_characters]));
  const audit: SiteAuditResult = {
    schema_version: 1,
    audit_id: auditId,
    app_id: context.manifest.app_id,
    fact_snapshot_id: context.snapshot.fact_snapshot_id,
    collected_at: utcNow(),
    collector_version: COLLECTOR_VERSION,
    method: "公网 HTTP 实测、AI 爬虫 UA 探测、HTML 解析；CSR 仅做原始 HTML 启发式，不做浏览器渲染",
    presence: {
      ...presence,
      owned_website_url: options.url ? target : presence.owned_website_url,
    },
    request: {
      url: target,
      brand,
      sample_pages: samplePages,
      url_override: Boolean(options.url),
    },
    meta: {
      target_url: target,
      final_home_url: rootFinal,
      requested_sample_pages: samplePages,
      sampled_pages: pageRows.length,
      successful_pages: pageRows.filter((page) => page.ok).length,
    },
    data_quality: {
      reliable: Boolean(home.ok && !homeMetrics.challenge && homeMetrics.main_text_characters >= 80),
      warnings,
      homepage_challenge: homeMetrics.challenge,
      homepage_challenge_marker: homeMetrics.challenge_marker,
    },
    red_card_facts: redCards,
    summary: {
      home_status: home.status,
      home_internal_links: homeLinks.length,
      sitemap_present: Boolean(sitemapUrls.length),
      blocked_ai_bots: blockedBots,
      schema_types: schemaTypes,
      csr_heuristic: homeMetrics.csr_heuristic,
      llms_txt_present: Boolean(llms.ok && llms.html.trim()),
      red_cards_triggered: Object.entries(redCards).filter(([, value]) => value.triggered).map(([key]) => key),
      scoring_note: "本文件只含客观采集与红牌事实；不设综合分。五维只以清单和缺口表达。",
    },
    access: {
      homepage: {
        url: home.url,
        final_url: home.final_url,
        status: home.status,
        ok: home.ok,
        elapsed_ms: home.elapsed_ms,
        bytes: home.bytes,
        encoding: home.encoding,
        redirects: home.redirects,
        error: home.error,
      },
      https_validated_by_request: homepageHttps,
      robots: {
        url: robotsUrl,
        status: robotsResponse.status,
        present: Boolean(robotsText),
        error: robotsResponse.error,
        global_root_disallow: robotsParsed.globalRootDisallow,
        bot_root_disallow: botRootDisallow,
        raw_excerpt: robotsText.slice(0, 12000),
      },
      sitemap: {
        present: Boolean(sitemapUrls.length),
        url_count: new Set(sitemapUrls).size,
        probes: sitemapProbes,
      },
      llms_txt: {
        url: llmsUrl,
        status: llms.status,
        present: Boolean(llms.ok && llms.html.trim()),
        error: llms.error,
      },
      ua_probe: {
        rows: uaRows,
        blocked_bots: blockedBots,
        blocked_bot_count: blockedBots.length,
      },
    },
    render: {
      available: false,
      method: "html_heuristic_v1",
      reason: "本地一期不做 Playwright 渲染；仅在原始 HTML 上做 CSR 启发式",
      csr_suspected_pages: csrPages,
    },
    structure: {
      sampled_ok_pages: okPages.length,
      schema_types: schemaTypes,
      schema_type_page_counts: schemaCounts,
      pages_with_json_ld: okPages.filter((page) => page.schema_types.length).length,
      organization_pages: okPages.filter((page) => page.schema_types.includes("Organization")).length,
      faq_pages: okPages.filter((page) => page.schema_types.includes("FAQPage")).length,
      article_pages: okPages.filter((page) => page.schema_types.some((type) => ["Article", "NewsArticle", "BlogPosting"].includes(type))).length,
      breadcrumb_pages: okPages.filter((page) => page.schema_types.includes("BreadcrumbList")).length,
    },
    content: {
      sampled_ok_pages: okPages.length,
      title_duplicates: duplicates(okPages.map((page) => page.title).filter(Boolean)),
      h1_duplicates: duplicates(okPages.flatMap((page) => page.h1[0] ? [page.h1[0]] : [])),
      pages_without_title: okPages.filter((page) => !page.title).length,
      pages_without_h1: okPages.filter((page) => !page.h1.length).length,
      pages_with_multiple_h1: okPages.filter((page) => page.h1.length > 1).length,
      pages_with_question_headings: okPages.filter((page) => page.question_heading_count > 0).length,
      pages_with_lists: okPages.filter((page) => page.list_count > 0).length,
      pages_with_tables: okPages.filter((page) => page.table_count > 0).length,
      images_total: okPages.reduce((sum, page) => sum + page.image_count, 0),
      images_missing_alt: okPages.reduce((sum, page) => sum + page.images_missing_alt, 0),
      pages_with_dates: okPages.filter((page) => page.dates_found.length).length,
      median_main_text_characters: median(okPages.map((page) => page.main_text_characters)),
    },
    entity: {
      brand_input: brand,
      brand_mentioned_in_sample_titles_or_h1: Boolean(brand && titleH1Text.toLowerCase().includes(brand.toLowerCase())),
      organization_schema_count: okPages.filter((page) => page.schema_types.some((type) => ["Organization", "Corporation", "LocalBusiness"].includes(type))).length,
      organization_names: organizationNames,
      same_as: [],
      manual_checks_required: ["页脚公司全称与工商主体是否一致", "各页 NAP 是否一致", "外部平台实体资料是否一致", "资质和案例是否可核验"],
    },
    pages: pageRows.map((page) => ({ ...page })),
  };

  const jsonPath = path.join(projectRoot, "diagnosis", "site-audits", `${auditId}.json`);
  await writeJson(jsonPath, audit);
  emit(99, "save", "采集数据已保存");
  return { audit, jsonPath: relToProject(projectRoot, jsonPath) };
}

export async function loadSiteAudit(projectRoot: string, auditId: string): Promise<SiteAuditResult> {
  const auditPath = path.join(projectRoot, "diagnosis", "site-audits", `${auditId}.json`);
  if (!(await pathExists(auditPath))) throw new Error(`site-audit not found: ${auditId}`);
  return readJson<SiteAuditResult>(auditPath);
}
