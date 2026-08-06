import path from "node:path";
import { appIdForDir } from "./registry.js";
import { readJson } from "./util.js";
import type { BaseInfo } from "./parse.js";
import type { FindingRecord } from "./fact-model.js";
import type { SkuItem } from "./skus.js";
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
  profile: {
    intro?: string;
    products_services?: string;
    advantages?: string;
    trust?: string;
  },
  skus: SkuItem[],
  hasChat: boolean,
  findings: FindingRecord[] = [],
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
  // Profile should be narrative; contact fields live in baseinfo.
  const blob = `${profile.intro ?? ""}\n${profile.products_services ?? ""}\n${profile.advantages ?? ""}\n${profile.trust ?? ""}`;
  if (
    /联系人|联系我们|电话[：:]|https?:\/\/|1688\.com/.test(blob) &&
    (baseinfo.contact_phone || baseinfo.website_or_shop_url)
  ) {
    missing.push({
      code: "profile_contact_leak",
      severity: "recommend",
      message:
        "画像(profile)里仍含电话/链接/联系人；请删掉，统一只留在 baseinfo（名片）。",
    });
  }
  if (!(profile.advantages ?? "").trim() || !(profile.trust ?? "").trim()) {
    missing.push({
      code: "profile_sections_thin",
      severity: "recommend",
      message:
        "画像未拆全：advantages（优势）或 trust（信任背书）为空。请按标题拆段，勿把整篇 Word 塞进 intro/products_services。",
    });
  }
  if (!skus.length) missing.push({ code: "products_empty", severity: "block", message: "未识别到产品主体。" });
  if (!hasChat) {
    missing.push({
      code: "chat_logs",
      severity: "recommend",
      message: "未提供客服/询盘记录；不阻断企业事实确认，后续可用于丰富客户问法。",
    });
  }
  for (const finding of findings) {
    if (!missing.some((item) => item.code === finding.code)) {
      missing.push({ code: finding.code, severity: finding.severity, message: finding.message });
    }
  }
  return missing;
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
      clean: { status: "review_required", at: null, fact_snapshot_id: null },
      diagnose: { status: "pending", at: null, by: null },
      write_social: { status: "pending", at: null, by: null },
      publish: { status: "pending", at: null, by: null },
    },
    missing,
    clean_pipeline: {
      stage: "review",
      inputs_hash: null,
      facts_hash: null,
      changed_since_confirmation: true,
      previous_snapshot_id: null,
    },
    clean_ready: false,
    review_ready: false,
    legacy_downstream_artifacts: [],
    updated_at: utcNow(),
  };
}
