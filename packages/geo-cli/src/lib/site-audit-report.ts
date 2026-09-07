import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { DiagnosisGap } from "./diagnosis-model.js";
import { stableId } from "./fact-model.js";
import { loadConfirmedDiagnosisContext } from "./diagnosis-seeds.js";
import { collectSiteAudit, loadSiteAudit, type SiteAuditCollectOptions } from "./site-audit-collect.js";
import type { ConfirmedSiteAuditGaps, SiteAuditReport, SiteAuditResult } from "./site-audit-model.js";
import { pathExists, readJson, relToProject, utcNow, writeJson } from "./util.js";

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]!);
}

function gap(
  kind: DiagnosisGap["kind"],
  severity: DiagnosisGap["severity"],
  observed: string,
  investigation: string,
  sources: string[],
  factIds: string[],
): DiagnosisGap {
  return {
    gap_id: stableId("gap", kind, observed),
    kind,
    severity,
    observed_issue: observed,
    question_ids: [],
    probe_ids: [],
    platforms: [],
    competitors: [],
    sources,
    fact_ids: factIds,
    recommended_investigation: investigation,
  };
}

function websiteFactIds(facts: Array<{ fact_id: string; field: string }>): string[] {
  return facts.filter((fact) => ["website_or_shop_url", "company_name", "company_short_name"].includes(fact.field)).map((fact) => fact.fact_id);
}

export function siteAuditGaps(audit: SiteAuditResult, factIds: string[]): DiagnosisGap[] {
  const gaps: DiagnosisGap[] = [];
  const sample = `采样的 ${audit.meta.sampled_pages} 个页面中`;
  const home = audit.meta.final_home_url;
  if (audit.red_card_facts.R5_transport_failure.triggered) {
    gaps.push(gap("site_access", "high", `首页未能以 HTTPS 成功访问（status=${audit.access.homepage.status || 0}）。`, "先修复证书、跳转和首页可达性，再谈内容与结构化数据。", [home], factIds));
  }
  if (audit.red_card_facts.R2_robots_all_blocked.triggered) {
    gaps.push(gap("site_access", "high", "robots.txt 对 * 禁止抓取整站（Disallow: /）。", "确认是否误拦 AI 爬虫；如需被引用，应允许主流搜索/AI bot 读取公开页。", [audit.access.robots.url], factIds));
  }
  if (audit.red_card_facts.R3_three_or_more_bots_blocked.triggered) {
    gaps.push(gap(
      "site_access",
      "high",
      `首页 UA 实测中，${audit.access.ua_probe.blocked_bot_count} 个主流 AI 爬虫被拦截或拿到空页：${audit.summary.blocked_ai_bots.join("、")}。`,
      "核验 WAF/CDN 是否把 GPTBot、ClaudeBot、Bytespider 等当成攻击；用各 bot 官方 UA 复测首页和一篇内页。",
      [home],
      factIds,
    ));
  }
  if (audit.red_card_facts.R4_no_sitemap_and_few_home_links.triggered) {
    gaps.push(gap("site_access", "medium", `未发现 sitemap，且首页站内链接只有 ${audit.summary.home_internal_links} 条。`, "补 sitemap.xml，并在首页提供足够的公开栏目入口，避免爬虫只能看到孤页。", [home], factIds));
  }
  if (audit.red_card_facts.R1_CSR_shell.triggered) {
    gaps.push(gap("site_render", "high", `首页原始 HTML 启发式判断为 CSR 空壳：${audit.pages[0]?.csr_reason || "正文过少"}。`, "让关键介绍页在无 JS 时也能输出可读正文；本期未做浏览器渲染，需人工打开页面核对。", audit.render.csr_suspected_pages, factIds));
  } else if (!audit.render.available) {
    gaps.push(gap("site_render", "low", "未做浏览器渲染检测，不能证明页面渲染后一定可被爬虫看到。", "若官网是 SPA/模板站，应用无 JS 抓取核对正文；不要把未检测写成已通过。", [home], factIds));
  }
  if (audit.data_quality.reliable && audit.structure.organization_pages === 0) {
    gaps.push(gap("site_structure", "medium", `${sample}未见 Organization/Corporation JSON-LD。`, "在首页和关于页补充 Organization，写清官方名称与 sameAs。", [home], factIds));
  }
  if (audit.data_quality.reliable && audit.structure.faq_pages === 0) {
    gaps.push(gap("site_structure", "low", `${sample}未见 FAQPage。`, "若后续规划 site 通道问答页，再用 FAQPage；不要把缺失写成全站没有 FAQ。", [home], factIds));
  }
  if (audit.data_quality.reliable && audit.content.pages_without_h1 > 0) {
    gaps.push(gap("site_content", "medium", `${sample}有 ${audit.content.pages_without_h1} 页缺少 H1。`, "给采样页补唯一、可读的 H1，避免标题重复。", audit.pages.filter((page) => page.ok && !page.h1.length).map((page) => page.url), factIds));
  }
  if (audit.data_quality.reliable && audit.content.median_main_text_characters < 200) {
    gaps.push(gap("site_content", "medium", `${sample}正文中位数只有 ${audit.content.median_main_text_characters} 字，可答性偏弱。`, "在公开页写清产品、场景和可核验主体，不要只留导航壳。", [home], factIds));
  }
  if (audit.data_quality.reliable && audit.entity.brand_input && !audit.entity.brand_mentioned_in_sample_titles_or_h1) {
    gaps.push(gap("site_entity", "medium", `采样页 title/H1 未出现品牌「${audit.entity.brand_input}」。`, "核验官网公开名称与已确认品牌是否一致，避免模型把同名主体认成别家。", [home], factIds));
  }
  return gaps;
}

