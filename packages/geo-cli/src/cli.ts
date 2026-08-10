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
import {
  approveAllNonRiskSeeds,
  confirmSeedSet,
  createSeedDraft,
  reviseSeedSet,
  reviewSeed,
} from "./lib/diagnosis-seeds.js";
import {
  appendAnalysisRevision,
  createDiagnosisRun,
  ingestManualProbes,
} from "./lib/diagnosis-probe.js";
import {
  confirmDiagnosisReport,
  generateDiagnosisReport,
} from "./lib/diagnosis-report.js";
import { validateDiagnosis } from "./lib/diagnosis-validate.js";
import { runConfiguredApiProbes } from "./lib/diagnosis-api.js";
import { importLegacyDiagnosis } from "./lib/diagnosis-legacy.js";
import type { ProbeAnalysis } from "./lib/diagnosis-model.js";
import {
  approveReadyScenarios,
  confirmScenarioLibrary,
  generateScenarioDraft,
  importLegacyKeywords,
  overrideScenarioPriority,
  reviseScenarioLibrary,
  reviewEvidenceGap,
  reviewMergeSuggestion,
  reviewScenario,
} from "./lib/scenario-strategy.js";
import { validateScenarioStrategy } from "./lib/scenario-validate.js";
import {
  approveReadyContentTopics,
  confirmContentPlan,
  generateContentPlan,
  importLegacyContent,
  overrideContentPriority,
  overrideProductionTask,
  reviseContentPlan,
  reviewContentBlocker,
  reviewContentMerge,
  reviewContentTopic,
} from "./lib/content-planning.js";
import { validateContentPlanning } from "./lib/content-plan-validate.js";
import { articleStatus, ingestArticle, prepareArticles, reviseArticle } from "./lib/article-generation.js";
import { validateArticles } from "./lib/article-validate.js";
import { articleReviewStatus, decideArticleReview, prepareArticleReviews, validateArticleReviews } from "./lib/article-review.js";
import { authorizePublishPlan, preparePublishPlan, publishingStatus, recordPublishResult, renderPublishingStatus } from "./lib/publishing.js";
import { validatePublishing } from "./lib/publishing-validate.js";
import { inspectSkill, syncSkill } from "./lib/skill-distribution.js";

function resolveProject(p: string): string {
  return path.resolve(p);
}

const program = new Command();
program.name("geo-cli").description("GEO project clean / diagnosis / validate tooling");

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

const diagnose = program.command("diagnose").description("prepare and audit baseline GEO diagnosis");

addProjectOpt(diagnose.command("seed-draft").description("generate a small diagnostic seed draft from confirmed facts"))
  .option("--size <number>", "target question count", "25")
  .action(async (opts: { project: string; size: string }) => {
    console.log(JSON.stringify(await createSeedDraft(resolveProject(opts.project), Number(opts.size)), null, 2));
  });

addProjectOpt(diagnose.command("seed-review").description("approve, reject, or replace one draft question"))
  .requiredOption("--question <id>", "question ID")
  .requiredOption("--action <action>", "approve | reject | edit | replace")
  .option("--text <text>", "replacement question text")
  .action(async (opts: { project: string; question: string; action: "approve" | "reject" | "edit" | "replace"; text?: string }) => {
    if (!["approve", "reject", "edit", "replace"].includes(opts.action)) throw new Error("action must be approve, reject, edit, or replace");
    const result = await reviewSeed(resolveProject(opts.project), opts.question, opts.action, opts.text);
    console.log(JSON.stringify({ seed_set_id: result.seed_set_id, question_id: opts.question, action: opts.action }, null, 2));
  });

addProjectOpt(diagnose.command("seed-approve-non-risk").description("approve all non-risk draft questions; negative-risk questions remain explicit"))
  .action(async (opts: { project: string }) => {
    const result = await approveAllNonRiskSeeds(resolveProject(opts.project));
    console.log(JSON.stringify({ seed_set_id: result.seed_set_id, still_unreviewed: result.questions.filter((q) => q.review_status === "unreviewed").map((q) => q.question_id) }, null, 2));
  });

addProjectOpt(diagnose.command("seed-confirm").description("freeze a fully reviewed seed set version"))
  .action(async (opts: { project: string }) => console.log(JSON.stringify(await confirmSeedSet(resolveProject(opts.project)), null, 2)));

