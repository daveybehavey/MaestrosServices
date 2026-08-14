import assert from "node:assert/strict";
import test from "node:test";

import {
  BUSINESS_MANAGE_SCOPE,
  PROFILE_AUDIT_READ_MASK,
  auditProfileCompleteness,
  buildAuthInfoReport,
  buildMultiDailyMetricsUrl,
  buildProfileGetUrl,
  buildReviewsListUrl,
  buildSearchKeywordsUrl,
  classifyLocationPresenceModel,
  countInclusiveUtcDays,
  defaultDailyRange,
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
  const described = describeGbpAuthSources(config);
  assert.equal(described.usingGbpSpecificClient, true);
  assert.equal(described.usingGbpSpecificRefreshToken, true);
  assert.equal(described.usingAnyGbpSpecificCredential, true);
  assert.equal(described.requiredScope, BUSINESS_MANAGE_SCOPE);
});

test("resolveGbpOAuthConfig falls back to shared GOOGLE_OAUTH_* when GBP vars are absent", () => {
  const config = resolveGbpOAuthConfig({
    GOOGLE_OAUTH_CLIENT_ID: "shared-client",
    GOOGLE_OAUTH_CLIENT_SECRET: "shared-secret",
    GOOGLE_OAUTH_REFRESH_TOKEN: "shared-refresh",
  });

  assert.equal(config.clientId, "shared-client");
  assert.equal(config.sources.clientId, "GOOGLE_OAUTH_CLIENT_ID");
  assert.deepEqual(listMissingGbpOauthLabels(config), []);
  const described = describeGbpAuthSources(config);
  assert.equal(described.usingGbpSpecificClient, false);
  assert.equal(described.usingGbpSpecificRefreshToken, false);
  assert.equal(described.usingAnyGbpSpecificCredential, false);
});

test("resolveGbpOAuthConfig treats empty GBP client ID as unset and uses shared", () => {
  const config = resolveGbpOAuthConfig({
    GOOGLE_GBP_OAUTH_CLIENT_ID: "",
    GOOGLE_OAUTH_CLIENT_ID: "shared-client",
    GOOGLE_OAUTH_CLIENT_SECRET: "shared-secret",
    GOOGLE_OAUTH_REFRESH_TOKEN: "shared-refresh",
  });
  assert.equal(config.clientId, "shared-client");
  assert.equal(config.sources.clientId, "GOOGLE_OAUTH_CLIENT_ID");
});

test("resolveGbpOAuthConfig treats empty GBP client secret as unset and uses shared", () => {
  const config = resolveGbpOAuthConfig({
    GOOGLE_GBP_OAUTH_CLIENT_SECRET: "",
    GOOGLE_OAUTH_CLIENT_ID: "shared-client",
    GOOGLE_OAUTH_CLIENT_SECRET: "shared-secret",
    GOOGLE_OAUTH_REFRESH_TOKEN: "shared-refresh",
  });
  assert.equal(config.clientSecret, "shared-secret");
  assert.equal(config.sources.clientSecret, "GOOGLE_OAUTH_CLIENT_SECRET");
});

test("resolveGbpOAuthConfig still prefers non-empty GBP-specific client credentials", () => {
  const config = resolveGbpOAuthConfig({
    GOOGLE_GBP_OAUTH_CLIENT_ID: "gbp-client",
    GOOGLE_GBP_OAUTH_CLIENT_SECRET: "gbp-secret",
    GOOGLE_OAUTH_CLIENT_ID: "shared-client",
    GOOGLE_OAUTH_CLIENT_SECRET: "shared-secret",
    GOOGLE_GBP_OAUTH_REFRESH_TOKEN: "gbp-refresh",
  });
  assert.equal(config.clientId, "gbp-client");
  assert.equal(config.clientSecret, "gbp-secret");
  assert.equal(config.sources.clientId, "GOOGLE_GBP_OAUTH_CLIENT_ID");
  assert.equal(config.sources.clientSecret, "GOOGLE_GBP_OAUTH_CLIENT_SECRET");
});

test("resolveGbpOAuthConfig prefers dedicated GBP refresh token when non-empty", () => {
  const config = resolveGbpOAuthConfig({
    GOOGLE_OAUTH_CLIENT_ID: "shared-client",
    GOOGLE_OAUTH_CLIENT_SECRET: "shared-secret",
    GOOGLE_GBP_OAUTH_REFRESH_TOKEN: "gbp-refresh",
    GOOGLE_OAUTH_REFRESH_TOKEN: "shared-refresh",
  });
  assert.equal(config.refreshToken, "gbp-refresh");
  assert.equal(config.sources.refreshToken, "GOOGLE_GBP_OAUTH_REFRESH_TOKEN");
});

