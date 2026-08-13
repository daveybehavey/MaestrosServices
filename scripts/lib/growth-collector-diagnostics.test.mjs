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