export function siteAuditChecklist(audit: SiteAuditResult): SiteAuditReport["checklist"] {
  const sample = `采样的 ${audit.meta.sampled_pages} 个页面`;
  const reliable = audit.data_quality.reliable;
  return [
    {
      id: "https",
      dimension: "access",
      label: "HTTPS 可达",
      status: audit.access.https_validated_by_request ? "pass" : "fail",
      observed: audit.access.https_validated_by_request ? `首页最终地址 ${audit.meta.final_home_url}` : `首页未能以 HTTPS 成功访问，status=${audit.access.homepage.status}`,
    },
    {
      id: "robots",
      dimension: "access",
      label: "robots 未全站禁止",
      status: audit.access.robots.global_root_disallow ? "fail" : audit.access.robots.present ? "pass" : "warn",
      observed: audit.access.robots.present
        ? (audit.access.robots.global_root_disallow ? "存在 Disallow: /" : "未发现对 * 的整站禁止")
        : "未读到 robots.txt",
    },
    {
      id: "ai_bots",
      dimension: "access",
      label: "主流 AI 爬虫可读取首页",
      status: audit.access.ua_probe.blocked_bot_count >= 3 ? "fail" : audit.access.ua_probe.blocked_bot_count ? "warn" : "pass",
      observed: audit.access.ua_probe.blocked_bot_count
        ? `被拦 bot：${audit.summary.blocked_ai_bots.join("、")}`
        : "采样 UA 均拿到可读首页",
    },
    {
      id: "sitemap",
      dimension: "access",
      label: "sitemap 或足够首页链接",
      status: audit.red_card_facts.R4_no_sitemap_and_few_home_links.triggered ? "fail" : audit.summary.sitemap_present ? "pass" : "warn",
      observed: `sitemap=${audit.summary.sitemap_present ? "有" : "无"}，首页站内链接 ${audit.summary.home_internal_links} 条`,
    },
    {
      id: "csr",
      dimension: "render",
      label: "原始 HTML 不是空壳",
      status: audit.red_card_facts.R1_CSR_shell.triggered ? "fail" : audit.render.available ? "pass" : "undetected",
      observed: audit.red_card_facts.R1_CSR_shell.triggered
        ? audit.pages[0]?.csr_reason || "启发式判断为 CSR 空壳"
        : audit.render.reason,
    },
    {
      id: "organization",
      dimension: "structure",
      label: "Organization 结构化数据",
      status: !reliable ? "undetected" : audit.structure.organization_pages ? "pass" : "warn",
      observed: reliable ? `${sample}中 ${audit.structure.organization_pages} 页含 Organization` : "首页正文不可靠，不判断结构化数据",
    },
    {
      id: "faq",
      dimension: "structure",
      label: "FAQPage（可选）",
      status: !reliable ? "undetected" : audit.structure.faq_pages ? "pass" : "warn",
      observed: reliable ? `${sample}中 ${audit.structure.faq_pages} 页含 FAQPage` : "未检测",
    },
    {
      id: "h1",
      dimension: "content",
      label: "采样页有 H1",
      status: !reliable ? "undetected" : audit.content.pages_without_h1 ? "warn" : "pass",
      observed: reliable ? `${sample}中 ${audit.content.pages_without_h1} 页缺 H1` : "未检测",
    },
    {
      id: "body",
      dimension: "content",
      label: "采样页正文可答",
      status: !reliable ? "undetected" : audit.content.median_main_text_characters >= 200 ? "pass" : "warn",
      observed: reliable ? `正文中位数 ${audit.content.median_main_text_characters} 字` : "未检测",
    },
    {
      id: "brand",
      dimension: "entity",
      label: "品牌出现在 title/H1",
      status: !reliable ? "undetected" : !audit.entity.brand_input ? "undetected" : audit.entity.brand_mentioned_in_sample_titles_or_h1 ? "pass" : "warn",
      observed: audit.entity.brand_input
        ? (audit.entity.brand_mentioned_in_sample_titles_or_h1 ? `采样 title/H1 出现「${audit.entity.brand_input}」` : `采样 title/H1 未出现「${audit.entity.brand_input}」`)
        : "未提供品牌名",
    },
    {
      id: "llms",
      dimension: "access",
      label: "llms.txt（只检查，不计分）",
      status: "undetected",
      observed: audit.summary.llms_txt_present ? `存在 ${audit.access.llms_txt.url}` : `未发现 ${audit.access.llms_txt.url}`,
    },
  ];
}

