import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { exportWeeklyCiPacket } from "../growth-weekly-ci-export.mjs";
import {
  GROWTH_CI_SOURCE,
  GROWTH_SHADOW_WORKFLOW_PATH,
  assessCiConfig,
  auditGrowthShadowWorkflow,
  formatCiConfigSummary,
  sanitizeWeeklyForCi,
  stripSensitiveFields,
} from "./growth-weekly-ci.mjs";
import { buildWeeklyIntelligence } from "./growth-weekly.mjs";
import {
  VERIFIED_CATALOG,
  buildGa4WithWindows,
  buildGbpPerformance,
} from "../../growth/fixtures/weekly/helpers.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const now = new Date("2026-08-12T15:00:00.000Z");

const sampleReport = () =>
  buildWeeklyIntelligence({
    reports: {
      ga4: buildGa4WithWindows({
        recent: { generate_lead: 2, phone_click: 0, sms_click: 0, quote_form_start: 3 },
        prior: { generate_lead: 1, phone_click: 0, sms_click: 0, quote_form_start: 2 },
      }),
      gsc: {
        comparison: {
          lagDays: 3,
          recent28: {
            dateRange: { startDate: "2026-07-13", endDate: "2026-08-09" },
            topQueries: [],
            topPages: [],
          },
        },
      },
      gbpPerformance: buildGbpPerformance(),
      gbpKeywords: {
        generatedAt: "2026-08-12T12:00:00.000Z",
        keywords: [
          { searchKeyword: "power washing", impressions: 40, belowThreshold: false },
        ],
      },
      gbpReviews: {
        generatedAt: "2026-08-12T12:00:00.000Z",
        unrepliedCount: 2,
        unrepliedReviewIds: ["rev_keep_opaque"],
        totalReviewCount: 2,
        averageRating: 5,
        reviews: [
          {
            reviewId: "rev_keep_opaque",
            reviewerDisplayName: "PII Person",
            comment: "SENSITIVE_SHOULD_NOT_LEAK",
            hasOwnerReply: false,
            ownerReply: { comment: "OWNER_REPLY_SECRET" },
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
    },
    catalog: VERIFIED_CATALOG,
    now,
    collectorResults: [
      { script: "gbp:reviews", ok: true, status: 0 },
      { script: "gbp:list-posts", ok: true, status: 0 },
      { script: "reporting:ga4", ok: false, status: 1 },
    ],
  });

test("CI export contains safety metadata and github_actions_shadow source", () => {
  const packet = sanitizeWeeklyForCi(sampleReport(), {
    run: {
      repository: "daveybehavey/MaestrosServices",
      workflow: "Growth Ops Shadow",
      commitSha: "abc123",
    },
  });
  assert.equal(packet.source, GROWTH_CI_SOURCE);
  assert.equal(packet.mode, "shadow_read_only");
  assert.equal(packet.publishes, false);
  assert.equal(packet.mutatesGoogle, false);
  assert.equal(packet.deploys, false);
  assert.equal(packet.requiresHumanReview, true);
  assert.equal(packet.autoPublishEligible, false);
  assert.equal(packet.safety.requiresHumanReview, true);
  assert.equal(packet.safety.autoPublishEligible, false);
  assert.equal(packet.run.repository, "daveybehavey/MaestrosServices");
  assert.equal(packet.run.commitSha, "abc123");
});

test("CI export contains max 3 actions", () => {
  const bloated = sampleReport();
  bloated.actions = Array.from({ length: 5 }, (_, i) => ({
    id: `action.${i}`,
    type: "maintenance",
    title: `Action ${i}`,
    reason: "x",
    recommendedNextStep: "y",
    targetKpi: "z",
    confidence: "low",
    impact: 1,
    priority: i + 1,
  }));
  const packet = sanitizeWeeklyForCi(bloated);
  assert.ok(packet.actions.length <= 3);
});

test("CI export strips PII and auth fields", () => {
  const dirty = sampleReport();
  dirty.reviewOpportunity.evidence = [
    {
      reviewerDisplayName: "PII Person",
      comment: "SENSITIVE_SHOULD_NOT_LEAK",
      ownerReply: { comment: "OWNER_REPLY_SECRET" },
      unrepliedReviewIds: ["rev_1"],
    },
  ];
  dirty.auth = {
    client_secret: "secret-value",
    refresh_token: "refresh-value",
    access_token: "access-value",
  };
  const packet = sanitizeWeeklyForCi(dirty);
  const blob = JSON.stringify(packet);
  assert.equal(blob.includes("PII Person"), false);
  assert.equal(blob.includes("SENSITIVE_SHOULD_NOT_LEAK"), false);
  assert.equal(blob.includes("OWNER_REPLY_SECRET"), false);
  assert.equal(blob.includes("secret-value"), false);
  assert.equal(blob.includes("refresh-value"), false);
  assert.equal(blob.includes("access-value"), false);
  assert.equal(blob.includes("reviewerDisplayName"), false);
  assert.equal(blob.includes("client_secret"), false);
  assert.equal(blob.includes("refresh_token"), false);
  assert.equal(blob.includes("access_token"), false);
  assert.equal("unrepliedReviewIds" in (packet.reviewOpportunity || {}), false);
  assert.equal(packet.reviewOpportunity.unrepliedCount, 2);
});

test("stripSensitiveFields removes nested token material", () => {
  const cleaned = stripSensitiveFields({
    ok: true,
    nested: { access_token: "x", keep: 1 },
    list: [{ refresh_token: "y", n: 2 }],
  });
  assert.deepEqual(cleaned, { ok: true, nested: { keep: 1 }, list: [{ n: 2 }] });
});

test("missing data remains missing, not zero", () => {
  const report = buildWeeklyIntelligence({
    reports: {},
    catalog: VERIFIED_CATALOG,
    now,
  });
  const packet = sanitizeWeeklyForCi(report);
  assert.equal(packet.reviewOpportunity.unrepliedCount, null);
  assert.notEqual(packet.reviewOpportunity.unrepliedCount, 0);
  assert.ok(packet.dataQuality.issues.some((i) => i.code === "missing"));
});

test("partial collector failure remains represented", () => {
  const report = sampleReport();
  report.collection = {
    attempted: true,
    results: [
      { script: "reporting:ga4", ok: false, status: 1 },
      { script: "gbp:reviews", ok: true, status: 0 },
    ],
  };
  const packet = sanitizeWeeklyForCi(report);
  assert.equal(packet.collection.attempted, true);
  assert.equal(packet.collection.results[0].ok, false);
  assert.equal(packet.collection.results[0].script, "reporting:ga4");
  assert.equal(packet.collection.results[1].ok, true);
});

test("postOpportunity refs survive when safe", () => {
  const packet = sanitizeWeeklyForCi(sampleReport());
  assert.equal(typeof packet.postOpportunity.shouldDraft, "boolean");
  assert.ok(Array.isArray(packet.postOpportunity.serviceRefs));
  assert.ok(Array.isArray(packet.postOpportunity.areaRefs));
  if (packet.postOpportunity.shouldDraft) {
    assert.ok(packet.postOpportunity.serviceRefs.length >= 1);
  }
});

test("reviewOpportunity exposes count but not customer text/name", () => {
  const packet = sanitizeWeeklyForCi(sampleReport());
  assert.equal(packet.reviewOpportunity.unrepliedCount, 2);
  assert.equal(packet.reviewOpportunity.actionRecommended, true);
  const blob = JSON.stringify(packet.reviewOpportunity);
  assert.equal(blob.includes("comment"), false);
  assert.equal(blob.includes("reviewerDisplayName"), false);
});

test("config preflight reports labels only and fails closed when required missing", () => {
  const missing = assessCiConfig({});
  assert.equal(missing.configured, false);
  assert.equal(missing.failureClass, "configuration_failure");
  assert.ok(missing.missingRequired.includes("GOOGLE_OAUTH_CLIENT_ID"));
  assert.ok(missing.missingRequired.includes("GOOGLE_GBP_OAUTH_REFRESH_TOKEN"));
  const summary = formatCiConfigSummary(missing);
  assert.match(summary, /GOOGLE_OAUTH_CLIENT_ID: no/);
  assert.match(summary, /GOOGLE_GBP_OAUTH_REFRESH_TOKEN: no/);
  assert.equal(summary.includes("secret-value"), false);

  const withoutGbpRefresh = assessCiConfig({
    GOOGLE_OAUTH_CLIENT_ID: "x",
    GOOGLE_OAUTH_CLIENT_SECRET: "y",
    GOOGLE_OAUTH_REFRESH_TOKEN: "z",
    GOOGLE_GA4_PROPERTY_ID: "p",
    GOOGLE_GBP_LOCATION_NAME: "locations/1",
    GOOGLE_GBP_ACCOUNT_NAME: "accounts/1",
  });
  assert.equal(withoutGbpRefresh.configured, false);
  assert.ok(withoutGbpRefresh.missingRequired.includes("GOOGLE_GBP_OAUTH_REFRESH_TOKEN"));

  const present = assessCiConfig({
    GOOGLE_OAUTH_CLIENT_ID: "x",
    GOOGLE_OAUTH_CLIENT_SECRET: "y",
    GOOGLE_OAUTH_REFRESH_TOKEN: "z",
    GOOGLE_GBP_OAUTH_REFRESH_TOKEN: "gbp-refresh-present",
    GOOGLE_GA4_PROPERTY_ID: "p",
    GOOGLE_GBP_LOCATION_NAME: "locations/1",
    GOOGLE_GBP_ACCOUNT_NAME: "accounts/1",
  });
  assert.equal(present.configured, true);
  assert.equal(present.labels.GOOGLE_GA4_PROPERTY_ID, "yes");
  assert.equal(present.labels.GOOGLE_GBP_OAUTH_REFRESH_TOKEN, "yes");
  assert.equal(present.labels.GOOGLE_GBP_OAUTH_CLIENT_ID, "no");
});

test("exporter writes sanitized files from fixtures without leaking PII", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "growth-ci-export-"));
  try {
    const inPath = path.join(tmp, "growth-weekly.json");
    const outDir = path.join(tmp, "out");
    const dirty = sampleReport();
    dirty.reviewOpportunity.evidence = [
      {
        reviewerDisplayName: "PII Person",
        comment: "SENSITIVE_SHOULD_NOT_LEAK",
      },
    ];
    fs.writeFileSync(inPath, `${JSON.stringify(dirty, null, 2)}\n`, "utf8");
    const { packet, paths } = exportWeeklyCiPacket({
      inPath,
      outDir,
      env: {
        GITHUB_REPOSITORY: "daveybehavey/MaestrosServices",
        GITHUB_WORKFLOW: "Growth Ops Shadow",
        GITHUB_SHA: "deadbeef",
      },
      now,
    });
    assert.ok(fs.existsSync(paths.jsonPath));
    assert.ok(fs.existsSync(paths.mdPath));
    const written = fs.readFileSync(paths.jsonPath, "utf8");
    assert.equal(written.includes("SENSITIVE_SHOULD_NOT_LEAK"), false);
    assert.equal(packet.source, GROWTH_CI_SOURCE);
    assert.equal(packet.run.commitSha, "deadbeef");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("shadow workflow is read-only with minimal permissions and approved triggers", () => {
  const workflowPath = path.join(root, GROWTH_SHADOW_WORKFLOW_PATH);
  assert.ok(fs.existsSync(workflowPath), "workflow file must exist");
  const yamlText = fs.readFileSync(workflowPath, "utf8");
  const audit = auditGrowthShadowWorkflow(yamlText);
  assert.equal(audit.ok, true, audit.violations.join("; "));
  assert.equal(audit.checks.hasWorkflowDispatch, true);
  assert.equal(audit.checks.hasSchedule, true);
  assert.equal(audit.checks.hasContentsRead, true);
  assert.equal(audit.checks.hasContentsWrite, false);
  assert.equal(audit.checks.hasPullRequestsWrite, false);
  assert.equal(audit.checks.hasDeploymentsWrite, false);
  assert.equal(audit.checks.hasIssuesWrite, false);
  assert.equal(audit.checks.runsGrowthWeekly, true);
  assert.equal(audit.checks.hasConcurrency, true);
  assert.equal(audit.checks.allActionsPinnedToSha, true);
  assert.equal(audit.checks.checkoutPersistCredentialsFalse, true);
  assert.equal(audit.checks.weeklyHasContinueOnError, true);
  assert.equal(audit.checks.weeklyHasId, true);
  assert.equal(audit.checks.hasDecisionEngineFailureSummary, true);
  assert.equal(audit.checks.hasFinalWeeklyFailStep, true);
  assert.equal(audit.checks.artifactUploadAfterControlledFailure, true);
  assert.match(yamlText, /cron:\s*"0 16 \* \* 1"/);
  assert.match(yamlText, /growth:weekly-ci-export/);
  assert.match(yamlText, /persist-credentials:\s*false/);
  assert.match(
    yamlText,
    /actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683/
  );
  assert.match(
    yamlText,
    /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/
  );
  assert.match(
    yamlText,
    /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/
  );
  assert.equal(/gbp:create-post/.test(yamlText.replace(/#.*$/gm, "")), false);
  assert.equal(/ads:create/.test(yamlText.replace(/#.*$/gm, "")), false);
  assert.equal(/wrangler\s+deploy/.test(yamlText.replace(/#.*$/gm, "")), false);
  assert.equal(/contents:\s*write/.test(yamlText.replace(/#.*$/gm, "")), false);
  assert.equal(/issues:\s*write/.test(yamlText.replace(/#.*$/gm, "")), false);
});