addProjectOpt(diagnose.command("seed-revise").description("create a new draft version from a confirmed seed set"))
  .requiredOption("--seed-set <id>", "confirmed seed set ID")
  .action(async (opts: { project: string; seedSet: string }) => console.log(JSON.stringify(await reviseSeedSet(resolveProject(opts.project), opts.seedSet), null, 2)));

addProjectOpt(diagnose.command("run-create").description("create an immutable diagnosis run shell"))
  .requiredOption("--seed-set <id>", "confirmed seed set ID")
  .requiredOption("--platforms <list>", "comma-separated platform names")
  .action(async (opts: { project: string; seedSet: string; platforms: string }) => {
    console.log(JSON.stringify(await createDiagnosisRun(resolveProject(opts.project), opts.seedSet, opts.platforms.split(",")), null, 2));
  });

addProjectOpt(diagnose.command("probe-ingest").description("ingest controlled manual probe evidence from JSON"))
  .requiredOption("--run <id>", "diagnosis run ID")
  .requiredOption("--input <file>", "manual probe JSON file")
  .action(async (opts: { project: string; run: string; input: string }) => {
    console.log(JSON.stringify(await ingestManualProbes(resolveProject(opts.project), opts.run, opts.input), null, 2));
  });

addProjectOpt(diagnose.command("probe-run").description("call configured OpenAI-compatible platform APIs for every approved seed question"))
  .requiredOption("--run <id>", "diagnosis run ID")
  .option("--config <file>", "probe platform config; defaults to BUDA_PROBE_CONFIG or config/probe-platforms.json")
  .option("--concurrency <number>", "maximum parallel API requests", "2")
  .action(async (opts: { project: string; run: string; config?: string; concurrency: string }) => {
    const concurrency = Number(opts.concurrency);
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 10) throw new Error("concurrency must be an integer between 1 and 10");
    console.log(JSON.stringify(await runConfiguredApiProbes(resolveProject(opts.project), opts.run, opts.config, concurrency), null, 2));
  });

addProjectOpt(diagnose.command("analysis-revise").description("append a corrected analysis without altering raw evidence"))
  .requiredOption("--run <id>", "diagnosis run ID")
  .requiredOption("--probe <id>", "probe ID")
  .requiredOption("--input <file>", "complete ProbeAnalysis JSON")
  .requiredOption("--reason <text>", "revision reason")
  .action(async (opts: { project: string; run: string; probe: string; input: string; reason: string }) => {
    const analysis = await readJson<ProbeAnalysis>(path.resolve(opts.input));
    console.log(JSON.stringify(await appendAnalysisRevision(resolveProject(opts.project), opts.run, opts.probe, analysis, opts.reason), null, 2));
  });

addProjectOpt(diagnose.command("report").description("calculate transparent metrics and render JSON/Markdown/HTML"))
  .requiredOption("--run <id>", "diagnosis run ID")
  .action(async (opts: { project: string; run: string }) => console.log(JSON.stringify(await generateDiagnosisReport(resolveProject(opts.project), opts.run), null, 2)));

addProjectOpt(diagnose.command("confirm").description("confirm a reviewed diagnosis report and expose gaps downstream"))
  .requiredOption("--report <id>", "diagnosis report ID")
  .option("--accept-limitations", "explicitly accept remaining probe failures", false)
  .action(async (opts: { project: string; report: string; acceptLimitations: boolean }) => {
    const result = await confirmDiagnosisReport(resolveProject(opts.project), opts.report, opts.acceptLimitations);
    console.log(JSON.stringify({ report_id: result.report_id, status: result.status, confirmed_at: result.confirmed_at }, null, 2));
  });

addProjectOpt(diagnose.command("validate").description("validate diagnosis schemas, links, evidence, and gate"))
  .action(async (opts: { project: string }) => {
    const result = await validateDiagnosis(resolveProject(opts.project));
    console.log(result.ok ? "DIAGNOSIS VALIDATE OK" : "DIAGNOSIS VALIDATE FAIL");
    for (const error of result.errors) console.log(`  ${error}`);
    console.log(`CHECKED: ${result.checked.length}`);
    process.exit(result.ok ? 0 : 1);
  });

