import path from "node:path";
import { docxPlainText, splitProfileSections } from "./docx.js";
import { inventory } from "./inventory.js";
import {
  buildMissing,
  defaultFaq,
  defaultManifest,
  defaultPlan,
  defaultPrompts,
  ensureAppId,
} from "./manifest.js";
import { parseInfoForm, parseKeywords } from "./parse.js";
import type { BaseInfo, KeywordsJson } from "./parse.js";
import { syncImagesAndSkus } from "./skus.js";
import { writeJson } from "./util.js";

export interface CleanResult {
  app_id: string;
  inventory: Awaited<ReturnType<typeof inventory>>;
  warnings: string[];
  missing: ReturnType<typeof buildMissing>;
  sku_count: number;
  clean_ready: boolean;
}

export async function cleanProject(
  projectRoot: string,
  appIdArg?: string,
): Promise<CleanResult> {
  const appId = await ensureAppId(projectRoot, appIdArg);
  const inv = await inventory(projectRoot);
  const knowledge = path.join(projectRoot, "knowledge");

  let warnings: string[] = [];
  let baseinfo: BaseInfo = {
    app_id: appId,
    company_name: "",
    company_short_name: "",
    contact_name: "",
    contact_phone: "",
    address: "",
    website_or_shop_url: "",
    region: "",
    media_accounts: [],
    conversion: {},
    credentials: [],
  };

  const formPaths = inv.by_kind.info_form ?? [];
  if (formPaths[0]) {
    const parsed = parseInfoForm(path.join(projectRoot, "inputs", formPaths[0]), appId);
    baseinfo = parsed.baseinfo;
    warnings = parsed.warnings;
  }

  let keywords: KeywordsJson = {
    app_id: appId,
    brand: { terms: [], questions: [] },
    search: { terms: [], expanded: [], questions: [] },
    qa: { questions: [] },
    intent: { questions: [] },
    source: "",
  };

  const kwPaths = inv.by_kind.keywords ?? [];
  if (kwPaths[0]) {
    keywords = parseKeywords(path.join(projectRoot, "inputs", kwPaths[0]), appId);
  }

  if (baseinfo.company_short_name) {
    keywords.brand.terms = [baseinfo.company_short_name];
    keywords.brand.questions = [
      `${baseinfo.company_short_name}厂家靠谱吗`,
      `${baseinfo.company_short_name}是源头工厂吗`,
    ];
  }

  let profile = {
    app_id: appId,
    intro: "",
    products_services: "",
    advantages: "",
    trust: "",
    pain_points: [] as string[],
    source: "",
  };

  const kbPaths = inv.by_kind.knowledge_docx ?? [];
  if (kbPaths[0]) {
    const kbPath = path.join(projectRoot, "inputs", kbPaths[0]);
    const text = await docxPlainText(kbPath);
    const sections = splitProfileSections(text);
    profile = { ...profile, ...sections, source: `docx:${path.basename(kbPath)}` };
    const m = text.match(/优化关键词[：:]\s*([^\n]+)/);
    if (m && !keywords.search.terms.length) {
      keywords.search.terms = m[1]
        .split(/[、,，/]/)
        .map((p) => p.trim())
        .filter(Boolean);
      keywords.source = keywords.source || "profile_header";
    }
  }

  const skus = await syncImagesAndSkus(projectRoot, appId);

  for (const rel of inv.by_kind.instruction_docx ?? []) {
    const ip = path.join(projectRoot, "inputs", rel);
    const brief = (await docxPlainText(ip)).slice(0, 2000);
    const stem = path.basename(ip, path.extname(ip));
    let matched = false;
    for (const item of skus.items) {
      if (
        stem.replace(/\s/g, "").includes(item.name.replace(/\s/g, "")) ||
        item.name.includes(stem)
      ) {
        item.copy_brief = brief;
        matched = true;
        break;
      }
    }
    if (!matched) {
      skus.items.push({
        sku_id: `sku_${stem}`,
        name: stem,
        category: "",
        selling_points: [],
        copy_brief: brief,
        images: [],
      });
    }
  }

  const faq = defaultFaq(appId);
  const prompts = defaultPrompts(appId);
  const plan = defaultPlan(appId);

  const topTerms = keywords.search.terms.filter((t) => t && t.length <= 40).slice(0, 5);
  for (let i = 0; i < topTerms.length; i++) {
    const term = topTerms[i];
    (plan.tasks as object[]).push({
      task_id: `t_search_${String(i + 1).padStart(2, "0")}`,
      keyword_group_id: `kg_${term}`,
      channels: ["social", "media"],
      use_knowledge: true,
      limit: 20,
      produced_count: 0,
      prompt_template_id: "eeat_intro_advantage_faq",
    });
  }

  let missing = buildMissing(baseinfo, profile, keywords, inv.has_chat_logs);
  if (warnings.length) {
    missing.push({
      code: "secrets_stripped",
      severity: "recommend",
      message:
        "收集表中的平台密码已剥离，未写入 knowledge；请使用本地 secrets 管理。" +
        (warnings.length ? ` ${warnings.slice(0, 5).join(",")}` : ""),
    });
  }
  if (inv.ignored.length) {
    missing.push({
      code: "legal_id_ignored",
      severity: "optional",
      message: `已忽略法人身份证等文件 ${inv.ignored.length} 个（不入库、不进文章）。`,
    });
  }

  await writeJson(path.join(knowledge, "company.baseinfo.json"), baseinfo);
  await writeJson(path.join(knowledge, "company.profile.json"), profile);
  await writeJson(path.join(knowledge, "company.skus.json"), skus);
  await writeJson(path.join(knowledge, "company.keywords.json"), keywords);
  await writeJson(path.join(knowledge, "company.faq.json"), faq);
  await writeJson(path.join(knowledge, "company.prompts.json"), prompts);
  await writeJson(path.join(knowledge, "company.generation_plan.json"), plan);

  const manifest = defaultManifest(projectRoot, appId, missing) as Record<string, unknown>;
  const cleanReady = !missing.some((m) => m.severity === "block");
  manifest.clean_ready = cleanReady;
  await writeJson(path.join(projectRoot, "manifest.json"), manifest);

  return {
    app_id: appId,
    inventory: inv,
    warnings,
    missing,
    sku_count: skus.items.length,
    clean_ready: cleanReady,
  };
}
