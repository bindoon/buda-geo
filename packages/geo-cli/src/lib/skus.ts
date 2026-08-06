import { readdir } from "node:fs/promises";
import path from "node:path";
import { LEGAL_ID_RE } from "./constants.js";
import type { CleanOverrides, ProductOverride, SourceIndex } from "./fact-model.js";
import { copyIfMissing, relToProject } from "./util.js";

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
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(full);
    }
  }
  await walk(dir);
  return out;
}

function normalizeSourcePath(value: string): string {
  return value.replace(/^inputs\//, "").split(path.sep).join("/");
}

export function sourcePathMatches(sourcePath: string, pattern: string): boolean {
  const source = normalizeSourcePath(sourcePath);
  const normalizedPattern = normalizeSourcePath(pattern);
  if (normalizedPattern.endsWith("/**")) {
    const prefix = normalizedPattern.slice(0, -3).replace(/\/$/, "");
    return source === prefix || source.startsWith(`${prefix}/`);
  }
  return source === normalizedPattern;
}

export async function syncImagesAndSkus(
  projectRoot: string,
  appId: string,
  sourceIndex: SourceIndex,
  overrides: CleanOverrides,
  previousItems: SkuItem[] = [],
): Promise<{ app_id: string; items: SkuItem[] }> {
  const inputs = path.join(projectRoot, "inputs");
  const assets = path.join(projectRoot, "assets", "images");
  const companyDir = path.join(assets, "_company");
  const trustDir = path.join(assets, "_trust");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(companyDir, { recursive: true });
  await mkdir(trustDir, { recursive: true });

  const sourceByPath = new Map(
    sourceIndex.sources.map((source) => [normalizeSourcePath(source.path), source]),
  );
  const assetForSource = (sourcePath: string) =>
    overrides.assets.find((override) => sourcePathMatches(sourcePath, override.source_path));
  const productForSource = (sourcePath: string): ProductOverride | undefined =>
    overrides.products.find((product) =>
      product.source_paths.some((pattern) => sourcePathMatches(sourcePath, pattern)),
    );
  const productByName = new Map(overrides.products.map((product) => [product.name, product]));
  const previousByName = new Map(previousItems.map((item) => [item.name, item]));
  const skuMap = new Map<string, SkuImage[]>();
  const usedDestinations = new Set<string>();
  const imageExts = new Set([".jpg", ".jpeg", ".png", ".webp"]);

  for (const absolute of (await walkImages(inputs)).sort()) {
    if (!imageExts.has(path.extname(absolute).toLowerCase())) continue;
    const name = path.basename(absolute);
    if (name.startsWith("~$") || name === ".DS_Store" || LEGAL_ID_RE.test(name)) continue;
    const relInput = path.relative(inputs, absolute).split(path.sep).join("/");
    const source = sourceByPath.get(relInput);
    if (!source) continue;
    const assetOverride = assetForSource(relInput);
    const productOverride = productForSource(relInput);
    if (assetOverride?.action === "ignore") continue;
    if (source.ignored && !assetOverride && !productOverride) continue;

    if (assetOverride?.action === "company") {
      await copyIfMissing(absolute, path.join(companyDir, name));
      continue;
    }
    if (assetOverride?.action === "evidence") {
      await copyIfMissing(absolute, path.join(trustDir, name));
      continue;
    }
    // An unreviewed image remains only in the source index. CLI must not turn a
    // filename or folder into a business product without a Skill/operator decision.
    if (!productOverride && assetOverride?.action !== "product") continue;

    const productName =
      productOverride?.name ??
      assetOverride?.product_name;
    if (!productName) continue;
    let destination = path.join(assets, productName, name);
    const destinationKey = destination.toLowerCase();
    if (usedDestinations.has(destinationKey)) {
      destination = path.join(assets, productName, `${source.source_id}_${name}`);
    }
    usedDestinations.add(destination.toLowerCase());
    await copyIfMissing(absolute, destination);
    const image: SkuImage = {
      path: relToProject(projectRoot, destination),
      role: /主图|(?:^|[^0-9])01(?:[^0-9]|$)/.test(name) ? "main" : "detail",
      url: null,
      source_ref: source.source_id,
    };
    skuMap.set(productName, [...(skuMap.get(productName) ?? []), image]);
  }

  const items = [...skuMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "zh-CN"))
    .map(([name, images]): SkuItem => {
      const semantic = productByName.get(name);
      const previous = previousByName.get(name);
      return {
        sku_id: previous?.sku_id ?? `sku_${name}`,
        name,
        category: semantic?.category ?? previous?.category ?? "",
        selling_points: semantic?.selling_points ?? previous?.selling_points ?? [],
        attributes: semantic?.attributes ?? previous?.attributes ?? {},
        capabilities: semantic?.capabilities ?? previous?.capabilities ?? [],
        is_main: semantic?.is_main ?? previous?.is_main ?? false,
        source_refs: [...new Set(images.map((image) => image.source_ref))],
        fact_refs: previous?.fact_refs ?? [],
        copy_brief: previous?.copy_brief ?? null,
        images,
      };
    });
  return { app_id: appId, items };
}