addProjectOpt(diagnose.command("import-legacy").description("import old questions and web spot checks as unconfirmed legacy candidates"))
  .requiredOption("--questions <file>", "legacy questions JSON")
  .requiredOption("--report <file>", "legacy report JSON")
  .action(async (opts: { project: string; questions: string; report: string }) => {
    console.log(JSON.stringify(await importLegacyDiagnosis(resolveProject(opts.project), opts.questions, opts.report), null, 2));
  });

const strategy = program.command("strategy").description("build and confirm customer-question buying scenarios");

addProjectOpt(strategy.command("import-legacy").description("import legacy company.keywords JSON/XLSX as unconfirmed candidates"))
  .requiredOption("--input <file>", "legacy company.keywords JSON or source XLSX")
  .action(async (opts: { project: string; input: string }) => console.log(JSON.stringify(await importLegacyKeywords(resolveProject(opts.project), opts.input), null, 2)));

addProjectOpt(strategy.command("generate").description("generate a reviewable scenario library from confirmed facts and diagnosis"))
  .option("--input <file>", "optional operator questions JSON")
  .action(async (opts: { project: string; input?: string }) => console.log(JSON.stringify(await generateScenarioDraft(resolveProject(opts.project), opts.input), null, 2)));

addProjectOpt(strategy.command("review").description("approve, reject, defer, or edit one scenario"))
  .requiredOption("--scenario <id>", "scenario ID")
  .requiredOption("--action <action>", "approve | reject | defer | edit")
  .option("--note <text>", "review note")
  .option("--input <file>", "JSON patch required for edit")
  .action(async (opts: { project: string; scenario: string; action: "approve" | "reject" | "defer" | "edit"; note?: string; input?: string }) => {
    if (!["approve", "reject", "defer", "edit"].includes(opts.action)) throw new Error("action must be approve, reject, defer, or edit");
    const library = await reviewScenario(resolveProject(opts.project), opts.scenario, opts.action, opts.note, opts.input);
    console.log(JSON.stringify({ scenario_library_id: library.scenario_library_id, scenario_id: opts.scenario, action: opts.action }, null, 2));
  });

addProjectOpt(strategy.command("approve-ready").description("approve every scenario without an open high-priority evidence gap"))
  .action(async (opts: { project: string }) => {
    const library = await approveReadyScenarios(resolveProject(opts.project));
    console.log(JSON.stringify({ approved: library.scenarios.filter((item) => item.review_status === "approved").map((item) => item.scenario_id), still_unreviewed: library.scenarios.filter((item) => item.review_status === "unreviewed").map((item) => item.scenario_id) }, null, 2));
  });

addProjectOpt(strategy.command("gap-review").description("accept, defer, or resolve one evidence gap"))
  .requiredOption("--gap <id>", "evidence gap ID")
  .requiredOption("--action <action>", "accept | defer | resolve")
  .requiredOption("--reason <text>", "review reason")
  .action(async (opts: { project: string; gap: string; action: "accept" | "defer" | "resolve"; reason: string }) => {
    if (!["accept", "defer", "resolve"].includes(opts.action)) throw new Error("action must be accept, defer, or resolve");
    await reviewEvidenceGap(resolveProject(opts.project), opts.gap, opts.action, opts.reason);
    console.log(JSON.stringify({ evidence_gap_id: opts.gap, action: opts.action }, null, 2));
  });

addProjectOpt(strategy.command("priority-override").description("override scenario priority with actor and reason"))
  .requiredOption("--scenario <id>", "scenario ID")
  .requiredOption("--score <number>", "0-25 final score")
  .requiredOption("--actor <name>", "operator applying the override")
  .requiredOption("--reason <text>", "override reason")
  .action(async (opts: { project: string; scenario: string; score: string; actor: string; reason: string }) => {
    await overrideScenarioPriority(resolveProject(opts.project), opts.scenario, Number(opts.score), opts.actor, opts.reason);
    console.log(JSON.stringify({ scenario_id: opts.scenario, score: Number(opts.score), actor: opts.actor }, null, 2));
  });

