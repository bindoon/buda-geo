import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { KNOWLEDGE_FILES } from "./constants.js";
import type { MissingItem } from "./manifest.js";
import { pathExists, readJson } from "./util.js";

const require = createRequire(import.meta.url);
const Ajv = require("ajv/dist/2020") as typeof import("ajv/dist/2020.js").default;
const addFormats = require("ajv-formats") as (ajv: InstanceType<typeof Ajv>) => void;

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCHEMAS_DIR = path.join(PACKAGE_ROOT, "schemas");

async function loadSchema(name: string): Promise<object> {
  const raw = await readFile(path.join(SCHEMAS_DIR, name), "utf-8");
  return JSON.parse(raw) as object;
}

function formatAjvErrors(errors: { instancePath: string; message?: string }[]): string[] {
  return errors.map((e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`);
}

export interface ValidateResult {
  ok: boolean;
  errors: string[];
  missing: MissingItem[];
}

export async function validateProject(
  projectRoot: string,
  strictClean = true,
): Promise<ValidateResult> {
  const errors: string[] = [];
  const knowledge = path.join(projectRoot, "knowledge");
  const manifestPath = path.join(projectRoot, "manifest.json");

  if (!(await pathExists(manifestPath))) {
    return { ok: false, errors: ["missing manifest.json"], missing: [] };
  }

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);

  const manifest = await readJson<{
    app_id: string;
    missing?: MissingItem[];
    gates?: { clean?: { status?: string } };
  }>(manifestPath);

  const missing = manifest.missing ?? [];
  const appId = manifest.app_id;

  const manifestSchema = await loadSchema("manifest.schema.json");
  const validateManifest = ajv.compile(manifestSchema);
  if (!validateManifest(manifest)) {
    errors.push(
      ...formatAjvErrors(validateManifest.errors ?? []).map((e) => `manifest: ${e}`),
    );
  }

  for (const [fname, schemaName] of Object.entries(KNOWLEDGE_FILES)) {
    const fpath = path.join(knowledge, fname);
    if (!(await pathExists(fpath))) {
      errors.push(`missing ${fname}`);
      continue;
    }
    const data = await readJson<Record<string, unknown>>(fpath);
    if (data.app_id !== appId) {
      errors.push(`${fname}: app_id mismatch (${data.app_id} != ${appId})`);
    }
    const schema = await loadSchema(schemaName);
    const validate = ajv.compile(schema);
    if (!validate(data)) {
      errors.push(
        ...formatAjvErrors(validate.errors ?? []).map((e) => `${fname}: ${e}`),
      );
    }

    if (fname === "company.skus.json") {
      const items = (data.items as { sku_id?: string; images?: { path?: string }[] }[]) ?? [];
      for (const item of items) {
        for (const img of item.images ?? []) {
          if (!img.path) {
            errors.push(`skus: image missing path in ${item.sku_id}`);
            continue;
          }
          if (!(await pathExists(path.join(projectRoot, img.path)))) {
            errors.push(`skus: path not found: ${img.path}`);
          }
        }
      }
    }

    if (fname === "company.baseinfo.json") {
      const accounts =
        (data.media_accounts as { password?: string }[] | undefined) ?? [];
      for (const acc of accounts) {
        if ("password" in acc) {
          errors.push("baseinfo: password field forbidden in media_accounts");
        }
      }
    }
  }

  const blocks = missing.filter((m) => m.severity === "block");
  if (strictClean) {
    for (const b of blocks) {
      errors.push(`block missing: ${b.code}: ${b.message}`);
    }
  }
  if (manifest.gates?.clean?.status === "confirmed" && blocks.length) {
    errors.push("gates.clean=confirmed but block missing remain");
  }

  return { ok: errors.length === 0, errors, missing };
}

export function printValidate(result: ValidateResult): void {
  if (!result.ok) {
    console.log("VALIDATE FAIL");
    for (const e of result.errors) console.log(`  - ${e}`);
  } else {
    console.log("VALIDATE OK");
  }
  if (result.missing.length) {
    console.log("MISSING:");
    for (const m of result.missing) {
      console.log(`  [${m.severity}] ${m.code}: ${m.message}`);
    }
  }
}
