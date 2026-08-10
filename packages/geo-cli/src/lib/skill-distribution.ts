import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_NAME = "buda-skills";
const SKILL_REPOSITORY = "bindoon/buda-geo";
const MANIFEST_FILE = "skill.manifest.json";
const MANAGED_FILE = ".geo-cli-managed.json";
const MAX_FILES = 500;
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
const REMOTE_TIMEOUT_MS = 120_000;

export interface SkillManifest {
  schema_version: 1;
  name: typeof SKILL_NAME;
  version: string;
  source: typeof SKILL_REPOSITORY;
  requires_geo_cli: {
    min: string;
    max_exclusive: string;
  };
}

export interface SkillCandidate {
  dir: string;
  manifest: SkillManifest;
  content_hash: string;
  file_count: number;
  total_bytes: number;
}

interface ManagedRecord {
  schema_version: 1;
  skill_name: typeof SKILL_NAME;
  source: "github" | "bundled";
  repository: typeof SKILL_REPOSITORY;
  skill_version: string;
  installed_by_cli_version: string;
  content_hash: string;
  installed_at: string;
}

export interface SkillStatus {
  skill_name: typeof SKILL_NAME;
  target: string;
  installed: boolean;
  managed: boolean;
  healthy: boolean;
  source: "github" | "bundled" | null;
  skill_version: string | null;
  installed_by_cli_version: string | null;
  current_cli_version: string;
  content_hash: string | null;
  error: string | null;
}

export interface RemoteSkillResult {
  dir: string;
  cleanup?: () => Promise<void>;
}

export interface SkillSyncOptions {
  offline?: boolean;
  force?: boolean;
  targetRoot?: string;
  bundledSource?: string;
  cliVersion?: string;
  remoteFetcher?: () => Promise<RemoteSkillResult>;
  now?: () => Date;
}

export interface SkillSyncResult {
  ok: true;
  operation: "install" | "update";
  action: "installed" | "updated" | "unchanged" | "kept";
  source: "github" | "bundled";
  fallback: boolean;
  remote_error: string | null;
  backup_path: string | null;
  status: SkillStatus;
}

interface Semver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

function parseSemver(input: string): Semver {
  const matched = input.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!matched) throw new Error(`invalid semantic version: ${input}`);
  return {
    major: Number(matched[1]),
    minor: Number(matched[2]),
    patch: Number(matched[3]),
    prerelease: matched[4]?.split(".") ?? [],
  };
}

function compareIdentifiers(left: string, right: string): number {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) return Number(left) - Number(right);
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return left.localeCompare(right);
}

function compareSemver(left: string, right: string): number {
  const a = parseSemver(left);
  const b = parseSemver(right);
  for (const key of ["major", "minor", "patch"] as const) {
    if (a[key] !== b[key]) return a[key] - b[key];
  }
  if (!a.prerelease.length && !b.prerelease.length) return 0;
  if (!a.prerelease.length) return 1;
  if (!b.prerelease.length) return -1;
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    if (a.prerelease[index] === undefined) return -1;
    if (b.prerelease[index] === undefined) return 1;
    const compared = compareIdentifiers(a.prerelease[index], b.prerelease[index]);
    if (compared !== 0) return compared;
  }
  return 0;
}

function assertCompatible(manifest: SkillManifest, cliVersion: string): void {
  const { min, max_exclusive: maxExclusive } = manifest.requires_geo_cli;
  parseSemver(manifest.version);
  if (compareSemver(min, maxExclusive) >= 0) {
    throw new Error(`${SKILL_NAME} ${manifest.version} has an invalid geo-cli compatibility range`);
  }
  if (compareSemver(cliVersion, min) < 0 || compareSemver(cliVersion, maxExclusive) >= 0) {
    throw new Error(
      `${SKILL_NAME} ${manifest.version} requires geo-cli >=${min} <${maxExclusive}; current ${cliVersion}`,
    );
  }
}

