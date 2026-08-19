import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");

const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("Chemainus gravel blog quote CTAs preselect gravel, not driveway grading", () => {
  const source = read("src/content/blog/gravel-driveway-preparation-chemainus.md");
  assert.match(source, /\/quote\?service=gravel#quote/);
  assert.equal(source.includes("service=driveway"), false);
});

test("Chemainus gravel location page heading stays conservative", () => {
  const source = read("src/pages/services/[serviceSlug]/[locationSlug].astro");
  assert.match(source, /isChemainusGravel/);
  assert.match(source, /Gravel Driveway Preparation Near Chemainus/);
  assert.equal(source.includes("Gravel Driveway Preparation in Chemainus"), false);
  assert.match(source, /<h1 class="section-title">\{pageHeading\}<\/h1>/);
});

test("Chemainus gravel FAQ is conditional, not an absolute yes", () => {
  const source = read("src/pages/services/[serviceSlug]/[locationSlug].astro");
  assert.match(source, /Can you take on gravel driveway projects in Chemainus\?/);
  assert.match(source, /we may be able to/);
  assert.equal(source.includes("Do you offer gravel driveways in Chemainus?"), false);
});

test("Chemainus remains a candidate service area, not verified", () => {
  const facts = JSON.parse(read("growth/service-areas.json"));
  const chemainus = facts.areas.find((area) => area.id === "area.chemainus");
  assert.equal(chemainus.status, "candidate");
  assert.equal(chemainus.verifiedAt, null);
});

test("driveway location pages do not inject weekly booking FAQs", () => {
  const source = read("src/pages/services/[serviceSlug]/[locationSlug].astro");
  assert.match(source, /if \(!isDrivewayService\) \{/);
  assert.match(source, /How often should I book/);
  const bookingBlock = source.slice(
    source.indexOf("if (!isDrivewayService)"),
    source.indexOf("if (service.slug === \"gravel-driveway-installation\")"),
  );
  assert.match(bookingBlock, /weekly, bi-weekly, or seasonal schedule/);
});

test("quote form applies service query params on the static quote page", () => {
  const source = read("src/components/QuoteForm.astro");
  assert.match(source, /allowedQuoteServices/);
  assert.match(source, /params\.get\("service"\)/);
  assert.match(source, /serviceSelect\.value = serviceParam/);
});

test("gravel driveway service still has no verified project evidence records", () => {
  const projectsDir = path.join(root, "growth/projects");
  const files = fs.readdirSync(projectsDir).filter((name) => name.endsWith(".json"));
  assert.deepEqual(files, []);
});
