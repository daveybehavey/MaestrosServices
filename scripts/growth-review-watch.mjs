/**
 * Growth Ops daily review-watch CLI.
 * Reads GBP reviews report, drafts human-review replies, never sends them.
 *
 * Usage:
 *   npm run growth:review-watch
 *   npm run growth:review-watch -- --reviews qa-reports/gbp-reviews.json
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { loadGrowthFacts } from "./lib/growth-facts.mjs";
import {
  REVIEW_WATCH_SAFETY,
  buildReviewWatchPacket,
  formatReviewWatchJobSummaryMarkdown,
  formatReviewWatchMarkdown,
  sanitizeReviewWatchPacketForCi,
} from "./lib/growth-review-watch.mjs";

const rootDir = process.cwd();
const defaultReportsDir = path.join(rootDir, "qa-reports");

const PUBLISH_GUARD = {
  mayPublish: false,
  maySendReviewReplies: false,
  mayMutateGoogle: false,
  mayDeploy: false,
  command: "growth:review-watch",
};

const parseArgs = (argv) => {
  const options = {
    reviewsPath: path.join(defaultReportsDir, "gbp-reviews.json"),
    factsDir: "growth",
    outDir: defaultReportsDir,
    ciOutDir: null,
    summaryPath: null,
    help: false,
  };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--reviews") options.reviewsPath = args[++i];
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
  npm run growth:review-watch
  npm run growth:review-watch -- --reviews <file>

Human-review reply drafts only. Never sends replies. Never mutates Google.`);
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

export const runGrowthReviewWatch = ({
  reviewsPath,
  factsDir,
  outDir,
  ciOutDir = null,
  summaryPath = null,
  env = process.env,
  now = new Date(),
} = {}) => {
  void PUBLISH_GUARD;
  const reviewsReport = readJsonIfExists(reviewsPath);
  if (!reviewsReport) {
    const error = new Error(`Reviews report not found: ${path.resolve(reviewsPath)}`);
    error.failureClass = "reviews_unavailable";
    throw error;
  }

  const facts = loadGrowthFacts(factsDir);
  const packet = buildReviewWatchPacket({
    reviewsReport,
    facts,
    now,
    source: {
      generatedAt: reviewsReport.generatedAt ?? null,
      repository: env.GITHUB_REPOSITORY ?? null,
      workflow: env.GITHUB_WORKFLOW ?? null,
      commitSha: env.GITHUB_SHA ?? null,
      runId: env.GITHUB_RUN_ID ?? null,
    },
  });
  const sanitized = sanitizeReviewWatchPacketForCi(packet, env);

  const absoluteOut = path.resolve(outDir);
  const jsonPath = writeReport(absoluteOut, "growth-review-watch.json", sanitized);
  const mdPath = writeReport(
    absoluteOut,
    "growth-review-watch.md",
    formatReviewWatchMarkdown(sanitized)
  );

  const ciPaths = {};
  if (ciOutDir) {
    const absoluteCi = path.resolve(ciOutDir);
    ciPaths.jsonPath = writeReport(
      absoluteCi,
      "growth-review-watch.sanitized.json",
      sanitized
    );
    ciPaths.mdPath = writeReport(
      absoluteCi,
      "growth-review-watch.sanitized.md",
      formatReviewWatchMarkdown(sanitized)
    );
  }

  const summary = formatReviewWatchJobSummaryMarkdown(sanitized);
  if (summaryPath) {
    const absoluteSummary = path.resolve(summaryPath);
    fs.mkdirSync(path.dirname(absoluteSummary), { recursive: true });
    fs.writeFileSync(absoluteSummary, summary, "utf8");
  }
  if (env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(env.GITHUB_STEP_SUMMARY, summary, "utf8");
  }

  return {
    packet: sanitized,
    safety: REVIEW_WATCH_SAFETY,
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
    const { paths, packet } = runGrowthReviewWatch(options);
    console.log(`Wrote ${paths.jsonPath}`);
    console.log(`Wrote ${paths.mdPath}`);
    console.log(
      `Review watch: unreplied=${packet.unrepliedCount} drafts=${packet.draftCount} repliesSent=0`
    );
    process.exit(0);
  } catch (error) {
    const failureClass = error?.failureClass ?? "review_watch_failure";
    console.error(`${failureClass}: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
