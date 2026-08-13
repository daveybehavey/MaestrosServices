import assert from "node:assert/strict";
import test from "node:test";

import {
  COLLECTOR_DIAGNOSTIC_MAX_CHARS,
  buildCollectorResult,
  classifyCollectorFailure,
  redactCollectorText,
  sanitizeCollectorResultForCi,
  truncateDiagnostic,
} from "./growth-collector-diagnostics.mjs";
import { sanitizeWeeklyForCi } from "./growth-weekly-ci.mjs";

const FAKE_ENV = {
  GOOGLE_OAUTH_CLIENT_ID: "fake-client-id-abc123",
  GOOGLE_OAUTH_CLIENT_SECRET: "fake-client-secret-xyz789",
  GOOGLE_OAUTH_REFRESH_TOKEN: "fake-refresh-token-shared",
  GOOGLE_GBP_OAUTH_REFRESH_TOKEN: "fake-refresh-token-gbp",
  GOOGLE_GBP_OAUTH_CLIENT_ID: "fake-gbp-client-id",
  GOOGLE_GBP_OAUTH_CLIENT_SECRET: "fake-gbp-client-secret",
};

test("actual secret values in fake child stderr are redacted", () => {
  const raw = `oauth failed client_id=${FAKE_ENV.GOOGLE_OAUTH_CLIENT_ID} secret=${FAKE_ENV.GOOGLE_OAUTH_CLIENT_SECRET} refresh=${FAKE_ENV.GOOGLE_OAUTH_REFRESH_TOKEN} gbp=${FAKE_ENV.GOOGLE_GBP_OAUTH_REFRESH_TOKEN}`;
  const redacted = redactCollectorText(raw, FAKE_ENV);
  assert.equal(redacted.includes(FAKE_ENV.GOOGLE_OAUTH_CLIENT_ID), false);
  assert.equal(redacted.includes(FAKE_ENV.GOOGLE_OAUTH_CLIENT_SECRET), false);
  assert.equal(redacted.includes(FAKE_ENV.GOOGLE_OAUTH_REFRESH_TOKEN), false);
  assert.equal(redacted.includes(FAKE_ENV.GOOGLE_GBP_OAUTH_REFRESH_TOKEN), false);
  assert.match(redacted, /\[REDACTED\]/);
});

test("Bearer tokens are redacted", () => {
  const redacted = redactCollectorText(
    "Authorization: Bearer ya29.fake-access-token-value",
    FAKE_ENV
  );
  assert.equal(redacted.includes("ya29.fake-access-token-value"), false);
  assert.match(redacted, /Bearer \[REDACTED\]/i);
});

test("refresh_token and client_secret patterns are redacted", () => {
  const redacted = redactCollectorText(
    'body={"refresh_token":"rt-leaked","client_secret":"cs-leaked","access_token":"at-leaked"}',
    {}
  );
  assert.equal(redacted.includes("rt-leaked"), false);
  assert.equal(redacted.includes("cs-leaked"), false);
  assert.equal(redacted.includes("at-leaked"), false);
});

test("long diagnostics are truncated", () => {
  const long = "x".repeat(COLLECTOR_DIAGNOSTIC_MAX_CHARS + 500);
  const truncated = truncateDiagnostic(long);
  assert.ok(truncated.length < long.length);
  assert.ok(truncated.includes("[truncated]"));
  assert.ok(truncated.length <= COLLECTOR_DIAGNOSTIC_MAX_CHARS + 40);
});

test("successful collectors do not leak captured output", () => {
  const result = buildCollectorResult({
    script: "gbp:reviews",
    status: 0,
    stdout: "reviewerDisplayName: PII Person\ncomment: SENSITIVE_SHOULD_NOT_LEAK",
    stderr: "",
    env: FAKE_ENV,
  });
  assert.equal(result.ok, true);
  assert.equal(result.diagnostic, null);
  assert.equal(result.failureClass, null);
});

