import path from "node:path";
import { DEFAULT_PROMPTS } from "./constants.js";
import { appIdForDir } from "./registry.js";
import { readJson } from "./util.js";
import type { BaseInfo } from "./parse.js";
import type { KeywordsJson } from "./parse.js";
import { utcNow } from "./util.js";

export interface MissingItem {
  code: string;
  severity: "block" | "recommend" | "optional";
  message: string;
}

export async function ensureAppId(
  projectRoot: string,
  appId?: string,
): Promise<string> {
  if (appId) return appId;
  const name = path.basename(projectRoot);
  const fromReg = await appIdForDir(name);
  if (fromReg) return fromReg;
  try {
    const m = (await readJson(path.join(projectRoot, "manifest.json"))) as {
      app_id?: string;
    };
    if (m.app_id) return m.app_id;
  } catch {
    /* no manifest yet */
  }
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 24);
  return slug ? `app_${slug}` : "app_unknown";
}

export function buildMissing(
  baseinfo: BaseInfo,
  profile: { intro?: string },
  keywords: KeywordsJson,
  hasChat: boolean,
): MissingItem[] {
  const missing: MissingItem[] = [];
  if (!baseinfo.company_name) {
    missing.push({
      code: "company_name",
      severity: "block",
      message: "缺少公司名称，无法确认主体。",
    });
  }
  if (!baseinfo.website_or_shop_url) {
    missing.push({
      code: "shop_or_website",
      severity: "block",
      message: "缺少官网或 1688 店铺链接。",
    });
  }
  const intro = profile.intro ?? "";
  if (intro.length < 100) {
    missing.push({
      code: "profile_intro_short",
      severity: "block",
      message: `公司介绍过短（${intro.length} 字），请补充知识库画像至 ≥100 字。`,
    });
  }
  const terms = keywords.search?.terms ?? [];
  const qs = keywords.qa?.questions ?? [];
  if (!terms.length && !qs.length) {
    missing.push({
      code: "keywords_empty",
      severity: "recommend",
      message: "未解析到关键词/问题库；可从知识库正文补词或提供词表 xlsx。",
    });
  }
  if (!hasChat) {
    missing.push({
      code: "chat_logs",
      severity: "recommend",
      message:
        "未提供客服/询盘记录；不阻断。补充后可优化 FAQ 与 prompts/generation_plan。",
    });
  }
  return missing;
}

export function defaultFaq(appId: string) {
  return { app_id: appId, items: [], status: "empty" };
}

export function defaultPrompts(appId: string) {
  return { app_id: appId, templates: DEFAULT_PROMPTS, source: "default_template" };
}

export function defaultPlan(appId: string) {
  return { app_id: appId, tasks: [] as unknown[] };
}

export function defaultManifest(
  projectRoot: string,
  appId: string,
  missing: MissingItem[],
) {
  return {
    app_id: appId,
    project_name: path.basename(projectRoot),
    gates: {
      clean: { status: "pending", at: null, by: null },
      diagnose: { status: "pending", at: null, by: null },
      write_social: { status: "pending", at: null, by: null },
      publish: { status: "pending", at: null, by: null },
    },
    missing,
    quota: {
      articles_generated: 0,
      articles_published: 0,
      diagnose_questions: 0,
      targets: {
        articles_year: 1500,
        social_year: 750,
        diagnose_questions: 500,
      },
    },
    updated_at: utcNow(),
  };
}
