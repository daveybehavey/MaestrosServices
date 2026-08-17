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
  LEAD_OPS_SAFETY,
  assertOpportunityCatalogSafety,
  buildEvidenceGapOpportunities,
  buildLeadOpsPacket,
  buildSeasonalOpportunities,
} from "./growth-lead-ops.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");

const FORBIDDEN_SOURCE_PATTERNS = [
  /require\(\s*["']nodemailer["']\s*\)/,
  /require\(\s*["']@sendgrid\//,
  /from\s+["']twilio["']/,
  /reviews\/.*\/reply/,
  /createLocalPost/,
  /gbp:create-post/,
  /ads:create/,
  /git\s+push/,
  /gh\s+pr\s+create/,
  /gh\s+issue\s+create/,
  /wrangler\s+deploy/,
  /pages\s+deploy/,
  /method:\s*["']POST["']/,
  /method:\s*["']PATCH["']/,
  /method:\s*["']PUT["']/,
  /method:\s*["']DELETE["']/,
];

const FULL_SERVICES = [
  ...VERIFIED_CATALOG.services,
  {
    id: "svc.moss-algae-treatment",
    slug: "moss-algae-treatment",
    name: "Moss and Algae Treatment",
    aliases: ["moss"],
    status: "candidate",
  },
  {
    id: "svc.large-tree-felling",
    slug: null,
    name: "Large Tree Felling",
    aliases: ["tree removal"],
    status: "rejected",
  },
];

const NOW = new Date("2026-08-12T12:00:00.000Z");

const stampGa4 = (ga4) => ({
  ...ga4,
  generatedAt: "2026-08-12T12:00:00.000Z",
});

const baseReports = () => ({
  ga4: stampGa4(
    buildGa4WithWindows({
      recent: {
        quote_form_start: 0,
        form_submit: 0,
        generate_lead: 0,
        phone_click: 0,
        sms_click: 0,
      },
      prior: {
        quote_form_start: 0,
        form_submit: 0,
        generate_lead: 0,
        phone_click: 0,
        sms_click: 0,
      },
    })
  ),
  gsc: {
    generatedAt: "2026-08-12T12:00:00.000Z",
    comparison: {
      recent28: {
        topPages: [
          {
            keys: ["https://example.com/services/power-washing"],
            impressions: 120,
            clicks: 1,
            ctr: 0.008,
            position: 12,
          },
        ],
        topQueries: [
          {
            keys: ["power washing shawnigan lake"],
            impressions: 80,
            clicks: 1,
            ctr: 0.012,
            position: 9,
          },
        ],
      },
    },
  },
  gbpPerformance: buildGbpPerformance({ endDate: "2026-08-11" }),
  gbpKeywords: {
    generatedAt: "2026-08-12T12:00:00.000Z",
    keywords: [
      {
        searchKeyword: "power washing",
        impressions: 40,
        belowThreshold: false,
      },
    ],
  },
  gbpReviews: {
    generatedAt: "2026-08-12T12:00:00.000Z",
    averageRating: 5,
    totalReviewCount: 2,
    unrepliedCount: 2,
    unrepliedReviewIds: ["rev_a", "rev_b"],
    reviews: [],
  },
  gbpPosts: {
    generatedAt: "2026-08-12T12:00:00.000Z",
    localPosts: [
      {
        createTime: "2026-07-01T00:00:00.000Z",
        updateTime: "2026-07-01T00:00:00.000Z",
        summary: "General property care update",
      },
    ],
  },
});

const factsBundle = {
  services: FULL_SERVICES,
  areas: VERIFIED_CATALOG.areas,
  projects: [],
};

test("verified service with credible demand can produce an opportunity", () => {
  const packet = buildLeadOpsPacket({
    reports: baseReports(),
    facts: {
      services: FULL_SERVICES,
      areas: VERIFIED_CATALOG.areas,
      projects: [],
    },
    now: NOW,
  });
  const demand = packet.opportunities.find(
    (o) => o.type === "gbp_search_demand" || o.type === "organic_search_demand"
  );
  assert.ok(demand, "expected a demand opportunity");
  assert.ok(demand.serviceRefs.includes("svc.power-washing"));
  assert.equal(demand.executionEligible, false);
  assert.equal(demand.requiresHumanReview, true);
});

test("candidate/rejected service cannot be promoted as execution-ready", () => {
  const unsafe = {
    id: "bad",
    type: "gbp_search_demand",
    serviceRefs: ["svc.moss-algae-treatment"],
    executionEligible: false,
    requiresHumanReview: true,
  };
  const candidateCheck = assertOpportunityCatalogSafety(unsafe, FULL_SERVICES);
  assert.equal(candidateCheck.ok, false);

  const rejected = {
    ...unsafe,
    serviceRefs: ["svc.large-tree-felling"],
  };
  assert.equal(assertOpportunityCatalogSafety(rejected, FULL_SERVICES).ok, false);

  const packet = buildLeadOpsPacket({
    reports: baseReports(),
    facts: {
      services: FULL_SERVICES,
      areas: VERIFIED_CATALOG.areas,
      projects: [],
    },
    now: NOW,
  });
  for (const opp of packet.opportunities) {
    if (opp.status === "research_required") {
      assert.deepEqual(opp.serviceRefs, []);
      continue;
    }
    assert.equal(assertOpportunityCatalogSafety(opp, FULL_SERVICES).ok, true);
    assert.equal(opp.serviceRefs.includes("svc.moss-algae-treatment"), false);
    assert.equal(opp.serviceRefs.includes("svc.large-tree-felling"), false);
  }
});

test("missing source does not become zero demand", () => {
  const reports = baseReports();
  reports.gsc = null;
  reports.gbpKeywords = null;
  const packet = buildLeadOpsPacket({
    reports,
    facts: {
      services: FULL_SERVICES,
      areas: VERIFIED_CATALOG.areas,
      projects: [],
    },
    now: NOW,
  });
  assert.equal(packet.dataQuality.available.gsc, false);
  assert.ok(
    packet.abstentions.some(
      (a) => a.type === "organic_search_demand" || a.type === "gbp_search_demand"
    )
  );
  assert.equal(
    packet.opportunities.some((o) => o.type === "organic_search_demand"),
    false
  );
});

test("tiny sample produces low confidence or watch status", () => {
  const reports = baseReports();
  reports.ga4 = stampGa4(
    buildGa4WithWindows({
      recent: {
        quote_form_start: 2,
        form_submit: 0,
        generate_lead: 0,
        phone_click: 0,
        sms_click: 0,
      },
      prior: {
        quote_form_start: 1,
        form_submit: 0,
        generate_lead: 0,
        phone_click: 0,
        sms_click: 0,
      },
    })
  );
  const packet = buildLeadOpsPacket({
    reports,
    facts: {
      services: FULL_SERVICES,
      areas: VERIFIED_CATALOG.areas,
      projects: [],
    },
    now: NOW,
  });
  const tiny = packet.opportunities.find((o) =>
    String(o.id).includes("quote_funnel_tiny_sample")
  );
  assert.ok(tiny);
  assert.equal(tiny.confidence, "low");
  assert.ok(tiny.status === "watch" || tiny.priority === "low");
  assert.match(tiny.rationale, /not .*conversion|conversion data/i);
});

test("incompatible GA4 event counts are not presented as conversion rates", () => {
  const reports = baseReports();
  reports.ga4 = stampGa4(
    buildGa4WithWindows({
      recent: {
        quote_form_start: 8,
        form_submit: 0,
        generate_lead: 0,
        phone_click: 0,
        sms_click: 0,
      },
      prior: {
        quote_form_start: 7,
        form_submit: 0,
        generate_lead: 0,
        phone_click: 0,
        sms_click: 0,
      },
    })
  );
  const packet = buildLeadOpsPacket({
    reports,
    facts: {
      services: FULL_SERVICES,
      areas: VERIFIED_CATALOG.areas,
      projects: [],
    },
    now: NOW,
  });
  assert.equal(packet.quoteFunnel.comparableAsConversionRate, false);
  assert.equal(packet.quoteFunnel.measurementKind, "event_count_diagnostic");
  const blob = JSON.stringify(packet);
  assert.equal(/conversion rate\s*=/.test(blob), false);
  assert.equal(packet.quoteFunnel.comparableAsConversionRate, false);
});

test("seasonal unverified service becomes research_required only", () => {
  const seasonal = buildSeasonalOpportunities({
    now: new Date("2026-11-15T12:00:00.000Z"),
    services: FULL_SERVICES,
  });
  const research = seasonal.filter((o) => o.status === "research_required");
  assert.ok(research.length >= 1);
  for (const row of research) {
    assert.deepEqual(row.serviceRefs, []);
    assert.equal(row.executionEligible, false);
    assert.match(row.recommendedAction, /Investigate/i);
    assert.equal(/Maestros offers snow/i.test(row.recommendedAction), false);
  }
  const verifiedSeasonal = seasonal.find((o) => o.status === "recommended");
  if (verifiedSeasonal) {
    for (const id of verifiedSeasonal.serviceRefs) {
      const svc = FULL_SERVICES.find((s) => s.id === id);
      assert.equal(svc.status, "verified");
    }
  }
});

test("no fabricated area/service refs", () => {
  const packet = buildLeadOpsPacket({
    reports: baseReports(),
    facts: {
      services: FULL_SERVICES,
      areas: VERIFIED_CATALOG.areas,
      projects: [],
    },
    now: NOW,
  });
  const knownServices = new Set(FULL_SERVICES.map((s) => s.id));
  const knownAreas = new Set(VERIFIED_CATALOG.areas.map((a) => a.id));
  for (const opp of packet.opportunities) {
    for (const id of opp.serviceRefs) assert.ok(knownServices.has(id));
    for (const id of opp.areaRefs) assert.ok(knownAreas.has(id));
  }
});

test("review state is reused via weekly reviewOpportunity, not duplicated writer", () => {
  const packet = buildLeadOpsPacket({
    reports: baseReports(),
    facts: {
      services: FULL_SERVICES,
      areas: VERIFIED_CATALOG.areas,
      projects: [],
    },
    now: NOW,
  });
  assert.equal(packet.reviewOpportunity.unrepliedCount, 2);
  assert.equal(packet.reviewOpportunity.actionRecommended, true);
  const reviewOpp = packet.opportunities.find((o) => o.id === "opp.review.unreplied");
  assert.ok(reviewOpp);
  assert.equal(reviewOpp.type, "review_reputation");
  const lib = fs.readFileSync(path.join(here, "growth-lead-ops.mjs"), "utf8");
  assert.match(lib, /buildReviewOpportunity/);
  assert.equal(/draftReply\s*=/.test(lib), false);
});

test("evidence-gap recommendation can be generated", () => {
  const gaps = buildEvidenceGapOpportunities({
    services: FULL_SERVICES,
    projects: [],
    demandServiceIds: ["svc.power-washing"],
  });
  const power = gaps.find((o) => o.serviceRefs.includes("svc.power-washing"));
  assert.ok(power);
  assert.equal(power.type, "content_evidence_gap");
  assert.match(power.recommendedAction, /before\/after photos/i);
});

test("no more than 3 topActions and zero is allowed", () => {
  const withData = buildLeadOpsPacket({
    reports: baseReports(),
    facts: {
      services: FULL_SERVICES,
      areas: VERIFIED_CATALOG.areas,
      projects: [],
    },
    now: NOW,
  });
  assert.ok(withData.topActions.length <= 3);

  const empty = buildLeadOpsPacket({
    reports: {
      ga4: null,
      gsc: null,
      gbpPerformance: null,
      gbpKeywords: null,
      gbpReviews: null,
      gbpPosts: null,
    },
    facts: {
      services: FULL_SERVICES,
      areas: VERIFIED_CATALOG.areas,
      projects: [{ id: "proj.1", serviceIds: ["svc.power-washing"], summary: "Power Washing" }],
    },
    now: new Date("2026-04-15T12:00:00.000Z"),
  });
  // April may still produce verified seasonal opportunities; filter research out of topActions.
  assert.ok(empty.topActions.length <= 3);
  const noEvidencePacket = buildLeadOpsPacket({
    reports: {
      ga4: null,
      gsc: null,
      gbpPerformance: null,
      gbpKeywords: null,
      gbpReviews: {
        generatedAt: "2026-08-12T12:00:00.000Z",
        averageRating: 5,
        totalReviewCount: 20,
        unrepliedCount: 0,
        unrepliedReviewIds: [],
      },
      gbpPosts: { generatedAt: "2026-08-12T12:00:00.000Z", localPosts: [] },
    },
    facts: {
      services: FULL_SERVICES.map((s) =>
        s.status === "verified"
          ? s
          : s
      ),
      areas: VERIFIED_CATALOG.areas,
      projects: FULL_SERVICES.filter((s) => s.status === "verified").map((s) => ({
        id: `proj.${s.id}`,
        serviceIds: [s.id],
        summary: s.name,
      })),
    },
    now: new Date("2026-04-02T12:00:00.000Z"),
  });
  assert.ok(noEvidencePacket.topActions.length <= 3);
});

test("all output requires human review and mutation flags stay false", () => {
  const packet = buildLeadOpsPacket({
    reports: baseReports(),
    facts: {
      services: FULL_SERVICES,
      areas: VERIFIED_CATALOG.areas,
      projects: [],
    },
    now: NOW,
  });
  assert.equal(packet.safety.requiresHumanReview, true);
  assert.equal(packet.safety.executionEligible, false);
  assert.equal(packet.safety.contactsProspects, false);
  assert.equal(packet.safety.sendsEmail, false);
  assert.equal(packet.safety.sendsSms, false);
  assert.equal(packet.safety.publishes, false);
  assert.equal(packet.safety.mutatesGoogle, false);
  assert.equal(packet.safety.createsAds, false);
  assert.equal(packet.safety.createsSeoPages, false);
  assert.equal(packet.safety.deploys, false);
  for (const opp of packet.opportunities) {
    assert.equal(opp.requiresHumanReview, true);
    assert.equal(opp.executionEligible, false);
  }
  for (const action of packet.topActions) {
    assert.equal(action.requiresHumanReview, true);
    assert.equal(action.executionEligible, false);
  }
  assert.deepEqual(
    { ...LEAD_OPS_SAFETY },
    {
      mode: "lead_ops",
      contactsProspects: false,
      sendsEmail: false,
      sendsSms: false,
      publishes: false,
      mutatesGoogle: false,
      createsAds: false,
      createsSeoPages: false,
      deploys: false,
      requiresHumanReview: true,
      executionEligible: false,
    }
  );
});

test("lead-ops sources have no outreach/mutation/deploy paths", () => {
  const files = [
    path.join(here, "growth-lead-ops.mjs"),
    path.join(root, "scripts/growth-lead-ops.mjs"),
  ];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const pattern of FORBIDDEN_SOURCE_PATTERNS) {
      assert.equal(
        pattern.test(source),
        false,
        `${path.basename(file)} matched forbidden pattern ${pattern}`
      );
    }
    assert.equal(/generateProgrammaticLocationPages/.test(source), false);
    assert.equal(/createProgrammaticServicePages/.test(source), false);
    assert.equal(/scaffoldLocationPages/.test(source), false);
  }
  assert.equal(
    fs.existsSync(path.join(root, ".github/workflows/growth-ops-lead-ops.yml")),
    false
  );
});
