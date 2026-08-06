import path from "node:path";
import { readdir } from "node:fs/promises";
import { LEGAL_ID_RE } from "./constants.js";
import type { AssetOverride, SourceIndex } from "./fact-model.js";
import { copyIfMissing, relToProject } from "./util.js";

function isCompanyImage(name: string): boolean {
  return /大门|车间|仓库|组装|模具|电机|厂房|办公|公司|拉力机|测功机|流水线|设备/.test(name);
}

function isOpaqueImage(name: string): boolean {
  return /^[0-9a-f-]{16,}\.(?:jpe?g|png|webp)$/i.test(name);
}

function skuNameFromFilename(name: string): string {
  let stem = path.basename(name, path.extname(name));
  stem = stem.replace(/^\d+\s*/, "");
  stem = stem.replace(/0[1-9]$/, "");
  stem = stem.replace(/(01|03|04|05)款$/, "");
  stem = stem.replace(/款$/, "");
  stem = stem.trim().replace(/^[_-]+|[_-]+$/g, "");
  if (stem.includes("修枝剪")) return "电动修枝剪";
  if (stem.includes("水管剪")) return "水管剪";
  if (stem.includes("大蒜剪")) return "大蒜剪";
  if (stem.includes("甘蔗剪")) return "甘蔗剪";
  if (stem.includes("注塑箱")) return "注塑箱";
  if (stem.includes("整套") || stem.includes("整机")) return "整机套装";
  return stem || "未命名";
}

export interface SkuImage {
  path: string;
  role: string;
  url: null;
  source_ref: string;
}

export interface SkuItem {
  sku_id: string;
  name: string;
  category: string;
  selling_points: string[];
  attributes: Record<string, string | number | boolean>;
  capabilities: string[];
  is_main: boolean;
  source_refs: string[];
  fact_refs: string[];
  copy_brief: string | null;
  images: SkuImage[];
}

async function walkImages(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(current, e.name);
      if (e.isDirectory()) await walk(full);
      else out.push(full);
    }
  }
  await walk(dir);
  return out;
}

