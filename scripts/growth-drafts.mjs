/**
 * Growth Ops human-review drafts CLI.
 * Never publishes, sends review replies, mutates Google, or deploys.
 *
 * Usage:
 *   npm run growth:drafts
 *   npm run growth:drafts -- --weekly qa-reports/growth-weekly.json --reviews qa-reports/gbp-reviews.json
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { loadGrowthFacts } from "./lib/growth-facts.mjs";
import {
  DRAFT_SAFETY,
  buildDraftPacket,
  formatDraftsJobSummaryMarkdown,
  formatDraftsMarkdown,
  sanitizeDraftPacketForCi,
} from "./lib/growth-drafts.mjs";

const rootDir = process.cwd();
const defaultReportsDir = path.join(rootDir, "qa-reports");

const PUBLISH_GUARD = {
  mayPublish: false,
  maySendReviewReplies: false,
  mayMutateGoogle: false,
  mayDeploy: false,
  mayCreatePullRequests: false,
  command: "growth:drafts",
};

const parseArgs = (argv) => {
  const options = {
    weeklyPath: path.join(defaultReportsDir, "growth-weekly.json"),
    reviewsPath: path.join(defaultReportsDir, "gbp-reviews.json"),
    postsPath: path.join(defaultReportsDir, "gbp-list-posts.json"),
    factsDir: "growth",
    outDir: defaultReportsDir,
    ciOutDir: null,
    summaryPath: null,
    help: false,
  };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--weekly") options.weeklyPath = args[++i];
    else if (arg === "--reviews") options.reviewsPath = args[++i];
    else if (arg === "--posts") options.postsPath = args[++i];
    else if (arg === "--facts-dir") options.factsDir = args[++i];
    else if (arg === "--out-dir") options.outDir = args[++i];
    else if (arg === "--ci-out-dir") options.ciOutDir = args[++i];
    else if (arg === "--summary-out") options.summaryPath = args[++i];
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
};

const printUsage = () => {
  console.error(`Usage:
  npm run growth:drafts
  npm run growth:drafts -- --weekly <file> --reviews <file>

Human-review drafts only. Never publishes. Never sends replies. Never mutates Google.`);
};

const readJsonIfExists = (filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
};

const writeReport = (outDir, fileName, data) => {
  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, fileName);
  const payload = typeof data === "string" ? data : `${JSON.stringify(data, null, 2)}\n`;
  fs.writeFileSync(reportPath, payload, "utf8");
  return reportPath;
};

export const runGrowthDrafts = ({
  weeklyPath,
  reviewsPath,
  postsPath,
  factsDir,
  outDir,
  ciOutDir = null,
  summaryPath = null,
  env = process.env,
  now = new Date(),
} = {}) => {
  void PUBLISH_GUARD;
  const weekly = readJsonIfExists(weeklyPath);
  if (!weekly) {
    throw new Error(`Weekly report not found: ${path.resolve(weeklyPath)}`);
  }
  const facts = loadGrowthFacts(factsDir);
  const packet = buildDraftPacket({
    weekly,
    reviewsReport: readJsonIfExists(reviewsPath),
    postsReport: readJsonIfExists(postsPath),
    facts,
    now,
    sourceWeeklyRun: {
      generatedAt: weekly.generatedAt ?? null,
      repository: env.GITHUB_REPOSITORY ?? null,
      workflow: env.GITHUB_WORKFLOW ?? null,
      commitSha: env.GITHUB_SHA ?? null,
      runId: env.GITHUB_RUN_ID ?? null,
    },
  });
  const sanitized = sanitizeDraftPacketForCi(packet, env);

  const absoluteOut = path.resolve(outDir);
  const jsonPath = writeReport(absoluteOut, "growth-drafts.json", sanitized);
  const mdPath = writeReport(absoluteOut, "growth-drafts.md", formatDraftsMarkdown(sanitized));

  const ciPaths = {};
  if (ciOutDir) {
    const absoluteCi = path.resolve(ciOutDir);
    ciPaths.jsonPath = writeReport(absoluteCi, "growth-drafts.sanitized.json", sanitized);
    ciPaths.mdPath = writeReport(
      absoluteCi,
      "growth-drafts.sanitized.md",
      formatDraftsMarkdown(sanitized)
    );
  }

  const summary = formatDraftsJobSummaryMarkdown(sanitized);
  if (summaryPath) {
    const absoluteSummary = path.resolve(summaryPath);
    fs.mkdirSync(path.dirname(absoluteSummary), { recursive: true });
    fs.appendFileSync(absoluteSummary, summary, "utf8");
  }
  if (env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(env.GITHUB_STEP_SUMMARY, summary, "utf8");
  }

  return {
    packet: sanitized,
    safety: DRAFT_SAFETY,
    paths: { jsonPath, mdPath, ...ciPaths },
  };
};

const isMain = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
})();

if (isMain) {
  try {
    const options = parseArgs(process.argv);
    if (options.help) {
      printUsage();
      process.exit(0);
    }
    const { paths, packet } = runGrowthDrafts(options);
    console.log(`Wrote ${paths.jsonPath}`);
    console.log(`Wrote ${paths.mdPath}`);
    if (paths.jsonPath && packet) {
      console.log(
        `Drafts: replies=${packet.reviewReplyDrafts.length} gbp=${packet.gbpPostDraft ? packet.gbpPostDraft.status : "none"} website=${packet.websiteOpportunity ? "yes" : "none"}`
      );
    }
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
