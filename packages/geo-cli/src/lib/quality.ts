import path from "node:path";
import type { FactLedger, FindingRecord, SourceIndex } from "./fact-model.js";
import type { ProfileView } from "./fact-layer.js";
import type { SkuItem } from "./skus.js";

function hashLike(value: string): boolean {
  return /^[0-9a-f-]{16,}$/i.test(value.replace(/^sku_/, ""));
}

export function semanticFindings(args: {
  profile: ProfileView;
  skus: SkuItem[];
  facts: FactLedger;
  sourceIndex: SourceIndex;
}): FindingRecord[] {
  const { profile, skus, facts, sourceIndex } = args;
  const findings: FindingRecord[] = [];
  if (skus.length > 0 && !skus.some((item) => item.is_main)) {
    findings.push({
      code: "main_product_missing",
      severity: "block",
      layer: "semantic",
      message: "尚未由 Skill/运营标记主产品；CLI 不会根据客户名或产品词硬编码推断。",
    });
  }
  for (const item of skus) {
    if (hashLike(item.name) || hashLike(item.sku_id)) {
      findings.push({
        code: `product_hash_name:${item.sku_id}`,
        severity: "block",
        layer: "semantic",
        message: `产品名称疑似文件哈希：${item.name}。请将图片归为产品、企业资料或忽略。`,
        refs: [item.sku_id],
      });
    }
    if (item.is_main) {
      const hasSubstance = item.selling_points.length > 0 || item.capabilities.length > 0 || Object.keys(item.attributes).length > 0;
      if (!item.category || !hasSubstance) {
        findings.push({
          code: `main_product_substance:${item.sku_id}`,
          severity: "block",
          layer: "semantic",
          message: `主产品“${item.name}”缺少${!item.category ? "分类" : "属性、能力或可核验卖点"}，不能只凭图片确认。`,
          refs: [item.sku_id],
        });
      }
    }
  }

  const normalized = new Map<string, SkuItem[]>();
  for (const item of skus) {
    const key = item.name.replace(/[\s_-]/g, "").toLowerCase();
    normalized.set(key, [...(normalized.get(key) ?? []), item]);
  }
  for (const duplicates of normalized.values()) {
    if (duplicates.length > 1) findings.push({
      code: `duplicate_product:${duplicates[0]!.name}`,
      severity: "block",
      layer: "semantic",
      message: `发现重复产品主体：${duplicates.map((item) => item.name).join("、")}。`,
      refs: duplicates.map((item) => item.sku_id),
    });
  }

  const profileBlob = [profile.intro, profile.products_services, profile.advantages, profile.trust, ...profile.pain_points].join("\n");
  if (/联系人|联系我们|电话[：:]|https?:\/\/|1688\.com/i.test(profileBlob)) findings.push({
    code: "profile_contact_leak",
    severity: "recommend",
    layer: "semantic",
    message: "介绍文案仍含联系方式或网址；联系方式只应保留在 company.baseinfo.json。",
  });
  if (!profile.trust.trim() && /信任背书|CE\s*认证|商标|专利/.test(profile.advantages)) findings.push({
    code: "profile_trust_misbucket",
    severity: "block",
    layer: "semantic",
    message: "信任背书仍混在 advantages，trust 为空。",
  });
  if (!profile.pain_points.length && /用户痛点|客户痛点|行业痛点/.test(profile.advantages)) findings.push({
    code: "profile_pain_points_misbucket",
    severity: "block",
    layer: "semantic",
    message: "痛点内容仍混在 advantages，pain_points 为空。",
  });

  for (const conflict of facts.conflicts.filter((item) => item.status === "unresolved")) findings.push({
    code: `unresolved_conflict:${conflict.conflict_id}`,
    severity: conflict.severity,
    layer: "semantic",
    message: `事实冲突未解决：${conflict.field}。`,
    refs: conflict.candidate_fact_ids,
  });

  const linkedSources = new Set<string>();
  for (const item of skus) for (const sourceRef of item.source_refs) linkedSources.add(sourceRef);
  for (const source of sourceIndex.sources) {
    if (source.scope !== "input" || source.kind !== "image" || source.ignored) continue;
    if (!linkedSources.has(source.source_id)) findings.push({
      code: `orphan_image:${source.source_id}`,
      severity: "recommend",
      layer: "referential",
      message: `图片尚未关联产品或企业素材：${path.basename(source.path)}。`,
      refs: [source.source_id],
    });
  }
  return findings;
}