export async function syncImagesAndSkus(
  projectRoot: string,
  appId: string,
  sourceIndex: SourceIndex,
  overrides: AssetOverride[] = [],
  previousItems: SkuItem[] = [],
  profileText = "",
): Promise<{ app_id: string; items: SkuItem[] }> {
  const inputs = path.join(projectRoot, "inputs");
  const assets = path.join(projectRoot, "assets", "images");
  const companyDir = path.join(assets, "_company");
  const trustDir = path.join(assets, "_trust");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(companyDir, { recursive: true });
  await mkdir(trustDir, { recursive: true });

  const skuMap = new Map<string, SkuImage[]>();
  const imageExts = new Set([".jpg", ".jpeg", ".png", ".webp"]);
  const sourceByPath = new Map(
    sourceIndex.sources.map((source) => [source.path.replace(/^inputs\//, ""), source]),
  );
  const overrideByPath = new Map(
    overrides.map((override) => [override.source_path.replace(/^inputs\//, ""), override]),
  );
  const previousByName = new Map(previousItems.map((item) => [item.name, item]));

  const allImages = await walkImages(inputs);
  for (const abs of allImages.sort()) {
    const ext = path.extname(abs).toLowerCase();
    if (!imageExts.has(ext)) continue;
    const name = path.basename(abs);
    if (name.startsWith("~$") || name === ".DS_Store") continue;
    if (LEGAL_ID_RE.test(name)) continue;
    const relInput = path.relative(inputs, abs).split(path.sep).join("/");
    const source = sourceByPath.get(relInput);
    if (!source) continue;
    const override = overrideByPath.get(relInput);
    if (override?.action === "ignore" || source.ignored && !override) continue;

    if (override?.action === "company") {
      await copyIfMissing(abs, path.join(companyDir, name));
      continue;
    }
    if (override?.action === "evidence") {
      await copyIfMissing(abs, path.join(trustDir, name));
      continue;
    }

    if (isCompanyImage(name)) {
      const dest = path.join(companyDir, name);
      await copyIfMissing(abs, dest);
      continue;
    }
    if (/营业执照|执照/.test(name)) {
      const dest = path.join(trustDir, name);
      await copyIfMissing(abs, dest);
      continue;
    }
    // Opaque root images can contain licenses, platform forms, or personal IDs.
    // They require a project-local override before any derived copy is made.
    if (isOpaqueImage(name) && !override) continue;

    const parent = path.basename(path.dirname(abs));
    let sku: string;
    if (override?.action === "product" && override.product_name) {
      sku = override.product_name;
    } else
    if (
      ["inputs", "华远GEO信息", "图片", "产品图片", "整理图片"].includes(parent) ||
      parent.startsWith("华远")
    ) {
      sku = skuNameFromFilename(name);
    } else if (/^[0-9a-f-]{16,}$/i.test(parent)) {
      sku = skuNameFromFilename(name);
    } else {
      sku = parent.trim();
      if (sku.length > 40) sku = skuNameFromFilename(name);
    }

    const destDir = path.join(assets, sku);
    await mkdir(destDir, { recursive: true });
    const dest = path.join(destDir, name);
    await copyIfMissing(abs, dest);
    const role = /主图|01/.test(name) ? "main" : "detail";
    const img: SkuImage = {
      path: relToProject(projectRoot, dest),
      role,
      url: null,
      source_ref: source.source_id,
    };
    if (!skuMap.has(sku)) skuMap.set(sku, []);
    skuMap.get(sku)!.push(img);
  }

  const items: SkuItem[] = [...skuMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "zh-CN"))
    .map(([name, images]) => {
      const previous = previousByName.get(name);
      const category = categoryForProduct(name, previous?.category ?? "");
      const extracted = substanceForProduct(name, profileText);
      const isMain = productMentioned(name, profileText) && !/套装|注塑箱|配件/.test(name);
      return {
        sku_id: previous?.sku_id ?? `sku_${name}`,
        name,
        category,
        selling_points:
          previous?.selling_points?.length ? previous.selling_points : extracted.sellingPoints,
        attributes: { ...(previous?.attributes ?? {}), ...extracted.attributes },
        capabilities:
          previous?.capabilities?.length ? previous.capabilities : extracted.capabilities,
        is_main: previous?.is_main ?? isMain,
        source_refs: [...new Set(images.map((image) => image.source_ref))],
        fact_refs: previous?.fact_refs ?? [],
        copy_brief: previous?.copy_brief ?? null,
        images,
      };
    });

  return { app_id: appId, items };
}

function categoryForProduct(name: string, previous: string): string {
  if (previous) return previous;
  if (/修枝剪|电动剪刀|高枝剪/.test(name)) return "园林电动剪切工具";
  if (/水管剪/.test(name)) return "管材剪切工具";
  if (/大蒜剪|甘蔗剪/.test(name)) return "农业剪切工具";
  if (/注塑箱|套装/.test(name)) return "工具配件与套装";
  return "";
}

function productMentioned(name: string, text: string): boolean {
  if (!text) return false;
  if (text.includes(name)) return true;
  return name === "电动修枝剪" && /园林电动剪刀|修枝剪/.test(text);
}

function substanceForProduct(
  name: string,
  text: string,
): {
  sellingPoints: string[];
  attributes: Record<string, string | number | boolean>;
  capabilities: string[];
} {
  const sellingPoints: string[] = [];
  const attributes: Record<string, string | number | boolean> = {};
  const capabilities: string[] = [];
  if (productMentioned(name, text)) capabilities.push("生产供应");
  if (/修枝剪/.test(name)) {
    if (/SK5/.test(text)) {
      attributes.blade_material = "SK5高碳钢";
      sellingPoints.push("SK5高碳钢刀片");
    }
    if (/3\s*[-—–至]\s*4\s*小时/.test(text)) {
      attributes.runtime = "3-4小时";
      sellingPoints.push("单块电池约可连续工作3-4小时");
    }
    if (/25[、,，\s]+30[、,，\s]+40/.test(text)) {
      attributes.opening_specs = "25/30/40";
      sellingPoints.push("提供25、30、40多种开口规格");
    }
    if (/OEM|ODM|定制/i.test(text)) capabilities.push("OEM/ODM定制");
  }
  return {
    sellingPoints: [...new Set(sellingPoints)],
    attributes,
    capabilities: [...new Set(capabilities)],
  };
}
