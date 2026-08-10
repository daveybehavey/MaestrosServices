import assert from "node:assert/strict";
import test from "node:test";

import {
  BUSINESS_MANAGE_SCOPE,
  PROFILE_AUDIT_READ_MASK,
  auditProfileCompleteness,
  buildMultiDailyMetricsUrl,
  buildProfileGetUrl,
  buildReviewsListUrl,
  buildSearchKeywordsUrl,
  describeGbpAuthSources,
  formatGoogleApiError,
  listMissingGbpOauthLabels,
  normalizeDailyMetricsResponse,
  normalizeReviewsResponse,
  normalizeSearchKeywordsResponse,
  paginateGoogleList,
  redactSecrets,
  resolveGbpOAuthConfig,
  toAccountLocationParent,
  toLocationResourceName,
} from "./gbp.mjs";

test("resolveGbpOAuthConfig prefers GOOGLE_GBP_OAUTH_* over GOOGLE_OAUTH_*", () => {
  const config = resolveGbpOAuthConfig({
    GOOGLE_GBP_OAUTH_CLIENT_ID: "gbp-client",
    GOOGLE_GBP_OAUTH_CLIENT_SECRET: "gbp-secret",
    GOOGLE_GBP_OAUTH_REFRESH_TOKEN: "gbp-refresh",
    GOOGLE_OAUTH_CLIENT_ID: "shared-client",
    GOOGLE_OAUTH_CLIENT_SECRET: "shared-secret",
    GOOGLE_OAUTH_REFRESH_TOKEN: "shared-refresh",
    GOOGLE_GBP_ACCOUNT_NAME: "accounts/1",
    GOOGLE_GBP_LOCATION_NAME: "locations/2",
  });

  assert.equal(config.clientId, "gbp-client");
  assert.equal(config.clientSecret, "gbp-secret");
  assert.equal(config.refreshToken, "gbp-refresh");
  assert.equal(config.sources.clientId, "GOOGLE_GBP_OAUTH_CLIENT_ID");
  assert.equal(config.sources.refreshToken, "GOOGLE_GBP_OAUTH_REFRESH_TOKEN");
  assert.equal(describeGbpAuthSources(config).usingGbpSpecificClient, true);
  assert.equal(describeGbpAuthSources(config).requiredScope, BUSINESS_MANAGE_SCOPE);
});

test("resolveGbpOAuthConfig falls back to shared GOOGLE_OAUTH_*", () => {
  const config = resolveGbpOAuthConfig({
    GOOGLE_OAUTH_CLIENT_ID: "shared-client",
    GOOGLE_OAUTH_CLIENT_SECRET: "shared-secret",
    GOOGLE_OAUTH_REFRESH_TOKEN: "shared-refresh",
  });

  assert.equal(config.clientId, "shared-client");
  assert.equal(config.sources.clientId, "GOOGLE_OAUTH_CLIENT_ID");
  assert.deepEqual(listMissingGbpOauthLabels(config), []);
  assert.equal(describeGbpAuthSources(config).usingGbpSpecificClient, false);
});

test("listMissingGbpOauthLabels reports missing configuration", () => {
  const config = resolveGbpOAuthConfig({});
  assert.deepEqual(listMissingGbpOauthLabels(config), [
    "oauth client ID",
    "oauth client secret",
    "oauth refresh token",
  ]);
});

test("toLocationResourceName handles accounts/, locations/, and bare ids", () => {
  assert.equal(
    toLocationResourceName("accounts/111/locations/222"),
    "locations/222"
  );
  assert.equal(toLocationResourceName("locations/222"), "locations/222");
  assert.equal(toLocationResourceName("222"), "locations/222");
  assert.throws(() => toLocationResourceName(""), /Location name is required/);
  assert.throws(() => toLocationResourceName("locations/a/b"), /Invalid location/);
});

test("toAccountLocationParent requires account when location is locations-only", () => {
  assert.equal(
    toAccountLocationParent("accounts/111/locations/222"),
    "accounts/111/locations/222"
  );
  assert.equal(
    toAccountLocationParent("locations/222", "accounts/111"),
    "accounts/111/locations/222"
  );
  assert.throws(
    () => toAccountLocationParent("locations/222"),
    /GOOGLE_GBP_ACCOUNT_NAME/
  );
});

