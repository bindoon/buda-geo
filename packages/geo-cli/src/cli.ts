#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import { cleanProject } from "./lib/clean.js";
import { confirmClean } from "./lib/confirm.js";
import { inventory } from "./lib/inventory.js";
import { ensureAppId } from "./lib/manifest.js";
import { parseInfoForm, parseKeywords } from "./lib/parse.js";
import {
  listProjects,
  loadRegistry,
  resolveQuery,
} from "./lib/registry.js";
import { printValidate, validateProject } from "./lib/validate.js";
import { readJson, writeJson } from "./lib/util.js";
import { writeCleanReview } from "./lib/review.js";

function resolveProject(p: string): string {
  return path.resolve(p);
}

const program = new Command();
program.name("geo-cli").description("GEO project clean / validate tooling");

function addProjectOpt(cmd: Command): Command {
  return cmd.requiredOption(
    "--project <path>",
    "path to projects/{name}",
  );
}

addProjectOpt(program.command("inventory").description("classify inputs")).action(
  async (opts: { project: string }) => {
    const report = await inventory(resolveProject(opts.project));
    console.log(JSON.stringify(report, null, 2));
  },
);

addProjectOpt(program.command("validate").description("validate knowledge + manifest"))
  .option("--no-strict", "do not fail on block missing")
  .action(async (opts: { project: string; strict: boolean }) => {
    const result = await validateProject(resolveProject(opts.project), opts.strict);
    printValidate(result);
    process.exit(result.ok ? 0 : 1);
  });

addProjectOpt(program.command("clean").description("run clean pipeline"))
  .option("--app-id <id>", "override app_id")
  .action(async (opts: { project: string; appId?: string }) => {
    const result = await cleanProject(resolveProject(opts.project), opts.appId);
    console.log(JSON.stringify(result, null, 2));
  });

addProjectOpt(program.command("confirm-clean").description("confirm reviewed enterprise facts and create immutable snapshot"))
  .action(async (opts: { project: string }) => {
    const result = await confirmClean(resolveProject(opts.project));
    console.log(JSON.stringify(result, null, 2));
  });

addProjectOpt(program.command("review-clean").description("write a business-readable enterprise fact confirmation checklist"))
  .action(async (opts: { project: string }) => {
    const result = await writeCleanReview(resolveProject(opts.project));
    console.log(JSON.stringify({
      wrote: result.path,
      status: result.status,
      next: result.status === "blocked"
        ? "resolve must-fix items and rerun clean"
        : result.status === "confirmed"
          ? "continue to baseline diagnosis"
          : "review clean-review.md and explicitly confirm enterprise facts",
    }, null, 2));
  });

addProjectOpt(program.command("parse-form").description("parse info form xlsx only"))
  .option("--app-id <id>", "override app_id")
  .action(async (opts: { project: string; appId?: string }) => {
    const project = resolveProject(opts.project);
    const inv = await inventory(project);
    const forms = inv.by_kind.info_form ?? [];
    if (!forms[0]) {
      console.error("no info form found");
      process.exit(1);
    }
    const appId = await ensureAppId(project, opts.appId);
    const { baseinfo, warnings } = parseInfoForm(
      path.join(project, "inputs", forms[0]),
      appId,
    );
    const out = path.join(project, "knowledge", "company.baseinfo.json");
    await writeJson(out, baseinfo);
    console.log(JSON.stringify({ wrote: out, warnings }, null, 2));
  });

addProjectOpt(program.command("parse-keywords").description("parse keywords xlsx only"))
  .option("--app-id <id>", "override app_id")
  .action(async (opts: { project: string; appId?: string }) => {
    const project = resolveProject(opts.project);
    const inv = await inventory(project);
    const kws = inv.by_kind.keywords ?? [];
    if (!kws[0]) {
      console.error("no keywords workbook found");
      process.exit(1);
    }
    const appId = await ensureAppId(project, opts.appId);
    const data = parseKeywords(path.join(project, "inputs", kws[0]), appId);
    const out = path.join(project, "knowledge", "company.keywords.json");
    await writeJson(out, data);
    console.log(
      JSON.stringify({ wrote: out, terms: data.search.terms.length }, null, 2),
    );
  });

addProjectOpt(program.command("status").description("print manifest")).action(
  async (opts: { project: string }) => {
    const mp = path.join(resolveProject(opts.project), "manifest.json");
    try {
      const m = await readJson(mp);
      console.log(JSON.stringify(m, null, 2));
    } catch {
      console.log("no manifest.json");
    }
  },
);

const projects = program
  .command("projects")
  .description("list or resolve customer projects (projects/registry.json)");

projects
  .command("list")
  .description("list registered projects")
  .action(async () => {
    const reg = await loadRegistry();
    console.log(JSON.stringify(listProjects(reg), null, 2));
  });

projects
  .command("resolve")
  .description("resolve dir / alias / app_id to project path")
  .argument("<query>", "company name, alias, app_id, or dir")
  .action(async (query: string) => {
    const reg = await loadRegistry();
    const result = resolveQuery(reg, query);
    if (result.ok) {
      console.log(JSON.stringify(result.project, null, 2));
      return;
    }
    console.error(
      JSON.stringify(
        { error: "ambiguous_or_unknown", candidates: result.candidates },
        null,
        2,
      ),
    );
    process.exit(1);
  });

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
