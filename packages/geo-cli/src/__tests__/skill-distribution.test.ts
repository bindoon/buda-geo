import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  inspectSkill,
  skillDistributionInternals,
  syncSkill,
  validateSkillCandidate,
} from "../lib/skill-distribution.js";

const CLI_VERSION = "0.1.0";

async function fixture(t: test.TestContext): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "geo-cli-skill-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function writeSkill(
  dir: string,
  options: {
    version?: string;
    min?: string;
    maxExclusive?: string;
    body?: string;
  } = {},
): Promise<void> {
  await mkdir(path.join(dir, "references"), { recursive: true });
  await writeFile(
    path.join(dir, "SKILL.md"),
    `---\nname: buda-skills\ndescription: test\n---\n\n${options.body ?? "test body"}\n`,
    "utf8",
  );
  await writeFile(
    path.join(dir, "skill.manifest.json"),
    `${JSON.stringify({
      schema_version: 1,
      name: "buda-skills",
      version: options.version ?? "0.1.0",
      source: "bindoon/buda-geo",
      requires_geo_cli: {
        min: options.min ?? "0.1.0",
        max_exclusive: options.maxExclusive ?? "0.2.0",
      },
    }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(path.join(dir, "references", "workflow.md"), "workflow\n", "utf8");
}

test("remote candidate is preferred and installed as a healthy managed Skill", async (t) => {
  const root = await fixture(t);
  const remote = path.join(root, "remote");
  const bundled = path.join(root, "bundled");
  const targetRoot = path.join(root, "agents", "skills");
  await writeSkill(remote, { version: "0.1.2", body: "remote" });
  await writeSkill(bundled, { version: "0.1.0", body: "bundled" });

  const result = await syncSkill("install", {
    targetRoot,
    bundledSource: bundled,
    cliVersion: CLI_VERSION,
    remoteFetcher: async () => ({ dir: remote }),
    now: () => new Date("2026-08-10T00:00:00.000Z"),
  });

  assert.equal(result.action, "installed");
  assert.equal(result.source, "github");
  assert.equal(result.fallback, false);
  assert.equal(result.status.healthy, true);
  assert.equal(result.status.skill_version, "0.1.2");
  assert.match(await readFile(path.join(targetRoot, "buda-skills", "SKILL.md"), "utf8"), /remote/);
});

test("offline first install uses the bundled snapshot", async (t) => {
  const root = await fixture(t);
  const bundled = path.join(root, "bundled");
  const targetRoot = path.join(root, "agents", "skills");
  await writeSkill(bundled, { body: "offline snapshot" });

  const result = await syncSkill("install", {
    offline: true,
    targetRoot,
    bundledSource: bundled,
    cliVersion: CLI_VERSION,
  });

  assert.equal(result.source, "bundled");
  assert.equal(result.remote_error, null);
  assert.equal(result.status.healthy, true);
  assert.match(await readFile(path.join(targetRoot, "buda-skills", "SKILL.md"), "utf8"), /offline snapshot/);
});

test("remote failure keeps an existing healthy installation instead of downgrading", async (t) => {
  const root = await fixture(t);
  const remote = path.join(root, "remote");
  const bundled = path.join(root, "bundled");
  const targetRoot = path.join(root, "agents", "skills");
  await writeSkill(remote, { version: "0.1.4", body: "newer remote" });
  await writeSkill(bundled, { version: "0.1.0", body: "older bundled" });
  const first = await syncSkill("install", {
    targetRoot,
    bundledSource: bundled,
    cliVersion: CLI_VERSION,
    remoteFetcher: async () => ({ dir: remote }),
  });

  const updated = await syncSkill("update", {
    targetRoot,
    bundledSource: bundled,
    cliVersion: CLI_VERSION,
    remoteFetcher: async () => { throw new Error("GitHub unavailable"); },
  });

  assert.equal(updated.action, "kept");
  assert.equal(updated.source, "github");
  assert.equal(updated.remote_error, "GitHub unavailable");
  assert.equal(updated.status.content_hash, first.status.content_hash);
  assert.match(await readFile(path.join(targetRoot, "buda-skills", "SKILL.md"), "utf8"), /newer remote/);
});

test("an incompatible remote candidate cannot replace a healthy installation", async (t) => {
  const root = await fixture(t);
  const currentRemote = path.join(root, "current");
  const incompatible = path.join(root, "incompatible");
  const bundled = path.join(root, "bundled");
  const targetRoot = path.join(root, "agents", "skills");
  await writeSkill(currentRemote, { version: "0.1.3", body: "compatible" });
  await writeSkill(incompatible, { version: "0.2.0", min: "0.2.0", maxExclusive: "0.3.0", body: "too new" });
  await writeSkill(bundled, { version: "0.1.0", body: "bundled" });
  await syncSkill("install", {
    targetRoot,
    bundledSource: bundled,
    cliVersion: CLI_VERSION,
    remoteFetcher: async () => ({ dir: currentRemote }),
  });

  const result = await syncSkill("update", {
    targetRoot,
    bundledSource: bundled,
    cliVersion: CLI_VERSION,
    remoteFetcher: async () => ({ dir: incompatible }),
  });

  assert.equal(result.action, "kept");
  assert.match(result.remote_error ?? "", /requires geo-cli/);
  assert.equal(result.status.skill_version, "0.1.3");
});

test("candidate validation rejects symbolic links", async (t) => {
  const root = await fixture(t);
  const candidate = path.join(root, "candidate");
  await writeSkill(candidate);
  await symlink(path.join(candidate, "SKILL.md"), path.join(candidate, "references", "unsafe.md"));

  await assert.rejects(validateSkillCandidate(candidate, CLI_VERSION), /symbolic link/);
});

test("unmanaged targets are protected and force replacement preserves a backup", async (t) => {
  const root = await fixture(t);
  const targetRoot = path.join(root, "agents", "skills");
  const target = path.join(targetRoot, "buda-skills");
  const bundled = path.join(root, "bundled");
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, "user.txt"), "user managed\n", "utf8");
  await writeSkill(bundled, { body: "replacement" });

  await assert.rejects(
    syncSkill("install", { offline: true, targetRoot, bundledSource: bundled, cliVersion: CLI_VERSION }),
    /not managed by geo-cli/,
  );
  assert.equal(await readFile(path.join(target, "user.txt"), "utf8"), "user managed\n");

  const result = await syncSkill("install", {
    offline: true,
    force: true,
    targetRoot,
    bundledSource: bundled,
    cliVersion: CLI_VERSION,
    now: () => new Date("2026-08-10T01:02:03.000Z"),
  });

  assert.ok(result.backup_path);
  assert.equal(await readFile(path.join(result.backup_path as string, "user.txt"), "utf8"), "user managed\n");
  assert.equal(result.status.source, "bundled");
  assert.equal(result.status.healthy, true);
});

test("status detects changes to managed Skill content", async (t) => {
  const root = await fixture(t);
  const targetRoot = path.join(root, "agents", "skills");
  const bundled = path.join(root, "bundled");
  await writeSkill(bundled);
  await syncSkill("install", { offline: true, targetRoot, bundledSource: bundled, cliVersion: CLI_VERSION });
  await writeFile(path.join(targetRoot, "buda-skills", "references", "workflow.md"), "tampered\n", "utf8");

  const status = await inspectSkill({ targetRoot, cliVersion: CLI_VERSION });
  assert.equal(status.managed, true);
  assert.equal(status.healthy, false);
  assert.match(status.error ?? "", /content hash/);
  assert.equal(skillDistributionInternals.SKILL_NAME, "buda-skills");
});