test("oauth invalid_grant classifies correctly", () => {
  assert.equal(
    classifyCollectorFailure({ text: "Error: invalid_grant" }),
    "oauth_invalid_grant"
  );
  const result = buildCollectorResult({
    script: "reporting:ga4",
    status: 1,
    stderr: `Token refresh failed: invalid_grant for ${FAKE_ENV.GOOGLE_OAUTH_REFRESH_TOKEN}`,
    env: FAKE_ENV,
  });
  assert.equal(result.failureClass, "oauth_invalid_grant");
  assert.equal(result.diagnostic.includes(FAKE_ENV.GOOGLE_OAUTH_REFRESH_TOKEN), false);
});

test("oauth invalid_client classifies correctly", () => {
  assert.equal(
    classifyCollectorFailure({ text: "invalid_client unauthorized_client" }),
    "oauth_invalid_client"
  );
});

test("missing env/config classifies correctly", () => {
  assert.equal(
    classifyCollectorFailure({
      text: "Missing required environment values: GOOGLE_OAUTH_CLIENT_ID",
    }),
    "missing_configuration"
  );
});

test("generic API/network error falls back safely", () => {
  assert.equal(
    classifyCollectorFailure({ text: "fetch failed ETIMEDOUT" }),
    "network_failure"
  );
  assert.equal(
    classifyCollectorFailure({ text: "something weird happened" }),
    "unknown_collector_failure"
  );
});

test("CI artifact keeps only sanitized diagnostic", () => {
  const dirty = buildCollectorResult({
    script: "gbp:reviews",
    status: 1,
    stderr: `invalid_grant refresh=${FAKE_ENV.GOOGLE_GBP_OAUTH_REFRESH_TOKEN} reviewerDisplayName=PII Person comment=SENSITIVE_SHOULD_NOT_LEAK`,
    env: FAKE_ENV,
  });
  const cleaned = sanitizeCollectorResultForCi(dirty, FAKE_ENV);
  assert.equal(cleaned.ok, false);
  assert.equal(cleaned.failureClass, "oauth_invalid_grant");
  assert.equal(cleaned.diagnostic.includes(FAKE_ENV.GOOGLE_GBP_OAUTH_REFRESH_TOKEN), false);
  assert.equal(cleaned.diagnostic.includes("PII Person"), false);
  assert.equal(cleaned.diagnostic.includes("SENSITIVE_SHOULD_NOT_LEAK"), false);
});

test("raw secret fixture strings are absent from serialized report/artifact", () => {
  const packet = sanitizeWeeklyForCi(
    {
      actions: [],
      postOpportunity: { shouldDraft: false, reason: "x", serviceRefs: [], areaRefs: [] },
      reviewOpportunity: { unrepliedCount: null, actionRecommended: false, reason: "y" },
      dataQuality: { available: {}, issues: [] },
      signals: [],
      kpis: {},
      collection: {
        attempted: true,
        results: [
          buildCollectorResult({
            script: "reporting:ga4",
            status: 1,
            stderr: `invalid_client secret=${FAKE_ENV.GOOGLE_OAUTH_CLIENT_SECRET}`,
            env: FAKE_ENV,
          }),
        ],
      },
    },
    { env: FAKE_ENV }
  );
  const blob = JSON.stringify(packet);
  assert.equal(blob.includes(FAKE_ENV.GOOGLE_OAUTH_CLIENT_SECRET), false);
  assert.equal(blob.includes(FAKE_ENV.GOOGLE_OAUTH_REFRESH_TOKEN), false);
  assert.equal(packet.collection.results[0].failureClass, "oauth_invalid_client");
  assert.ok(packet.collection.results[0].diagnostic);
});

test("customer review text cannot leak through collector diagnostics", () => {
  const result = buildCollectorResult({
    script: "gbp:reviews",
    status: 1,
    stdout: "reviewerDisplayName: Alice Example\ncomment: Great work on my driveway\nownerReply: Thanks!",
    stderr: "Request failed with status 500",
    env: FAKE_ENV,
  });
  const blob = JSON.stringify(result);
  assert.equal(blob.includes("Alice Example"), false);
  assert.equal(blob.includes("Great work on my driveway"), false);
  assert.equal(blob.includes("Thanks!"), false);
  assert.match(result.diagnostic, /Request failed with status 500/);
});

