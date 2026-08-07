import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { BaseInfoView, ProfileView } from "./fact-layer.js";
import type {
  CleanOverrides,
  ConflictRecord,
  FactLedger,
  FactRecord,
  FindingRecord,
  SourceIndex,
} from "./fact-model.js";
import type { MissingItem } from "./manifest.js";
import type { SkuItem } from "./skus.js";
import { pathExists, readJson } from "./util.js";
import { validateProject } from "./validate.js";

const FIELD_LABELS: Record<string, string> = {
  company_name: "公司全称",
  company_short_name: "公司简称",
  contact_name: "联系人",
  contact_phone: "联系电话",
  address: "地址",
  website_or_shop_url: "官网或店铺",
  region: "地区",
  media_accounts: "媒体账号",
  conversion: "转化联系方式",
  intro: "公司概况",
  products_services: "产品与服务",
  advantages: "企业与供应链优势",
  trust: "信任背书",
  pain_points: "客户与行业痛点",
  name: "产品名称",
  category: "通用品类",
  selling_points: "产品卖点",
  attributes: "产品属性",
  capabilities: "供应与服务能力",
  is_main: "是否主产品",
};

const BASE_FIELDS = [
  "company_name",
  "company_short_name",
  "contact_name",
  "contact_phone",
  "address",
  "region",
  "website_or_shop_url",
  "media_accounts",
  "conversion",
] as const;

function escapeTable(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function valueText(value: unknown, compact = false): string {
  if (value == null || value === "") return "未提供";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (Array.isArray(value)) {
    if (!value.length) return "未提供";
    return value.map((item) => valueText(item, true)).join("；");
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item != null && item !== "" && !(Array.isArray(item) && item.length === 0))
      .map(([key, item]) => `${FIELD_LABELS[key] ?? key}=${valueText(item, true)}`)
      .join("；") || "未提供";
  }
  const text = String(value).trim() || "未提供";
  return compact && text.length > 180 ? `${text.slice(0, 177)}…` : text;
}

function sourceNames(sourceIndex: SourceIndex, refs: string[]): string {
  const byId = new Map(sourceIndex.sources.map((source) => [source.source_id, source.name]));
  const names = [...new Set(refs.map((ref) => byId.get(ref)).filter((name): name is string => Boolean(name)))];
  return names.length ? names.join("、") : "未关联文字来源，需确认";
}

function derivationLabel(fact: FactRecord): string {
  if (fact.derivation === "extracted") return "原件直接提取";
  if (fact.derivation === "inferred") return "Skill 归纳，需确认";
  if (fact.derivation === "operator") return "项目清洗判断，需确认";
  return "旧知识库继承，需确认";
}

function uniqueFindings(items: FindingRecord[]): FindingRecord[] {
  const byCode = new Map<string, FindingRecord>();
  for (const item of items) byCode.set(item.code, item);
  return [...byCode.values()];
}

function bulletList(lines: string[], emptyText = "无"): string {
  return lines.length ? lines.map((line) => `- ${line}`).join("\n") : `- ${emptyText}`;
}

function conflictRows(
  conflicts: ConflictRecord[],
  factById: Map<string, FactRecord>,
): string[] {
  return conflicts.map((conflict) => {
    const candidates = conflict.candidate_fact_ids
      .map((factId) => factById.get(factId))
      .filter((fact): fact is FactRecord => Boolean(fact))
      .map((fact) => valueText(fact.value, true))
      .join(" / ");
    const state = conflict.status === "unresolved" ? "尚未解决" : `已给出处理方案：${conflict.resolution ?? "未写理由"}`;
    return `| ${FIELD_LABELS[conflict.field] ?? conflict.field} | ${escapeTable(candidates)} | ${escapeTable(state)} | ${conflict.status === "unresolved" ? "是" : "仍需确认处理方案"} |`;
  });
}