test("resolveGbpOAuthConfig treats empty GBP refresh as unset and uses shared", () => {
  const config = resolveGbpOAuthConfig({
    GOOGLE_OAUTH_CLIENT_ID: "shared-client",
    GOOGLE_OAUTH_CLIENT_SECRET: "shared-secret",
    GOOGLE_GBP_OAUTH_REFRESH_TOKEN: "",
    GOOGLE_OAUTH_REFRESH_TOKEN: "shared-refresh",
  });
  assert.equal(config.refreshToken, "shared-refresh");
  assert.equal(config.sources.refreshToken, "GOOGLE_OAUTH_REFRESH_TOKEN");
});

test("Actions-shaped empty optional GBP client vars still resolve shared credentials", () => {
  const config = resolveGbpOAuthConfig({
    GOOGLE_OAUTH_CLIENT_ID: "shared-client",
    GOOGLE_OAUTH_CLIENT_SECRET: "shared-secret",
    GOOGLE_OAUTH_REFRESH_TOKEN: "shared-refresh",
    GOOGLE_GBP_OAUTH_REFRESH_TOKEN: "gbp-refresh",
    GOOGLE_GBP_OAUTH_CLIENT_ID: "",
    GOOGLE_GBP_OAUTH_CLIENT_SECRET: "",
    GOOGLE_GBP_ACCOUNT_NAME: "accounts/1",
    GOOGLE_GBP_LOCATION_NAME: "locations/2",
    SITE_URL: "",
    GOOGLE_SEARCH_CONSOLE_PROPERTY: "",
  });
  assert.equal(config.clientId, "shared-client");
  assert.equal(config.clientSecret, "shared-secret");
  assert.equal(config.refreshToken, "gbp-refresh");
  assert.equal(config.sources.clientId, "GOOGLE_OAUTH_CLIENT_ID");
  assert.equal(config.sources.clientSecret, "GOOGLE_OAUTH_CLIENT_SECRET");
  assert.equal(config.sources.refreshToken, "GOOGLE_GBP_OAUTH_REFRESH_TOKEN");
  assert.deepEqual(listMissingGbpOauthLabels(config), []);
});

test("describeGbpAuthSources distinguishes mixed shared-client + GBP refresh token", () => {
  const config = resolveGbpOAuthConfig({
    GOOGLE_OAUTH_CLIENT_ID: "shared-client",
    GOOGLE_OAUTH_CLIENT_SECRET: "shared-secret",
    GOOGLE_GBP_OAUTH_REFRESH_TOKEN: "gbp-refresh-only",
    GOOGLE_OAUTH_REFRESH_TOKEN: "shared-refresh",
  });

  const described = describeGbpAuthSources(config);
  assert.equal(described.clientIdSource, "GOOGLE_OAUTH_CLIENT_ID");
  assert.equal(described.clientSecretSource, "GOOGLE_OAUTH_CLIENT_SECRET");
  assert.equal(described.refreshTokenSource, "GOOGLE_GBP_OAUTH_REFRESH_TOKEN");
  assert.equal(described.usingGbpSpecificClient, false);
  assert.equal(described.usingGbpSpecificRefreshToken, true);
  assert.equal(described.usingAnyGbpSpecificCredential, true);
});

