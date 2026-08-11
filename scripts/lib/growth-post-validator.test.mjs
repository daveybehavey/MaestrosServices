import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildCanonicalGbpQuoteUrl, validateGbpCtaUrl } from "./growth-cta.mjs";
import {
  findDuplicateMatch,
  normalizePostText,
  scorePostSimilarity,
} from "./growth-duplicate.mjs";
import { loadGrowthFacts } from "./growth-facts.mjs";
import { validateGbpPost } from "./growth-post-validator.mjs";
import {
  formatValidationReport,
  runValidatePostCli,
} from "../growth-validate-post.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const productionFactsDir = path.join(root, "growth");
const overlayFactsDir = path.join(root, "growth/fixtures/facts-verified-overlay");
const postsDir = path.join(root, "growth/fixtures/posts");

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));

const validDraft = () => readJson(path.join(postsDir, "valid-power-washing.json"));

test("production growth facts load and keep services as candidates by default", () => {
  const facts = loadGrowthFacts(productionFactsDir);
  assert.ok(facts.businessFacts.some((f) => f.id === "biz.name" && f.status === "verified"));
  const power = facts.services.find((s) => s.id === "svc.power-washing");
  assert.equal(power.status, "candidate");
  assert.ok(facts.services.every((s) => s.id === "svc.large-tree-felling" || s.status === "candidate"));
  assert.equal(facts.rules.duplicate.nearDuplicateThreshold, 0.82);
});

test("missing facts directory fails closed", () => {
  assert.throws(() => loadGrowthFacts(path.join(root, "growth/does-not-exist")), /Missing facts directory/);
});

test("CTA validator enforces https, host, path, and GBP UTMs", () => {
  const rules = loadGrowthFacts(overlayFactsDir).rules;
  assert.equal(
    validateGbpCtaUrl(
      "https://maestrosservices.com/quote?utm_source=google_business_profile&utm_medium=organic&utm_campaign=gbp_posts#quote",
      rules
    ).ok,
    true
  );
  assert.match(
    validateGbpCtaUrl("http://maestrosservices.com/quote?utm_source=google_business_profile&utm_medium=organic&utm_campaign=gbp_posts", rules)
      .errors.join(" "),
    /HTTPS/
  );
  assert.match(
    validateGbpCtaUrl("https://example.com/quote?utm_source=google_business_profile&utm_medium=organic&utm_campaign=gbp_posts", rules)
      .errors.join(" "),
    /hostname/
  );
  assert.match(
    validateGbpCtaUrl("https://maestrosservices.com/quote", rules).errors.join(" "),
    /utm_source/
  );
  assert.match(
    validateGbpCtaUrl("javascript:alert(1)", rules).errors.join(" "),
    /forbidden scheme/
  );
  assert.ok(buildCanonicalGbpQuoteUrl({ campaign: "GBP Posts!" }).includes("utm_campaign=gbp_posts"));
});

test("duplicate detection catches exact and near-duplicate May power-washing captions", () => {
  const history = readJson(
    path.join(postsDir, "historical-may-power-washing-duplicates.json")
  ).recentPosts;
  const [may26, may29] = history;
  const exact = findDuplicateMatch(may26.summary, [may26], { nearDuplicateThreshold: 0.82 });
  assert.equal(exact.isDuplicate, true);
  assert.equal(exact.exact, true);

  const near = scorePostSimilarity(may26.summary, may29.summary);
  assert.equal(near.exact, false);
  assert.ok(near.score >= 0.82, `expected near-duplicate score >= 0.82, got ${near.score}`);

  const nearMatch = findDuplicateMatch(may29.summary, [may26], {
    nearDuplicateThreshold: 0.82,
  });
  assert.equal(nearMatch.isDuplicate, true);
  assert.equal(nearMatch.type, "near");
  assert.ok(normalizePostText(may26.summary).includes("power washing"));
});

