import { existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const mode = process.argv[2] ?? "mobile";
const targetUrl = process.argv[3] ?? "http://127.0.0.1:4325";
const rootDir = process.cwd();
const reportsDir = path.join(rootDir, "qa-reports");
const reportBase = path.join(
  reportsDir,
  mode === "desktop" ? "lighthouse-desktop" : "lighthouse-mobile",
);

if (!existsSync(reportsDir)) {
  mkdirSync(reportsDir, { recursive: true });
}

const cliPath = path.join(
  rootDir,
  "node_modules",
  "lighthouse",
  "cli",
  "index.js",
);

const args = [
  cliPath,
  targetUrl,
  '--chrome-flags=--headless=new',
  '--only-categories=performance,accessibility,best-practices,seo',
  '--output=html',
  '--output=json',
  `--output-path=${reportBase}`,
];

if (mode === "desktop") {
  args.splice(2, 0, "--preset=desktop");
}

const result = spawnSync(process.execPath, args, {
  cwd: rootDir,
  encoding: "utf8",
  stdio: "pipe",
});

if (result.stdout) {
  process.stdout.write(result.stdout);
}

if (result.stderr) {
  process.stderr.write(result.stderr);
}

const windowsCleanupError =
  (result.stdout ?? "").includes("EPERM, Permission denied") ||
  (result.stderr ?? "").includes("EPERM, Permission denied");
const reportsWritten =
  existsSync(`${reportBase}.report.html`) && existsSync(`${reportBase}.report.json`);

if (result.status === 0 || (windowsCleanupError && reportsWritten)) {
  if (windowsCleanupError && reportsWritten) {
    process.stdout.write(
      "\nLighthouse wrote the reports successfully. Ignoring a Windows temp cleanup error after report generation.\n",
    );
  }
  process.exit(0);
}

process.exit(result.status ?? 1);