function reportMarkdown(report: SiteAuditReport, audit: SiteAuditResult): string {
  const lines = [
    `# ${report.project_name} · 官网技术审计报告`,
    "",
    "> 本报告只描述本次对自有官网的客观采样，不替代 AI 平台 probe 诊断，也不设综合分。",
    "",
    `- 报告时间：${report.generated_at}`,
    `- 事实快照：\`${report.fact_snapshot_id}\``,
    `- 审计编号：\`${report.audit_id}\``,
    `- 目标网址：${report.target_url}`,
    `- 最终首页：${audit.meta.final_home_url}`,
    `- 状态：${report.status}`,
    `- 综合分：未设置。红牌只作为缺口，不当总分。`,
    "",
    "## 数据质量",
    "",
    `- 采集是否可靠：${audit.data_quality.reliable ? "是" : "否"}`,
    `- 采样页：${audit.meta.sampled_pages}（成功 ${audit.meta.successful_pages}）`,
    ...audit.data_quality.warnings.map((item) => `- 警告：${item}`),
    "",
    "## 红牌事实",
    "",
  ];
  const labels: Record<string, string> = {
    R1_CSR_shell: "原始 HTML 疑似 CSR 空壳",
    R2_robots_all_blocked: "robots 全站禁止",
    R3_three_or_more_bots_blocked: "3 个及以上 AI 爬虫被拦",
    R4_no_sitemap_and_few_home_links: "无 sitemap 且首页链接过少",
    R5_transport_failure: "非 HTTPS 或首页访问失败",
  };
  if (!report.red_cards_triggered.length) lines.push("本次采样未触发红牌。", "");
  for (const key of report.red_cards_triggered) lines.push(`- **${key}**：${labels[key] ?? key}`);
  if (report.red_cards_triggered.length) lines.push("");
  lines.push("## 检查清单", "", "| 维度 | 检查项 | 状态 | 观察 |", "|---|---|---|---|");
  for (const item of report.checklist) {
    lines.push(`| ${item.dimension} | ${item.label} | ${item.status} | ${item.observed.replace(/\|/g, "\\|")} |`);
  }
  lines.push("", "## AI 爬虫实测", "", "| Bot | 页面 | 状态码 | 可见字数 | 是否被拦 |", "|---|---|---:|---:|---|");
  for (const row of audit.access.ua_probe.rows) {
    lines.push(`| ${row.bot} | ${row.page} | ${row.status} | ${row.text_characters} | ${row.blocked ? "是" : "否"} |`);
  }
  lines.push("", "## 结构化数据与内容", "", `- ${sampleNote(audit)}见到的 Schema 类型：${audit.structure.schema_types.join("、") || "无"}`, `- Organization 页：${audit.structure.organization_pages}`, `- FAQPage 页：${audit.structure.faq_pages}`, `- 缺 H1 页：${audit.content.pages_without_h1}`, `- 正文中位数：${audit.content.median_main_text_characters} 字`, "", "## 结构化缺口", "");
  if (!report.gaps.length) lines.push("本次有效采样尚未形成官网缺口。", "");
  for (const item of report.gaps) lines.push(`### ${item.severity.toUpperCase()} · ${item.kind}`, "", item.observed_issue, "", `建议调查：${item.recommended_investigation}`, "");
  lines.push("## 需人工核验", "", ...audit.entity.manual_checks_required.map((item) => `- ${item}`), "", "## 限制", "", ...report.limitations.map((item) => `- ${item}`), "");
  return lines.join("\n");
}

function sampleNote(audit: SiteAuditResult): string {
  return `采样的 ${audit.meta.sampled_pages} 个页面中`;
}