test("valid verified service + area + CTA passes", () => {
  const facts = loadGrowthFacts(overlayFactsDir);
  const result = validateGbpPost({
    draft: validDraft(),
    facts,
    recentPosts: [],
  });
  assert.equal(result.valid, true, result.errors.join("; "));
  assert.ok(result.matchedFactIds.includes("svc.power-washing"));
  assert.ok(result.matchedFactIds.includes("area.shawnigan-lake"));
  assert.ok(result.normalizedCta);
  assert.equal(result.audit.publishes, false);
});

test("valid project-backed statement passes with verified project evidence", () => {
  const facts = loadGrowthFacts(overlayFactsDir);
  const draft = readJson(path.join(postsDir, "valid-project-backed.json"));
  const result = validateGbpPost({ draft, facts, recentPosts: [] });
  assert.equal(result.valid, true, result.errors.join("; "));
  assert.ok(result.matchedFactIds.includes("proj.power-wash-reset"));
});

test("negative: unsupported service fails", () => {
  const facts = loadGrowthFacts(overlayFactsDir);
  const draft = {
    ...validDraft(),
    summary:
      "Large Tree Felling and tree removal around Shawnigan Lake. Send photos for Power Washing instead if that fits better.",
  };
  const result = validateGbpPost({ draft, facts });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /Large Tree Felling/i.test(e)));
});

test("negative: unsupported service area fails", () => {
  const facts = loadGrowthFacts(overlayFactsDir);
  const draft = {
    ...validDraft(),
    summary:
      "Power Washing for homes in Vancouver. Send a photo for a practical quote.",
  };
  const result = validateGbpPost({ draft, facts });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /Vancouver/i.test(e)));
});

test("negative: phone number in body fails", () => {
  const facts = loadGrowthFacts(overlayFactsDir);
  const draft = {
    ...validDraft(),
    summary: `${validDraft().summary} Call 250-858-1781 today.`,
  };
  const result = validateGbpPost({ draft, facts });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /phone/i.test(e)));
});

test("negative: external CTA domain fails", () => {
  const facts = loadGrowthFacts(overlayFactsDir);
  const draft = {
    ...validDraft(),
    callToAction: {
      actionType: "LEARN_MORE",
      url: "https://other-site.com/quote?utm_source=google_business_profile&utm_medium=organic&utm_campaign=gbp_posts",
    },
  };
  const result = validateGbpPost({ draft, facts });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /hostname/i.test(e)));
});

test("negative: HTTP CTA fails", () => {
  const facts = loadGrowthFacts(overlayFactsDir);
  const draft = {
    ...validDraft(),
    callToAction: {
      actionType: "LEARN_MORE",
      url: "http://maestrosservices.com/quote?utm_source=google_business_profile&utm_medium=organic&utm_campaign=gbp_posts",
    },
  };
  const result = validateGbpPost({ draft, facts });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /HTTPS/i.test(e)));
});

test("negative: missing UTM fails", () => {
  const facts = loadGrowthFacts(overlayFactsDir);
  const draft = {
    ...validDraft(),
    callToAction: {
      actionType: "LEARN_MORE",
      url: "https://maestrosservices.com/quote#quote",
    },
  };
  const result = validateGbpPost({ draft, facts });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /utm_source/i.test(e)));
});

test("negative: invented price fails", () => {
  const facts = loadGrowthFacts(overlayFactsDir);
  const draft = {
    ...validDraft(),
    summary: "Power Washing in Shawnigan Lake starting at $99 this month. Send photos for a quote.",
  };
  const result = validateGbpPost({ draft, facts });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /Price\/discount/i.test(e)));
});

test("negative: unsupported discount fails", () => {
  const facts = loadGrowthFacts(overlayFactsDir);
  const draft = {
    ...validDraft(),
    summary: "Power Washing in Shawnigan Lake with a 20% discount special offer. Send photos.",
  };
  const result = validateGbpPost({ draft, facts });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /Price\/discount/i.test(e)));
});

test("negative: available this week fails without availability evidence", () => {
  const facts = loadGrowthFacts(overlayFactsDir);
  const draft = {
    ...validDraft(),
    summary:
      "We have openings this week for Power Washing around Shawnigan Lake. Send photos for a quote.",
  };
  const result = validateGbpPost({ draft, facts });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /Availability/i.test(e)));
});

