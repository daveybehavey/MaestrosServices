import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadGrowthFacts } from "./growth-facts.mjs";
import {
  NEUTRAL_REPLY,
  buildReviewReplyDrafts,
  buildReviewReplyDraftsFromReviews,
} from "./growth-drafts.mjs";
import {
  GROWTH_REVIEW_WATCH_WORKFLOW_PATH,
  REVIEW_WATCH_SAFETY,
  assessReviewWatchConfig,
  auditGrowthReviewWatchWorkflow,
  buildReviewWatchPacket,
  countUnrepliedReviews,
  formatReviewWatchJobSummaryMarkdown,
  sanitizeReviewWatchPacketForCi,
} from "./growth-review-watch.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const facts = loadGrowthFacts(path.join(root, "growth"));

const FAKE_YARD_COMMENT =
  "They finished the yard tidy with weeding, raking, mowing, bush trimming, and bark mulch.";
const FAKE_GENERIC_COMMENT = "Hard workers and showed up on time.";
const FAKE_REVIEWER = "Casey Fixture";

const makeReviewsReport = (reviews) => ({
  generatedAt: "2026-08-15T12:00:00.000Z",
  reviews,
});

const unrepliedFive = {
  reviewId: "rev_watch_five",
  starRating: "FIVE",
  comment: FAKE_GENERIC_COMMENT,
  reviewerDisplayName: FAKE_REVIEWER,
  hasOwnerReply: false,
};

const unrepliedYard = {
  reviewId: "rev_watch_yard",
  starRating: "FIVE",
  comment: FAKE_YARD_COMMENT,
  reviewerDisplayName: "Jordan Fixture",
  hasOwnerReply: false,
};

const unrepliedLow = {
  reviewId: "rev_watch_low",
  starRating: "TWO",
  comment: "The timing was not what we expected.",
  reviewerDisplayName: "Alex Fixture",
  hasOwnerReply: false,
};

const replied = {
  reviewId: "rev_watch_replied",
  starRating: "FIVE",
  comment: "Already answered.",
  reviewerDisplayName: "Pat Fixture",
  hasOwnerReply: true,
  ownerReply: { comment: "Thanks for the kind words." },
};

test("0 unreplied reviews yields 0 drafts", () => {
  const packet = buildReviewWatchPacket({
    reviewsReport: makeReviewsReport([replied]),
    facts,
  });
  assert.equal(packet.unrepliedCount, 0);
  assert.equal(packet.draftCount, 0);
  assert.deepEqual(packet.drafts, []);
});

test("1 unreplied review yields 1 draft", () => {
  const packet = buildReviewWatchPacket({
    reviewsReport: makeReviewsReport([unrepliedFive, replied]),
    facts,
  });
  assert.equal(packet.unrepliedCount, 1);
  assert.equal(packet.draftCount, 1);
  assert.equal(packet.drafts[0].reviewId, "rev_watch_five");
});

test("2 unreplied reviews yield 2 drafts", () => {
  const packet = buildReviewWatchPacket({
    reviewsReport: makeReviewsReport([unrepliedFive, unrepliedYard, replied]),
    facts,
  });
  assert.equal(packet.unrepliedCount, 2);
  assert.equal(packet.draftCount, 2);
});

test("replied review is excluded", () => {
  const packet = buildReviewWatchPacket({
    reviewsReport: makeReviewsReport([replied, unrepliedFive]),
    facts,
  });
  assert.equal(packet.drafts.some((row) => row.reviewId === "rev_watch_replied"), false);
});

test("FIVE-star uses positive approved path", () => {
  const packet = buildReviewWatchPacket({
    reviewsReport: makeReviewsReport([unrepliedFive]),
    facts,
  });
  assert.match(packet.drafts[0].draftReply, /kind review/i);
});

test("low rating uses neutral path", () => {
  const packet = buildReviewWatchPacket({
    reviewsReport: makeReviewsReport([unrepliedLow]),
    facts,
  });
  assert.equal(packet.drafts[0].draftReply, NEUTRAL_REPLY);
});

test("supported serviceRefs are retained for yard cleanup wording", () => {
  const packet = buildReviewWatchPacket({
    reviewsReport: makeReviewsReport([unrepliedYard]),
    facts,
  });
  assert.match(packet.drafts[0].draftReply, /yard cleanup/i);
  assert.ok(packet.drafts[0].serviceRefs.includes("svc.lawn-mowing"));
  assert.ok(packet.drafts[0].serviceRefs.includes("svc.seasonal-cleanups"));
});

