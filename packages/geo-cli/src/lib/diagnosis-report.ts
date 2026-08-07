import { writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  DiagnosisGap,
  DiagnosisMetrics,
  DiagnosisReport,
  DiagnosisRun,
  DistributionItem,
  ProbeResult,
  RateMetric,
  SeedSet,
} from "./diagnosis-model.js";
import { stableId } from "./fact-model.js";
import { listProbeResults } from "./diagnosis-probe.js";
import { loadConfirmedDiagnosisContext } from "./diagnosis-seeds.js";
import { pathExists, readJson, relToProject, utcNow, writeJson } from "./util.js";

function rate(numerator: number, denominator: number, unavailableReason: string | null = null): RateMetric {
  return { numerator, denominator, rate: denominator ? numerator / denominator : null, unavailable_reason: denominator ? null : unavailableReason ?? "no eligible probes" };
}

function distribution(values: string[], denominator: number): DistributionItem[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count, denominator, rate: denominator ? count / denominator : null }));
}

function flatMetrics(probes: ProbeResult[], topN = 3): Omit<DiagnosisMetrics, "by_platform"> {
  const valid = probes.filter((probe) => probe.status === "success" && probe.analysis);
  const negatives = valid.filter((probe) => probe.question_family === "negative_risk");
  const observableRank = valid.filter((probe) => probe.analysis!.recommendation_position != null);
  const withCitation = valid.filter((probe) => probe.analysis!.citations.length > 0);
  return {
    formula_version: "transparent-rates-v1",
    composite_score: null,
    attempted_probes: probes.length,
    valid_probes: valid.length,
    failed_probes: probes.length - valid.length,
    valid_coverage: rate(valid.length, probes.length, "no probe attempts"),
    brand_mention_rate: rate(valid.filter((probe) => probe.analysis!.target_mentioned).length, valid.length),
    active_recommendation_rate: rate(valid.filter((probe) => probe.analysis!.actively_recommended).length, valid.length),
    top_n: { n: topN, metric: rate(observableRank.filter((probe) => probe.analysis!.recommendation_position! <= topN).length, observableRank.length, "recommendation position was not observable") },
    negative_risk_mention_rate: rate(negatives.filter((probe) => probe.analysis!.negative_risk_mentioned).length, negatives.length, "no valid negative-risk probes"),
    citation_observation_rate: rate(withCitation.length, valid.length),
    competitor_distribution: distribution(valid.flatMap((probe) => probe.analysis!.competitors), valid.length),
    source_distribution: distribution(valid.flatMap((probe) => probe.analysis!.citations.map((citation) => citation.domain)), valid.length),
  };
}

export function calculateMetrics(probes: ProbeResult[], topN = 3): DiagnosisMetrics {
  const overall = flatMetrics(probes, topN);
  const platforms = [...new Set(probes.map((probe) => probe.platform))].sort();
  const byPlatform: DiagnosisMetrics["by_platform"] = {};
  for (const platform of platforms) byPlatform[platform] = flatMetrics(probes.filter((probe) => probe.platform === platform), topN);
  return { ...overall, by_platform: byPlatform };
}