test("negative: unsupported guarantee/superlative fails", () => {
  const facts = loadGrowthFacts(overlayFactsDir);
  const draft = {
    ...validDraft(),
    summary:
      "Best Power Washing in Shawnigan Lake with a satisfaction guarantee and 20 years of experience.",
  };
  const result = validateGbpPost({ draft, facts });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /Guarantee|superlative|credential/i.test(e)));
});

test("negative: unsupported project claim fails without project evidence", () => {
  const facts = loadGrowthFacts(overlayFactsDir);
  // Remove projects to simulate missing evidence.
  const factsNoProjects = { ...facts, projects: [] };
  const draft = readJson(path.join(postsDir, "valid-project-backed.json"));
  const result = validateGbpPost({ draft, facts: factsNoProjects });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /Project\/job-specific/i.test(e)));
});

test("negative: exact and near duplicates fail closed", () => {
  const facts = loadGrowthFacts(overlayFactsDir);
  const history = readJson(
    path.join(postsDir, "historical-may-power-washing-duplicates.json")
  ).recentPosts;

  const exact = validateGbpPost({
    draft: { ...validDraft(), summary: history[0].summary },
    facts,
    recentPosts: [history[0]],
  });
  assert.equal(exact.valid, false);
  assert.ok(exact.errors.some((e) => /Exact duplicate/i.test(e)));

  const near = validateGbpPost({
    draft: {
      ...validDraft(),
      summary: history[1].summary,
    },
    facts,
    recentPosts: [history[0]],
  });
  assert.equal(near.valid, false);
  assert.ok(near.errors.some((e) => /Near-duplicate|duplicate/i.test(e)));
  assert.ok(near.duplicateScore >= 0.82);
});

test("negative: malformed draft and missing facts/rules fail", () => {
  assert.equal(validateGbpPost({ draft: null, facts: { rules: {} } }).valid, false);
  assert.equal(validateGbpPost({ draft: validDraft(), facts: null }).valid, false);
});

test("candidate services in production facts cause fail-closed on mention", () => {
  const facts = loadGrowthFacts(productionFactsDir);
  const result = validateGbpPost({
    draft: validDraft(),
    facts,
    recentPosts: [],
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /not verified/i.test(e)));
});

test("dry-run CLI reports PASS/FAIL and never claims publish", () => {
  const pass = runValidatePostCli({
    draftPath: path.join(postsDir, "valid-power-washing.json"),
    factsDir: overlayFactsDir,
  });
  assert.equal(pass.result.valid, true);
  assert.equal(pass.meta.guard.mayCallCreatePost, false);
  assert.equal(pass.meta.guard.mayMutateGbp, false);
  const report = formatValidationReport(pass.result, pass.meta);
  assert.match(report, /PASS/);
  assert.match(report, /Publishes: no/);

  const fail = runValidatePostCli({
    draftPath: path.join(postsDir, "valid-power-washing.json"),
    factsDir: productionFactsDir,
  });
  assert.equal(fail.result.valid, false);
  assert.match(formatValidationReport(fail.result, fail.meta), /FAIL/);
});

test("validator module source has no GBP create-post API path", () => {
  const validatorSource = fs.readFileSync(
    path.join(here, "growth-post-validator.mjs"),
    "utf8"
  );
  const cliSource = fs.readFileSync(path.join(root, "scripts/growth-validate-post.mjs"), "utf8");
  const factsSource = fs.readFileSync(path.join(here, "growth-facts.mjs"), "utf8");
  for (const source of [validatorSource, cliSource, factsSource]) {
    assert.equal(/mybusiness\.googleapis\.com\/v4\/.*localPosts/.test(source), false);
    assert.equal(/createLocalPost/.test(source), false);
    assert.equal(/gbp:create-post/.test(source), false);
    assert.equal(/method:\s*["']POST["']/.test(source), false);
  }
});
