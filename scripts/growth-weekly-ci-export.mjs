/**
 * Export a sanitized Growth Ops weekly packet for GitHub Actions artifacts / summaries.
 * Never uploads raw qa-reports review payloads.
 *
 * Usage:
 *   node scripts/growth-weekly-ci-export.mjs --in qa-reports/growth-weekly.json --out-dir artifacts/growth-shadow
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  formatCiJobSummaryMarkdown,
  formatCiMarkdownArtifact,
  sanitizeWeeklyForCi,
} from "./lib/growth-weekly-ci.mjs";

const parseArgs = (argv) => {
  const options = {
    inPath: "qa-reports/growth-weekly.json",
    outDir: "artifacts/growth-shadow",
    summaryPath: null,
    help: false,
  };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--in") options.inPath = args[++i];
    else if (arg === "--out-dir") options.outDir = args[++i];
    else if (arg === "--summary-out") options.summaryPath = args[++i];
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
};

export const exportWeeklyCiPacket = ({
  inPath,
  outDir,
  summaryPath = null,
  env = process.env,
  now = new Date(),
} = {}) => {
  const absoluteIn = path.resolve(inPath);
  if (!fs.existsSync(absoluteIn)) {
    throw new Error(`Weekly report not found: ${absoluteIn}`);
  }
  const report = JSON.parse(fs.readFileSync(absoluteIn, "utf8"));
  const packet = sanitizeWeeklyForCi(report, {
    generatedAt: now.toISOString(),
    run: {
      repository: env.GITHUB_REPOSITORY ?? null,
      workflow: env.GITHUB_WORKFLOW ?? null,
      commitSha: env.GITHUB_SHA ?? null,
      runId: env.GITHUB_RUN_ID ?? null,
      runAttempt: env.GITHUB_RUN_ATTEMPT ?? null,
    },
  });

  const absoluteOut = path.resolve(outDir);
  fs.mkdirSync(absoluteOut, { recursive: true });
  const jsonPath = path.join(absoluteOut, "growth-weekly.sanitized.json");
  const mdPath = path.join(absoluteOut, "growth-weekly.sanitized.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(packet, null, 2)}\n`, "utf8");
  fs.writeFileSync(mdPath, formatCiMarkdownArtifact(packet), "utf8");

  const summary = formatCiJobSummaryMarkdown(packet);
  if (summaryPath) {
    const absoluteSummary = path.resolve(summaryPath);
    fs.mkdirSync(path.dirname(absoluteSummary), { recursive: true });
    fs.writeFileSync(absoluteSummary, summary, "utf8");
  }
  if (env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(env.GITHUB_STEP_SUMMARY, summary, "utf8");
  }

  return { packet, paths: { jsonPath, mdPath, summaryPath } };
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
      console.log(`Usage:
  node scripts/growth-weekly-ci-export.mjs --in qa-reports/growth-weekly.json --out-dir artifacts/growth-shadow`);
      process.exit(0);
    }
    const { paths } = exportWeeklyCiPacket(options);
    console.log(`Wrote ${paths.jsonPath}`);
    console.log(`Wrote ${paths.mdPath}`);
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