addProjectOpt(strategy.command("merge-review").description("approve or reject a semantic merge suggestion"))
  .requiredOption("--suggestion <id>", "merge suggestion ID")
  .requiredOption("--action <action>", "approve | reject")
  .requiredOption("--reason <text>", "review reason")
  .action(async (opts: { project: string; suggestion: string; action: "approve" | "reject"; reason: string }) => {
    if (!["approve", "reject"].includes(opts.action)) throw new Error("action must be approve or reject");
    await reviewMergeSuggestion(resolveProject(opts.project), opts.suggestion, opts.action, opts.reason);
    console.log(JSON.stringify({ suggestion_id: opts.suggestion, action: opts.action }, null, 2));
  });

addProjectOpt(strategy.command("confirm").description("freeze the reviewed scenario library and open the downstream gate"))
  .action(async (opts: { project: string }) => console.log(JSON.stringify(await confirmScenarioLibrary(resolveProject(opts.project)), null, 2)));

addProjectOpt(strategy.command("revise").description("create a new draft version from a confirmed scenario library"))
  .requiredOption("--library <id>", "confirmed scenario library ID")
  .action(async (opts: { project: string; library: string }) => console.log(JSON.stringify(await reviseScenarioLibrary(resolveProject(opts.project), opts.library), null, 2)));

addProjectOpt(strategy.command("validate").description("validate scenario schemas, evidence links and manifest gate"))
  .action(async (opts: { project: string }) => {
    const result = await validateScenarioStrategy(resolveProject(opts.project));
    console.log(result.ok ? "STRATEGY VALIDATE OK" : "STRATEGY VALIDATE FAIL");
    for (const error of result.errors) console.log(`  ${error}`);
    console.log(`CHECKED: ${result.checked.length}`);
    process.exit(result.ok ? 0 : 1);
  });

const plan = program.command("plan").description("build and confirm FAQ, topic, prompt, and production-task plans");

addProjectOpt(plan.command("import-legacy").description("audit legacy FAQ/prompt/keyword/generation-plan JSON as unconfirmed candidates"))
  .requiredOption("--input <files...>", "one or more legacy JSON files")
  .action(async (opts: { project: string; input: string[] }) => console.log(JSON.stringify(await importLegacyContent(resolveProject(opts.project), opts.input), null, 2)));

addProjectOpt(plan.command("generate").description("generate a reviewable content plan from the confirmed scenario library"))
  .option("--quota <number>", "requested maximum task quantity for this batch", "30")
  .action(async (opts: { project: string; quota: string }) => console.log(JSON.stringify(await generateContentPlan(resolveProject(opts.project), Number(opts.quota)), null, 2)));

addProjectOpt(plan.command("review").description("approve, reject, defer, or edit one content topic bundle"))
  .requiredOption("--topic <id>", "topic ID")
  .requiredOption("--action <action>", "approve | reject | defer | edit")
  .option("--note <text>", "review note")
  .option("--input <file>", "JSON patch required for edit")
  .action(async (opts: { project: string; topic: string; action: "approve" | "reject" | "defer" | "edit"; note?: string; input?: string }) => {
    if (!["approve", "reject", "defer", "edit"].includes(opts.action)) throw new Error("action must be approve, reject, defer, or edit");
    await reviewContentTopic(resolveProject(opts.project), opts.topic, opts.action, opts.note, opts.input); console.log(JSON.stringify({ topic_id: opts.topic, action: opts.action }, null, 2));
  });

addProjectOpt(plan.command("approve-ready").description("approve every evidence-ready content topic bundle"))
  .action(async (opts: { project: string }) => { const value = await approveReadyContentTopics(resolveProject(opts.project)); console.log(JSON.stringify({ approved: value.topics.filter((x) => x.review_status === "approved").map((x) => x.topic_id), still_unreviewed: value.topics.filter((x) => x.review_status === "unreviewed").map((x) => x.topic_id) }, null, 2)); });

addProjectOpt(plan.command("gap-review").description("resolve, defer, accept, or make one evidence blocker research-only"))
  .requiredOption("--blocker <id>", "content blocker ID")
  .requiredOption("--action <action>", "resolve | defer | accept | research-only")
  .requiredOption("--reason <text>", "review reason")
  .action(async (opts: { project: string; blocker: string; action: "resolve" | "defer" | "accept" | "research-only"; reason: string }) => { if (!["resolve", "defer", "accept", "research-only"].includes(opts.action)) throw new Error("action must be resolve, defer, accept, or research-only"); await reviewContentBlocker(resolveProject(opts.project), opts.blocker, opts.action, opts.reason); console.log(JSON.stringify({ blocker_id: opts.blocker, action: opts.action }, null, 2)); });

