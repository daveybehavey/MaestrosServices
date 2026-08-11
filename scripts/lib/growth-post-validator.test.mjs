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
  assert.ok(result.errors.some((e) => /offerRef|Price\/discount/i.test(e)));
  assert.ok(result.audit.unsupportedClaims.some((c) => c.claim === "price_or_discount"));
});

test("negative: unsupported discount fails", () => {
  const facts = loadGrowthFacts(overlayFactsDir);
  const draft = {
    ...validDraft(),
    summary: "Power Washing in Shawnigan Lake with a 20% discount special offer. Send photos.",
  };
  const result = validateGbpPost({ draft, facts });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /offerRef|Price\/discount/i.test(e)));
});

test("negative: available this week fails without availability evidence", () => {
  const facts = loadGrowthFacts(overlayFactsDir);
  const draft = {
    ...validDraft(),
    summary:
      "We have openings this week for Power Washing around Shawnigan Lake. Send photos for a quote.",
  };
  const result = validateGbpPost({ draft, facts, now: new Date("2026-08-11T12:00:00Z") });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /availabilityRef|Availability/i.test(e)));
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
  assert.ok(result.errors.some((e) => /claimRefs|Guarantee|superlative|credential/i.test(e)));
});

test("negative: unsupported project claim fails without project evidence", () => {
  const facts = loadGrowthFacts(overlayFactsDir);
  const factsNoProjects = { ...facts, projects: [] };
  const draft = readJson(path.join(postsDir, "valid-project-backed.json"));
  const result = validateGbpPost({ draft, facts: factsNoProjects });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /projectRef|Project\/job-specific|Unknown evidence/i.test(e)));
});

test("PASS: exact verified price/offer evidence binds", () => {
  const facts = loadGrowthFacts(overlayFactsDir);
  const draft = readJson(path.join(postsDir, "valid-price-bound.json"));
  const result = validateGbpPost({ draft, facts });
  assert.equal(result.valid, true, result.errors.join("; "));
  assert.ok(result.audit.matchedEvidenceIds.includes("offer.pw-minimum-250"));
  assert.ok(result.audit.evidenceBindings.some((b) => b.role === "offer"));
});

test("PASS: exact current availability evidence binds", () => {
  const facts = loadGrowthFacts(overlayFactsDir);
  const draft = readJson(path.join(postsDir, "valid-availability-bound.json"));
  const result = validateGbpPost({
    draft,
    facts,
    now: new Date("2026-08-11T12:00:00Z"),
  });
  assert.equal(result.valid, true, result.errors.join("; "));
  assert.ok(result.audit.matchedEvidenceIds.includes("availability.pw-shawnigan-current"));
});

test("PASS: exact verified credential evidence binds", () => {
  const facts = loadGrowthFacts(overlayFactsDir);
  const draft = readJson(path.join(postsDir, "valid-credential-bound.json"));
  const result = validateGbpPost({ draft, facts });
  assert.equal(result.valid, true, result.errors.join("; "));
  assert.ok(result.audit.matchedEvidenceIds.includes("credential.insured"));
});

test("PASS: approved testimonial evidence binds", () => {
  const facts = loadGrowthFacts(overlayFactsDir);
  const draft = readJson(path.join(postsDir, "valid-testimonial-bound.json"));
  const result = validateGbpPost({ draft, facts });
  assert.equal(result.valid, true, result.errors.join("; "));
  assert.ok(result.audit.matchedEvidenceIds.includes("testimonial.driveway-algae"));
});

test("PASS: project claim correctly bound to its project/service/area", () => {
  const facts = loadGrowthFacts(overlayFactsDir);
  const draft = {
    summary:
      "We just finished a Retaining Walls repair in Sooke. Send photos for a practical quote.",
    topicType: "STANDARD",
    projectRef: "proj.sooke-retaining-wall",
    callToAction: validDraft().callToAction,
  };
  const result = validateGbpPost({ draft, facts });
  assert.equal(result.valid, true, result.errors.join("; "));
  assert.ok(result.audit.matchedEvidenceIds.includes("proj.sooke-retaining-wall"));
  assert.ok(result.matchedFactIds.includes("svc.retaining-walls"));
  assert.ok(result.matchedFactIds.includes("area.sooke"));
});

