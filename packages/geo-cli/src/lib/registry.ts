import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface RegistryProject {
  dir: string;
  app_id: string;
  aliases?: string[];
  notes?: string;
}

export interface Registry {
  version: number;
  projects: RegistryProject[];
}

const PKG_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const REPO_ROOT = path.resolve(PKG_ROOT, "../..");
const REGISTRY_PATH = path.join(REPO_ROOT, "projects/registry.json");

export function repoRoot(): string {
  return REPO_ROOT;
}

export async function loadRegistry(): Promise<Registry> {
  const raw = await fs.readFile(REGISTRY_PATH, "utf8");
  return JSON.parse(raw) as Registry;
}

export function projectPath(dir: string): string {
  return path.join(REPO_ROOT, "projects", dir);
}

export interface ResolvedProject {
  dir: string;
  app_id: string;
  path: string;
  match: "dir" | "app_id" | "alias" | "partial";
  notes?: string;
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

export function resolveQuery(
  registry: Registry,
  query: string,
): { ok: true; project: ResolvedProject } | { ok: false; candidates: ResolvedProject[] } {
  const q = query.trim();
  if (!q) {
    return { ok: false, candidates: listProjects(registry) };
  }

  const nq = normalize(q);

  for (const p of registry.projects) {
    if (p.dir === q || normalize(p.dir) === nq) {
      return {
        ok: true,
        project: {
          dir: p.dir,
          app_id: p.app_id,
          path: projectPath(p.dir),
          match: "dir",
          notes: p.notes,
        },
      };
    }
    if (p.app_id === q || normalize(p.app_id) === nq) {
      return {
        ok: true,
        project: {
          dir: p.dir,
          app_id: p.app_id,
          path: projectPath(p.dir),
          match: "app_id",
          notes: p.notes,
        },
      };
    }
    for (const alias of p.aliases ?? []) {
      if (alias === q || normalize(alias) === nq) {
        return {
          ok: true,
          project: {
            dir: p.dir,
            app_id: p.app_id,
            path: projectPath(p.dir),
            match: "alias",
            notes: p.notes,
          },
        };
      }
    }
  }

  const partial: ResolvedProject[] = [];
  for (const p of registry.projects) {
    const hay = [p.dir, p.app_id, ...(p.aliases ?? [])].map(normalize);
    if (hay.some((h) => h.includes(nq) || nq.includes(h))) {
      partial.push({
        dir: p.dir,
        app_id: p.app_id,
        path: projectPath(p.dir),
        match: "partial",
        notes: p.notes,
      });
    }
  }

  if (partial.length === 1) {
    return { ok: true, project: partial[0]! };
  }

  return { ok: false, candidates: partial.length ? partial : listProjects(registry) };
}

export function listProjects(registry: Registry): ResolvedProject[] {
  return registry.projects.map((p) => ({
    dir: p.dir,
    app_id: p.app_id,
    path: projectPath(p.dir),
    match: "dir" as const,
    notes: p.notes,
  }));
}

export async function appIdForDir(dirName: string): Promise<string | undefined> {
  try {
    const reg = await loadRegistry();
    return reg.projects.find((p) => p.dir === dirName)?.app_id;
  } catch {
    return undefined;
  }
}
