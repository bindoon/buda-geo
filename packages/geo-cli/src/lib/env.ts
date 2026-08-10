import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathExists } from "./util.js";

function parseEnv(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const sourceLine of raw.split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[match[1]] = value.replace(/\\n/g, "\n");
  }
  return out;
}

async function findUp(start: string, name: string): Promise<string | null> {
  let current = path.resolve(start);
  while (true) {
    const candidate = path.join(current, name);
    if (await pathExists(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export async function loadLocalEnv(projectRoot?: string): Promise<string[]> {
  const candidates: string[] = [];
  if (projectRoot) {
    const projectSecrets = path.join(projectRoot, ".secrets.env");
    if (await pathExists(projectSecrets)) candidates.push(projectSecrets);
    const repositoryEnv = await findUp(projectRoot, ".env");
    if (repositoryEnv && !candidates.includes(repositoryEnv)) candidates.push(repositoryEnv);
  }
  const cwdEnv = await findUp(process.cwd(), ".env");
  if (cwdEnv && !candidates.includes(cwdEnv)) candidates.push(cwdEnv);
  const loaded: string[] = [];
  for (const file of candidates) {
    const values = parseEnv(await readFile(file, "utf-8"));
    for (const [key, value] of Object.entries(values)) if (process.env[key] === undefined) process.env[key] = value;
    loaded.push(file);
  }
  return loaded;
}

export async function findRepositoryFile(projectRoot: string, relativePath: string): Promise<string | null> {
  let current = path.resolve(projectRoot);
  while (true) {
    const candidate = path.join(current, relativePath);
    if (await pathExists(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
