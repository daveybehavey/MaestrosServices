import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadGrowthFacts } from "./growth-facts.mjs";
import { validateGbpPost } from "./growth-post-validator.mjs";
import {
  DRAFT_SAFETY,
  buildDraftPacket,
  buildReviewReplyDrafts,
  formatDraftsJobSummaryMarkdown,
  matchVerifiedServicesFromComment,
  sanitizeDraftPacketForCi,
} from "./growth-drafts.mjs";
import { auditGrowthShadowWorkflow } from "./growth-weekly-ci.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const facts = loadGrowthFacts(path.join(root, "growth"));

const FAKE_YARD_COMMENT =
  "They finished the yard tidy with weeding, raking, mowing, bush trimming, and bark mulch.";
const FAKE_GENERIC_COMMENT = "Hard workers and showed up on time.";
const FAKE_REVIEWER_YARD = "Casey Fixture";
const FAKE_REVIEWER_GENERIC = "Jordan Fixture";

const fakeReviewsReport = ({ extra = [] } = {}) => ({
  generatedAt: "2026-08-14T12:00:00.000Z",
  reviews: [
    {
      reviewId: "rev_fake_yard",
      starRating: "FIVE",
      comment: FAKE_YARD_COMMENT,
      reviewerDisplayName: FAKE_REVIEWER_YARD,
      hasOwnerReply: false,
    },
    {
      reviewId: "rev_fake_generic",
      starRating: "FIVE",
      comment: FAKE_GENERIC_COMMENT,
      reviewerDisplayName: FAKE_REVIEWER_GENERIC,
      hasOwnerReply: false,
    },
    {
      reviewId: "rev_fake_replied",
      starRating: "FIVE",
      comment: "Already answered in fixture.",
      reviewerDisplayName: "Pat Fixture",
      hasOwnerReply: true,
      ownerReply: { comment: "Thanks" },
    },
    ...extra,
  ],
});

const weeklyBase = (overrides = {}) => ({
  generatedAt: "2026-08-14T17:12:24.237Z",
  reviewOpportunity: {
    unrepliedCount: 2,
    actionRecommended: true,
    reason: "2 unreplied review(s) reduce response coverage and trust signals.",
  },
  postOpportunity: {
    shouldDraft: false,
    reason: "GBP posts are stale (73 days), but no strong verified topic demand was found.",
    serviceRefs: [],
    areaRefs: [],
    maintenanceSignal: true,
  },
  actions: [
    {
      id: "action.review_reply",
      type: "review_reply",
      title: "Reply to unreplied Google reviews",
      reason: "2 unreplied review(s) reduce response coverage and trust signals.",
    },
    {
      id: "action.quote_funnel_gap",
      type: "lead_conversion",
      title: "Inspect quote-form completion gap",
      reason: "Quote form starts occurred without matching completed generate_lead events.",
      recommendedNextStep:
        "Review quote form UX and tracking continuity; do not invent offer changes from this signal alone.",
      targetKpi: "generate_lead",
      evidence: [
        { source: "ga4", event: "quote_form_start", current7: 4, prior7: 3, comparable: true },
        { source: "ga4", event: "generate_lead", current7: 0, prior7: 1, comparable: true },
      ],
    },
  ],
  ...overrides,
});

const blobHas = (value, needle) => JSON.stringify(value).includes(needle);

test("two unreplied reviews produce two draft replies", () => {
  const drafts = buildReviewReplyDrafts({
    weekly: weeklyBase(),
    reviewsReport: fakeReviewsReport(),
    facts,
  });
  assert.equal(drafts.length, 2);
  assert.deepEqual(
    drafts.map((row) => row.reviewId).sort(),
    ["rev_fake_generic", "rev_fake_yard"]
  );
  for (const row of drafts) {
    assert.equal(row.status, "draft");
    assert.equal(row.requiresHumanReview, true);
    assert.equal(row.sendEligible, false);
  }
});

test("replied review does not receive a reply draft", () => {
  const drafts = buildReviewReplyDrafts({
    weekly: weeklyBase(),
    reviewsReport: fakeReviewsReport(),
    facts,
  });
  assert.equal(drafts.some((row) => row.reviewId === "rev_fake_replied"), false);
});