addProjectOpt(plan.command("merge-review").description("approve or reject a content semantic-merge suggestion"))
  .requiredOption("--suggestion <id>", "merge suggestion ID")
  .requiredOption("--action <action>", "approve | reject")
  .requiredOption("--reason <text>", "review reason")
  .action(async (opts: { project: string; suggestion: string; action: "approve" | "reject"; reason: string }) => { if (!["approve", "reject"].includes(opts.action)) throw new Error("action must be approve or reject"); await reviewContentMerge(resolveProject(opts.project), opts.suggestion, opts.action, opts.reason); console.log(JSON.stringify({ suggestion_id: opts.suggestion, action: opts.action }, null, 2)); });

addProjectOpt(plan.command("priority-override").description("override topic priority with actor and reason"))
  .requiredOption("--topic <id>", "topic ID").requiredOption("--score <number>", "0-30 final score").requiredOption("--actor <name>", "operator").requiredOption("--reason <text>", "override reason")
  .action(async (opts: { project: string; topic: string; score: string; actor: string; reason: string }) => { await overrideContentPriority(resolveProject(opts.project), opts.topic, Number(opts.score), opts.actor, opts.reason); console.log(JSON.stringify({ topic_id: opts.topic, score: Number(opts.score), actor: opts.actor }, null, 2)); });

addProjectOpt(plan.command("task-override").description("override one task batch/quantity with a complete audit record"))
  .requiredOption("--task <id>", "task ID").requiredOption("--batch <number>", "batch number").requiredOption("--quantity <number>", "task quantity").requiredOption("--actor <name>", "operator").requiredOption("--reason <text>", "override reason")
  .action(async (opts: { project: string; task: string; batch: string; quantity: string; actor: string; reason: string }) => { await overrideProductionTask(resolveProject(opts.project), opts.task, Number(opts.batch), Number(opts.quantity), opts.actor, opts.reason); console.log(JSON.stringify({ task_id: opts.task, batch: Number(opts.batch), quantity: Number(opts.quantity), actor: opts.actor }, null, 2)); });

addProjectOpt(plan.command("confirm").description("freeze the reviewed content plan and open the article-generation gate"))
  .action(async (opts: { project: string }) => console.log(JSON.stringify(await confirmContentPlan(resolveProject(opts.project)), null, 2)));

addProjectOpt(plan.command("revise").description("create a new draft version from a confirmed content plan"))
  .requiredOption("--content-plan <id>", "confirmed content plan ID")
  .action(async (opts: { project: string; contentPlan: string }) => console.log(JSON.stringify(await reviseContentPlan(resolveProject(opts.project), opts.contentPlan), null, 2)));

addProjectOpt(plan.command("validate").description("validate content-plan schemas, evidence links, quotas, and manifest gate"))
  .action(async (opts: { project: string }) => { const result = await validateContentPlanning(resolveProject(opts.project)); console.log(result.ok ? "CONTENT PLAN VALIDATE OK" : "CONTENT PLAN VALIDATE FAIL"); for (const error of result.errors) console.log(`  ${error}`); console.log(`CHECKED: ${result.checked.length}`); process.exit(result.ok ? 0 : 1); });

const article = program.command("article").description("prepare, ingest, revise, and validate local article drafts");

addProjectOpt(article.command("prepare").description("prepare stable writing briefs from the confirmed content plan"))
  .option("--task <id>", "prepare one eligible production task")
  .option("--limit <number>", "maximum article slots to prepare")
  .option("--force", "refresh existing briefs/prompts without touching drafts")
  .action(async (opts: { project: string; task?: string; limit?: string; force?: boolean }) => console.log(JSON.stringify(await prepareArticles(resolveProject(opts.project), opts.task, opts.limit ? Number(opts.limit) : undefined, Boolean(opts.force)), null, 2)));

