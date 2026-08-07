import { unlink } from "node:fs/promises";
import path from "node:path";
import { docxPlainText, splitProfileSections } from "./docx.js";
import {
  addLegacyProjectionSources,
  buildFactLayer,
  loadCleanOverrides,
  type BaseInfoView,
  type PreviousCleanViews,
  type ProfileView,
} from "./fact-layer.js";
import { inventory } from "./inventory.js";
import { buildMissing, defaultManifest, ensureAppId, type MissingItem } from "./manifest.js";
import { parseInfoForm, type BaseInfo } from "./parse.js";
import { operatorReviewFindings, semanticFindings } from "./quality.js";
import { sourcePathMatches, syncImagesAndSkus, type SkuItem } from "./skus.js";
import { pathExists, readJson, utcNow, writeJson } from "./util.js";

export interface CleanResult {
  app_id: string;
  inventory: Awaited<ReturnType<typeof inventory>>;
  warnings: string[];
  missing: MissingItem[];
  sku_count: number;
  facts_count: number;
  facts_hash: string;
  review_ready: boolean;
  clean_ready: boolean;
  clean_status: "review_required" | "confirmed";
  preserved_legacy_files: string[];
}

async function readIfExists<T>(filePath: string): Promise<T | undefined> {
  if (!(await pathExists(filePath))) return undefined;
  return readJson<T>(filePath);
}

async function loadPrevious(projectRoot: string): Promise<PreviousCleanViews> {
  const knowledge = path.join(projectRoot, "knowledge");
  return {
    baseinfo: await readIfExists<BaseInfoView>(path.join(knowledge, "company.baseinfo.json")),
    profile: await readIfExists<ProfileView>(path.join(knowledge, "company.profile.json")),
    skus: await readIfExists<{ app_id: string; items: SkuItem[] }>(path.join(knowledge, "company.skus.json")),
    facts: await readIfExists(path.join(knowledge, "company.facts.json")),
  };
}

interface LegacyEvidenceItem {
  path?: string | null;
}

async function removeLegacyEvidenceOutputs(projectRoot: string): Promise<string[]> {
  const evidencePath = path.join(projectRoot, "knowledge", "company.evidence.json");
  if (!(await pathExists(evidencePath))) return [];
  const removed: string[] = [];
  const legacy = await readJson<{ items?: LegacyEvidenceItem[] }>(evidencePath);
  const allowedRoots = [
    path.resolve(projectRoot, "assets", "images", "_trust"),
    path.resolve(projectRoot, "assets", "evidence"),
  ];
  for (const item of legacy.items ?? []) {
    if (!item.path) continue;
    const absolute = path.resolve(projectRoot, item.path);
    if (!allowedRoots.some((root) => absolute.startsWith(`${root}${path.sep}`))) continue;
    if (!(await pathExists(absolute))) continue;
    await unlink(absolute);
    removed.push(item.path);
  }
  await unlink(evidencePath);
  removed.push("knowledge/company.evidence.json");
  return removed;
}

async function removeMisclassifiedDerivedAssets(
  projectRoot: string,
  previousItems: SkuItem[],
  opaqueSourceNames: Set<string>,
): Promise<string[]> {
  const removed: string[] = [];
  const assetsRoot = path.resolve(projectRoot, "assets", "images");
  for (const item of previousItems) {
    for (const image of item.images ?? []) {
      if (!opaqueSourceNames.has(path.basename(image.path))) continue;
      const absolute = path.resolve(projectRoot, image.path);
      if (!absolute.startsWith(`${assetsRoot}${path.sep}`)) continue;
      if (await pathExists(absolute)) {
        await unlink(absolute);
        removed.push(image.path);
      }
    }
  }
  return removed;
}

