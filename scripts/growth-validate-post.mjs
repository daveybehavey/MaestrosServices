/**
 * Dry-run GBP post validator CLI.
 * Never publishes. Never calls GBP create/update endpoints.
 *
 * Usage:
 *   npm run growth:validate-post -- <draft.json> [--facts-dir <dir>] [--recent <json>]
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { loadGrowthFacts } from "./lib/growth-facts.mjs";
import { validateGbpPost } from "./lib/growth-post-validator.mjs";

const PUBLISH_GUARD = {
  mayCallCreatePost: false,
  mayMutateGbp: false,
  command: "growth:validate-post",
};

const printUsage = () => {
  console.error(
    "Usage: npm run growth:validate-post -- <draft.json> [--facts-dir growth] [--recent recent-posts.json]"
  );
};

const parseArgs = (argv) => {
  const args = argv.slice(2);
  const options = {
    draftPath: null,
    factsDir: "growth",
    recentPath: null,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--facts-dir") {
      options.factsDir = args[++i];
    } else if (arg === "--recent") {
      options.recentPath = args[++i];
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!options.draftPath) {
      options.draftPath = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  return options;
};

const loadRecentPosts = (recentPath) => {
  if (!recentPath) return [];
  const raw = JSON.parse(fs.readFileSync(recentPath, "utf8"));
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.recentPosts)) return raw.recentPosts;
  if (Array.isArray(raw.localPosts)) return raw.localPosts;
  throw new Error("Recent posts file must be an array or contain recentPosts/localPosts.");
};

export const formatValidationReport = (result, meta = {}) => {
  const lines = [];
  lines.push(`Growth Ops GBP post validation: ${result.valid ? "PASS" : "FAIL"}`);
  lines.push(`Publishes: no`);
  lines.push(`Contacts Google: no`);
  if (meta.draftPath) lines.push(`Draft: ${meta.draftPath}`);
  if (meta.factsDir) lines.push(`Facts dir: ${meta.factsDir}`);
  if (result.normalizedCta) lines.push(`Normalized CTA: ${result.normalizedCta}`);
  lines.push(`Matched facts: ${result.matchedFactIds.join(", ") || "(none)"}`);
  lines.push(
    `Duplicate: score=${result.duplicateScore}` +
      (result.duplicateMatch?.isDuplicate
        ? ` (${result.duplicateMatch.type} match)`
        : " (ok)")
  );
  if (result.errors.length) {
    lines.push("Errors:");
    for (const error of result.errors) lines.push(`- ${error}`);
  }
  if (result.warnings.length) {
    lines.push("Warnings:");
    for (const warning of result.warnings) lines.push(`- ${warning}`);
  }
  return lines.join("\n");
};

export const runValidatePostCli = ({
  draftPath,
  factsDir = "growth",
  recentPath = null,
} = {}) => {
  if (!draftPath) {
    throw new Error("Draft JSON path is required.");
  }
  const absDraft = path.resolve(draftPath);
  if (!fs.existsSync(absDraft)) {
    throw new Error(`Draft file not found: ${absDraft}`);
  }

  const draft = JSON.parse(fs.readFileSync(absDraft, "utf8"));
  const facts = loadGrowthFacts(factsDir);
  const recentPosts = loadRecentPosts(recentPath);
  const result = validateGbpPost({ draft, facts, recentPosts });

  return {
    result,
    meta: {
      draftPath: absDraft,
      factsDir: path.resolve(factsDir),
      recentPath: recentPath ? path.resolve(recentPath) : null,
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
    const { result, meta } = runValidatePostCli(options);
    console.log(formatValidationReport(result, meta));
    console.log("");
    console.log(JSON.stringify({ valid: result.valid, errors: result.errors, warnings: result.warnings, matchedFactIds: result.matchedFactIds, duplicateScore: result.duplicateScore, normalizedCta: result.normalizedCta, audit: result.audit, guard: meta.guard }, null, 2));
    process.exit(result.valid ? 0 : 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    printUsage();
    process.exit(1);
  }
}