addProjectOpt(article.command("ingest").description("validate and store one locally generated Markdown draft"))
  .requiredOption("--article <id>", "article slot ID").requiredOption("--input <file>", "Markdown draft path").requiredOption("--title <text>", "article title").requiredOption("--used-facts <ids>", "comma-separated Fact IDs actually used")
  .option("--used-images <paths>", "optional comma-separated asset paths; defaults to Markdown image refs")
  .action(async (opts: { project: string; article: string; input: string; title: string; usedFacts: string; usedImages?: string }) => console.log(JSON.stringify(await ingestArticle(resolveProject(opts.project), opts.article, opts.input, opts.title, opts.usedFacts.split(",").map((x) => x.trim()).filter(Boolean), opts.usedImages?.split(",").map((x) => x.trim()).filter(Boolean)), null, 2)));

addProjectOpt(article.command("revise").description("append a new revision without overwriting the original draft"))
  .requiredOption("--article <id>", "article ID").requiredOption("--input <file>", "revised Markdown path").requiredOption("--reason <text>", "human-readable revision reason")
  .action(async (opts: { project: string; article: string; input: string; reason: string }) => { const meta = await reviseArticle(resolveProject(opts.project), opts.article, opts.input, opts.reason); console.log(JSON.stringify({ article_id: meta.article_id, revision: meta.current_revision, path: meta.body_path }, null, 2)); });

addProjectOpt(article.command("status").description("show planned, prepared, drafted, and missing article counts"))
  .action(async (opts: { project: string }) => console.log(JSON.stringify(await articleStatus(resolveProject(opts.project)), null, 2)));

addProjectOpt(article.command("validate").description("validate briefs, draft metadata, hashes, and confirmed-plan references"))
  .action(async (opts: { project: string }) => { const result = await validateArticles(resolveProject(opts.project)); console.log(result.ok ? "ARTICLE VALIDATE OK" : "ARTICLE VALIDATE FAIL"); for (const error of result.errors) console.log(`  ${error}`); console.log(`CHECKED: ${result.checked.length}`); process.exit(result.ok ? 0 : 1); });

addProjectOpt(article.command("review-prepare").description("prepare evidence-rich review packets for current drafts"))
  .action(async (opts: { project: string }) => console.log(JSON.stringify(await prepareArticleReviews(resolveProject(opts.project)), null, 2)));

addProjectOpt(article.command("review-decide").description("record request-changes, approve, reject, or defer with a five-check assessment"))
  .requiredOption("--article <id>", "article ID").requiredOption("--action <action>", "request-changes | approve | reject | defer").requiredOption("--assessment <file>", "assessment JSON path").requiredOption("--reason <text>", "decision reason")
  .action(async (opts: { project: string; article: string; action: "request_changes" | "approve" | "reject" | "defer"; assessment: string; reason: string }) => { const action = opts.action.replace("-", "_") as "request_changes" | "approve" | "reject" | "defer"; if (!["request_changes", "approve", "reject", "defer"].includes(action)) throw new Error("invalid review action"); const meta = await decideArticleReview(resolveProject(opts.project), opts.article, action, opts.assessment, opts.reason); console.log(JSON.stringify({ article_id: meta.article_id, status: meta.status }, null, 2)); });

addProjectOpt(article.command("review-status").description("show article counts by review lifecycle"))
  .action(async (opts: { project: string }) => console.log(JSON.stringify(await articleReviewStatus(resolveProject(opts.project)), null, 2)));

addProjectOpt(article.command("review-validate").description("validate review history, current hashes, and approved gate conditions"))
  .action(async (opts: { project: string }) => { const result = await validateArticleReviews(resolveProject(opts.project)); console.log(result.ok ? "ARTICLE REVIEW VALIDATE OK" : "ARTICLE REVIEW VALIDATE FAIL"); for (const error of result.errors) console.log(`  ${error}`); console.log(`CHECKED: ${result.checked.length}`); process.exit(result.ok ? 0 : 1); });

const publish = program.command("publish").description("prepare, authorize, record, and validate auditable publishing");

addProjectOpt(publish.command("prepare").description("create a dry-run plan from currently approved article hashes"))
  .option("--destinations <ids>", "optional comma-separated destination IDs; defaults to all enabled matching destinations")
  .action(async (opts: { project: string; destinations?: string }) => {
    const ids = opts.destinations?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
    console.log(JSON.stringify(await preparePublishPlan(resolveProject(opts.project), ids), null, 2));
  });