test("FAIL: wrong dollar amount against verified offer", () => {
  const facts = loadGrowthFacts(overlayFactsDir);
  const draft = {
    ...validDraft(),
    summary:
      "Power Washing in Shawnigan Lake starting at $199 this month. Send photos for a quote.",
    offerRef: "offer.pw-minimum-250",
    claimedPrice: { amount: 199 },
  };
  const result = validateGbpPost({ draft, facts });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /\$199|does not match offer/i.test(e)));
});

test("FAIL: wrong discount percent against verified offer", () => {
  const facts = loadGrowthFacts(overlayFactsDir);
  const draft = {
    ...validDraft(),
    summary: "Power Washing in Shawnigan Lake with 20% off this month. Send photos.",
    offerRef: "offer.spring-10-off",
    claimedDiscount: { percent: 20 },
  };
  const result = validateGbpPost({ draft, facts, now: new Date("2026-08-11T12:00:00Z") });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /20%|does not match offer/i.test(e)));
});

test("FAIL: expired availability evidence", () => {
  const facts = loadGrowthFacts(overlayFactsDir);
  const draft = {
    ...validDraft(),
    summary:
      "We have openings this week for Power Washing around Shawnigan Lake. Send photos for a quote.",
    availabilityRef: "availability.pw-shawnigan-expired",
    claimedAvailability: { key: "openings_this_week" },
  };
  const result = validateGbpPost({
    draft,
    facts,
    now: new Date("2026-08-11T12:00:00Z"),
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /expired|not yet valid/i.test(e)));
});

test("FAIL: availability evidence for another service/area", () => {
  const facts = loadGrowthFacts(overlayFactsDir);
  const draft = {
    ...validDraft(),
    summary:
      "We have openings this week for Power Washing around Shawnigan Lake. Send photos for a quote.",
    availabilityRef: "availability.fence-victoria",
    claimedAvailability: { key: "openings_this_week" },
  };
  const result = validateGbpPost({
    draft,
    facts,
    now: new Date("2026-08-11T12:00:00Z"),
  });
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((e) => /does not cover (service|area)/i.test(e)),
    result.errors.join("; ")
  );
});

test("FAIL: unrelated verified claim does not authorize licensed/insured/certified/#1/best/years", () => {
  const facts = loadGrowthFacts(overlayFactsDir);
  const draft = {
    ...validDraft(),
    summary:
      "Licensed, insured, and certified Power Washing in Shawnigan Lake. Best and #1 crew with 10 years of experience.",
    claimRefs: ["claim.unrelated-verified"],
  };
  const result = validateGbpPost({ draft, facts });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /insured/i.test(e)));
  assert.ok(result.errors.some((e) => /licensed/i.test(e)));
  assert.ok(result.errors.some((e) => /certified/i.test(e)));
  assert.ok(result.errors.some((e) => /superlative/i.test(e)));
  assert.ok(result.errors.some((e) => /years experience/i.test(e)));
  assert.ok(
    result.audit.unsupportedClaims.some((c) => /insured|licensed|certified|superlative|years/i.test(c.claim))
  );
});

test("FAIL: invented testimonial despite another verified testimonial", () => {
  const facts = loadGrowthFacts(overlayFactsDir);
  const draft = {
    ...validDraft(),
    summary:
      'Our customers say "Absolutely the fastest crew we have ever hired for outdoor work." Power Washing around Shawnigan Lake.',
    testimonialRef: "testimonial.driveway-algae",
  };
  const result = validateGbpPost({ draft, facts });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /does not match approved quote/i.test(e)));
});

