/**
 * Growth Ops weekly intelligence CLI.
 * Collects read-only reports (or loads fixtures), runs the pure decision engine,
 * and writes ignored qa-reports output. Never publishes or mutates Google.
 *
 * Usage:
 *   npm run growth:weekly
 *   npm run growth:weekly -- --from-reports qa-reports
 *   npm run growth:weekly -- --from-reports growth/fixtures/weekly/case-reviews --skip-collect
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import { loadGrowthFacts, verifiedOnly } from "./lib/growth-facts.mjs";
import { buildCollectorResult } from "./lib/growth-collector-diagnostics.mjs";
import {
  COLLECTOR_REPORT_MAP,
  WEEKLY_SAFETY,
  buildWeeklyIntelligence,
  formatWeeklyMarkdown,
} from "./lib/growth-weekly.mjs";

const rootDir = process.cwd();
const defaultReportsDir = path.join(rootDir, "qa-reports");

const PUBLISH_GUARD = {
  mayPublish: false,
  mayMutateGoogle: false,
  mayDeploy: false,
  command: "growth:weekly",
};

const parseArgs = (argv) => {
  const args = argv.slice(2);
  const options = {
    fromReports: null,
    skipCollect: false,
    factsDir: "growth",
    outDir: defaultReportsDir,
    help: false,
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--from-reports") {
      options.fromReports = args[++i];
    } else if (arg === "--skip-collect") {
      options.skipCollect = true;
    } else if (arg === "--facts-dir") {
      options.factsDir = args[++i];
    } else if (arg === "--out-dir") {
      options.outDir = args[++i];
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  if (options.fromReports) options.skipCollect = true;
  return options;
};

const printUsage = () => {
  console.error(`Usage:
  npm run growth:weekly
  npm run growth:weekly -- --from-reports <dir>
  npm run growth:weekly -- --skip-collect

Read-only. Never publishes. Never mutates Google. Never deploys.`);
};

const readJsonIfExists = (filePath) => {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
};

const writeReport = (outDir, fileName, data) => {
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, fileName);
  const payload = typeof data === "string" ? data : `${JSON.stringify(data, null, 2)}\n`;
  fs.writeFileSync(reportPath, payload, "utf8");
  return reportPath;
};

export const runNpmScript = (scriptName, { env = process.env } = {}) => {
  const result = spawnSync("npm", ["run", scriptName], {
    cwd: rootDir,
    encoding: "utf8",
    shell: true,
    env,
  });

  // Capture child output only long enough to sanitize; never return raw streams.
  return buildCollectorResult({
    script: scriptName,
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null,
    env,
  });
};

export const collectReadOnlyReports = () => {
  const collectors = Object.keys(COLLECTOR_REPORT_MAP);
  const results = [];
  for (const script of collectors) {
    results.push(runNpmScript(script));
  }
  return results;
};

export const loadWeeklyReportsFromDir = (reportsDir) => {
  const dir = path.resolve(reportsDir);
  return {
    ga4: readJsonIfExists(path.join(dir, COLLECTOR_REPORT_MAP["reporting:ga4"].file)),
    gsc: readJsonIfExists(path.join(dir, COLLECTOR_REPORT_MAP["reporting:gsc"].file)),
    gbpPerformance: readJsonIfExists(
      path.join(dir, COLLECTOR_REPORT_MAP["gbp:performance"].file)
    ),
    gbpKeywords: readJsonIfExists(
      path.join(dir, COLLECTOR_REPORT_MAP["gbp:search-keywords"].file)
    ),
    gbpReviews: readJsonIfExists(path.join(dir, COLLECTOR_REPORT_MAP["gbp:reviews"].file)),
    gbpPosts: readJsonIfExists(path.join(dir, COLLECTOR_REPORT_MAP["gbp:list-posts"].file)),
  };
};

export const loadWeeklyCatalog = (factsDir = "growth") => {
  const facts = loadGrowthFacts(factsDir);
  return {
    services: verifiedOnly(facts.services),
    areas: verifiedOnly(facts.areas),
  };
};

export const formatWeeklyConsoleSummary = (report) => {
  const lines = [];
  lines.push(`Growth Ops weekly intelligence: ${report.mode}`);
  lines.push(`Publishes: no`);
  lines.push(`Mutates Google: no`);
  lines.push(`Deploys: no`);
  lines.push(`Human review required: yes`);
  lines.push(`Auto-publish eligible: no`);
  lines.push(`Actions: ${report.actions.length}`);
  for (const action of report.actions) {
    lines.push(`  ${action.priority}. [${action.confidence}] ${action.title}`);
  }
  lines.push(
    `Post opportunity: shouldDraft=${report.postOpportunity.shouldDraft} (${report.postOpportunity.reason})`
  );
  lines.push(
    `Review opportunity: unreplied=${report.reviewOpportunity.unrepliedCount} action=${report.reviewOpportunity.actionRecommended}`
  );
  if (report.collection?.attempted && Array.isArray(report.collection.results)) {
    const failed = report.collection.results.filter((row) => !row.ok);
    if (failed.length) {
      lines.push(`Collector failures: ${failed.length}`);
      for (const row of failed.slice(0, 8)) {
        lines.push(
          `  - ${row.script}: ${row.failureClass ?? "unknown_collector_failure"}`
        );
      }
    }
  }
  if (report.dataQuality.issues.length) {
    lines.push(`Data-quality issues: ${report.dataQuality.issues.length}`);
    for (const issue of report.dataQuality.issues.slice(0, 8)) {
      lines.push(`  - ${issue.source}: ${issue.code}`);
    }
  }
  return lines.join("\n");
};

export const runGrowthWeekly = ({
  fromReports = null,
  skipCollect = false,
  factsDir = "growth",
  outDir = defaultReportsDir,
  now = new Date(),
  collectFn = collectReadOnlyReports,
} = {}) => {
  const collection = {
    attempted: !skipCollect && !fromReports,
    results: [],
  };
  if (collection.attempted) {
    collection.results = collectFn();
  }

  const reportsDir = fromReports ? path.resolve(fromReports) : defaultReportsDir;
  const reports = loadWeeklyReportsFromDir(reportsDir);
  const catalog = loadWeeklyCatalog(factsDir);
  const report = buildWeeklyIntelligence({
    reports,
    catalog,
    now,
    collectorResults: collection.attempted ? collection.results : [],
  });

  // Attach collector status without implying missing==zero.
  report.collection = {
    ...collection,
    reportsDir,
    guard: PUBLISH_GUARD,
    safety: WEEKLY_SAFETY,
  };

  const jsonPath = writeReport(outDir, "growth-weekly.json", report);
  const mdPath = writeReport(outDir, "growth-weekly.md", formatWeeklyMarkdown(report));

  return {
    report,
    paths: { jsonPath, mdPath },
    meta: {
      reportsDir,
      factsDir: path.resolve(factsDir),
      outDir: path.resolve(outDir),
      guard: PUBLISH_GUARD,
    },
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
    const { report, paths } = runGrowthWeekly(options);
    console.log(formatWeeklyConsoleSummary(report));
    console.log("");
    console.log(`Wrote ${paths.jsonPath}`);
    console.log(`Wrote ${paths.mdPath}`);
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    printUsage();
    process.exit(1);
  }
}
