import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  CHAT_RE,
  FORM_RE,
  KB_RE,
  KW_RE,
  LEGAL_ID_RE,
} from "./constants.js";
import { appIdForDir } from "./registry.js";
import { digestObject, stableId, type SourceIndex, type SourceRecord } from "./fact-model.js";
import { utcNow } from "./util.js";

export type FileKind =
  | "legal_id"
  | "info_form"
  | "keywords"
  | "knowledge_docx"
  | "instruction_docx"
  | "chat_logs"
  | "image"
  | "video"
  | "archive"
  | "unclassified_sensitive"
  | "other";

export interface ClassifiedFile {
  path: string;
  name: string;
  kind: FileKind;
  ignored?: boolean;
  reason?: string;
  source_id?: string;
  hash?: string;
  size?: number;
  parse_status?: SourceRecord["parse_status"];
}

export interface InventoryReport {
  project: string;
  app_id?: string;
  counts: Record<string, number>;
  by_kind: Record<string, string[]>;
  ignored: ClassifiedFile[];
  has_chat_logs: boolean;
  files: ClassifiedFile[];
  inputs_hash: string;
  source_index: SourceIndex;
}

function classifyFile(rel: string, name: string, parts: string[]): ClassifiedFile {
  const item: ClassifiedFile = { path: rel, name, kind: "other" };
  const ext = path.extname(name).toLowerCase();

  if (name === ".DS_Store" || name.startsWith("~$")) {
    return { ...item, ignored: true, reason: "system_or_temporary_file" };
  }

  if (
    LEGAL_ID_RE.test(name) ||
    (parts.length <= 2 && parts.slice(0, -1).some((part) => LEGAL_ID_RE.test(part)))
  ) {
    return { ...item, kind: "legal_id", ignored: true, reason: "legal_id_skip" };
  }
  if ([".xlsx", ".xls"].includes(ext) && FORM_RE.test(name)) {
    return { ...item, kind: "info_form" };
  }
  if ([".xlsx", ".xls"].includes(ext) && KW_RE.test(name)) {
    return { ...item, kind: "keywords" };
  }
  if ([".docx", ".doc"].includes(ext) && KB_RE.test(name)) {
    return { ...item, kind: "knowledge_docx" };
  }
  if ([".docx", ".doc"].includes(ext) && parts.includes("指令")) {
    return { ...item, kind: "instruction_docx" };
  }
  if (CHAT_RE.test(name) || CHAT_RE.test(rel)) {
    return { ...item, kind: "chat_logs" };
  }
  if ([".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext)) {
    const stem = path.basename(name, ext);
    if (parts.length <= 2 && /^[0-9a-f-]{16,}$/i.test(stem)) {
      return {
        ...item,
        kind: "unclassified_sensitive",
        ignored: true,
        reason: "opaque_root_image_review",
      };
    }
    return { ...item, kind: "image" };
  }
  if ([".mp4", ".mov"].includes(ext)) {
    return { ...item, kind: "video" };
  }
  if (ext === ".zip") {
    return { ...item, kind: "archive" };
  }
  return item;
}

async function walkFiles(dir: string): Promise<string[]> {
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

export async function inventory(projectRoot: string): Promise<InventoryReport> {
  const inputs = path.join(projectRoot, "inputs");
  if (!(await stat(inputs).catch(() => null))) {
    throw new Error(`missing inputs/: ${inputs}`);
  }

  const files: ClassifiedFile[] = [];
  const all = await walkFiles(inputs);
  for (const abs of all.sort()) {
    const name = path.basename(abs);
    const rel = path.relative(inputs, abs).split(path.sep).join("/");
    const parts = rel.split("/");
    const item = classifyFile(rel, name, parts);
    const data = await readFile(abs);
    const hash = digestObject(data.toString("base64"));
    const info = await stat(abs);
    const parseStatus: SourceRecord["parse_status"] = item.ignored
      ? "ignored"
      : ["info_form", "knowledge_docx", "instruction_docx", "chat_logs"].includes(
            item.kind,
          )
        ? "extractable"
        : ["image", "video", "keywords"].includes(item.kind)
          ? "indexed_only"
          : "discovered";
    files.push({
      ...item,
      source_id: stableId("src", rel),
      hash,
      size: info.size,
      parse_status: parseStatus,
    });
  }

  const by_kind: Record<string, string[]> = {};
  const ignored: ClassifiedFile[] = [];
  for (const f of files) {
    if (!by_kind[f.kind]) by_kind[f.kind] = [];
    by_kind[f.kind].push(f.path);
    if (f.ignored) ignored.push(f);
  }

  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(by_kind)) counts[k] = v.length;

  const appId = await appIdForDir(path.basename(projectRoot));
  const sources: SourceRecord[] = files.map((f) => ({
    source_id: f.source_id!,
    scope: "input",
    path: `inputs/${f.path}`,
    name: f.name,
    kind: f.kind,
    hash: f.hash!,
    size: f.size!,
    parse_status: f.parse_status!,
    ignored: Boolean(f.ignored),
    ignored_reason: f.reason ?? null,
  }));
  const inputsHash = digestObject(
    sources.map((s) => ({ path: s.path, hash: s.hash })),
  );
  const sourceIndex: SourceIndex = {
    app_id: appId ?? "",
    generated_at: utcNow(),
    inputs_hash: inputsHash,
    sources,
  };

  return {
    project: path.basename(projectRoot),
    app_id: appId,
    counts,
    by_kind,
    ignored,
    has_chat_logs: Boolean(by_kind.chat_logs?.length),
    files,
    inputs_hash: inputsHash,
    source_index: sourceIndex,
  };
}