test("reviewer name is absent from durable draft artifact", () => {
  const packet = buildDraftPacket({
    weekly: weeklyBase(),
    reviewsReport: fakeReviewsReport(),
    facts,
  });
  const sanitized = sanitizeDraftPacketForCi(packet);
  assert.equal(blobHas(sanitized, FAKE_REVIEWER_YARD), false);
  assert.equal(blobHas(sanitized, FAKE_REVIEWER_GENERIC), false);
  assert.equal(blobHas(packet, FAKE_REVIEWER_YARD), false);
  assert.equal(blobHas(packet, FAKE_REVIEWER_GENERIC), false);
});

test("raw review text is absent from artifact", () => {
  const packet = sanitizeDraftPacketForCi(
    buildDraftPacket({
      weekly: weeklyBase(),
      reviewsReport: fakeReviewsReport(),
      facts,
    })
  );
  assert.equal(blobHas(packet, FAKE_YARD_COMMENT), false);
  assert.equal(blobHas(packet, FAKE_GENERIC_COMMENT), false);
});

test("generic review produces generic response", () => {
  const drafts = buildReviewReplyDrafts({
    weekly: weeklyBase(),
    reviewsReport: fakeReviewsReport(),
    facts,
  });
  const generic = drafts.find((row) => row.reviewId === "rev_fake_generic");
  assert.ok(generic.draftReply);
  assert.equal(generic.serviceRefs.length, 0);
  assert.match(generic.draftReply, /thank you/i);
  assert.equal(/power washing|gravel driveway|cordova bay/i.test(generic.draftReply), false);
});

test("service-specific review only references supported services", () => {
  const drafts = buildReviewReplyDrafts({
    weekly: weeklyBase(),
    reviewsReport: fakeReviewsReport(),
    facts,
  });
  const yard = drafts.find((row) => row.reviewId === "rev_fake_yard");
  assert.ok(yard.serviceRefs.includes("svc.weed-control"));
  assert.ok(yard.serviceRefs.includes("svc.lawn-mowing"));
  assert.ok(yard.serviceRefs.includes("svc.hedge-trimming"));
  assert.ok(yard.serviceRefs.includes("svc.garden-bed-maintenance"));
  assert.ok(yard.serviceRefs.includes("svc.seasonal-cleanups"));
  assert.equal(yard.serviceRefs.includes("svc.yard-waste-removal"), false);
  assert.equal(yard.serviceRefs.includes("svc.light-pruning"), false);
});

test("unsupported service claim is not added", () => {
  const drafts = buildReviewReplyDrafts({
    weekly: weeklyBase(),
    reviewsReport: fakeReviewsReport({
      extra: [
        {
          reviewId: "rev_fake_roof",
          starRating: "FIVE",
          comment: "Great roof replacement and pool installation.",
          reviewerDisplayName: "Riley Fixture",
          hasOwnerReply: false,
        },
      ],
    }),
    facts,
  });
  const roof = drafts.find((row) => row.reviewId === "rev_fake_roof");
  assert.ok(roof);
  assert.equal(/roof replacement|pool installation/i.test(roof.draftReply), false);
  assert.equal(roof.serviceRefs.length, 0);
});

test("no incentives or rating-manipulation wording", () => {
  const packet = buildDraftPacket({
    weekly: weeklyBase(),
    reviewsReport: fakeReviewsReport(),
    facts,
  });
  const blob = JSON.stringify(packet);
  assert.equal(/discount|coupon|gift card|update your rating|leave a 5-star/i.test(blob), false);
});

test("postOpportunity.shouldDraft=false yields no GBP draft", () => {
  const packet = buildDraftPacket({
    weekly: weeklyBase(),
    reviewsReport: fakeReviewsReport(),
    facts,
  });
  assert.equal(packet.gbpPostDraft, null);
});

test("shouldDraft=true with verified refs creates a candidate draft that PASSes the validator", () => {
  const packet = buildDraftPacket({
    weekly: weeklyBase({
      postOpportunity: {
        shouldDraft: true,
        reason: "Verified demand",
        serviceRefs: ["svc.power-washing"],
        areaRefs: ["area.shawnigan-lake"],
        maintenanceSignal: false,
      },
    }),
    reviewsReport: fakeReviewsReport(),
    facts,
  });
  assert.equal(packet.gbpPostDraft?.status, "review_ready");
  assert.equal(packet.gbpPostDraft.publishEligible, false);
  assert.equal(packet.gbpPostDraft.autoPublishEligible, false);
  const validation = validateGbpPost({
    draft: packet.gbpPostDraft.draft,
    facts,
    recentPosts: [],
  });
  assert.equal(validation.valid, true);
  assert.match(packet.gbpPostDraft.draft.summary, /Power Washing/);
  assert.match(packet.gbpPostDraft.draft.summary, /Shawnigan Lake/);
});