test("buildMultiDailyMetricsUrl constructs Performance API query", () => {
  const url = buildMultiDailyMetricsUrl("locations/222", {
    startDate: "2026-01-01",
    endDate: "2026-01-31",
    dailyMetrics: ["CALL_CLICKS", "WEBSITE_CLICKS"],
  });

  assert.match(url, /^https:\/\/businessprofileperformance\.googleapis\.com\/v1\/locations\/222:fetchMultiDailyMetricsTimeSeries\?/);
  assert.match(url, /dailyMetrics=CALL_CLICKS/);
  assert.match(url, /dailyMetrics=WEBSITE_CLICKS/);
  assert.match(url, /dailyRange\.start_date\.year=2026/);
  assert.match(url, /dailyRange\.start_date\.month=1/);
  assert.match(url, /dailyRange\.start_date\.day=1/);
  assert.match(url, /dailyRange\.end_date\.day=31/);
  assert.throws(
    () => buildMultiDailyMetricsUrl("locations/222", { startDate: "bad", endDate: "2026-01-31" }),
    /YYYY-MM-DD/
  );
});

test("buildSearchKeywordsUrl constructs monthly impressions URL", () => {
  const url = buildSearchKeywordsUrl("222", {
    startMonth: { year: 2026, month: 1 },
    endMonth: { year: 2026, month: 3 },
    pageToken: "abc",
  });

  assert.match(
    url,
    /^https:\/\/businessprofileperformance\.googleapis\.com\/v1\/locations\/222\/searchkeywords\/impressions\/monthly\?/
  );
  assert.match(url, /monthlyRange\.start_month\.year=2026/);
  assert.match(url, /monthlyRange\.start_month\.month=1/);
  assert.match(url, /monthlyRange\.end_month\.month=3/);
  assert.match(url, /pageToken=abc/);
  assert.match(url, /pageSize=100/);
});

test("buildReviewsListUrl and buildProfileGetUrl construct read-only endpoints", () => {
  const reviewsUrl = buildReviewsListUrl("locations/222", "accounts/111", {
    pageSize: 25,
    pageToken: "tok",
  });
  assert.equal(
    reviewsUrl,
    "https://mybusiness.googleapis.com/v4/accounts/111/locations/222/reviews?pageSize=25&orderBy=updateTime+desc&pageToken=tok"
  );

  const profileUrl = buildProfileGetUrl("locations/222");
  assert.match(
    profileUrl,
    /^https:\/\/mybusinessbusinessinformation\.googleapis\.com\/v1\/locations\/222\?/
  );
  assert.ok(profileUrl.includes("readMask="));
  assert.ok(profileUrl.includes("title"));
  assert.ok(profileUrl.includes("phoneNumbers"));
  assert.ok(profileUrl.includes("websiteUri"));
  for (const field of PROFILE_AUDIT_READ_MASK.split(",")) {
    assert.ok(profileUrl.includes(field), `expected readMask field ${field}`);
  }
});

test("normalizeDailyMetricsResponse flattens series and totals", () => {
  const normalized = normalizeDailyMetricsResponse({
    multiDailyMetricTimeSeries: [
      {
        dailyMetricTimeSeries: [
          {
            dailyMetric: "CALL_CLICKS",
            timeSeries: {
              datedValues: [
                { date: { year: 2026, month: 1, day: 1 }, value: "2" },
                { date: { year: 2026, month: 1, day: 2 }, value: "3" },
              ],
            },
          },
        ],
      },
    ],
  });

  assert.equal(normalized.series.length, 1);
  assert.equal(normalized.series[0].dailyMetric, "CALL_CLICKS");
  assert.equal(normalized.series[0].total, 5);
  assert.deepEqual(normalized.series[0].points[0], { date: "2026-01-01", value: 2 });
  assert.throws(() => normalizeDailyMetricsResponse(null), /Malformed performance/);
  assert.throws(() => normalizeDailyMetricsResponse([]), /Malformed performance/);
});