test("unsupported service is not introduced", () => {
  const packet = buildReviewWatchPacket({
    reviewsReport: makeReviewsReport([
      {
        ...unrepliedFive,
        comment: "Great snow removal and roofing work.",
      },
    ]),
    facts,
  });
  assert.deepEqual(packet.drafts[0].serviceRefs, []);
  assert.equal(packet.drafts[0].draftReply.includes("snow"), false);
  assert.equal(packet.drafts[0].draftReply.includes("roof"), false);
});

test("sanitized packet excludes reviewer name, raw comment, ownerReply, and customer PII", () => {
  const packet = sanitizeReviewWatchPacketForCi(
    buildReviewWatchPacket({
      reviewsReport: makeReviewsReport([
        unrepliedYard,
        {
          ...replied,
          comment: "Call me at 250-555-0199 or email person@example.com",
        },
      ]),
      facts,
    })
  );
  const blob = JSON.stringify(packet);
  assert.equal(blob.includes(FAKE_REVIEWER), false);
  assert.equal(blob.includes("Jordan Fixture"), false);
  assert.equal(blob.includes(FAKE_YARD_COMMENT), false);
  assert.equal(blob.includes("ownerReply"), false);
  assert.equal(blob.includes("250-555-0199"), false);
  assert.equal(blob.includes("person@example.com"), false);
  assert.equal(blob.includes("reviewerDisplayName"), false);
});

test("sendEligible=false and requiresHumanReview=true", () => {
  const packet = buildReviewWatchPacket({
    reviewsReport: makeReviewsReport([unrepliedFive]),
    facts,
  });
  assert.equal(packet.safety.sendEligible, false);
  assert.equal(packet.safety.requiresHumanReview, true);
  assert.equal(packet.drafts[0].sendEligible, false);
  assert.equal(packet.drafts[0].requiresHumanReview, true);
  assert.deepEqual(packet.safety, { ...REVIEW_WATCH_SAFETY });
});

test("failed or missing review source does not fabricate drafts", () => {
  assert.throws(
    () => buildReviewWatchPacket({ reviewsReport: null, facts }),
    /unavailable|malformed/i
  );
  assert.throws(
    () => buildReviewWatchPacket({ reviewsReport: { generatedAt: "x" }, facts }),
    /unavailable|malformed/i
  );
  assert.equal(countUnrepliedReviews(null), null);
  assert.equal(countUnrepliedReviews({}), null);
});

test("job summary contains counts only and not reply text", () => {
  const packet = buildReviewWatchPacket({
    reviewsReport: makeReviewsReport([unrepliedYard]),
    facts,
  });
  const summary = formatReviewWatchJobSummaryMarkdown(packet);
  assert.match(summary, /Unreplied reviews: 1/);
  assert.match(summary, /Human-review drafts: 1/);
  assert.match(summary, /Replies sent: 0/);
  assert.equal(summary.includes(packet.drafts[0].draftReply), false);
  assert.equal(summary.includes("reviewId"), false);
});

test("local packet matches existing P2B draft semantics", () => {
  const reviewsReport = makeReviewsReport([unrepliedYard, unrepliedLow, replied]);
  const watch = buildReviewWatchPacket({ reviewsReport, facts });
  const p2b = buildReviewReplyDrafts({
    weekly: {
      reviewOpportunity: { actionRecommended: true, unrepliedCount: 2 },
    },
    reviewsReport,
    facts,
  });
  const fromReviews = buildReviewReplyDraftsFromReviews({ reviewsReport, facts });
  assert.deepEqual(watch.drafts, fromReviews);
  assert.deepEqual(watch.drafts, p2b);
});

test("review-watch workflow is contents:read only with no write paths", () => {
  const yamlText = fs.readFileSync(
    path.join(root, GROWTH_REVIEW_WATCH_WORKFLOW_PATH),
    "utf8"
  );
  const audit = auditGrowthReviewWatchWorkflow(yamlText);
  assert.equal(audit.ok, true, audit.violations.join("; "));
  assert.equal(audit.checks.hasContentsRead, true);
  assert.equal(audit.checks.hasContentsWrite, false);
  assert.equal(audit.checks.hasIssuesWrite, false);
  assert.equal(audit.checks.hasPullRequestsWrite, false);
  assert.equal(audit.checks.runsReviewWatch, true);
  assert.equal(audit.checks.runsGbpReviews, true);
  assert.equal(audit.checks.runsWeeklyStack, false);
  assert.equal(audit.checks.allActionsPinnedToSha, true);
  assert.equal(audit.checks.checkoutPersistCredentialsFalse, true);
});