async function pathState(target: string): Promise<"missing" | "directory" | "other"> {
  try {
    const stat = await lstat(target);
    return stat.isDirectory() && !stat.isSymbolicLink() ? "directory" : "other";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

function validateManifest(value: unknown): SkillManifest {
  if (!value || typeof value !== "object") throw new Error(`${MANIFEST_FILE} must contain an object`);
  const manifest = value as Partial<SkillManifest>;
  if (manifest.schema_version !== 1) throw new Error(`${MANIFEST_FILE} schema_version must be 1`);
  if (manifest.name !== SKILL_NAME) throw new Error(`${MANIFEST_FILE} name must be ${SKILL_NAME}`);
  if (manifest.source !== SKILL_REPOSITORY) throw new Error(`${MANIFEST_FILE} source must be ${SKILL_REPOSITORY}`);
  if (typeof manifest.version !== "string") throw new Error(`${MANIFEST_FILE} version is required`);
  if (!manifest.requires_geo_cli || typeof manifest.requires_geo_cli !== "object") {
    throw new Error(`${MANIFEST_FILE} requires_geo_cli is required`);
  }
  if (typeof manifest.requires_geo_cli.min !== "string" || typeof manifest.requires_geo_cli.max_exclusive !== "string") {
    throw new Error(`${MANIFEST_FILE} requires_geo_cli min/max_exclusive are required`);
  }
  return manifest as SkillManifest;
}

async function collectFiles(root: string): Promise<{ relative: string; absolute: string; size: number }[]> {
  const files: { relative: string; absolute: string; size: number }[] = [];
  let total = 0;

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (!relative || relative.startsWith("../") || path.isAbsolute(relative)) {
        throw new Error(`unsafe candidate path: ${relative}`);
      }
      if (entry.isSymbolicLink()) throw new Error(`candidate contains symbolic link: ${relative}`);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!entry.isFile()) throw new Error(`candidate contains non-regular file: ${relative}`);
      const stat = await lstat(absolute);
      total += stat.size;
      files.push({ relative, absolute, size: stat.size });
      if (files.length > MAX_FILES) throw new Error(`candidate exceeds ${MAX_FILES} files`);
      if (total > MAX_TOTAL_BYTES) throw new Error(`candidate exceeds ${MAX_TOTAL_BYTES} bytes`);
    }
  }

  await walk(root);
  return files;
}

export async function validateSkillCandidate(dir: string, cliVersion: string): Promise<SkillCandidate> {
  if ((await pathState(dir)) !== "directory") throw new Error(`Skill candidate directory not found: ${dir}`);
  const files = await collectFiles(dir);
  const included = files.filter((file) => file.relative !== MANAGED_FILE);
  const skill = included.find((file) => file.relative === "SKILL.md");
  const manifestEntry = included.find((file) => file.relative === MANIFEST_FILE);
  if (!skill) throw new Error("Skill candidate is missing SKILL.md");
  if (!manifestEntry) throw new Error(`Skill candidate is missing ${MANIFEST_FILE}`);

  const skillText = await readFile(skill.absolute, "utf8");
  const frontmatter = skillText.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatter || !/^name:\s*buda-skills\s*$/m.test(frontmatter[1])) {
    throw new Error("SKILL.md frontmatter name must be buda-skills");
  }

  const manifest = validateManifest(await readJson<unknown>(manifestEntry.absolute));
  assertCompatible(manifest, cliVersion);

  const digest = createHash("sha256");
  for (const file of included) {
    digest.update(file.relative);
    digest.update("\0");
    digest.update(await readFile(file.absolute));
    digest.update("\0");
  }
  return {
    dir,
    manifest,
    content_hash: digest.digest("hex"),
    file_count: included.length,
    total_bytes: included.reduce((sum, file) => sum + file.size, 0),
  };
}

function modulePackageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

export function resolveBundledSkillSource(): string {
  const packageRoot = modulePackageRoot();
  const packaged = path.join(packageRoot, "bundled-skills", SKILL_NAME);
  return process.env.GEO_CLI_BUNDLED_SKILL_DIR || packaged;
}

async function existingBundledSkillSource(explicit?: string): Promise<string> {
  if (explicit) return explicit;
  const primary = resolveBundledSkillSource();
  if ((await pathState(primary)) === "directory") return primary;
  const repository = path.resolve(modulePackageRoot(), "../../skills", SKILL_NAME);
  if ((await pathState(repository)) === "directory") return repository;
  throw new Error("bundled buda-skills snapshot is missing from the geo-cli package");
}

export async function currentCliVersion(): Promise<string> {
  const packageJson = await readJson<{ version?: string }>(path.join(modulePackageRoot(), "package.json"));
  if (!packageJson.version) throw new Error("geo-cli package version is missing");
  parseSemver(packageJson.version);
  return packageJson.version;
}

function defaultTargetRoot(): string {
  return path.join(os.homedir(), ".agents", "skills");
}

function targetPath(targetRoot?: string): string {
  return path.join(path.resolve(targetRoot ?? defaultTargetRoot()), SKILL_NAME);
}

async function readManagedRecord(target: string): Promise<ManagedRecord | null> {
  try {
    const record = await readJson<ManagedRecord>(path.join(target, MANAGED_FILE));
    if (
      record.schema_version !== 1
      || record.skill_name !== SKILL_NAME
      || !["github", "bundled"].includes(record.source)
      || record.repository !== SKILL_REPOSITORY
      || typeof record.skill_version !== "string"
      || typeof record.installed_by_cli_version !== "string"
      || !/^[a-f0-9]{64}$/.test(record.content_hash)
      || typeof record.installed_at !== "string"
    ) return null;
    return record;
  } catch {
    return null;
  }
}