function makeGaps(probes: ProbeResult[], seedSet: SeedSet): DiagnosisGap[] {
  const gaps: DiagnosisGap[] = [];
  const valid = probes.filter((probe) => probe.status === "success" && probe.analysis);
  const failures = probes.filter((probe) => probe.status !== "success");
  if (failures.length) gaps.push({
    gap_id: stableId("gap", "probe_coverage", failures.map((probe) => probe.probe_id)),
    kind: "probe_coverage",
    severity: failures.length >= Math.max(2, probes.length / 4) ? "high" : "medium",
    observed_issue: `${failures.length} 次探测失败或不可用，不能当作品牌未提及。`,
    question_ids: [...new Set(failures.map((probe) => probe.question_id))],
    probe_ids: failures.map((probe) => probe.probe_id),
    platforms: [...new Set(failures.map((probe) => probe.platform))],
    competitors: [], sources: [],
    fact_ids: [...new Set(failures.flatMap((probe) => seedSet.questions.find((question) => question.question_id === probe.question_id)?.fact_ids ?? []))],
    recommended_investigation: "先重试或补齐失败探测，再判断可见度。",
  });
  const absent = valid.filter((probe) => probe.question_family !== "negative_risk" && !probe.analysis!.target_mentioned);
  if (absent.length) gaps.push({
    gap_id: stableId("gap", "visibility", absent.map((probe) => probe.probe_id)),
    kind: "visibility", severity: absent.length >= valid.length / 2 ? "high" : "medium",
    observed_issue: `目标品牌在 ${absent.length}/${valid.filter((probe) => probe.question_family !== "negative_risk").length} 条有效正向问题中未被提及。`,
    question_ids: [...new Set(absent.map((probe) => probe.question_id))], probe_ids: absent.map((probe) => probe.probe_id),
    platforms: [...new Set(absent.map((probe) => probe.platform))],
    competitors: [...new Set(absent.flatMap((probe) => probe.analysis!.competitors))],
    sources: [...new Set(absent.flatMap((probe) => probe.analysis!.citations.map((citation) => citation.domain)))],
    fact_ids: [...new Set(absent.flatMap((probe) => seedSet.questions.find((question) => question.question_id === probe.question_id)?.fact_ids ?? []))],
    recommended_investigation: "在后续场景阶段研究 AI 已采用的竞品与来源证据，并核对企业对应事实是否缺少公开可信信源。",
  });
  const mentionedNotRecommended = valid.filter((probe) => probe.question_family !== "negative_risk" && probe.analysis!.target_mentioned && !probe.analysis!.actively_recommended);
  if (mentionedNotRecommended.length) gaps.push({
    gap_id: stableId("gap", "recommendation", mentionedNotRecommended.map((probe) => probe.probe_id)),
    kind: "recommendation", severity: "medium",
    observed_issue: `目标品牌在 ${mentionedNotRecommended.length} 条回答中仅被提及但未被主动推荐。`,
    question_ids: [...new Set(mentionedNotRecommended.map((probe) => probe.question_id))], probe_ids: mentionedNotRecommended.map((probe) => probe.probe_id),
    platforms: [...new Set(mentionedNotRecommended.map((probe) => probe.platform))], competitors: [...new Set(mentionedNotRecommended.flatMap((probe) => probe.analysis!.competitors))],
    sources: [...new Set(mentionedNotRecommended.flatMap((probe) => probe.analysis!.citations.map((citation) => citation.domain)))],
    fact_ids: [...new Set(mentionedNotRecommended.flatMap((probe) => seedSet.questions.find((question) => question.question_id === probe.question_id)?.fact_ids ?? []))],
    recommended_investigation: "研究推荐集合采用的比较维度和证据来源，不把“出现”误当作“推荐”。",
  });
  const risks = valid.filter((probe) => probe.question_family === "negative_risk" && probe.analysis!.negative_risk_mentioned);
  if (risks.length) gaps.push({
    gap_id: stableId("gap", "negative_risk", risks.map((probe) => probe.probe_id)), kind: "negative_risk", severity: "high",
    observed_issue: `${risks.length} 条经批准负面风险题出现目标品牌风险描述。`, question_ids: [...new Set(risks.map((probe) => probe.question_id))],
    probe_ids: risks.map((probe) => probe.probe_id), platforms: [...new Set(risks.map((probe) => probe.platform))], competitors: [],
    sources: [...new Set(risks.flatMap((probe) => probe.analysis!.citations.map((citation) => citation.domain)))],
    fact_ids: [...new Set(risks.flatMap((probe) => seedSet.questions.find((question) => question.question_id === probe.question_id)?.fact_ids ?? []))],
    recommended_investigation: "人工核验负面说法及其来源；未核验前不要公开复述或据此生成内容。",
  });
  return gaps;
}

function pct(metric: RateMetric): string {
  const reasonLabels: Record<string, string> = {
    "no eligible probes": "无有效回答",
    "no valid negative-risk probes": "无有效负面风险回答",
    "recommendation position was not observable": "无可观察排名的有效回答",
    "no probe attempts": "未记录探测",
  };
  const reason = metric.unavailable_reason ? reasonLabels[metric.unavailable_reason] ?? metric.unavailable_reason : "无可用数据";
  return metric.rate == null ? `不可用（${reason}）` : `${(metric.rate * 100).toFixed(1)}%（${metric.numerator}/${metric.denominator}）`;
}

function probeStatusLabel(probe: ProbeResult): string {
  return ({ success: "有效回答", failed: "失败", timeout: "超时", unavailable: "不可用" } as const)[probe.status];
}

function probeResultLabel(probe: ProbeResult, value: boolean | undefined): string {
  if (probe.status !== "success") return "—";
  return value ? "是" : "否";
}

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]!);
}

