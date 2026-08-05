import path from "node:path";
import { readdir, stat } from "node:fs/promises";
import { LEGAL_ID_RE } from "./constants.js";
import { copyIfMissing, relToProject } from "./util.js";

function isCompanyImage(name: string): boolean {
  return /大门|车间|仓库|组装|模具|电机|厂房|办公|公司/.test(name);
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
}

export interface SkuItem {
  sku_id: string;
  name: string;
  category: string;
  selling_points: string[];
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

  const allImages = await walkImages(inputs);
  for (const abs of allImages.sort()) {
    const ext = path.extname(abs).toLowerCase();
    if (!imageExts.has(ext)) continue;
    const name = path.basename(abs);
    if (name.startsWith("~$") || name === ".DS_Store") continue;
    if (LEGAL_ID_RE.test(name)) continue;

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

    const parent = path.basename(path.dirname(abs));
    let sku: string;
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
    const img: SkuImage = { path: relToProject(projectRoot, dest), role, url: null };
    if (!skuMap.has(sku)) skuMap.set(sku, []);
    skuMap.get(sku)!.push(img);
  }

  const items: SkuItem[] = [...skuMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "zh-CN"))
    .map(([name, images]) => ({
      sku_id: `sku_${name}`,
      name,
      category: "",
      selling_points: [],
      copy_brief: null,
      images,
    }));

  return { app_id: appId, items };
}