export async function inspectSkill(options: Pick<SkillSyncOptions, "targetRoot" | "cliVersion"> = {}): Promise<SkillStatus> {
  const cliVersion = options.cliVersion ?? await currentCliVersion();
  const target = targetPath(options.targetRoot);
  const state = await pathState(target);
  if (state === "missing") {
    return {
      skill_name: SKILL_NAME,
      target,
      installed: false,
      managed: false,
      healthy: false,
      source: null,
      skill_version: null,
      installed_by_cli_version: null,
      current_cli_version: cliVersion,
      content_hash: null,
      error: null,
    };
  }
  if (state !== "directory") {
    return {
      skill_name: SKILL_NAME,
      target,
      installed: true,
      managed: false,
      healthy: false,
      source: null,
      skill_version: null,
      installed_by_cli_version: null,
      current_cli_version: cliVersion,
      content_hash: null,
      error: "target is not a regular directory",
    };
  }

  const record = await readManagedRecord(target);
  if (!record) {
    return {
      skill_name: SKILL_NAME,
      target,
      installed: true,
      managed: false,
      healthy: false,
      source: null,
      skill_version: null,
      installed_by_cli_version: null,
      current_cli_version: cliVersion,
      content_hash: null,
      error: "target is not managed by geo-cli",
    };
  }

  try {
    const candidate = await validateSkillCandidate(target, cliVersion);
    const healthy = candidate.content_hash === record.content_hash
      && candidate.manifest.version === record.skill_version;
    return {
      skill_name: SKILL_NAME,
      target,
      installed: true,
      managed: true,
      healthy,
      source: record.source,
      skill_version: candidate.manifest.version,
      installed_by_cli_version: record.installed_by_cli_version,
      current_cli_version: cliVersion,
      content_hash: candidate.content_hash,
      error: healthy ? null : "managed Skill content hash or version does not match its install record",
    };
  } catch (error) {
    return {
      skill_name: SKILL_NAME,
      target,
      installed: true,
      managed: true,
      healthy: false,
      source: record.source,
      skill_version: record.skill_version,
      installed_by_cli_version: record.installed_by_cli_version,
      current_cli_version: cliVersion,
      content_hash: null,
      error: (error as Error).message,
    };
  }
}

async function spawnSkillsCli(home: string): Promise<void> {
  const executable = process.platform === "win32" ? "npx.cmd" : "npx";
  const args = [
    "--yes",
    "skills@1",
    "add",
    SKILL_REPOSITORY,
    "--global",
    "--agent",
    "codex",
    "--skill",
    SKILL_NAME,
    "--yes",
    "--copy",
    "--full-depth",
  ];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: home,
      shell: false,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        XDG_CONFIG_HOME: path.join(home, ".config"),
        XDG_CACHE_HOME: path.join(home, ".cache"),
        npm_config_cache: path.join(home, ".npm-cache"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const append = (chunk: Buffer): void => {
      if (output.length < 1_000_000) output += chunk.toString("utf8");
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const timer = setTimeout(() => child.kill("SIGTERM"), REMOTE_TIMEOUT_MS);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`skills@1 exited with ${code ?? signal ?? "unknown"}: ${output.trim() || "no output"}`));
    });
  });
}

export async function fetchRemoteSkill(): Promise<RemoteSkillResult> {
  const temporaryHome = await mkdtemp(path.join(os.tmpdir(), "geo-cli-skills-"));
  try {
    await spawnSkillsCli(temporaryHome);
    const candidates = [
      path.join(temporaryHome, ".agents", "skills", SKILL_NAME),
      path.join(temporaryHome, ".codex", "skills", SKILL_NAME),
    ];
    for (const candidate of candidates) {
      if ((await pathState(candidate)) !== "missing") {
        const resolved = await realpath(candidate);
        return {
          dir: resolved,
          cleanup: () => rm(temporaryHome, { recursive: true, force: true }),
        };
      }
    }
    throw new Error("skills@1 completed without producing buda-skills");
  } catch (error) {
    await rm(temporaryHome, { recursive: true, force: true });
    throw error;
  }
}

function managedRecord(
  candidate: SkillCandidate,
  source: "github" | "bundled",
  cliVersion: string,
  now: Date,
): ManagedRecord {
  return {
    schema_version: 1,
    skill_name: SKILL_NAME,
    source,
    repository: SKILL_REPOSITORY,
    skill_version: candidate.manifest.version,
    installed_by_cli_version: cliVersion,
    content_hash: candidate.content_hash,
    installed_at: now.toISOString(),
  };
}

