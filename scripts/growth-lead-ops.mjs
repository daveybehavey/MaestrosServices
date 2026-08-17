/**
 * Lead Ops v1 CLI.
 * Read-only opportunity ranking from existing Growth Ops reports/facts.
 * Never contacts prospects, mutates Google, publishes, creates ads/pages, or deploys.
 *
 * Usage:
 *   npm run growth:lead-ops
 *   npm run growth:lead-ops -- --from-reports qa-reports
 *   npm run growth:lead-ops -- --skip-collect
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { loadGrowthFacts } from "./lib/growth-facts.mjs";
import {
  collectReadOnlyReports,
  loadWeeklyReportsFromDir,
} from "./growth-weekly.mjs";
import {
  LEAD_OPS_SAFETY,
  buildLeadOpsPacket,
  formatLeadOpsConsoleSummary,
  formatLeadOpsMarkdown,
} from "./lib/growth-lead-ops.mjs";

const rootDir = process.cwd();
const defaultReportsDir = path.join(rootDir, "qa-reports");

const GUARD = {
  mayContactProspects: false,
  maySendEmail: false,
  maySendSms: false,
  mayPublish: false,
  mayMutateGoogle: false,
  mayCreateAds: false,
  mayCreateSeoPages: false,
  mayDeploy: false,
  command: "growth:lead-ops",
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
  npm run growth:lead-ops
  npm run growth:lead-ops -- --from-reports <dir>
  npm run growth:lead-ops -- --skip-collect

Read-only Lead Ops ranking. Never contacts prospects. Never mutates Google.`);
};

const writeReport = (outDir, fileName, data) => {
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, fileName);
  const payload = typeof data === "string" ? data : `${JSON.stringify(data, null, 2)}\n`;
  fs.writeFileSync(reportPath, payload, "utf8");
  return reportPath;
};

export const runGrowthLeadOps = ({
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
  const facts = loadGrowthFacts(factsDir);
  const packet = buildLeadOpsPacket({
    reports,
    facts,
    now,
    collectorResults: collection.attempted ? collection.results : [],
  });

  packet.collection = {
    ...collection,
    reportsDir,
    guard: GUARD,
    safety: LEAD_OPS_SAFETY,
  };

  const jsonPath = writeReport(outDir, "growth-lead-ops.json", packet);
  const mdPath = writeReport(outDir, "growth-lead-ops.md", formatLeadOpsMarkdown(packet));

  return {
    packet,
    paths: { jsonPath, mdPath },
    meta: {
      reportsDir,
      factsDir: path.resolve(factsDir),
      outDir: path.resolve(outDir),
      guard: GUARD,
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
    const { packet, paths } = runGrowthLeadOps(options);
    console.log(formatLeadOpsConsoleSummary(packet));
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