function reportMarkdown(report: DiagnosisReport): string {
  const valid = report.probes.filter((probe) => probe.status === "success");
  const failed = report.probes.filter((probe) => probe.status !== "success");
  const lines = [
    `# ${report.project_name} · GEO 基线诊断报告`, "",
    "> 本报告只描述本次有证据的基线探测，不代表完整市场，也不会自动生成关键词或文章。", "",
    `- 报告时间：${report.generated_at}`, `- 事实快照：\`${report.fact_snapshot_id}\``, `- 种子题版本：\`${report.seed_set_id}\``, `- 探测运行：\`${report.run_id}\``,
    `- 状态：${report.status}`, "",
    "## 概览", "",
    `- 有效覆盖：${pct(report.metrics.valid_coverage)}`, `- 品牌提及率：${pct(report.metrics.brand_mention_rate)}`, `- 主动推荐率：${pct(report.metrics.active_recommendation_rate)}`,
    `- Top-${report.metrics.top_n.n}：${pct(report.metrics.top_n.metric)}`, `- 负面风险提及率：${pct(report.metrics.negative_risk_mention_rate)}`, `- 有引用回答占比：${pct(report.metrics.citation_observation_rate)}`,
    "- 综合分：未设置。首期只展示可复算的独立指标。", "",
    "## 分平台", "", "| 平台 | 有效/尝试 | 品牌提及 | 主动推荐 | Top-3 | 引用 |", "|---|---:|---:|---:|---:|---:|",
  ];
  for (const [platform, metric] of Object.entries(report.metrics.by_platform)) lines.push(`| ${platform} | ${metric.valid_probes}/${metric.attempted_probes} | ${pct(metric.brand_mention_rate)} | ${pct(metric.active_recommendation_rate)} | ${pct(metric.top_n.metric)} | ${pct(metric.citation_observation_rate)} |`);
  lines.push("", "## 逐题证据", "", "| 平台/模型 | 问题 | 状态 | 说明 | 提及 | 推荐 | 竞品 | 原始快照 |", "|---|---|---|---|---:|---:|---|---|");
  for (const probe of report.probes) lines.push(`| ${probe.platform}/${probe.model ?? "未知"} | ${probe.question_text.replace(/\|/g, "\\|")} | ${probeStatusLabel(probe)} | ${(probe.error?.message ?? "—").replace(/\|/g, "\\|")} | ${probeResultLabel(probe, probe.analysis?.target_mentioned)} | ${probeResultLabel(probe, probe.analysis?.actively_recommended)} | ${probe.analysis?.competitors.join("、") || "—"} | ${probe.raw_snapshot_path ? `\`${probe.raw_snapshot_path}\`` : "—"} |`);
  lines.push("", "## 结构化缺口", "");
  if (!report.gaps.length) lines.push("本次有效证据尚未形成缺口。", "");
  for (const gap of report.gaps) lines.push(`### ${gap.severity.toUpperCase()} · ${gap.kind}`, "", gap.observed_issue, "", `建议调查：${gap.recommended_investigation}`, "");
  lines.push("## 竞品与引用来源", "", "### 竞品出现", "");
  if (!report.metrics.competitor_distribution.length) lines.push(report.metrics.valid_probes ? "有效回答中未观察到竞品。" : "无有效回答，暂时无法判断竞品。", "");
  for (const item of report.metrics.competitor_distribution) lines.push(`- ${item.name}: ${item.count} 次（分母：${item.denominator} 条有效回答）`);
  lines.push("", "### 引用域名", "");
  if (!report.metrics.source_distribution.length) lines.push(report.metrics.valid_probes ? "有效回答中未观察到引用；这可能是平台不展示引用，也可能是回答没有引用。" : "无有效回答，暂时无法观察引用来源。", "");
  for (const item of report.metrics.source_distribution) lines.push(`- ${item.name}: ${item.count} 次（分母：${item.denominator} 条有效回答）`);
  lines.push("", "## 限制与公式", "", ...report.limitations.map((item) => `- ${item}`), "- 所有 rate = numerator / denominator；失败、超时和不可用不进入提及/推荐分母。", `- 有效回答：${valid.length}；失败/超时/不可用：${failed.length}。`, "");
  return lines.join("\n");
}