export async function cleanProject(
  projectRoot: string,
  appIdArg?: string,
): Promise<CleanResult> {
  const appId = await ensureAppId(projectRoot, appIdArg);
  const inv = await inventory(projectRoot);
  inv.source_index.app_id = appId;
  const knowledge = path.join(projectRoot, "knowledge");
  const removedLegacyEvidence = await removeLegacyEvidenceOutputs(projectRoot);
  const previous = await loadPrevious(projectRoot);
  const overrides = await loadCleanOverrides(projectRoot, appId);
  const sourceIndex = await addLegacyProjectionSources(projectRoot, inv.source_index, previous);
  for (const source of sourceIndex.sources) {
    if (source.scope !== "input") continue;
    const override = overrides.assets.find((item) =>
      sourcePathMatches(source.path, item.source_path),
    );
    if (!override) continue;
    source.ignored = override.action === "ignore";
    source.ignored_reason = override.action === "ignore"
      ? override.reason ?? "operator_ignored"
      : null;
    if (override.action !== "ignore") {
      source.parse_status = "indexed_only";
      source.kind = override.action === "company"
          ? "company_asset"
          : override.action === "product"
            ? "product_image"
            : source.kind;
    }
  }
  for (const source of sourceIndex.sources) {
    if (
      source.scope === "input" &&
      overrides.products.some((product) =>
        product.source_paths.some((pattern) => sourcePathMatches(source.path, pattern)),
      )
    ) {
      source.kind = "product_image";
    }
  }

  let warnings: string[] = [];
  if (removedLegacyEvidence.length) {
    warnings.push(`removed_legacy_evidence:${removedLegacyEvidence.join(",")}`);
  }
  let baseinfo: BaseInfoView = {
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
  const formPath = inv.by_kind.info_form?.[0];
  if (formPath) {
    const parsed = parseInfoForm(path.join(projectRoot, "inputs", formPath), appId);
    baseinfo = parsed.baseinfo;
    warnings.push(...parsed.warnings);
  }

  let profile: ProfileView = {
    app_id: appId,
    intro: "",
    products_services: "",
    advantages: "",
    trust: "",
    pain_points: [],
    source: "",
  };
  const kbPathRel = inv.by_kind.knowledge_docx?.[0];
  if (kbPathRel) {
    const kbPath = path.join(projectRoot, "inputs", kbPathRel);
    const sections = splitProfileSections(await docxPlainText(kbPath));
    profile = { app_id: appId, ...sections, source: `docx:${path.basename(kbPath)}` };
  }
  if (overrides.profile) {
    const profileSource = sourceIndex.sources.find((source) =>
      source.scope === "input" && sourcePathMatches(source.path, overrides.profile!.source_path),
    );
    if (!profileSource) throw new Error(`profile override source not found: ${overrides.profile.source_path}`);
    for (const field of ["intro", "products_services", "advantages", "trust", "pain_points"] as const) {
      const value = overrides.profile[field];
      if (value !== undefined) (profile[field] as string | string[]) = value;
    }
    profile.source = `operator:${profileSource.name}`;
  }

  const previousItems = previous.skus?.items ?? [];
  const opaqueSourceNames = new Set(
    sourceIndex.sources
      .filter((source) => source.scope === "input" && source.kind === "unclassified_sensitive")
      .map((source) => source.name),
  );
  const removedAssets = await removeMisclassifiedDerivedAssets(projectRoot, previousItems, opaqueSourceNames);
  if (removedAssets.length) warnings.push(`removed_misclassified_assets:${removedAssets.join(",")}`);

  const skus = await syncImagesAndSkus(
    projectRoot,
    appId,
    sourceIndex,
    overrides,
    previousItems,
  );

  for (const rel of inv.by_kind.instruction_docx ?? []) {
    const instructionPath = path.join(projectRoot, "inputs", rel);
    const brief = (await docxPlainText(instructionPath)).slice(0, 2000);
    const stem = path.basename(instructionPath, path.extname(instructionPath));
    const matched = skus.items.find((item) =>
      stem.replace(/\s/g, "").includes(item.name.replace(/\s/g, "")) ||
      item.name.includes(stem),
    );
    if (matched) matched.copy_brief = brief;
    else warnings.push(`instruction_without_product:${rel}`);
  }

  const layer = await buildFactLayer({
    projectRoot,
    appId,
    sourceIndex,
    baseinfo,
    profile,
    skus,
    factResolutions: overrides.fact_resolutions,
    profileDerivation: overrides.profile ? "operator" : "extracted",
    previous,
  });
  const findings = semanticFindings({
    profile: layer.profile,
    skus: layer.skus.items,
    facts: layer.facts,
    sourceIndex,
  });
  findings.push(...operatorReviewFindings(overrides));
  let missing = buildMissing(layer.baseinfo as BaseInfo, layer.profile, layer.skus.items, inv.has_chat_logs, findings);
  if (warnings.some((warning) => warning.startsWith("password_stripped:"))) missing.push({
    code: "secrets_stripped",
    severity: "recommend",
    message: "收集表中的平台密码已剥离，未写入 knowledge；请使用项目 .secrets.env 或环境变量。",
  });
  const ignoredSensitive = sourceIndex.sources.filter(
    (item) =>
      item.scope === "input" &&
      item.ignored &&
      (item.kind === "legal_id" || item.kind === "unclassified_sensitive"),
  );
  if (ignoredSensitive.length) missing.push({
    code: "sensitive_inputs_reviewed",
    severity: "optional",
    message: `当前有 ${ignoredSensitive.length} 个身份证、注册材料或不透明命名文件仅保留在 inputs；清洗不会复制、OCR 或写入企业事实。`,
  });

  const previousManifest = await readIfExists<Record<string, any>>(path.join(projectRoot, "manifest.json"));
  const baseline = defaultManifest(projectRoot, appId, missing) as Record<string, any>;
  const previousClean = previousManifest?.gates?.clean;
  const recoverableSnapshotId =
    previousClean?.fact_snapshot_id ??
    previousManifest?.clean_pipeline?.previous_snapshot_id ??
    null;
  const recoverableSnapshot = recoverableSnapshotId
    ? await readIfExists<{
        fact_snapshot_id: string;
        confirmed_at: string;
        inputs_hash: string;
        facts_hash: string;
        facts: typeof layer.facts;
      }>(path.join(knowledge, "snapshots", `${recoverableSnapshotId}.json`))
    : undefined;
  const unchangedConfirmed =
    recoverableSnapshot?.inputs_hash === sourceIndex.inputs_hash &&
    recoverableSnapshot?.facts_hash === layer.facts.facts_hash;
  if (unchangedConfirmed && recoverableSnapshot) {
    layer.facts = recoverableSnapshot.facts;
  }
  const blockCount = missing.filter((item) => item.severity === "block").length;
  const legacyNames = [
    "company.keywords.json",
    "company.faq.json",
    "company.prompts.json",
    "company.generation_plan.json",
  ];
  const preservedLegacyFiles: string[] = [];
  for (const name of legacyNames) if (await pathExists(path.join(knowledge, name))) preservedLegacyFiles.push(`knowledge/${name}`);

  const manifest: Record<string, any> = {
    ...baseline,
    ...(previousManifest ?? {}),
    app_id: appId,
    project_name: path.basename(projectRoot),
    gates: {
      ...baseline.gates,
      ...(previousManifest?.gates ?? {}),
      clean: unchangedConfirmed
        ? {
            status: "confirmed",
            at: recoverableSnapshot!.confirmed_at,
            fact_snapshot_id: recoverableSnapshot!.fact_snapshot_id,
          }
        : { status: "review_required", at: null, fact_snapshot_id: null },
      diagnose: unchangedConfirmed
        ? (previousManifest?.gates?.diagnose ?? baseline.gates.diagnose)
        : baseline.gates.diagnose,
    },
    missing,
    clean_pipeline: {
      stage: unchangedConfirmed ? "confirmed" : "review",
      inputs_hash: sourceIndex.inputs_hash,
      facts_hash: layer.facts.facts_hash,
      changed_since_confirmation: !unchangedConfirmed,
      previous_snapshot_id: previousClean?.fact_snapshot_id ?? null,
    },
    clean_ready: unchangedConfirmed,
    review_ready: blockCount === 0,
    legacy_downstream_artifacts: preservedLegacyFiles,
    updated_at: utcNow(),
  };

  await writeJson(path.join(knowledge, "source-index.json"), sourceIndex);
  await writeJson(path.join(knowledge, "company.baseinfo.json"), layer.baseinfo);
  await writeJson(path.join(knowledge, "company.profile.json"), layer.profile);
  await writeJson(path.join(knowledge, "company.skus.json"), layer.skus);
  await writeJson(path.join(knowledge, "company.facts.json"), layer.facts);
  await writeJson(path.join(projectRoot, "manifest.json"), manifest);

  return {
    app_id: appId,
    inventory: inv,
    warnings,
    missing,
    sku_count: layer.skus.items.length,
    facts_count: layer.facts.facts.length,
    facts_hash: layer.facts.facts_hash,
    review_ready: blockCount === 0,
    clean_ready: unchangedConfirmed,
    clean_status: unchangedConfirmed ? "confirmed" : "review_required",
    preserved_legacy_files: preservedLegacyFiles,
  };
}