async function activateCandidate(args: {
  candidate: SkillCandidate;
  source: "github" | "bundled";
  current: SkillStatus;
  force: boolean;
  cliVersion: string;
  targetRoot?: string;
  now: Date;
}): Promise<{ action: "installed" | "updated" | "unchanged"; backup: string | null }> {
  const target = targetPath(args.targetRoot);
  if (args.current.installed && !args.current.managed && !args.force) {
    throw new Error(`${target} already exists and is not managed by geo-cli; rerun with --force to preserve it as a backup`);
  }
  if (
    args.current.healthy
    && args.current.content_hash === args.candidate.content_hash
    && args.current.source === args.source
  ) return { action: "unchanged", backup: null };

  const parent = path.dirname(target);
  await mkdir(parent, { recursive: true });
  const stageParent = await mkdtemp(path.join(parent, `.${SKILL_NAME}-stage-`));
  const stage = path.join(stageParent, SKILL_NAME);
  let backup: string | null = null;
  let movedExisting = false;
  try {
    await cp(args.candidate.dir, stage, { recursive: true, errorOnExist: true });
    await writeFile(
      path.join(stage, MANAGED_FILE),
      `${JSON.stringify(managedRecord(args.candidate, args.source, args.cliVersion, args.now), null, 2)}\n`,
      "utf8",
    );
    const staged = await validateSkillCandidate(stage, args.cliVersion);
    if (staged.content_hash !== args.candidate.content_hash) throw new Error("staged Skill hash changed during copy");

  } catch (error) {
    await rm(stageParent, { recursive: true, force: true });
    throw error;
  }

  try {
    if (args.current.installed) {
      const stamp = args.now.toISOString().replace(/[^0-9]/g, "").slice(0, 14);
      backup = path.join(parent, `.${SKILL_NAME}-backup-${stamp}-${randomBytes(4).toString("hex")}`);
      await rename(target, backup);
      movedExisting = true;
    }
    await rename(stage, target);
  } catch (error) {
    if (movedExisting && backup) await rename(backup, target);
    await rm(stageParent, { recursive: true, force: true });
    throw error;
  }
  await rm(stageParent, { recursive: true, force: true }).catch(() => undefined);

  if (backup && args.current.managed) {
    try {
      await rm(backup, { recursive: true, force: true });
      backup = null;
    } catch {
      // The new installation is already active; retain the recoverable backup.
    }
  }
  return {
    action: args.current.installed ? "updated" : "installed",
    backup,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function syncSkill(
  operation: "install" | "update",
  options: SkillSyncOptions = {},
): Promise<SkillSyncResult> {
  const cliVersion = options.cliVersion ?? await currentCliVersion();
  const current = await inspectSkill({ targetRoot: options.targetRoot, cliVersion });
  if (current.installed && !current.managed && !options.force) {
    throw new Error(`${current.target} already exists and is not managed by geo-cli; rerun with --force to preserve it as a backup`);
  }

  let remoteError: string | null = null;
  let remote: RemoteSkillResult | null = null;
  if (!options.offline) {
    try {
      remote = await (options.remoteFetcher ?? fetchRemoteSkill)();
      const candidate = await validateSkillCandidate(remote.dir, cliVersion);
      const activated = await activateCandidate({
        candidate,
        source: "github",
        current,
        force: options.force ?? false,
        cliVersion,
        targetRoot: options.targetRoot,
        now: options.now?.() ?? new Date(),
      });
      const status = await inspectSkill({ targetRoot: options.targetRoot, cliVersion });
      return {
        ok: true,
        operation,
        action: activated.action,
        source: "github",
        fallback: false,
        remote_error: null,
        backup_path: activated.backup,
        status,
      };
    } catch (error) {
      remoteError = errorMessage(error);
    } finally {
      try {
        await remote?.cleanup?.();
      } catch {
        // A cleanup failure must not invalidate an already selected candidate/result.
      }
    }
  }

  if (current.managed && current.healthy) {
    return {
      ok: true,
      operation,
      action: "kept",
      source: current.source as "github" | "bundled",
      fallback: false,
      remote_error: remoteError,
      backup_path: null,
      status: current,
    };
  }

  const bundledDir = await existingBundledSkillSource(options.bundledSource);
  const candidate = await validateSkillCandidate(bundledDir, cliVersion);
  const activated = await activateCandidate({
    candidate,
    source: "bundled",
    current,
    force: options.force ?? false,
    cliVersion,
    targetRoot: options.targetRoot,
    now: options.now?.() ?? new Date(),
  });
  const status = await inspectSkill({ targetRoot: options.targetRoot, cliVersion });
  return {
    ok: true,
    operation,
    action: activated.action,
    source: "bundled",
    fallback: !options.offline,
    remote_error: remoteError,
    backup_path: activated.backup,
    status,
  };
}

export const skillDistributionInternals = {
  MANAGED_FILE,
  MANIFEST_FILE,
  SKILL_NAME,
  SKILL_REPOSITORY,
  compareSemver,
  defaultTargetRoot,
};
