import { access } from "node:fs/promises";

const routes = [
  "dist/index.html",
  "dist/services/index.html",
  "dist/service-area/index.html",
  "dist/404.html",
];

const missing = [];
for (const route of routes) {
  try {
    await access(route);
    console.log(`OK ${route}`);
  } catch {
    missing.push(route);
    console.error(`MISSING ${route}`);
  }
}

if (missing.length > 0) {
  console.error(`\nSmoke check failed: ${missing.length} route(s) missing.`);
  process.exit(1);
}

console.log("\nSmoke check passed.");
