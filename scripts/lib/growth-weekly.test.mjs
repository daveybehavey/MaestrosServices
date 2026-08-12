import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  VERIFIED_CATALOG,
  buildGa4WithWindows,
  buildGbpPerformance,
} from "../../growth/fixtures/weekly/helpers.mjs";
import {
  buildPostOpportunity,
  buildReviewOpportunity,
  buildWeeklyIntelligence,
} from "./growth-weekly.mjs";
import { formatWeeklyConsoleSummary, runGrowthWeekly } from "../growth-weekly.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const fixtureRoot = path.join(root, "growth/fixtures/weekly");
const now = new Date("2026-08-12T15:00:00.000Z");

const writeCase = (name, files) => {
  const dir = path.join(fixtureRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [fileName, data] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, fileName), `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }
  return dir;
};

const baseReports = (overrides = {}) => ({
  ga4: buildGa4WithWindows(),
  gsc: {
    dateRange: { startDate: "2026-07-15", endDate: "2026-08-12" },
    topQueries: [
      {
        keys: ["power washing shawnigan lake"],
        clicks: 0,
        impressions: 55,
        ctr: 0,
        position: 12,
      },
      { keys: ["noise query"], clicks: 0, impressions: 2, ctr: 0, position: 40 },
    ],
    topPages: [
      {
        keys: ["https://maestrosservices.com/"],
        clicks: 1,
        impressions: 80,
        ctr: 0.0125,
        position: 20,
      },
      {
        keys: ["https://maestrosservices.com/services/power-washing/victoria/"],
        clicks: 0,
        impressions: 90,
        ctr: 0,
        position: 15,
      },
    ],
    comparison: {
      lagDays: 3,
      recent28: {
        dateRange: { startDate: "2026-07-12", endDate: "2026-08-08" },
        topQueries: [
          {
            keys: ["power washing shawnigan lake"],
            clicks: 0,
            impressions: 55,
            ctr: 0,
            position: 12,
          },
          { keys: ["noise query"], clicks: 0, impressions: 2, ctr: 0, position: 40 },
        ],
        topPages: [
          {
            keys: ["https://maestrosservices.com/"],
            clicks: 1,
            impressions: 80,
            ctr: 0.0125,
            position: 20,
          },
          {
            keys: ["https://maestrosservices.com/services/power-washing/victoria/"],
            clicks: 0,
            impressions: 90,
            ctr: 0,
            position: 15,
          },
        ],
      },
      prior28: {
        dateRange: { startDate: "2026-06-14", endDate: "2026-07-11" },
        topQueries: [],
        topPages: [],
      },
    },
  },
  gbpPerformance: buildGbpPerformance({
    callClicks: [...Array(14).fill(0), ...Array(7).fill(0), ...Array(7).fill(1)],
  }),
  gbpKeywords: {
    generatedAt: "2026-08-12T12:00:00.000Z",
    keywords: [
      { searchKeyword: "power washing", impressions: 42, belowThreshold: false },
      { searchKeyword: "random junk", impressions: 3, belowThreshold: false },
    ],
  },
  gbpReviews: {
    generatedAt: "2026-08-12T12:00:00.000Z",
    averageRating: 5,
    totalReviewCount: 2,
    unrepliedCount: 2,
    unrepliedReviewIds: ["rev_fixture_1", "rev_fixture_2"],
    reviews: [
      {
        reviewId: "rev_fixture_1",
        starRating: "FIVE",
        comment: "SENSITIVE_SHOULD_NOT_LEAK",
        reviewerDisplayName: "PII Person",
        hasOwnerReply: false,
      },
    ],
  },
  gbpPosts: {
    generatedAt: "2026-08-12T12:00:00.000Z",
    localPosts: [
      {
        createTime: "2026-06-01T12:00:00.000Z",
        updateTime: "2026-06-01T12:00:00.000Z",
        summary: "Gravel driveway tips for wet season maintenance around Shawnigan Lake.",
      },
    ],
  },
  ...overrides,
});

test("unreplied reviews produce a high-priority reputation action", () => {
  const report = buildWeeklyIntelligence({
    reports: baseReports(),
    catalog: VERIFIED_CATALOG,
    now,
  });
  assert.equal(report.reviewOpportunity.actionRecommended, true);
  assert.equal(report.actions[0].type, "review_reply");
  assert.equal(report.actions[0].priority, 1);
});

test("meaningful lead decline produces a conversion investigation action", () => {
  const report = buildWeeklyIntelligence({
    reports: baseReports({
      gbpReviews: {
        generatedAt: "2026-08-12T12:00:00.000Z",
        unrepliedCount: 0,
        unrepliedReviewIds: [],
        totalReviewCount: 2,
        averageRating: 5,
      },
      ga4: buildGa4WithWindows({
        recent: { generate_lead: 2, phone_click: 0, sms_click: 0, quote_form_start: 3 },
        prior: { generate_lead: 8, phone_click: 1, sms_click: 0, quote_form_start: 5 },
      }),
    }),
    catalog: VERIFIED_CATALOG,
    now,
  });
  assert.ok(report.actions.some((a) => a.id === "action.lead_decline_investigate"));
});

test("lead improvement is represented correctly", () => {
  const report = buildWeeklyIntelligence({
    reports: baseReports({
      gbpReviews: {
        generatedAt: "2026-08-12T12:00:00.000Z",
        unrepliedCount: 0,
        unrepliedReviewIds: [],
        totalReviewCount: 2,
        averageRating: 5,
      },
      ga4: buildGa4WithWindows({
        recent: { generate_lead: 9, phone_click: 2, sms_click: 0, quote_form_start: 8 },
        prior: { generate_lead: 3, phone_click: 1, sms_click: 0, quote_form_start: 4 },
      }),
      gbpKeywords: { generatedAt: "2026-08-12T12:00:00.000Z", keywords: [] },
      gbpPosts: {
        generatedAt: "2026-08-12T12:00:00.000Z",
        localPosts: [
          {
            createTime: "2026-08-10T12:00:00.000Z",
            summary: "Recent power washing note around Shawnigan Lake.",
          },
        ],
      },
    }),
    catalog: VERIFIED_CATALOG,
    now,
  });
  assert.ok(report.signals.some((s) => s.id === "signal.leads.improve"));
  assert.ok(report.actions.some((a) => a.id === "action.lead_improve_reinforce"));
});

test("high-impression low-CTR existing-page opportunity can surface", () => {
  const report = buildWeeklyIntelligence({
    reports: baseReports({
      gbpReviews: {
        generatedAt: "2026-08-12T12:00:00.000Z",
        unrepliedCount: 0,
        unrepliedReviewIds: [],
        totalReviewCount: 1,
        averageRating: 5,
      },
      ga4: buildGa4WithWindows({
        recent: { generate_lead: 4, phone_click: 1, sms_click: 0, quote_form_start: 4 },
        prior: { generate_lead: 4, phone_click: 1, sms_click: 0, quote_form_start: 4 },
      }),
      gbpKeywords: { generatedAt: "2026-08-12T12:00:00.000Z", keywords: [] },
      gbpPosts: {
        generatedAt: "2026-08-12T12:00:00.000Z",
        localPosts: [
          {
            createTime: "2026-08-10T12:00:00.000Z",
            summary: "Fresh post about seasonal cleanup.",
          },
        ],
      },
    }),
    catalog: VERIFIED_CATALOG,
    now,
  });
  assert.ok(report.signals.some((s) => s.id === "signal.gsc.page_low_ctr"));
  assert.ok(report.actions.some((a) => a.type === "organic_opportunity"));
  assert.ok(
    report.actions.every(
      (a) => !/\b(create|spawn|add)\b.*\b(programmatic )?location pages?\b/i.test(a.recommendedNextStep)
    )
  );
});

test("trivial low-volume GSC noise does not create an exaggerated action", () => {
  const report = buildWeeklyIntelligence({
    reports: baseReports({
      gbpReviews: {
        generatedAt: "2026-08-12T12:00:00.000Z",
        unrepliedCount: 0,
        unrepliedReviewIds: [],
        totalReviewCount: 1,
        averageRating: 5,
      },
      ga4: buildGa4WithWindows({
        recent: { generate_lead: 4, phone_click: 1, sms_click: 0, quote_form_start: 4 },
        prior: { generate_lead: 4, phone_click: 1, sms_click: 0, quote_form_start: 4 },
      }),
      gsc: {
        topQueries: [{ keys: ["tiny"], clicks: 0, impressions: 2, ctr: 0, position: 50 }],
        topPages: [
          {
            keys: ["https://maestrosservices.com/services/weed-control/victoria/"],
            clicks: 0,
            impressions: 3,
            ctr: 0,
            position: 40,
          },
        ],
        comparison: {
          recent28: {
            topQueries: [{ keys: ["tiny"], clicks: 0, impressions: 2, ctr: 0, position: 50 }],
            topPages: [
              {
                keys: ["https://maestrosservices.com/services/weed-control/victoria/"],
                clicks: 0,
                impressions: 3,
                ctr: 0,
                position: 40,
              },
            ],
          },
        },
      },
      gbpKeywords: { generatedAt: "2026-08-12T12:00:00.000Z", keywords: [] },
      gbpPosts: {
        generatedAt: "2026-08-12T12:00:00.000Z",
        localPosts: [
          {
            createTime: "2026-08-10T12:00:00.000Z",
            summary: "Fresh seasonal cleanup note.",
          },
        ],
      },
    }),
    catalog: VERIFIED_CATALOG,
    now,
  });
  assert.equal(report.signals.some((s) => s.type === "organic"), false);
});

test("verified GBP service-demand signal can produce a structured post opportunity", () => {
  const opportunity = buildPostOpportunity({
    catalog: VERIFIED_CATALOG,
    gbpKeywords: {
      keywords: [{ searchKeyword: "power washing", impressions: 40, belowThreshold: false }],
    },
    gbpPosts: {
      localPosts: [
        {
          createTime: "2026-06-01T00:00:00.000Z",
          summary: "Gravel driveway tips for wet season.",
        },
      ],
    },
    now,
  });
  assert.equal(opportunity.shouldDraft, true);
  assert.deepEqual(opportunity.serviceRefs, ["svc.power-washing"]);
  assert.ok(opportunity.areaRefs.includes("area.shawnigan-lake"));
});

test("recent duplicate/stale topic suppresses a post opportunity", () => {
  const opportunity = buildPostOpportunity({
    catalog: VERIFIED_CATALOG,
    gbpKeywords: {
      keywords: [{ searchKeyword: "power washing", impressions: 40, belowThreshold: false }],
    },
    gbpPosts: {
      localPosts: [
        {
          createTime: "2026-08-01T00:00:00.000Z",
          summary: "Power washing around Shawnigan Lake keeps driveways cleaner.",
        },
        {
          createTime: "2026-07-28T00:00:00.000Z",
          summary: "Power washing helps clear wet-season grime around Shawnigan Lake.",
        },
      ],
    },
    now,
  });
  assert.equal(opportunity.shouldDraft, false);
  assert.match(opportunity.reason, /duplicate|already cover/i);
});

test("no verified evidence yields no post opportunity", () => {
  const opportunity = buildPostOpportunity({
    catalog: VERIFIED_CATALOG,
    gbpKeywords: { keywords: [] },
    gbpPosts: {
      localPosts: [
        {
          createTime: "2026-08-10T00:00:00.000Z",
          summary: "Thanks for the kind notes this week.",
        },
      ],
    },
    now,
  });
  assert.equal(opportunity.shouldDraft, false);
});

test("missing input is not interpreted as zero", () => {
  const review = buildReviewOpportunity(null);
  assert.equal(review.unrepliedCount, null);
  assert.equal(review.actionRecommended, false);

  const report = buildWeeklyIntelligence({
    reports: {},
    catalog: VERIFIED_CATALOG,
    now,
  });
  assert.ok(report.dataQuality.issues.some((i) => i.code === "missing"));
  assert.equal(report.kpis.ga4Leads.events.generate_lead.days28, null);
  assert.notEqual(report.kpis.ga4Leads.events.generate_lead.days28, 0);
});

test("deterministic action ordering and max three actions", () => {
  const report = buildWeeklyIntelligence({
    reports: baseReports({
      ga4: buildGa4WithWindows({
        recent: { generate_lead: 1, phone_click: 0, sms_click: 0, quote_form_start: 6 },
        prior: { generate_lead: 8, phone_click: 2, sms_click: 0, quote_form_start: 6 },
      }),
    }),
    catalog: VERIFIED_CATALOG,
    now,
  });
  assert.ok(report.actions.length <= 3);
  const priorities = report.actions.map((a) => a.priority);
  assert.deepEqual(priorities, priorities.slice().sort((a, b) => a - b));
  const again = buildWeeklyIntelligence({
    reports: baseReports({
      ga4: buildGa4WithWindows({
        recent: { generate_lead: 1, phone_click: 0, sms_click: 0, quote_form_start: 6 },
        prior: { generate_lead: 8, phone_click: 2, sms_click: 0, quote_form_start: 6 },
      }),
    }),
    catalog: VERIFIED_CATALOG,
    now,
  });
  assert.deepEqual(
    report.actions.map((a) => a.id),
    again.actions.map((a) => a.id)
  );
});

test("never recommends programmatic location-page creation", () => {
  const report = buildWeeklyIntelligence({
    reports: baseReports(),
    catalog: VERIFIED_CATALOG,
    now,
  });
  const blob = JSON.stringify(report.actions);
  assert.equal(/\b(create|spawn|add)\b.*\b(programmatic )?location pages?\b/i.test(blob), false);
  assert.ok(
    report.actions.every(
      (a) => !/\b(create|spawn|add)\b.*\b(programmatic )?location pages?\b/i.test(a.recommendedNextStep)
    )
  );
});

test("output always requires human review and never auto-publish eligible", () => {
  const passLike = buildWeeklyIntelligence({
    reports: baseReports(),
    catalog: VERIFIED_CATALOG,
    now,
  });
  const empty = buildWeeklyIntelligence({ reports: {}, catalog: VERIFIED_CATALOG, now });
  for (const report of [passLike, empty]) {
    assert.equal(report.safety.requiresHumanReview, true);
    assert.equal(report.safety.autoPublishEligible, false);
    assert.equal(report.safety.publishes, false);
    assert.equal(report.safety.mutatesGoogle, false);
    assert.equal(report.safety.deploys, false);
    assert.equal(report.mode, "shadow_read_only");
  }
});

test("customer PII is absent from sanitized weekly output", () => {
  const report = buildWeeklyIntelligence({
    reports: baseReports(),
    catalog: VERIFIED_CATALOG,
    now,
  });
  const blob = JSON.stringify(report);
  assert.equal(blob.includes("SENSITIVE_SHOULD_NOT_LEAK"), false);
  assert.equal(blob.includes("PII Person"), false);
  assert.equal(blob.includes("reviewerDisplayName"), false);
  assert.ok(Array.isArray(report.reviewOpportunity.evidence[0].unrepliedReviewIds));
});

test("from-reports CLI mode writes shadow-mode artifacts without collecting", () => {
  const caseDir = writeCase("case-cli-smoke", {
    "ga4-summary.json": buildGa4WithWindows(),
    "search-console-summary.json": baseReports().gsc,
    "gbp-performance.json": buildGbpPerformance(),
    "gbp-search-keywords.json": baseReports().gbpKeywords,
    "gbp-reviews.json": {
      generatedAt: "2026-08-12T12:00:00.000Z",
      unrepliedCount: 1,
      unrepliedReviewIds: ["rev_cli_1"],
      totalReviewCount: 1,
      averageRating: 5,
    },
    "gbp-list-posts.json": baseReports().gbpPosts,
  });
  const outDir = path.join(fixtureRoot, "case-cli-smoke-out");
  fs.rmSync(outDir, { recursive: true, force: true });
  const { report, paths } = runGrowthWeekly({
    fromReports: caseDir,
    factsDir: path.join(root, "growth"),
    outDir,
    now,
    collectFn: () => {
      throw new Error("collectFn should not run in from-reports mode");
    },
  });
  assert.equal(report.collection.attempted, false);
  assert.equal(report.safety.requiresHumanReview, true);
  assert.ok(fs.existsSync(paths.jsonPath));
  assert.ok(fs.existsSync(paths.mdPath));
  const summary = formatWeeklyConsoleSummary(report);
  assert.match(summary, /Human review required: yes/);
  assert.match(summary, /Auto-publish eligible: no/);
  assert.match(summary, /Publishes: no/);
});

test("weekly engine source has no mutation / create-post paths", () => {
  const engine = fs.readFileSync(path.join(here, "growth-weekly.mjs"), "utf8");
  const cli = fs.readFileSync(path.join(root, "scripts/growth-weekly.mjs"), "utf8");
  for (const source of [engine, cli]) {
    assert.equal(/createLocalPost/.test(source), false);
    assert.equal(/gbp:create-post/.test(source), false);
    assert.equal(/ads:create/.test(source), false);
    assert.equal(/method:\s*["']POST["']/.test(source), false);
  }
});
