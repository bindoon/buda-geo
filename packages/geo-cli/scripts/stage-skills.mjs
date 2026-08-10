import { access, cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(packageRoot, "../../skills/buda-skills");
const targetRoot = resolve(packageRoot, "bundled-skills");
const target = resolve(targetRoot, "buda-skills");
const action = process.argv[2];

if (action === "clean") {
  await rm(targetRoot, { recursive: true, force: true });
} else if (action === "stage") {
  await access(resolve(source, "SKILL.md"));
  await access(resolve(source, "skill.manifest.json"));
  await rm(targetRoot, { recursive: true, force: true });
  await mkdir(targetRoot, { recursive: true });
  await cp(source, target, { recursive: true, errorOnExist: true });
} else {
  throw new Error("usage: node scripts/stage-skills.mjs <stage|clean>");
}