test("validator failure suppresses a publishable GBP draft", () => {
  const packet = buildDraftPacket({
    weekly: weeklyBase({
      postOpportunity: {
        shouldDraft: true,
        reason: "Would draft",
        serviceRefs: ["svc.not-a-real-service"],
        areaRefs: [],
        maintenanceSignal: false,
      },
    }),
    facts,
  });
  assert.ok(packet.gbpPostDraft);
  assert.equal(packet.gbpPostDraft.status, "invalid");
  assert.equal(packet.gbpPostDraft.publishEligible, false);
  assert.equal(packet.gbpPostDraft.draft, undefined);
});

test("candidate or rejected service/area cannot enter a post draft", () => {
  const packet = buildDraftPacket({
    weekly: weeklyBase({
      postOpportunity: {
        shouldDraft: true,
        reason: "Would draft",
        serviceRefs: ["svc.gutter-cleaning-ground-access", "svc.power-washing"],
        areaRefs: ["area.saanich"],
        maintenanceSignal: false,
      },
    }),
    facts,
  });
  const refs = packet.gbpPostDraft?.draft?.serviceRefs ?? [];
  const areas = packet.gbpPostDraft?.draft?.areaRefs ?? [];
  assert.equal(refs.includes("svc.gutter-cleaning-ground-access"), false);
  assert.equal(areas.includes("area.saanich"), false);
  if (packet.gbpPostDraft?.status === "review_ready") {
    assert.ok(refs.includes("svc.power-washing"));
  }
});

test("website action produces a recommendation only", () => {
  const packet = buildDraftPacket({
    weekly: weeklyBase(),
    reviewsReport: fakeReviewsReport(),
    facts,
  });
  assert.equal(packet.websiteOpportunity.status, "review_recommended");
  assert.equal(packet.websiteOpportunity.createsPullRequest, false);
  assert.equal(packet.websiteOpportunity.title, "Inspect quote-form completion gap");
});

test("website recommendation distinguishes observation from hypothesis", () => {
  const packet = buildDraftPacket({
    weekly: weeklyBase(),
    facts,
  });
  assert.match(packet.websiteOpportunity.observation, /Quote form starts/);
  assert.ok(packet.websiteOpportunity.hypotheses.length >= 3);
  assert.equal(
    packet.websiteOpportunity.hypotheses.some((row) => /may/i.test(row)),
    true
  );
  assert.equal(/the form is broken/i.test(JSON.stringify(packet.websiteOpportunity)), false);
});

test("safety flags stay false for mutations/publish/send/deploy", () => {
  const packet = buildDraftPacket({ weekly: weeklyBase(), facts });
  assert.equal(packet.safety.publishes, false);
  assert.equal(packet.safety.repliesToReviews, false);
  assert.equal(packet.safety.mutatesGoogle, false);
  assert.equal(packet.safety.deploys, false);
  assert.equal(packet.safety.createsPullRequests, false);
  assert.equal(packet.safety.autoPublishEligible, false);
  assert.equal(DRAFT_SAFETY.sendEligible, false);
});

test("CI export strips raw review/customer data", () => {
  const dirty = buildDraftPacket({
    weekly: weeklyBase(),
    reviewsReport: fakeReviewsReport(),
    facts,
  });
  dirty.reviewReplyDrafts[0].reviewerDisplayName = FAKE_REVIEWER_YARD;
  dirty.reviewReplyDrafts[0].comment = FAKE_YARD_COMMENT;
  const cleaned = sanitizeDraftPacketForCi(dirty);
  assert.equal(blobHas(cleaned, FAKE_REVIEWER_YARD), false);
  assert.equal(blobHas(cleaned, FAKE_YARD_COMMENT), false);
  assert.equal("comment" in (cleaned.reviewReplyDrafts[0] || {}), false);
  assert.equal("reviewerDisplayName" in (cleaned.reviewReplyDrafts[0] || {}), false);
});

test("missing or failed review source yields no fabricated reply drafts", () => {
  assert.deepEqual(
    buildReviewReplyDrafts({ weekly: weeklyBase(), reviewsReport: null, facts }),
    []
  );
  assert.deepEqual(
    buildReviewReplyDrafts({
      weekly: weeklyBase({
        reviewOpportunity: { unrepliedCount: null, actionRecommended: false, reason: "missing" },
      }),
      reviewsReport: fakeReviewsReport(),
      facts,
    }),
    []
  );
});