function reportHtml(report: DiagnosisReport, markdown: string): string {
  const probeRows = report.probes.map((probe) => `<tr><td>${esc(probe.platform)}</td><td>${esc(probe.model ?? "未知")}</td><td>${esc(probe.question_text)}</td><td>${esc(probeStatusLabel(probe))}</td><td>${esc(probe.error?.message ?? "—")}</td><td>${probeResultLabel(probe, probe.analysis?.target_mentioned)}</td><td>${probeResultLabel(probe, probe.analysis?.actively_recommended)}</td><td>${esc(probe.analysis?.competitors.join("、") || "—")}</td></tr>`).join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(report.project_name)} GEO 基线诊断</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#172033;background:#f5f7fb;margin:0}.wrap{max-width:1120px;margin:0 auto;padding:36px 22px}.hero,.card{background:#fff;border:1px solid #dfe5ef;border-radius:14px;padding:24px;margin-bottom:18px}.hero{background:linear-gradient(135deg,#172554,#2563eb);color:#fff}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}.metric{background:#f8fafc;border-radius:10px;padding:16px}.metric b{display:block;font-size:1.55rem;color:#1d4ed8;margin-top:5px}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;padding:10px;border-bottom:1px solid #e5e7eb;vertical-align:top}th{background:#f8fafc}.warn{color:#9a3412}code{word-break:break-all}@media(max-width:700px){.wrap{padding:16px 10px}.card{overflow:auto}}</style></head><body><main class="wrap"><section class="hero"><h1>${esc(report.project_name)} · GEO 基线诊断</h1><p>报告时间 ${esc(report.generated_at)} · 状态 ${esc(report.status)}</p><p>只描述本次可追溯探测，不使用不透明综合分。</p></section><section class="card"><h2>透明指标</h2><div class="grid"><div class="metric">有效覆盖<b>${pct(report.metrics.valid_coverage)}</b></div><div class="metric">品牌提及<b>${pct(report.metrics.brand_mention_rate)}</b></div><div class="metric">主动推荐<b>${pct(report.metrics.active_recommendation_rate)}</b></div><div class="metric">Top-3<b>${pct(report.metrics.top_n.metric)}</b></div><div class="metric">负面风险<b>${pct(report.metrics.negative_risk_mention_rate)}</b></div><div class="metric">引用观察<b>${pct(report.metrics.citation_observation_rate)}</b></div></div></section><section class="card"><h2>逐题证据</h2><table><thead><tr><th>平台</th><th>模型</th><th>精确问题</th><th>状态</th><th>说明</th><th>提及</th><th>推荐</th><th>竞品</th></tr></thead><tbody>${probeRows}</tbody></table></section><section class="card"><h2>缺口</h2>${report.gaps.map((gap) => `<h3>${esc(gap.severity.toUpperCase())} · ${esc(gap.kind)}</h3><p>${esc(gap.observed_issue)}</p><p>建议调查：${esc(gap.recommended_investigation)}</p>`).join("") || "<p>本次有效证据尚未形成缺口。</p>"}</section><section class="card"><h2>限制</h2><ul>${report.limitations.map((item) => `<li>${esc(item)}</li>`).join("")}</ul><details><summary>机器可读 Markdown 内容</summary><pre>${esc(markdown)}</pre></details></section></main></body></html>`;
}