test("stderr plain review fields are redacted while preserving API error marker", () => {
  const result = buildCollectorResult({
    script: "gbp:reviews",
    status: 1,
    stdout: "",
    stderr:
      "Request failed with status 500\nreviewerDisplayName: Alice Example\ncomment: Great work on my driveway\nownerReply: Thanks!",
    env: FAKE_ENV,
  });
  const blob = JSON.stringify(result);
  assert.equal(blob.includes("Alice Example"), false);
  assert.equal(blob.includes("Great work on my driveway"), false);
  assert.equal(blob.includes("Thanks!"), false);
  assert.match(result.diagnostic, /Request failed with status 500/);
  const cleaned = sanitizeCollectorResultForCi(result, FAKE_ENV);
  assert.equal(JSON.stringify(cleaned).includes("Alice Example"), false);
});

test("stderr JSON review fields are redacted", () => {
  const result = buildCollectorResult({
    script: "gbp:reviews",
    status: 1,
    stdout: "ok-ish",
    stderr: `API error 500 {"reviewerDisplayName":"Alice Example","comment":"Great work on my driveway","starRating":"FIVE"}`,
    env: FAKE_ENV,
  });
  const blob = JSON.stringify(result);
  assert.equal(blob.includes("Alice Example"), false);
  assert.equal(blob.includes("Great work on my driveway"), false);
  assert.match(result.diagnostic, /API error 500/);
});

test("stderr nested ownerReply comment is fail-closed", () => {
  const result = buildCollectorResult({
    script: "gbp:reviews",
    status: 1,
    stderr:
      'upstream failed {"ownerReply":{"comment":"Thanks for the kind note!","updateTime":"2026-01-01T00:00:00Z"},"reviewId":"rev_x"}',
    env: FAKE_ENV,
  });
  const blob = JSON.stringify(result);
  assert.equal(blob.includes("Thanks for the kind note!"), false);
  assert.match(result.diagnostic, /upstream failed/);
});

test("stderr mixed API error plus review data keeps marker and drops PII", () => {
  const result = buildCollectorResult({
    script: "gbp:reviews",
    status: 1,
    stderr:
      'Google API 403 PERMISSION_DENIED while dumping {"reviewer_display_name":"Bob Customer","comment":"Please call me back","owner_reply":{"comment":"We will follow up"}}',
    env: FAKE_ENV,
  });
  const blob = JSON.stringify(result);
  assert.equal(blob.includes("Bob Customer"), false);
  assert.equal(blob.includes("Please call me back"), false);
  assert.equal(blob.includes("We will follow up"), false);
  assert.match(result.diagnostic, /PERMISSION_DENIED|403/);
  assert.equal(result.failureClass, "api_permission_denied");
});

test("stdout fallback is used when stderr is empty and still redacts review text", () => {
  const result = buildCollectorResult({
    script: "gbp:reviews",
    status: 1,
    stdout:
      "Collector failed\nreviewerDisplayName: Alice Example\ncomment: Great work on my driveway",
    stderr: "",
    env: FAKE_ENV,
  });
  const blob = JSON.stringify(result);
  assert.equal(blob.includes("Alice Example"), false);
  assert.equal(blob.includes("Great work on my driveway"), false);
  assert.match(result.diagnostic, /Collector failed/);
});

test("403 SERVICE_DISABLED classifies as api_not_enabled_or_quota", () => {
  assert.equal(
    classifyCollectorFailure({
      text: "403 SERVICE_DISABLED Google My Business API has not been used in project 123",
    }),
    "api_not_enabled_or_quota"
  );
  const result = buildCollectorResult({
    script: "gbp:performance",
    status: 1,
    stderr:
      "Error: 403 SERVICE_DISABLED\nGoogle My Business API has not been used in project 123 before or it is disabled.",
    env: FAKE_ENV,
  });
  assert.equal(result.failureClass, "api_not_enabled_or_quota");
});

test("ordinary 403 PERMISSION_DENIED classifies as api_permission_denied", () => {
  assert.equal(
    classifyCollectorFailure({
      text: "403 PERMISSION_DENIED Caller does not have permission",
    }),
    "api_permission_denied"
  );
});