addProjectOpt(publish.command("authorize").description("explicitly authorize one reviewed dry-run plan"))
  .requiredOption("--plan <id>", "publish plan ID")
  .requiredOption("--confirm <id>", "must exactly repeat the publish plan ID")
  .requiredOption("--by <name>", "operator authorizing the plan")
  .requiredOption("--reason <text>", "authorization reason")
  .action(async (opts: { project: string; plan: string; confirm: string; by: string; reason: string }) => {
    console.log(JSON.stringify(await authorizePublishPlan(resolveProject(opts.project), opts.plan, opts.confirm, opts.by, opts.reason), null, 2));
  });

addProjectOpt(publish.command("record").description("append one manual/adapter attempt and immutable receipt event"))
  .requiredOption("--plan <id>", "publish plan ID")
  .requiredOption("--item <id>", "publish item ID")
  .requiredOption("--status <status>", "submitted | published | failed | skipped")
  .requiredOption("--by <name>", "operator or adapter identity")
  .option("--external-url <url>", "published/submitted external URL")
  .option("--external-id <id>", "external platform record ID")
  .option("--evidence <path-or-url>", "project-relative evidence path or public URL")
  .option("--error-code <code>", "failure code")
  .option("--error-message <text>", "failure message")
  .option("--no-retryable", "mark a failure as non-retryable")
  .action(async (opts: { project: string; plan: string; item: string; status: "submitted" | "published" | "failed" | "skipped"; by: string; externalUrl?: string; externalId?: string; evidence?: string; errorCode?: string; errorMessage?: string; retryable: boolean }) => {
    if (!["submitted", "published", "failed", "skipped"].includes(opts.status)) throw new Error("status must be submitted, published, failed, or skipped");
    const result = await recordPublishResult(resolveProject(opts.project), opts.plan, opts.item, { status: opts.status, recorded_by: opts.by, external_url: opts.externalUrl, external_id: opts.externalId, evidence_path: opts.evidence, error_code: opts.errorCode, error_message: opts.errorMessage, retryable: opts.retryable });
    console.log(JSON.stringify({ attempt: result.attempt, receipt: result.receipt, plan_status: result.plan.status }, null, 2));
  });

addProjectOpt(publish.command("status").description("show publish lifecycle counts and write publish/status.md"))
  .option("--plan <id>", "optional publish plan ID")
  .action(async (opts: { project: string; plan?: string }) => {
    const project = resolveProject(opts.project);
    const report = await renderPublishingStatus(project, opts.plan);
    console.log(JSON.stringify({ ...(await publishingStatus(project, opts.plan)), report }, null, 2));
  });

addProjectOpt(publish.command("validate").description("validate destinations, approvals, hashes, authorization, attempts, receipts, and evidence"))
  .action(async (opts: { project: string }) => {
    const result = await validatePublishing(resolveProject(opts.project));
    console.log(result.ok ? "PUBLISH VALIDATE OK" : "PUBLISH VALIDATE FAIL");
    for (const error of result.errors) console.log(`  ${error}`);
    console.log(`CHECKED: ${result.checked.length}`);
    process.exit(result.ok ? 0 : 1);
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

const skills = program
  .command("skills")
  .description("install, update, or inspect the Codex buda-skills package");

skills
  .command("install")
  .description("install buda-skills from GitHub, with the npm snapshot as an offline fallback")
  .option("--offline", "skip GitHub and use the bundled snapshot when no healthy installation exists", false)
  .option("--force", "preserve an unmanaged target as a backup and replace it", false)
  .action(async (opts: { offline: boolean; force: boolean }) => {
    console.log(JSON.stringify(await syncSkill("install", opts), null, 2));
  });

skills
  .command("update")
  .description("refresh buda-skills from GitHub without downgrading a healthy installation")
  .option("--offline", "skip GitHub and keep a healthy installation or use the bundled snapshot", false)
  .option("--force", "preserve an unmanaged target as a backup and replace it", false)
  .action(async (opts: { offline: boolean; force: boolean }) => {
    console.log(JSON.stringify(await syncSkill("update", opts), null, 2));
  });

skills
  .command("status")
  .description("report the installed buda-skills source, version, compatibility, and content integrity")
  .action(async () => {
    console.log(JSON.stringify(await inspectSkill(), null, 2));
  });

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