test("FAIL: Langford power-washing project must not authorize Sooke retaining-wall claim", () => {
  const facts = loadGrowthFacts(overlayFactsDir);
  const draft = {
    summary:
      "We just finished a Retaining Walls job in Sooke. Send photos for a practical quote.",
    topicType: "STANDARD",
    projectRef: "proj.langford-power-wash",
    callToAction: validDraft().callToAction,
  };
  const result = validateGbpPost({ draft, facts });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /does not include mentioned service/i.test(e)));
  assert.ok(result.errors.some((e) => /does not include mentioned area/i.test(e)));
});

test("FAIL: project service mismatch", () => {
  const facts = loadGrowthFacts(overlayFactsDir);
  const draft = {
    summary:
      "We just finished Fence Work near Shawnigan Lake. Send photos for a quote.",
    topicType: "STANDARD",
    projectRef: "proj.power-wash-reset",
    callToAction: validDraft().callToAction,
  };
  const result = validateGbpPost({ draft, facts });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /does not include mentioned service/i.test(e)));
});

test("FAIL: project area mismatch", () => {
  const facts = loadGrowthFacts(overlayFactsDir);
  const draft = {
    summary:
      "We just finished Power Washing in Victoria. Send photos for a quote.",
    topicType: "STANDARD",
    projectRef: "proj.power-wash-reset",
    callToAction: validDraft().callToAction,
  };
  const result = validateGbpPost({ draft, facts });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /does not include mentioned area/i.test(e)));
});

test("FAIL: sensitive claim with no evidence reference", () => {
  const facts = loadGrowthFacts(overlayFactsDir);
  const draft = {
    ...validDraft(),
    summary: "Insured Power Washing around Shawnigan Lake. Send photos for a quote.",
  };
  const result = validateGbpPost({ draft, facts });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /claimRefs/i.test(e)));
  assert.ok(result.audit.unsupportedClaims.some((c) => c.reason === "missing_claimRefs"));
});

test("FAIL: unknown evidence ID", () => {
  const facts = loadGrowthFacts(overlayFactsDir);
  const draft = {
    ...validDraft(),
    summary:
      "Power Washing in Shawnigan Lake starting at $250 this month. Send photos for a quote.",
    offerRef: "offer.does-not-exist",
  };
  const result = validateGbpPost({ draft, facts });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /Unknown evidence id/i.test(e)));
  assert.ok(result.audit.rejectedEvidence.some((r) => r.reason === "unknown_evidence_id"));
});

test("FAIL: candidate/unverified evidence ID", () => {
  const facts = loadGrowthFacts(overlayFactsDir);
  const draft = {
    ...validDraft(),
    summary:
      "Power Washing in Shawnigan Lake starting at $199 this month. Send photos for a quote.",
    offerRef: "offer.candidate-price",
  };
  const result = validateGbpPost({ draft, facts });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /not verified/i.test(e)));
  assert.ok(result.audit.rejectedEvidence.some((r) => String(r.reason).startsWith("status:")));
});

test("audit includes evidence binding fields on pass and fail", () => {
  const facts = loadGrowthFacts(overlayFactsDir);
  const pass = validateGbpPost({
    draft: readJson(path.join(postsDir, "valid-price-bound.json")),
    facts,
  });
  assert.ok(Array.isArray(pass.audit.requestedEvidenceIds));
  assert.ok(Array.isArray(pass.audit.matchedEvidenceIds));
  assert.ok(Array.isArray(pass.audit.rejectedEvidence));
  assert.ok(Array.isArray(pass.audit.unsupportedClaims));
  assert.ok(Array.isArray(pass.audit.evidenceBindings));

  const fail = validateGbpPost({
    draft: {
      ...validDraft(),
      summary: "Insured Power Washing around Shawnigan Lake. Send photos.",
    },
    facts,
  });
  assert.equal(fail.valid, false);
  assert.ok(fail.audit.unsupportedClaims.length >= 1);
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
