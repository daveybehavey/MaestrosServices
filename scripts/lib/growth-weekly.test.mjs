import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
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
  buildQuoteFunnel,
  buildReviewOpportunity,
  buildWeeklyIntelligence,
  collectSignals,
  computeGa4LeadKpis,
  diagnoseQuoteFunnel,
  LEAD_EVENTS,
  prepareWeeklyInputs,
  QUOTE_FUNNEL_CAVEAT,
} from "./growth-weekly.mjs";
import { formatWeeklyConsoleSummary, runGrowthWeekly } from "../growth-weekly.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const now = new Date("2026-08-12T15:00:00.000Z");

const writeTempCase = (files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "growth-weekly-"));
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
        dateRange: { startDate: "2026-07-13", endDate: "2026-08-09" },
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
        dateRange: { startDate: "2026-06-15", endDate: "2026-07-12" },
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
    reports: baseReports({
      ga4: buildGa4WithWindows({
        recent: { generate_lead: 4, phone_click: 1, sms_click: 0, quote_form_start: 4 },
        prior: { generate_lead: 4, phone_click: 1, sms_click: 0, quote_form_start: 4 },
      }),
    }),
    catalog: VERIFIED_CATALOG,
    now,
  });
  assert.equal(report.reviewOpportunity.actionRecommended, true);
  assert.ok(report.actions.some((a) => a.type === "review_reply"));
});