function reportHtml(report: SiteAuditReport, markdown: string): string {
  const checklist = report.checklist.map((item) => `<tr><td>${esc(item.dimension)}</td><td>${esc(item.label)}</td><td>${esc(item.status)}</td><td>${esc(item.observed)}</td></tr>`).join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(report.project_name)} 官网技术审计</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#172033;background:#f5f7fb;margin:0}.wrap{max-width:1100px;margin:0 auto;padding:36px 22px}.hero,.card{background:#fff;border:1px solid #dfe5ef;border-radius:14px;padding:24px;margin-bottom:18px}.hero{background:linear-gradient(135deg,#0f766e,#115e59);color:#fff}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.metric{background:#f8fafc;border-radius:10px;padding:16px}.metric b{display:block;font-size:1.35rem;color:#0f766e;margin-top:5px}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;padding:10px;border-bottom:1px solid #e5e7eb;vertical-align:top}th{background:#f8fafc}@media(max-width:700px){.wrap{padding:16px 10px}.card{overflow:auto}}</style></head><body><main class="wrap"><section class="hero"><h1>${esc(report.project_name)} · 官网技术审计</h1><p>${esc(report.target_url)} · ${esc(report.generated_at)}</p><p>只描述本次采样，不设综合分，不替代 AI 平台探测。</p></section><section class="card"><h2>红牌与质量</h2><div class="grid"><div class="metric">采集可靠<b>${report.data_quality.reliable ? "是" : "否"}</b></div><div class="metric">红牌<b>${report.red_cards_triggered.length}</b></div><div class="metric">缺口<b>${report.gaps.length}</b></div></div></section><section class="card"><h2>检查清单</h2><table><thead><tr><th>维度</th><th>检查项</th><th>状态</th><th>观察</th></tr></thead><tbody>${checklist}</tbody></table></section><section class="card"><h2>缺口</h2>${report.gaps.map((item) => `<h3>${esc(item.severity.toUpperCase())} · ${esc(item.kind)}</h3><p>${esc(item.observed_issue)}</p><p>建议调查：${esc(item.recommended_investigation)}</p>`).join("") || "<p>本次有效采样尚未形成官网缺口。</p>"}</section><section class="card"><h2>限制</h2><ul>${report.limitations.map((item) => `<li>${esc(item)}</li>`).join("")}</ul><details><summary>机器可读 Markdown</summary><pre>${esc(markdown)}</pre></details></section></main></body></html>`;
}

function limitations(audit: SiteAuditResult): string[] {
  return [
    `结论只覆盖本次采样的 ${audit.meta.sampled_pages} 个页面，不能写成全站结论。`,
    "未采到的数据写「未检测」，不得用行业均值补齐。",
    "本报告不替代种子题 + 多平台 probe 的可见度诊断。",
    "浏览器渲染未执行；CSR 红牌仅在原始 HTML 启发式成立时触发。",
    "llms.txt 只检查，不计分，不列为优先投入。",
    audit.data_quality.reliable ? "首页正文可采样，内容与结构化结论可以使用。" : "data_quality.reliable=false：不判断内容/结构优劣，只保留 robots、UA、sitemap、TLS 等准入事实。",
  ];
}

export async function generateSiteAuditReport(projectRoot: string, auditId: string): Promise<{ report: SiteAuditReport; jsonPath: string; markdownPath: string; htmlPath: string; reviewPath: string }> {
  const context = await loadConfirmedDiagnosisContext(projectRoot);
  const audit = await loadSiteAudit(projectRoot, auditId);
  if (audit.fact_snapshot_id !== context.snapshot.fact_snapshot_id) throw new Error("site-audit report blocked: audit fact snapshot is stale");
  const factIds = websiteFactIds(context.snapshot.facts.facts);
  const gaps = audit.data_quality.reliable
    ? siteAuditGaps(audit, factIds)
    : siteAuditGaps(audit, factIds).filter((item) => item.kind === "site_access");
  const reportId = stableId("site_audit_report", audit.audit_id, audit.collected_at, gaps.map((item) => item.gap_id));
  const report: SiteAuditReport = {
    schema_version: 1,
    report_id: reportId,
    app_id: audit.app_id,
    project_name: path.basename(projectRoot),
    fact_snapshot_id: audit.fact_snapshot_id,
    audit_id: audit.audit_id,
    generated_at: utcNow(),
    status: "review_required",
    confirmed_at: null,
    target_url: audit.request.url,
    composite_score: null,
    data_quality: audit.data_quality,
    red_cards_triggered: audit.summary.red_cards_triggered,
    checklist: siteAuditChecklist(audit),
    gaps,
    limitations: limitations(audit),
    result_path: `diagnosis/site-audits/${audit.audit_id}.json`,
  };
  const base = path.join(projectRoot, "diagnosis", "reports", reportId);
  await writeJson(`${base}.json`, report);
  const markdown = reportMarkdown(report, audit);
  await writeFile(`${base}.md`, markdown, "utf-8");
  await writeFile(`${base}.html`, reportHtml(report, markdown), "utf-8");
  const reviewPath = path.join(projectRoot, "diagnosis", "site-audit-review.md");
  await writeFile(reviewPath, markdown, "utf-8");
  const manifestPath = path.join(projectRoot, "manifest.json");
  const manifest = await readJson<Record<string, any>>(manifestPath);
  manifest.gates = manifest.gates ?? {};
  manifest.gates.site_audit = {
    status: "review_required",
    at: null,
    fact_snapshot_id: report.fact_snapshot_id,
    audit_id: report.audit_id,
    report_id: report.report_id,
    target_url: report.target_url,
    skip_reason: null,
  };
  manifest.updated_at = report.generated_at;
  await writeJson(manifestPath, manifest);
  return {
    report,
    jsonPath: relToProject(projectRoot, `${base}.json`),
    markdownPath: relToProject(projectRoot, `${base}.md`),
    htmlPath: relToProject(projectRoot, `${base}.html`),
    reviewPath: relToProject(projectRoot, reviewPath),
  };
}

