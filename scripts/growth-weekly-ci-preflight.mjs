/**
 * CI preflight for Growth Ops shadow workflow.
 * Prints yes/no configuration labels only. Never prints secret values.
 *
 * Exit 0 when required config is present.
 * Exit 2 on configuration_failure.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  assessCiConfig,
  formatCiConfigSummary,
} from "./lib/growth-weekly-ci.mjs";

const parseArgs = (argv) => {
  const options = { summaryPath: null, jsonPath: null, help: false };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--summary-out") options.summaryPath = args[++i];
    else if (arg === "--json-out") options.jsonPath = args[++i];
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
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
      console.log(`Usage: node scripts/growth-weekly-ci-preflight.mjs [--summary-out path] [--json-out path]`);
      process.exit(0);
    }
    const assessment = assessCiConfig(process.env);
    const summary = formatCiConfigSummary(assessment);
    process.stdout.write(summary);
    if (options.summaryPath) {
      fs.mkdirSync(path.dirname(path.resolve(options.summaryPath)), { recursive: true });
      fs.writeFileSync(options.summaryPath, summary, "utf8");
    }
    if (options.jsonPath) {
      fs.mkdirSync(path.dirname(path.resolve(options.jsonPath)), { recursive: true });
      fs.writeFileSync(
        options.jsonPath,
        `${JSON.stringify(assessment, null, 2)}\n`,
        "utf8"
      );
    }
    // GitHub Actions step output (names only).
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(
        process.env.GITHUB_OUTPUT,
        `configured=${assessment.configured ? "true" : "false"}\nfailure_class=${assessment.failureClass ?? ""}\n`,
        "utf8"
      );
    }
    process.exit(assessment.configured ? 0 : 2);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