export async function generateDiagnosisReport(projectRoot: string, runId: string): Promise<{ report: DiagnosisReport; jsonPath: string; markdownPath: string; htmlPath: string }> {
  const context = await loadConfirmedDiagnosisContext(projectRoot);
  const runPath = path.join(projectRoot, "diagnosis", "runs", runId, "run.json");
  const run = await readJson<DiagnosisRun>(runPath);
  if (run.fact_snapshot_id !== context.snapshot.fact_snapshot_id) throw new Error("report blocked: diagnosis run references a stale fact snapshot");
  const seedSet = await readJson<SeedSet>(path.join(projectRoot, "diagnosis", "seed-sets", `${run.seed_set_id}.json`));
  const probes = await listProbeResults(projectRoot, runId);
  if (!probes.length) throw new Error("report blocked: no probe attempts recorded");
  const approvedCount = seedSet.questions.filter((question) => question.review_status === "approved").length * run.requested_platforms.length;
  const metrics = calculateMetrics(probes);
  const reportId = stableId("diagnosis_report", runId, probes.map((probe) => [probe.probe_id, probe.raw_content_hash, probe.latest_analysis_revision_id]));
  const limitations = [
    `计划 ${approvedCount} 次题目×平台探测，当前记录 ${probes.length} 次；未记录的组合不计入任何命中率。`,
    "AI 回答具有时间、平台和模型依赖性；本报告只代表保存时间点。",
    "平台未显示引用时，引用指标只能记为未观察到，不能证明回答没有使用来源。",
    "种子题只用于基线诊断，不是正式关键词/场景库。",
  ];
  const errorCounts = new Map<string, number>();
  for (const probe of probes.filter((item) => item.status !== "success" && item.error)) {
    const message = probe.error!.message;
    errorCounts.set(message, (errorCounts.get(message) ?? 0) + 1);
  }
  if (errorCounts.size) limitations.splice(1, 0, ...[...errorCounts].map(([message, count]) => `${count} 次不可用：${message}`));
  const report: DiagnosisReport = {
    schema_version: 1, report_id: reportId, app_id: run.app_id, project_name: path.basename(projectRoot), fact_snapshot_id: run.fact_snapshot_id,
    seed_set_id: run.seed_set_id, run_id: runId, generated_at: utcNow(), status: "review_required", confirmed_at: null,
    limitations_accepted: false, metrics, probes, gaps: makeGaps(probes, seedSet), limitations,
  };
  const base = path.join(projectRoot, "diagnosis", "reports", reportId);
  const jsonPath = `${base}.json`; const markdownPath = `${base}.md`; const htmlPath = `${base}.html`;
  await writeJson(jsonPath, report);
  const markdown = reportMarkdown(report);
  await writeFile(markdownPath, markdown, "utf-8");
  await writeFile(htmlPath, reportHtml(report, markdown), "utf-8");
  run.status = metrics.failed_probes ? "complete_with_failures" : "complete";
  await writeJson(runPath, run);
  const manifestPath = path.join(projectRoot, "manifest.json");
  const manifest = await readJson<Record<string, any>>(manifestPath);
  manifest.gates = manifest.gates ?? {};
  manifest.gates.diagnose = {
    status: "review_required",
    at: null,
    fact_snapshot_id: report.fact_snapshot_id,
    seed_set_id: report.seed_set_id,
    run_id: report.run_id,
    report_id: report.report_id,
    limitations_accepted: false,
  };
  manifest.updated_at = report.generated_at;
  await writeJson(manifestPath, manifest);
  return { report, jsonPath: relToProject(projectRoot, jsonPath), markdownPath: relToProject(projectRoot, markdownPath), htmlPath: relToProject(projectRoot, htmlPath) };
}

export async function confirmDiagnosisReport(projectRoot: string, reportId: string, acceptLimitations = false): Promise<DiagnosisReport> {
  const context = await loadConfirmedDiagnosisContext(projectRoot);
  const reportPath = path.join(projectRoot, "diagnosis", "reports", `${reportId}.json`);
  const report = await readJson<DiagnosisReport>(reportPath);
  if (report.fact_snapshot_id !== context.snapshot.fact_snapshot_id) throw new Error("diagnosis confirmation blocked: report fact snapshot is stale");
  if (report.metrics.failed_probes > 0 && !acceptLimitations) throw new Error("diagnosis confirmation blocked: failed/unavailable probes remain; rerun them or pass --accept-limitations");
  const confirmedAt = utcNow();
  report.status = "confirmed"; report.confirmed_at = confirmedAt; report.limitations_accepted = acceptLimitations;
  await writeJson(reportPath, report);
  const confirmedMarkdown = reportMarkdown(report);
  const reportBase = path.join(projectRoot, "diagnosis", "reports", reportId);
  await writeFile(`${reportBase}.md`, confirmedMarkdown, "utf-8");
  await writeFile(`${reportBase}.html`, reportHtml(report, confirmedMarkdown), "utf-8");
  await writeJson(path.join(projectRoot, "diagnosis", "gaps", `${reportId}.json`), {
    schema_version: 1, report_id: reportId, status: "confirmed", confirmed_at: confirmedAt, gaps: report.gaps,
  });
  const manifestPath = path.join(projectRoot, "manifest.json");
  const manifest = await readJson<Record<string, any>>(manifestPath);
  manifest.gates = manifest.gates ?? {};
  manifest.gates.diagnose = { status: "confirmed", at: confirmedAt, fact_snapshot_id: report.fact_snapshot_id, seed_set_id: report.seed_set_id, run_id: report.run_id, report_id: report.report_id, limitations_accepted: acceptLimitations };
  manifest.updated_at = confirmedAt;
  await writeJson(manifestPath, manifest);
  return report;
}

export async function diagnosisGapInput(projectRoot: string): Promise<string> {
  const manifest = await readJson<Record<string, any>>(path.join(projectRoot, "manifest.json"));
  const gate = manifest.gates?.diagnose;
  if (gate?.status !== "confirmed" || !gate.report_id) throw new Error("formal scenario generation blocked: diagnosis report is not confirmed");
  const gapPath = path.join(projectRoot, "diagnosis", "gaps", `${gate.report_id}.json`);
  if (!(await pathExists(gapPath))) throw new Error("formal scenario generation blocked: confirmed gap artifact is missing");
  return relToProject(projectRoot, gapPath);
}