test("current-run replay: 2 replies, 0 GBP posts, 1 website recommendation", () => {
  const packet = buildDraftPacket({
    weekly: weeklyBase(),
    reviewsReport: fakeReviewsReport(),
    facts,
  });
  assert.equal(packet.reviewReplyDrafts.length, 2);
  assert.equal(packet.gbpPostDraft, null);
  assert.equal(packet.websiteOpportunity.title, "Inspect quote-form completion gap");
  const summary = formatDraftsJobSummaryMarkdown(packet);
  assert.match(summary, /Review replies: 2/);
  assert.match(summary, /opportunity gate false/);
  assert.equal(summary.includes(packet.reviewReplyDrafts[0].draftReply), false);
});

test("matched services come from verified catalog phrases", () => {
  const matched = matchVerifiedServicesFromComment(FAKE_YARD_COMMENT, facts.services);
  assert.ok(matched.some((row) => row.id === "svc.lawn-mowing"));
  assert.equal(matched.some((row) => row.status !== "verified"), false);
});

test("static workflow retains contents:read only and no write command paths", () => {
  const yamlText = fs.readFileSync(
    path.join(root, ".github/workflows/growth-ops-shadow.yml"),
    "utf8"
  );
  const audit = auditGrowthShadowWorkflow(yamlText);
  assert.equal(audit.ok, true, audit.violations.join("; "));
  assert.equal(audit.checks.hasContentsRead, true);
  assert.equal(audit.checks.hasContentsWrite, false);
  assert.equal(audit.checks.hasIssuesWrite, false);
  assert.equal(audit.checks.hasPullRequestsWrite, false);
  const active = yamlText.replace(/#.*$/gm, "");
  assert.equal(/gbp:create-post/.test(active), false);
  assert.equal(/createLocalPost/.test(active), false);
  assert.equal(/gh\s+pr\s+create/.test(active), false);
  assert.equal(/gh\s+issue\s+create/.test(active), false);
  assert.equal(/git\s+push/.test(active), false);
  assert.equal(/wrangler\s+deploy/.test(active), false);
  assert.match(active, /growth:drafts/);
});

test("P2B module source has no publish/send/write command paths", () => {
  const lib = fs.readFileSync(path.join(here, "growth-drafts.mjs"), "utf8");
  const cli = fs.readFileSync(path.join(root, "scripts/growth-drafts.mjs"), "utf8");
  for (const source of [lib, cli]) {
    assert.equal(/createLocalPost/.test(source), false);
    assert.equal(/gbp:create-post/.test(source), false);
    assert.equal(/reviews\/.*\/reply/.test(source), false);
    assert.equal(/ads:create/.test(source), false);
    assert.equal(/wrangler\s+deploy/.test(source), false);
    assert.equal(/gh\s+pr\s+create/.test(source), false);
    assert.equal(/gh\s+issue\s+create/.test(source), false);
    assert.equal(/git\s+push/.test(source), false);
    assert.equal(/method:\s*["'](POST|PUT|PATCH|DELETE)["']/.test(source), false);
  }
});

test("CLI writes sanitized local drafts without customer fields", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "growth-drafts-"));
  try {
    const weeklyPath = path.join(tmp, "growth-weekly.json");
    const reviewsPath = path.join(tmp, "gbp-reviews.json");
    fs.writeFileSync(weeklyPath, `${JSON.stringify(weeklyBase(), null, 2)}\n`);
    fs.writeFileSync(reviewsPath, `${JSON.stringify(fakeReviewsReport(), null, 2)}\n`);
    const { runGrowthDrafts } = await import("../growth-drafts.mjs");
    const { packet, paths } = runGrowthDrafts({
      weeklyPath,
      reviewsPath,
      postsPath: path.join(tmp, "missing-posts.json"),
      factsDir: path.join(root, "growth"),
      outDir: tmp,
      now: new Date("2026-08-14T18:00:00.000Z"),
    });
    assert.equal(packet.reviewReplyDrafts.length, 2);
    const written = fs.readFileSync(paths.jsonPath, "utf8");
    assert.equal(written.includes(FAKE_REVIEWER_YARD), false);
    assert.equal(written.includes(FAKE_YARD_COMMENT), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