test("buildAuthInfoReport stays local and never embeds secret values", () => {
  const config = resolveGbpOAuthConfig({
    GOOGLE_OAUTH_CLIENT_ID: "shared-client-id-value",
    GOOGLE_OAUTH_CLIENT_SECRET: "shared-client-secret-value",
    GOOGLE_GBP_OAUTH_REFRESH_TOKEN: "gbp-refresh-token-value",
  });
  const report = buildAuthInfoReport(config);
  const serialized = JSON.stringify(report);

  assert.equal(report.contactsGoogle, false);
  assert.equal(report.mode, "local-config-only");
  assert.equal(report.auth.usingGbpSpecificClient, false);
  assert.equal(report.auth.usingGbpSpecificRefreshToken, true);
  assert.equal(report.oauthValuesConfigured.clientId, true);
  assert.equal(report.oauthValuesConfigured.refreshToken, true);
  assert.equal(serialized.includes("shared-client-id-value"), false);
  assert.equal(serialized.includes("shared-client-secret-value"), false);
  assert.equal(serialized.includes("gbp-refresh-token-value"), false);
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

test("defaultDailyRange uses exactly 28 inclusive completed UTC days ending yesterday", () => {
  const now = new Date(Date.UTC(2026, 7, 10, 15, 30, 0)); // 2026-08-10
  const range = defaultDailyRange(now);
  assert.deepEqual(range, {
    startDate: "2026-07-13",
    endDate: "2026-08-09",
  });
  assert.equal(countInclusiveUtcDays(range.startDate, range.endDate), 28);

  const januaryNow = new Date(Date.UTC(2026, 0, 5, 12, 0, 0)); // 2026-01-05
  const januaryRange = defaultDailyRange(januaryNow);
  assert.deepEqual(januaryRange, {
    startDate: "2025-12-08",
    endDate: "2026-01-04",
  });
  assert.equal(countInclusiveUtcDays(januaryRange.startDate, januaryRange.endDate), 28);
});

test("auditProfileCompleteness is service-area aware and does not invent certainty", () => {
  const serviceAreaOnly = {
    name: "locations/sa",
    title: "Maestros Services",
    websiteUri: "https://maestrosservices.com",
    phoneNumbers: { primaryPhone: "+12505551234" },
    serviceArea: { businessType: "CUSTOMER_LOCATION_ONLY" },
    categories: { primaryCategory: { name: "gcid:landscaper" } },
    regularHours: { periods: [{ openDay: "MONDAY" }] },
    profile: { description: "Residential landscaping" },
    latlng: { latitude: 48.4, longitude: -123.5 },
    openInfo: { status: "OPEN" },
    serviceItems: [{ freeFormServiceItem: { label: { displayName: "Lawn care" } } }],
  };
  const serviceAudit = auditProfileCompleteness(serviceAreaOnly);
  assert.equal(classifyLocationPresenceModel(serviceAreaOnly), "service_area_only");
  assert.equal(serviceAudit.presenceModel, "service_area_only");
  assert.equal(serviceAudit.checks.find((c) => c.id === "storefrontAddress").status, "not_applicable");
  assert.equal(serviceAudit.missing.includes("storefrontAddress"), false);
  assert.equal(serviceAudit.scoreKind, "internal_audit_heuristic");
  assert.equal(serviceAudit.internalAuditHeuristicScore, 1);

  const storefront = {
    name: "locations/sf",
    title: "Shop",
    storefrontAddress: { addressLines: ["123 Main St"] },
    websiteUri: "https://example.com",
    phoneNumbers: { primaryPhone: "+12505550000" },
  };
  const storefrontAudit = auditProfileCompleteness(storefront);
  assert.equal(storefrontAudit.presenceModel, "storefront");
  assert.equal(storefrontAudit.checks.find((c) => c.id === "serviceArea").status, "not_applicable");
  assert.equal(storefrontAudit.checks.find((c) => c.id === "storefrontAddress").status, "pass");

  const hybrid = {
    name: "locations/hy",
    title: "Hybrid",
    storefrontAddress: { addressLines: ["123 Main St"] },
    serviceArea: { businessType: "CUSTOMER_AND_BUSINESS_LOCATION" },
  };
  const hybridAudit = auditProfileCompleteness(hybrid);
  assert.equal(hybridAudit.presenceModel, "hybrid");
  assert.equal(hybridAudit.checks.find((c) => c.id === "storefrontAddress").status, "pass");
  assert.equal(hybridAudit.checks.find((c) => c.id === "serviceArea").status, "pass");

  const ambiguous = {
    name: "locations/unk",
    title: "Ambiguous",
    serviceArea: { places: { placeInfos: [{ placeName: "Victoria" }] } },
  };
  const before = JSON.stringify(ambiguous);
  const unknownAudit = auditProfileCompleteness(ambiguous);
  assert.equal(unknownAudit.presenceModel, "unknown");
  assert.equal(unknownAudit.checks.find((c) => c.id === "storefrontAddress").status, "unknown");
  assert.equal(unknownAudit.checks.find((c) => c.id === "serviceArea").status, "unknown");
  assert.equal(unknownAudit.missing.includes("storefrontAddress"), false);
  assert.equal(unknownAudit.missing.includes("serviceArea"), false);
  assert.equal(JSON.stringify(ambiguous), before);
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