export async function renderCleanReview(projectRoot: string): Promise<string> {
  const knowledge = path.join(projectRoot, "knowledge");
  const [manifest, sourceIndex, facts, baseinfo, profile, skus, validation] = await Promise.all([
    readJson<Record<string, any>>(path.join(projectRoot, "manifest.json")),
    readJson<SourceIndex>(path.join(knowledge, "source-index.json")),
    readJson<FactLedger>(path.join(knowledge, "company.facts.json")),
    readJson<BaseInfoView>(path.join(knowledge, "company.baseinfo.json")),
    readJson<ProfileView>(path.join(knowledge, "company.profile.json")),
    readJson<{ app_id: string; items: SkuItem[] }>(path.join(knowledge, "company.skus.json")),
    validateProject(projectRoot, true),
  ]);
  const overridePath = path.join(knowledge, "clean.overrides.json");
  const hasOverrides = await pathExists(overridePath);
  const overrides: CleanOverrides = hasOverrides
    ? await readJson<CleanOverrides>(overridePath)
    : { app_id: manifest.app_id as string, assets: [], products: [], fact_resolutions: [] };

  const subjectById = new Map(facts.subjects.map((subject) => [subject.subject_id, subject]));
  const factById = new Map(facts.facts.map((fact) => [fact.fact_id, fact]));
  const importantCandidates = facts.facts.filter((fact) =>
    fact.review_status === "candidate" && ["inferred", "operator", "legacy"].includes(fact.derivation),
  );
  const machineFindings = uniqueFindings([
    ...validation.structural,
    ...validation.referential,
    ...validation.semantic,
    ...validation.security,
  ]);
  const missing = (manifest.missing ?? validation.missing ?? []) as MissingItem[];
  const blockers = [
    ...machineFindings.filter((item) => item.severity === "block"),
    ...missing.filter((item) => item.severity === "block").map((item) => ({
      code: item.code,
      severity: item.severity,
      layer: "semantic" as const,
      message: item.message,
    })),
  ].filter((item, index, all) => all.findIndex((candidate) => candidate.code === item.code) === index);
  const recommendations = [
    ...machineFindings.filter((item) => item.severity !== "block"),
    ...missing.filter((item) => item.severity !== "block").map((item) => ({
      code: item.code,
      severity: item.severity,
      layer: "semantic" as const,
      message: item.message,
    })),
  ].filter((item, index, all) => all.findIndex((candidate) => candidate.code === item.code) === index);
  const gateStatus = manifest.gates?.clean?.status as string | undefined;
  const status = gateStatus === "confirmed"
    ? "已确认，可进入诊断"
    : blockers.length
      ? "暂不能确认：请先修正必须处理项"
      : "机器检查通过，可以提交人工确认";

  const lines: string[] = [];
  lines.push(`# 【${baseinfo.company_short_name || baseinfo.company_name || path.basename(projectRoot)}】企业资料确认清单`);
  lines.push("");
  lines.push(`**当前结论：${status}。**`);
  lines.push("");
  lines.push("这份文件是普通用户的确认入口，不需要打开 JSON。确认范围是下方全部企业与产品内容；其中“重点待确认”是系统归纳或项目清洗判断，应优先核对。");
  lines.push("");
  lines.push("## 1. 您现在需要做什么");
  lines.push("");
  if (blockers.length) {
    lines.push("先处理“必须修正”中的问题，处理完重新运行清洗和本清单；目前不要确认企业事实。");
  } else if (gateStatus === "confirmed") {
    lines.push("企业事实已经确认。后续诊断必须引用本次确认快照；资料变化后应重新清洗和确认。");
  } else {
    lines.push("请重点核对归纳值、冲突处理方案以及企业名片、介绍和产品库。全部正确时回复“确认企业事实”，再运行确认命令。");
  }
  lines.push("");
  lines.push(`- 必须修正：${blockers.length} 项`);
  lines.push(`- 重点待确认：${importantCandidates.length} 项`);
  lines.push(`- 冲突记录：${facts.conflicts.length} 项（未解决 ${facts.conflicts.filter((item) => item.status === "unresolved").length} 项）`);
  lines.push(`- 建议或可选补充：${recommendations.length} 项`);
  lines.push(`- 企业/品牌/产品事实：${facts.facts.length} 条；图片不计入 Facts`);
  lines.push("");
  lines.push("### 必须修正");
  lines.push("");
  lines.push(bulletList(blockers.map((item) => item.message), "无，机器检查未发现阻断项"));
  lines.push("");
  lines.push("### 重点待确认");
  lines.push("");
  if (importantCandidates.length) {
    lines.push("| 对象 | 业务项 | 当前值 | 形成方式与来源 |");
    lines.push("|---|---|---|---|");
    for (const fact of importantCandidates) {
      const subject = subjectById.get(fact.subject_id);
      lines.push(`| ${escapeTable(subject?.name ?? "未知对象")} | ${FIELD_LABELS[fact.field] ?? fact.field} | ${escapeTable(valueText(fact.value, true))} | ${derivationLabel(fact)}；${escapeTable(sourceNames(sourceIndex, fact.source_refs))} |`);
    }
  } else {
    lines.push("- 无单独的归纳或规范化候选；仍需核对下方原件提取内容是否准确。");
  }
  lines.push("");
  lines.push("### 冲突及处理方案");
  lines.push("");
  if (facts.conflicts.length) {
    lines.push("| 业务项 | 候选值 | 当前处理状态 | 是否还要您确认 |");
    lines.push("|---|---|---|---|");
    lines.push(...conflictRows(facts.conflicts, factById));
  } else {
    lines.push("- 无冲突。");
  }
  lines.push("");
  lines.push("### 建议或可选补充（不阻断确认）");
  lines.push("");
  lines.push(bulletList(recommendations.map((item) => item.message), "无"));

  lines.push("");
  lines.push("## 2. 企业名片");
  lines.push("");
  lines.push("| 业务项 | 当前值 | 来源与状态 |");
  lines.push("|---|---|---|");
  const baseRecord = baseinfo as unknown as Record<string, unknown>;
  for (const field of BASE_FIELDS) {
    const refs = baseinfo.fact_refs?.[field] ?? [];
    const supportingFacts = refs.map((ref) => factById.get(ref)).filter((fact): fact is FactRecord => Boolean(fact));
    const state = supportingFacts.length
      ? supportingFacts.map((fact) => `${derivationLabel(fact)}；${sourceNames(sourceIndex, fact.source_refs)}`).join(" / ")
      : "未形成事实记录";
    lines.push(`| ${FIELD_LABELS[field]} | ${escapeTable(valueText(baseRecord[field], true))} | ${escapeTable(state)} |`);
  }
  lines.push("| 密码、Token | 未保存 | 禁止进入知识库 |");

  lines.push("");
  lines.push("## 3. 企业介绍");
  for (const [field, title] of [
    ["intro", "公司概况"],
    ["products_services", "产品与服务"],
    ["advantages", "企业与供应链优势"],
    ["trust", "信任背书"],
    ["pain_points", "客户与行业痛点"],
  ] as const) {
    lines.push("");
    lines.push(`### ${title}`);
    lines.push("");
    const value = profile[field];
    if (Array.isArray(value)) lines.push(bulletList(value, "未提供"));
    else lines.push(value?.trim() || "未提供");
  }

  lines.push("");
  lines.push("## 4. 产品库");
  if (!skus.items.length) {
    lines.push("");
    lines.push("- 尚未形成产品记录。");
  }
  for (const [index, item] of skus.items.entries()) {
    lines.push("");
    lines.push(`### ${index + 1}. ${item.name}${item.is_main ? "（主产品）" : ""}`);
    lines.push("");
    lines.push(`- 通用品类：${item.category || "未提供"}`);
    lines.push(`- 卖点：${item.selling_points.length ? item.selling_points.join("；") : "未提供"}`);
    lines.push(`- 属性：${valueText(item.attributes)}`);
    lines.push(`- 供应与服务能力：${item.capabilities.length ? item.capabilities.join("；") : "未提供"}`);
    lines.push(`- 事实来源：${sourceNames(sourceIndex, item.source_refs)}`);
    lines.push(`- 产品图片：${item.images.length} 张，保存在 ${item.images[0] ? path.dirname(item.images[0].path) : "未建立目录"}`);
    lines.push(`- 内容指令：${item.copy_brief ? "已关联；仅作为后续写作要求，不属于企业事实" : "未关联"}`);
    const decision = overrides.products.find((product) => product.name === item.name);
    if (decision?.reason) lines.push(`- 产品归并理由：${decision.reason}`);
  }

  const inputSources = sourceIndex.sources.filter((source) => source.scope === "input");
  const ignoredSources = inputSources.filter((source) => source.ignored);
  const productImageCount = inputSources.filter((source) => source.kind === "product_image" && !source.ignored).length;
  const companyImageCount = inputSources.filter((source) => source.kind === "company_asset" && !source.ignored).length;
  lines.push("");
  lines.push("## 5. 原始资料、图片与安全处理");
  lines.push("");
  lines.push(`- 原始文件：${inputSources.length} 个；清洗过程不修改 inputs。`);
  lines.push(`- 产品图片：${productImageCount} 张；产品归属记录在 SKU，不进入 Facts。`);
  lines.push(`- 企业环境图片：${companyImageCount} 张；仅作为素材，不自动证明产能或质量。`);
  lines.push(`- 隔离文件：${ignoredSources.length} 个；营业执照、商标证、许可证、身份证和平台注册材料仅保留原件，不复制、不 OCR、不入事实。`);

  lines.push("");
  lines.push("## 6. 确认结果");
  lines.push("");
  if (blockers.length) {
    lines.push("当前不能确认。请先修正必须处理项，然后重新运行：");
    lines.push("");
    lines.push("```bash");
    lines.push(`geo-cli clean --project "${projectRoot}"`);
    lines.push(`geo-cli review-clean --project "${projectRoot}"`);
    lines.push("```");
  } else if (gateStatus === "confirmed") {
    lines.push(`已确认快照：${manifest.gates?.clean?.fact_snapshot_id ?? "未记录"}`);
  } else {
    lines.push("核对无误后，请明确回复：**确认企业事实**。随后运行：");
    lines.push("");
    lines.push("```bash");
    lines.push(`geo-cli confirm-clean --project "${projectRoot}"`);
    lines.push("```");
  }
  lines.push("");
  lines.push("正式 GEO 诊断尚未开始；只有企业事实确认后才能进入诊断。");

  lines.push("");
  lines.push("## 技术附录");
  lines.push("");
  lines.push(`- app_id：${manifest.app_id}`);
  lines.push(`- inputs_hash：${sourceIndex.inputs_hash}`);
  lines.push(`- facts_hash：${facts.facts_hash}`);
  lines.push(`- clean gate：${gateStatus ?? "unknown"}`);
  lines.push(`- Facts 主体：${facts.subjects.length} 个；事实：${facts.facts.length} 条；直接提取：${facts.facts.filter((fact) => fact.derivation === "extracted").length} 条；归纳/项目判断/继承：${importantCandidates.length} 条。`);
  return `${lines.join("\n")}\n`;
}

export async function writeCleanReview(projectRoot: string): Promise<{
  path: string;
  status: string;
}> {
  const outputPath = path.join(projectRoot, "clean-review.md");
  const markdown = await renderCleanReview(projectRoot);
  await writeFile(outputPath, markdown, "utf-8");
  const status = markdown.includes("暂不能确认")
    ? "blocked"
    : markdown.includes("已确认，可进入诊断")
      ? "confirmed"
      : "review_required";
  return { path: outputPath, status };
}