export async function runSiteAudit(projectRoot: string, options: SiteAuditCollectOptions = {}): Promise<{ audit: SiteAuditResult; report: SiteAuditReport; jsonPath: string; markdownPath: string; htmlPath: string; reviewPath: string; auditPath: string }> {
  const collected = await collectSiteAudit(projectRoot, options);
  const rendered = await generateSiteAuditReport(projectRoot, collected.audit.audit_id);
  return { audit: collected.audit, report: rendered.report, jsonPath: rendered.jsonPath, markdownPath: rendered.markdownPath, htmlPath: rendered.htmlPath, reviewPath: rendered.reviewPath, auditPath: collected.jsonPath };
}

export async function confirmSiteAuditReport(projectRoot: string, reportId: string): Promise<SiteAuditReport> {
  const context = await loadConfirmedDiagnosisContext(projectRoot);
  const reportPath = path.join(projectRoot, "diagnosis", "reports", `${reportId}.json`);
  const report = await readJson<SiteAuditReport>(reportPath);
  if (report.fact_snapshot_id !== context.snapshot.fact_snapshot_id) throw new Error("site-audit confirmation blocked: report fact snapshot is stale");
  const confirmedAt = utcNow();
  report.status = "confirmed";
  report.confirmed_at = confirmedAt;
  await writeJson(reportPath, report);
  const audit = await loadSiteAudit(projectRoot, report.audit_id);
  const markdown = reportMarkdown(report, audit);
  const reportBase = path.join(projectRoot, "diagnosis", "reports", reportId);
  await writeFile(`${reportBase}.md`, markdown, "utf-8");
  await writeFile(`${reportBase}.html`, reportHtml(report, markdown), "utf-8");
  await writeFile(path.join(projectRoot, "diagnosis", "site-audit-review.md"), markdown, "utf-8");
  const gaps: ConfirmedSiteAuditGaps = {
    schema_version: 1,
    report_id: reportId,
    audit_id: report.audit_id,
    status: "confirmed",
    confirmed_at: confirmedAt,
    gaps: report.gaps,
  };
  await writeJson(path.join(projectRoot, "diagnosis", "gaps", `${reportId}.json`), gaps);
  const manifestPath = path.join(projectRoot, "manifest.json");
  const manifest = await readJson<Record<string, any>>(manifestPath);
  manifest.gates = manifest.gates ?? {};
  manifest.gates.site_audit = {
    status: "confirmed",
    at: confirmedAt,
    fact_snapshot_id: report.fact_snapshot_id,
    audit_id: report.audit_id,
    report_id: report.report_id,
    target_url: report.target_url,
    skip_reason: null,
  };
  manifest.updated_at = confirmedAt;
  await writeJson(manifestPath, manifest);
  return report;
}

export async function siteAuditGapInput(projectRoot: string): Promise<string | null> {
  const manifest = await readJson<Record<string, any>>(path.join(projectRoot, "manifest.json"));
  const gate = manifest.gates?.site_audit;
  if (gate?.status !== "confirmed" || !gate.report_id) return null;
  const gapPath = path.join(projectRoot, "diagnosis", "gaps", `${gate.report_id}.json`);
  if (!(await pathExists(gapPath))) return null;
  return relToProject(projectRoot, gapPath);
}