test("review-watch module and CLI have no send/write mutation paths", () => {
  const lib = fs.readFileSync(path.join(here, "growth-review-watch.mjs"), "utf8");
  const cli = fs.readFileSync(path.join(root, "scripts/growth-review-watch.mjs"), "utf8");
  for (const source of [lib, cli]) {
    assert.equal(/reviews\/.*\/reply/.test(source), false);
    assert.equal(/createLocalPost/.test(source), false);
    assert.equal(/gbp:create-post/.test(source), false);
    assert.equal(/ads:create/.test(source), false);
    assert.equal(/gh\s+pr\s+create/.test(source), false);
    assert.equal(/gh\s+issue\s+create/.test(source), false);
    assert.equal(/git\s+push/.test(source), false);
    assert.equal(/method:\s*["']POST["']/.test(source), false);
  }
});

test("review-watch preflight succeeds without shared GOOGLE_OAUTH_REFRESH_TOKEN", () => {
  const assessment = assessReviewWatchConfig({
    GOOGLE_OAUTH_CLIENT_ID: "shared-client-id",
    GOOGLE_OAUTH_CLIENT_SECRET: "shared-client-secret",
    GOOGLE_GBP_OAUTH_REFRESH_TOKEN: "gbp-refresh-only",
    GOOGLE_GBP_LOCATION_NAME: "locations/1",
    GOOGLE_GBP_ACCOUNT_NAME: "accounts/1",
  });
  assert.equal(assessment.configured, true);
  assert.equal(assessment.labels.GOOGLE_GBP_OAUTH_REFRESH_TOKEN, "yes");
  assert.equal(assessment.labels.GOOGLE_OAUTH_REFRESH_TOKEN, undefined);
  assert.equal(assessment.labels.GOOGLE_GA4_PROPERTY_ID, undefined);
  assert.equal(
    assessment.missingRequired.includes("GOOGLE_OAUTH_REFRESH_TOKEN"),
    false
  );
});

test("review-watch preflight fails when dedicated GBP refresh token is missing", () => {
  const assessment = assessReviewWatchConfig({
    GOOGLE_OAUTH_CLIENT_ID: "shared-client-id",
    GOOGLE_OAUTH_CLIENT_SECRET: "shared-client-secret",
    GOOGLE_OAUTH_REFRESH_TOKEN: "shared-refresh-must-not-satisfy",
    GOOGLE_GBP_LOCATION_NAME: "locations/1",
    GOOGLE_GBP_ACCOUNT_NAME: "accounts/1",
  });
  assert.equal(assessment.configured, false);
  assert.ok(
    assessment.missingRequired.includes("GOOGLE_GBP_OAUTH_REFRESH_TOKEN")
  );
});

test("review-watch preflight accepts optional GBP-specific client credentials alone", () => {
  const assessment = assessReviewWatchConfig({
    GOOGLE_GBP_OAUTH_CLIENT_ID: "gbp-client-id",
    GOOGLE_GBP_OAUTH_CLIENT_SECRET: "gbp-client-secret",
    GOOGLE_GBP_OAUTH_REFRESH_TOKEN: "gbp-refresh-only",
    GOOGLE_GBP_LOCATION_NAME: "locations/1",
    GOOGLE_GBP_ACCOUNT_NAME: "accounts/1",
  });
  assert.equal(assessment.configured, true);
  assert.equal(assessment.labels.GOOGLE_GBP_OAUTH_CLIENT_ID, "yes");
  assert.equal(assessment.labels.GOOGLE_GBP_OAUTH_CLIENT_SECRET, "yes");
  assert.equal(assessment.labels.GOOGLE_OAUTH_CLIENT_ID, "no");
  assert.equal(assessment.labels.GOOGLE_OAUTH_CLIENT_SECRET, "no");
});

test("review-watch workflow does not expose shared GOOGLE_OAUTH_REFRESH_TOKEN", () => {
  const yaml = fs.readFileSync(
    path.join(root, GROWTH_REVIEW_WATCH_WORKFLOW_PATH),
    "utf8"
  );
  assert.equal(/secrets\.GOOGLE_OAUTH_REFRESH_TOKEN/.test(yaml), false);
  assert.match(yaml, /secrets\.GOOGLE_GBP_OAUTH_REFRESH_TOKEN/);
  assert.match(yaml, /contents:\s*read/);
  assert.equal(/contents:\s*write/.test(yaml), false);
  assert.equal(/reviews\/.*\/reply/.test(yaml), false);
  assert.equal(/gbp:create-post/.test(yaml), false);
  assert.equal(/git\s+push/.test(yaml), false);
  assert.equal(/gh\s+pr\s+create/.test(yaml), false);
  assert.equal(/gh\s+issue\s+create/.test(yaml), false);
  assert.equal(/wrangler\s+deploy/.test(yaml), false);
});
