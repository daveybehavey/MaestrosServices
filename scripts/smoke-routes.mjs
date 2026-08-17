import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const directRoutes = [
  "dist/index.html",
  "dist/services/index.html",
  "dist/service-area/index.html",
  "dist/services-by-area/index.html",
  "dist/quote/index.html",
  "dist/projects/index.html",
  "dist/review/index.html",
  "dist/driveway-faq/index.html",
  "dist/blog/index.html",
  "dist/404.html",
];

async function walkHtmlFiles(root) {
  const files = [];
  const entries = await readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkHtmlFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".html")) {
      files.push(fullPath);
    }
  }

  return files;
}

const missing = [];
for (const route of directRoutes) {
  try {
    await access(route);
    console.log(`OK ${route}`);
  } catch {
    missing.push(route);
    console.error(`MISSING ${route}`);
  }
}

const htmlFiles = await walkHtmlFiles("dist");
const families = {
  areaPages: 0,
  servicePages: 0,
  localizedServicePages: 0,
  blogPosts: 0,
};

for (const file of htmlFiles) {
  const relative = file.split(path.sep).join("/");
  const parts = relative.split("/");

  if (relative.startsWith("dist/areas/") && parts.length === 4 && parts[3] === "index.html") {
    families.areaPages += 1;
    continue;
  }

  if (relative.startsWith("dist/services/") && parts.length === 4 && parts[3] === "index.html") {
    families.servicePages += 1;
    continue;
  }

  if (relative.startsWith("dist/services/") && parts.length === 5 && parts[4] === "index.html") {
    families.localizedServicePages += 1;
    continue;
  }

  if (relative.startsWith("dist/blog/") && parts.length === 4 && parts[3] === "index.html") {
    families.blogPosts += 1;
  }
}

const familyChecks = [
  ["areaPages", families.areaPages],
  ["servicePages", families.servicePages],
  ["localizedServicePages", families.localizedServicePages],
  ["blogPosts", families.blogPosts],
];

for (const [label, count] of familyChecks) {
  if (count < 1) {
    missing.push(label);
    console.error(`MISSING ${label}`);
    continue;
  }

  console.log(`OK ${label}: ${count}`);
}

const contentChecks = [
  {
    file: "dist/blog/gravel-driveway-preparation-chemainus/index.html",
    includes: ["/quote?service=gravel"],
    excludes: ["service=driveway", "Need help with your yard?"],
  },
  {
    file: "dist/services/gravel-driveway-installation/chemainus/index.html",
    includes: [
      "Gravel Driveway Preparation in Chemainus",
      "Typical gravel driveway outcomes",
    ],
    excludes: [
      "How often should I book gravel driveways",
      "weekly, bi-weekly, or seasonal schedule",
      "combine this with lawn mowing and hedge trimming",
      "Gravel Driveways outcomes in Chemainus",
    ],
  },
];

for (const check of contentChecks) {
  try {
    const html = await readFile(check.file, "utf8");
    const missingIncludes = check.includes.filter((snippet) => !html.includes(snippet));
    const presentExcludes = check.excludes.filter((snippet) => html.includes(snippet));
    if (missingIncludes.length > 0 || presentExcludes.length > 0) {
      missing.push(check.file);
      for (const snippet of missingIncludes) {
        console.error(`MISSING CONTENT ${check.file}: ${snippet}`);
      }
      for (const snippet of presentExcludes) {
        console.error(`UNEXPECTED CONTENT ${check.file}: ${snippet}`);
      }
      continue;
    }
    console.log(`OK content ${check.file}`);
  } catch {
    missing.push(check.file);
    console.error(`MISSING ${check.file}`);
  }
}

if (missing.length > 0) {
  console.error(`\nSmoke check failed: ${missing.length} check(s) missing.`);
  process.exit(1);
}

console.log("\nSmoke check passed.");