test("normalizeSearchKeywordsResponse handles values and thresholds", () => {
  const normalized = normalizeSearchKeywordsResponse({
    searchKeywordsCounts: [
      { searchKeyword: "power washing langford", insightsValue: { value: "40" } },
      { searchKeyword: "rare term", insightsValue: { threshold: "15" } },
    ],
    nextPageToken: "next",
  });

  assert.equal(normalized.keywords[0].impressions, 40);
  assert.equal(normalized.keywords[0].belowThreshold, false);
  assert.equal(normalized.keywords[1].impressions, null);
  assert.equal(normalized.keywords[1].threshold, 15);
  assert.equal(normalized.keywords[1].belowThreshold, true);
  assert.equal(normalized.nextPageToken, "next");
  assert.throws(() => normalizeSearchKeywordsResponse("nope"), /Malformed search-keywords/);
});

test("normalizeReviewsResponse identifies owner reply state", () => {
  const normalized = normalizeReviewsResponse({
    averageRating: 4.5,
    totalReviewCount: 2,
    reviews: [
      {
        name: "accounts/1/locations/2/reviews/r1",
        reviewId: "r1",
        starRating: "FIVE",
        comment: "Great work",
        reviewer: { displayName: "Alex" },
        reviewReply: { comment: "Thanks!", updateTime: "2026-01-02T00:00:00Z" },
      },
      {
        name: "accounts/1/locations/2/reviews/r2",
        reviewId: "r2",
        starRating: "FOUR",
        comment: "Needs a reply",
        reviewer: { displayName: "Sam" },
      },
    ],
  });

  assert.equal(normalized.reviews[0].hasOwnerReply, true);
  assert.equal(normalized.reviews[1].hasOwnerReply, false);
  assert.equal(normalized.unrepliedCount, 1);
  assert.deepEqual(normalized.unrepliedReviewIds, ["r2"]);
  assert.throws(() => normalizeReviewsResponse(undefined), /Malformed reviews/);
});

test("auditProfileCompleteness reports missing fields without mutating input", () => {
  const location = {
    name: "locations/222",
    title: "Maestros Services",
    websiteUri: "https://maestrosservices.com",
    phoneNumbers: { primaryPhone: "+12505551234" },
  };
  const before = JSON.stringify(location);
  const audit = auditProfileCompleteness(location);

  assert.equal(audit.checks.find((check) => check.id === "title").present, true);
  assert.equal(audit.checks.find((check) => check.id === "regularHours").present, false);
  assert.ok(audit.missing.includes("regularHours"));
  assert.ok(audit.completenessScore < 1);
  assert.equal(JSON.stringify(location), before);
  assert.throws(() => auditProfileCompleteness(null), /Malformed profile/);
});

test("paginateGoogleList aggregates pages and rejects malformed pages", async () => {
  const pages = [
    { items: [{ id: 1 }], nextPageToken: "p2" },
    { items: [{ id: 2 }], nextPageToken: null },
  ];
  let calls = 0;
  const result = await paginateGoogleList(async (token) => {
    const page = pages[calls];
    calls += 1;
    if (calls === 1) assert.equal(token, undefined);
    if (calls === 2) assert.equal(token, "p2");
    return page;
  });

  assert.deepEqual(result.items, [{ id: 1 }, { id: 2 }]);
  assert.equal(result.pages, 2);

  await assert.rejects(
    () => paginateGoogleList(async () => null),
    /Malformed paginated page/
  );
});

test("redactSecrets and formatGoogleApiError never echo credentials", () => {
  const secrets = ["super-secret-value", "refresh-token-xyz"];
  const dirty =
    'Bearer super-secret-value and refresh_token=refresh-token-xyz and "client_secret":"super-secret-value"';
  const clean = redactSecrets(dirty, secrets);

  assert.equal(clean.includes("super-secret-value"), false);
  assert.equal(clean.includes("refresh-token-xyz"), false);
  assert.match(clean, /Bearer \[REDACTED\]/);
  assert.match(clean, /refresh_token=\[REDACTED\]/);

  const message = formatGoogleApiError(
    401,
    "https://example.com?access_token=refresh-token-xyz",
    dirty,
    secrets
  );
  assert.equal(message.includes("super-secret-value"), false);
  assert.equal(message.includes("refresh-token-xyz"), false);
  assert.match(message, /Google Business Profile API error 401/);
});