test("meaningful lead decline outranks routine review-response work", () => {
  const report = buildWeeklyIntelligence({
    reports: baseReports({
      ga4: buildGa4WithWindows({
        recent: { generate_lead: 2, phone_click: 0, sms_click: 0, quote_form_start: 3 },
        prior: { generate_lead: 8, phone_click: 1, sms_click: 0, quote_form_start: 5 },
      }),
    }),
    catalog: VERIFIED_CATALOG,
    now,
  });
  assert.equal(report.actions[0].id, "action.lead_decline_investigate");
  assert.ok(report.actions.some((a) => a.id === "action.review_reply"));
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

test("verified GBP service-demand can draft with locality only when evidenced", () => {
  const withArea = buildPostOpportunity({
    catalog: VERIFIED_CATALOG,
    gbpKeywords: {
      generatedAt: "2026-08-12T12:00:00.000Z",
      keywords: [
        {
          searchKeyword: "power washing shawnigan lake",
          impressions: 40,
          belowThreshold: false,
        },
      ],
    },
    gbpPosts: {
      generatedAt: "2026-08-12T12:00:00.000Z",
      localPosts: [
        {
          createTime: "2026-06-01T00:00:00.000Z",
          summary: "Gravel driveway tips for wet season.",
        },
      ],
    },
    now,
  });
  assert.equal(withArea.shouldDraft, true);
  assert.deepEqual(withArea.serviceRefs, ["svc.power-washing"]);
  assert.deepEqual(withArea.areaRefs, ["area.shawnigan-lake"]);

  const serviceOnly = buildPostOpportunity({
    catalog: VERIFIED_CATALOG,
    gbpKeywords: {
      generatedAt: "2026-08-12T12:00:00.000Z",
      keywords: [{ searchKeyword: "power washing", impressions: 40, belowThreshold: false }],
    },
    gbpPosts: {
      generatedAt: "2026-08-12T12:00:00.000Z",
      localPosts: [
        {
          createTime: "2026-06-01T00:00:00.000Z",
          summary: "Gravel driveway tips for wet season.",
        },
      ],
    },
    now,
  });
  assert.equal(serviceOnly.shouldDraft, true);
  assert.deepEqual(serviceOnly.serviceRefs, ["svc.power-washing"]);
  assert.deepEqual(serviceOnly.areaRefs, []);
});

test("recent duplicate/stale topic suppresses a post opportunity", () => {
  const opportunity = buildPostOpportunity({
    catalog: VERIFIED_CATALOG,
    gbpKeywords: {
      generatedAt: "2026-08-12T12:00:00.000Z",
      keywords: [{ searchKeyword: "power washing", impressions: 40, belowThreshold: false }],
    },
    gbpPosts: {
      generatedAt: "2026-08-12T12:00:00.000Z",
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
  assert.match(opportunity.reason, /already cover/i);
});

test("keyword demand without usable post history does not authorize a draft", () => {
  const opportunity = buildPostOpportunity({
    catalog: VERIFIED_CATALOG,
    gbpKeywords: {
      generatedAt: "2026-08-12T12:00:00.000Z",
      keywords: [{ searchKeyword: "power washing", impressions: 40, belowThreshold: false }],
    },
    gbpPosts: null,
    now,
  });
  assert.equal(opportunity.shouldDraft, false);
  assert.deepEqual(opportunity.serviceRefs, []);
  assert.deepEqual(opportunity.areaRefs, []);
  assert.equal(opportunity.maintenanceSignal, false);
  assert.match(opportunity.reason, /post history is unavailable/i);
  assert.match(opportunity.reason, /duplicate|topic coverage/i);
});

test("keyword demand with current empty localPosts may draft", () => {
  const opportunity = buildPostOpportunity({
    catalog: VERIFIED_CATALOG,
    gbpKeywords: {
      generatedAt: "2026-08-12T12:00:00.000Z",
      keywords: [{ searchKeyword: "power washing", impressions: 40, belowThreshold: false }],
    },
    gbpPosts: {
      generatedAt: "2026-08-12T12:00:00.000Z",
      localPosts: [],
    },
    now,
  });
  assert.equal(opportunity.shouldDraft, true);
  assert.deepEqual(opportunity.serviceRefs, ["svc.power-washing"]);
  assert.deepEqual(opportunity.areaRefs, []);
});

test("failed list-posts collector suppresses old post file and blocks demand-backed draft", () => {
  const reports = baseReports({
    gbpReviews: {
      generatedAt: "2026-08-12T12:00:00.000Z",
      unrepliedCount: 0,
      unrepliedReviewIds: [],
      totalReviewCount: 1,
      averageRating: 5,
    },
    gbpKeywords: {
      generatedAt: "2026-08-12T12:00:00.000Z",
      keywords: [{ searchKeyword: "power washing", impressions: 40, belowThreshold: false }],
    },
    gbpPosts: {
      generatedAt: "2026-08-12T12:00:00.000Z",
      localPosts: [
        {
          createTime: "2026-06-01T00:00:00.000Z",
          summary: "Gravel driveway tips for wet season.",
        },
      ],
    },
  });

  const prepared = prepareWeeklyInputs(reports, {
    now,
    collectorResults: [{ script: "gbp:list-posts", ok: false, status: 1 }],
  });
  assert.equal(prepared.usableReports.gbpPosts, null);
  assert.ok(
    prepared.dataQuality.issues.some(
      (i) => i.source === "gbpPosts" && i.code === "collector_failed"
    )
  );

  const report = buildWeeklyIntelligence({
    reports,
    catalog: VERIFIED_CATALOG,
    now,
    collectorResults: [{ script: "gbp:list-posts", ok: false, status: 1 }],
  });
  assert.equal(report.postOpportunity.shouldDraft, false);
  assert.deepEqual(report.postOpportunity.serviceRefs, []);
  assert.deepEqual(report.postOpportunity.areaRefs, []);
  assert.equal(report.postOpportunity.maintenanceSignal, false);
  assert.match(report.postOpportunity.reason, /post history is unavailable/i);
  assert.equal(report.actions.some((a) => a.type === "gbp_post"), false);
});

test("stale post-history with fresh keyword demand does not authorize a draft", () => {
  const report = buildWeeklyIntelligence({
    reports: baseReports({
      gbpReviews: {
        generatedAt: "2026-08-12T12:00:00.000Z",
        unrepliedCount: 0,
        unrepliedReviewIds: [],
        totalReviewCount: 1,
        averageRating: 5,
      },
      gbpKeywords: {
        generatedAt: "2026-08-12T12:00:00.000Z",
        keywords: [{ searchKeyword: "power washing", impressions: 40, belowThreshold: false }],
      },
      gbpPosts: {
        generatedAt: "2026-08-01T12:00:00.000Z",
        localPosts: [
          {
            createTime: "2026-06-01T00:00:00.000Z",
            summary: "Gravel driveway tips for wet season.",
          },
        ],
      },
    }),
    catalog: VERIFIED_CATALOG,
    now,
  });
  assert.ok(report.dataQuality.issues.some((i) => i.source === "gbpPosts" && i.code === "stale"));
  assert.equal(report.postOpportunity.shouldDraft, false);
  assert.deepEqual(report.postOpportunity.serviceRefs, []);
  assert.match(report.postOpportunity.reason, /post history is unavailable/i);
});

test("stale posts without service demand do not invent serviceRefs or areaRefs", () => {
  const opportunity = buildPostOpportunity({
    catalog: VERIFIED_CATALOG,
    gbpKeywords: { generatedAt: "2026-08-12T12:00:00.000Z", keywords: [] },
    gbpPosts: {
      generatedAt: "2026-08-12T12:00:00.000Z",
      localPosts: [
        {
          createTime: "2026-05-01T00:00:00.000Z",
          summary: "Thanks for the kind notes this week.",
        },
      ],
    },
    now,
  });
  assert.equal(opportunity.shouldDraft, false);
  assert.deepEqual(opportunity.serviceRefs, []);
  assert.deepEqual(opportunity.areaRefs, []);
  assert.equal(opportunity.maintenanceSignal, true);
  assert.match(opportunity.reason, /stale/i);
  assert.match(opportunity.reason, /no strong verified topic/i);
});

test("no verified evidence yields no post opportunity", () => {
  const opportunity = buildPostOpportunity({
    catalog: VERIFIED_CATALOG,
    gbpKeywords: { generatedAt: "2026-08-12T12:00:00.000Z", keywords: [] },
    gbpPosts: {
      generatedAt: "2026-08-12T12:00:00.000Z",
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
  assert.deepEqual(opportunity.serviceRefs, []);
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
  const caseDir = writeTempCase({
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
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "growth-weekly-out-"));
  try {
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
  } finally {
    fs.rmSync(caseDir, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test("failed collector suppresses stale on-disk report for that source", () => {
  const reports = baseReports({
    ga4: buildGa4WithWindows({
      recent: { generate_lead: 4, phone_click: 1, sms_click: 0, quote_form_start: 4 },
      prior: { generate_lead: 4, phone_click: 1, sms_click: 0, quote_form_start: 4 },
    }),
  });
  const prepared = prepareWeeklyInputs(reports, {
    now,
    collectorResults: [{ script: "gbp:reviews", ok: false, status: 1 }],
  });
  assert.equal(prepared.usableReports.gbpReviews, null);
  assert.ok(
    prepared.dataQuality.issues.some(
      (i) => i.source === "gbpReviews" && i.code === "collector_failed"
    )
  );

  const report = buildWeeklyIntelligence({
    reports,
    catalog: VERIFIED_CATALOG,
    now,
    collectorResults: [{ script: "gbp:reviews", ok: false, status: 1 }],
  });
  assert.equal(report.reviewOpportunity.actionRecommended, false);
  assert.equal(report.actions.some((a) => a.type === "review_reply"), false);
  // Other valid sources can still produce actions (organic page opportunity).
  assert.ok(report.actions.some((a) => a.type === "organic_opportunity"));
});

test("stale reviews report does not create a current unreplied-review action", () => {
  const report = buildWeeklyIntelligence({
    reports: baseReports({
      ga4: buildGa4WithWindows({
        recent: { generate_lead: 4, phone_click: 1, sms_click: 0, quote_form_start: 4 },
        prior: { generate_lead: 4, phone_click: 1, sms_click: 0, quote_form_start: 4 },
      }),
      gbpReviews: {
        generatedAt: "2026-08-01T12:00:00.000Z",
        unrepliedCount: 5,
        unrepliedReviewIds: ["rev_old_1"],
        totalReviewCount: 5,
        averageRating: 5,
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
  assert.ok(report.dataQuality.issues.some((i) => i.source === "gbpReviews" && i.code === "stale"));
  assert.equal(report.reviewOpportunity.actionRecommended, false);
  assert.equal(report.actions.some((a) => a.type === "review_reply"), false);
});

test("stale keyword/post data does not create a current post opportunity", () => {
  const report = buildWeeklyIntelligence({
    reports: baseReports({
      ga4: buildGa4WithWindows({
        recent: { generate_lead: 4, phone_click: 1, sms_click: 0, quote_form_start: 4 },
        prior: { generate_lead: 4, phone_click: 1, sms_click: 0, quote_form_start: 4 },
      }),
      gbpReviews: {
        generatedAt: "2026-08-12T12:00:00.000Z",
        unrepliedCount: 0,
        unrepliedReviewIds: [],
        totalReviewCount: 1,
        averageRating: 5,
      },
      gbpKeywords: {
        generatedAt: "2026-07-01T12:00:00.000Z",
        keywords: [
          { searchKeyword: "power washing", impressions: 99, belowThreshold: false },
        ],
      },
      gbpPosts: {
        generatedAt: "2026-07-01T12:00:00.000Z",
        localPosts: [
          {
            createTime: "2026-01-01T00:00:00.000Z",
            summary: "Old note.",
          },
        ],
      },
    }),
    catalog: VERIFIED_CATALOG,
    now,
  });
  assert.equal(report.postOpportunity.shouldDraft, false);
  assert.deepEqual(report.postOpportunity.serviceRefs, []);
  assert.ok(report.dataQuality.issues.some((i) => i.source === "gbpKeywords" && i.code === "stale"));
  assert.ok(report.dataQuality.issues.some((i) => i.source === "gbpPosts" && i.code === "stale"));
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

test("form_submit is collected in recent7/prior7/days28 lead KPIs", () => {
  const kpis = computeGa4LeadKpis(
    buildGa4WithWindows({
      recent: {
        generate_lead: 0,
        phone_click: 0,
        sms_click: 0,
        quote_form_start: 11,
        form_submit: 5,
      },
      prior: {
        generate_lead: 2,
        phone_click: 1,
        sms_click: 0,
        quote_form_start: 1,
        form_submit: 1,
      },
    })
  );
  assert.equal(LEAD_EVENTS.includes("form_submit"), true);
  assert.equal(kpis.events.form_submit.current7, 5);
  assert.equal(kpis.events.form_submit.prior7, 1);
  assert.equal(kpis.events.form_submit.days28, 6);
  assert.equal(kpis.events.form_submit.comparable, true);
});

test("valid GA4 zero for form_submit remains zero, missing GA4 stays null", () => {
  const zeroed = computeGa4LeadKpis(
    buildGa4WithWindows({
      recent: {
        generate_lead: 0,
        phone_click: 0,
        sms_click: 0,
        quote_form_start: 4,
        form_submit: 0,
      },
      prior: {
        generate_lead: 1,
        phone_click: 0,
        sms_click: 0,
        quote_form_start: 2,
        form_submit: 0,
      },
    })
  );
  assert.equal(zeroed.events.form_submit.current7, 0);
  assert.equal(zeroed.events.form_submit.prior7, 0);

  const absentRow = computeGa4LeadKpis(
    buildGa4WithWindows({
      recent: { generate_lead: 0, phone_click: 0, sms_click: 0, quote_form_start: 4 },
      prior: { generate_lead: 1, phone_click: 0, sms_click: 0, quote_form_start: 2 },
    })
  );
  assert.equal(absentRow.events.form_submit.current7, 0);

  const missing = computeGa4LeadKpis(null);
  assert.equal(missing.events.form_submit.current7, null);
  assert.equal(missing.events.form_submit.days28, null);
});

test("11 starts / 0 submits / 0 leads yields conservative pre-submit investigation", () => {
  const report = buildWeeklyIntelligence({
    reports: baseReports({
      ga4: buildGa4WithWindows({
        recent: {
          generate_lead: 0,
          phone_click: 0,
          sms_click: 0,
          quote_form_start: 11,
          form_submit: 0,
        },
        prior: {
          generate_lead: 2,
          phone_click: 1,
          sms_click: 0,
          quote_form_start: 1,
          form_submit: 1,
        },
      }),
    }),
    catalog: VERIFIED_CATALOG,
    now,
  });
  assert.ok(report.signals.some((s) => s.id === "signal.leads.quote_pre_submit_gap"));
  const action = report.actions.find((a) => a.id === "action.quote_funnel_gap");
  assert.ok(action);
  assert.match(action.title, /pre-submit/i);
  assert.match(action.reason, /Raw event counts are not session-level/);
  assert.equal(/%/.test(action.reason), false);
  assert.equal(report.quoteFunnel.comparableAsConversionRate, false);
  assert.ok(report.quoteFunnel.caveats.includes(QUOTE_FUNNEL_CAVEAT));
});

test("11 starts / 5 submits / 0 leads yields post-submit continuity investigation", () => {
  const report = buildWeeklyIntelligence({
    reports: baseReports({
      ga4: buildGa4WithWindows({
        recent: {
          generate_lead: 0,
          phone_click: 0,
          sms_click: 0,
          quote_form_start: 11,
          form_submit: 5,
        },
        prior: {
          generate_lead: 2,
          phone_click: 0,
          sms_click: 0,
          quote_form_start: 4,
          form_submit: 3,
        },
      }),
    }),
    catalog: VERIFIED_CATALOG,
    now,
  });
  assert.ok(report.signals.some((s) => s.id === "signal.leads.quote_post_submit_gap"));
  const action = report.actions.find((a) => a.id === "action.quote_funnel_gap");
  assert.ok(action);
  assert.match(action.title, /submit-to-lead/i);
  assert.match(action.reason, /Form submissions were observed/);
});

test("11 starts / 5 submits / 5 leads does not invent a generic abandonment alarm", () => {
  const report = buildWeeklyIntelligence({
    reports: baseReports({
      ga4: buildGa4WithWindows({
        recent: {
          generate_lead: 5,
          phone_click: 0,
          sms_click: 0,
          quote_form_start: 11,
          form_submit: 5,
        },
        prior: {
          generate_lead: 5,
          phone_click: 0,
          sms_click: 0,
          quote_form_start: 8,
          form_submit: 5,
        },
      }),
    }),
    catalog: VERIFIED_CATALOG,
    now,
  });
  assert.equal(
    report.signals.some((s) => String(s.id).startsWith("signal.leads.quote_")),
    false
  );
  assert.equal(
    report.actions.some((a) => a.id === "action.quote_funnel_gap"),
    false
  );
});

test("generate_lead greater than quote_form_start does not imply impossible conversion", () => {
  const report = buildWeeklyIntelligence({
    reports: baseReports({
      ga4: buildGa4WithWindows({
        recent: {
          generate_lead: 5,
          phone_click: 0,
          sms_click: 0,
          quote_form_start: 2,
          form_submit: 4,
        },
        prior: {
          generate_lead: 1,
          phone_click: 0,
          sms_click: 0,
          quote_form_start: 1,
          form_submit: 1,
        },
      }),
    }),
    catalog: VERIFIED_CATALOG,
    now,
  });
  assert.equal(report.quoteFunnel.comparableAsConversionRate, false);
  assert.equal(
    report.actions.some((a) => a.id === "action.quote_funnel_gap"),
    false
  );
  const quoteText = [
    JSON.stringify(report.quoteFunnel),
    ...report.signals.filter((s) => String(s.id).includes("quote")).map((s) => s.summary),
    ...report.actions.filter((a) => a.id === "action.quote_funnel_gap").map((a) => `${a.title} ${a.reason}`),
  ].join("\n");
  assert.equal(/\b\d+(\.\d+)?\s*%\s*(abandoned|conversion|funnel)/i.test(quoteText), false);
});

test("quoteFunnel packet marks event counts as non-comparable conversion rates", () => {
  const funnel = buildQuoteFunnel(
    computeGa4LeadKpis(
      buildGa4WithWindows({
        recent: {
          generate_lead: 0,
          phone_click: 0,
          sms_click: 0,
          quote_form_start: 11,
          form_submit: 0,
        },
        prior: {
          generate_lead: 2,
          phone_click: 0,
          sms_click: 0,
          quote_form_start: 1,
          form_submit: 1,
        },
      })
    )
  );
  assert.equal(funnel.measurementKind, "event_count_diagnostic");
  assert.equal(funnel.comparableAsConversionRate, false);
  assert.deepEqual(funnel.recent7, {
    quote_form_start: 11,
    form_submit: 0,
    generate_lead: 0,
  });
  assert.ok(funnel.caveats.includes(QUOTE_FUNNEL_CAVEAT));
});

test("small quote-form samples reduce confidence", () => {
  const diagnosis = diagnoseQuoteFunnel({
    events: {
      quote_form_start: { current7: 2, prior7: 1, days28: 3, comparable: true },
      form_submit: { current7: 0, prior7: 0, days28: 0, comparable: true },
      generate_lead: { current7: 0, prior7: 0, days28: 0, comparable: true },
    },
  });
  assert.equal(diagnosis.id, "signal.leads.quote_funnel_tiny_sample");
  assert.equal(diagnosis.confidence, "low");
});

test("unavailable form_submit fails closed with low confidence", () => {
  const diagnosis = diagnoseQuoteFunnel({
    events: {
      quote_form_start: { current7: 11, prior7: 1, days28: 13, comparable: true },
      form_submit: { current7: null, prior7: null, days28: null, comparable: false },
      generate_lead: { current7: 0, prior7: 2, days28: 5, comparable: true },
    },
  });
  assert.equal(diagnosis.id, "signal.leads.quote_funnel_submit_unavailable");
  assert.equal(diagnosis.confidence, "low");
});

test("quote diagnostic runs without prior7 WoW comparator", () => {
  const ga4Kpis = {
    ok: true,
    reason: null,
    events: {
      quote_form_start: {
        current7: 11,
        prior7: null,
        days28: 12,
        absChange: null,
        pctChange: null,
        comparable: false,
      },
      form_submit: {
        current7: 0,
        prior7: null,
        days28: 1,
        absChange: null,
        pctChange: null,
        comparable: false,
      },
      generate_lead: {
        current7: 0,
        prior7: null,
        days28: 2,
        absChange: null,
        pctChange: null,
        comparable: false,
      },
      phone_click: {
        current7: 0,
        prior7: null,
        days28: 0,
        absChange: null,
        pctChange: null,
        comparable: false,
      },
      sms_click: {
        current7: 0,
        prior7: null,
        days28: 0,
        absChange: null,
        pctChange: null,
        comparable: false,
      },
    },
  };
  const signals = collectSignals({
    ga4Kpis,
    gbpKpis: { ok: false, metrics: {} },
    gsc: null,
    catalog: VERIFIED_CATALOG,
    reviewOpportunity: { actionRecommended: false, unrepliedCount: 0, evidence: [] },
    postOpportunity: { shouldDraft: false, maintenanceSignal: false, evidence: [] },
    dataQuality: { available: { ga4: true }, issues: [] },
  });
  assert.equal(signals.some((s) => s.id === "signal.leads.decline"), false);
  assert.equal(signals.some((s) => s.id === "signal.leads.improve"), false);
  assert.ok(signals.some((s) => s.id === "signal.leads.quote_pre_submit_gap"));
});

test("zero or null starts still allow post-submit continuity when submits>0 and leads=0", () => {
  assert.equal(
    diagnoseQuoteFunnel({
      events: {
        quote_form_start: { current7: 0, prior7: 1, days28: 1, comparable: true },
        form_submit: { current7: 5, prior7: 1, days28: 6, comparable: true },
        generate_lead: { current7: 0, prior7: 2, days28: 2, comparable: true },
      },
    }).id,
    "signal.leads.quote_post_submit_gap"
  );
  assert.equal(
    diagnoseQuoteFunnel({
      events: {
        quote_form_start: { current7: null, prior7: null, days28: null, comparable: false },
        form_submit: { current7: 5, prior7: 1, days28: 6, comparable: true },
        generate_lead: { current7: 0, prior7: 2, days28: 2, comparable: true },
      },
    }).id,
    "signal.leads.quote_post_submit_gap"
  );
});

test("tiny start count does not suppress stronger post-submit evidence", () => {
  const diagnosis = diagnoseQuoteFunnel({
    events: {
      quote_form_start: { current7: 2, prior7: 1, days28: 3, comparable: true },
      form_submit: { current7: 5, prior7: 1, days28: 6, comparable: true },
      generate_lead: { current7: 0, prior7: 1, days28: 1, comparable: true },
    },
  });
  assert.equal(diagnosis.id, "signal.leads.quote_post_submit_gap");
  assert.equal(diagnosis.stage, "post_submit");
});

test("missing generate_lead evidence is not treated as a post-submit gap", () => {
  const diagnosis = diagnoseQuoteFunnel({
    events: {
      quote_form_start: { current7: 11, prior7: 1, days28: 12, comparable: true },
      form_submit: { current7: 5, prior7: 1, days28: 6, comparable: true },
      generate_lead: { current7: null, prior7: null, days28: null, comparable: false },
    },
  });
  assert.equal(diagnosis, null);
});

test("quote funnel diagnostics never emit percentage conversion rates", () => {
  const report = buildWeeklyIntelligence({
    reports: baseReports({
      ga4: buildGa4WithWindows({
        recent: {
          generate_lead: 0,
          phone_click: 0,
          sms_click: 0,
          quote_form_start: 11,
          form_submit: 0,
        },
        prior: {
          generate_lead: 2,
          phone_click: 0,
          sms_click: 0,
          quote_form_start: 1,
          form_submit: 1,
        },
      }),
    }),
    catalog: VERIFIED_CATALOG,
    now,
  });
  const quoteBits = [
    JSON.stringify(report.quoteFunnel),
    ...report.signals.filter((s) => String(s.id).includes("quote")).map((s) => s.summary),
    ...report.actions.filter((a) => a.id === "action.quote_funnel_gap").map((a) => a.reason),
  ].join("\n");
  assert.equal(/\b\d+(\.\d+)?\s*%\s*(abandoned|conversion|funnel|complete)/i.test(quoteBits), false);
  assert.equal(report.quoteFunnel.comparableAsConversionRate, false);
});
