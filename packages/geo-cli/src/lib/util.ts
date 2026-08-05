import { mkdir, readFile, writeFile, copyFile, access } from "node:fs/promises";
import path from "node:path";

export async function writeJson(filePath: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

export async function readJson<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

export function relToProject(projectRoot: string, absPath: string): string {
  return path.relative(projectRoot, absPath).split(path.sep).join("/");
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export async function copyIfMissing(src: string, dest: string): Promise<void> {
  if (await pathExists(dest)) return;
  await mkdir(path.dirname(dest), { recursive: true });
  await copyFile(src, dest);
}

export function utcNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function cellStr(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

export function uniq(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}
