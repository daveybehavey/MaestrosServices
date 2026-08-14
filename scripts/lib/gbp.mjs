/**
 * Pure Google Business Profile helpers for URL construction,
 * resource-name handling, response normalization, and secret redaction.
 * Safe for unit tests without live credentials.
 */

import { nonEmptyEnvValue, preferEnvValue } from "./env-value.mjs";

export const BUSINESS_MANAGE_SCOPE = "https://www.googleapis.com/auth/business.manage";

export const DEFAULT_DAILY_METRICS = [
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  "BUSINESS_DIRECTION_REQUESTS",
  "CALL_CLICKS",
  "WEBSITE_CLICKS",
  "BUSINESS_CONVERSATIONS",
];

export const PROFILE_AUDIT_READ_MASK = [
  "name",
  "title",
  "storeCode",
  "languageCode",
  "phoneNumbers",
  "categories",
  "storefrontAddress",
  "websiteUri",
  "regularHours",
  "specialHours",
  "serviceArea",
  "labels",
  "latlng",
  "openInfo",
  "metadata",
  "profile",
  "serviceItems",
].join(",");

const SECRET_KEY_HINTS = [
  "client_secret",
  "clientSecret",
  "refresh_token",
  "refreshToken",
  "access_token",
  "accessToken",
  "Authorization",
  "Bearer",
];

/**
 * Resolve GBP OAuth config with GBP-specific env vars preferred over shared Google OAuth.
 * Empty strings (GitHub Actions optional secrets) are treated as unset.
 * Does not read or print secret values beyond returning them for internal use.
 */
export const resolveGbpOAuthConfig = (env = process.env) => {
  const clientId = preferEnvValue(
    env,
    "GOOGLE_GBP_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_ID"
  );
  const clientSecret = preferEnvValue(
    env,
    "GOOGLE_GBP_OAUTH_CLIENT_SECRET",
    "GOOGLE_OAUTH_CLIENT_SECRET"
  );
  const refreshToken = preferEnvValue(
    env,
    "GOOGLE_GBP_OAUTH_REFRESH_TOKEN",
    "GOOGLE_OAUTH_REFRESH_TOKEN"
  );

  return {
    clientId: clientId.value,
    clientSecret: clientSecret.value,
    refreshToken: refreshToken.value,
    accountName: nonEmptyEnvValue(env, "GOOGLE_GBP_ACCOUNT_NAME"),
    locationName: nonEmptyEnvValue(env, "GOOGLE_GBP_LOCATION_NAME"),
    sources: {
      clientId: clientId.source,
      clientSecret: clientSecret.source,
      refreshToken: refreshToken.source,
    },
  };
};

export const listMissingGbpOauthLabels = (config) => {
  const missing = [];
  if (!config.clientId) missing.push("oauth client ID");
  if (!config.clientSecret) missing.push("oauth client secret");
  if (!config.refreshToken) missing.push("oauth refresh token");
  return missing;
};

export const describeGbpAuthSources = (config) => {
  const clientIdSource = config.sources?.clientId ?? null;
  const clientSecretSource = config.sources?.clientSecret ?? null;
  const refreshTokenSource = config.sources?.refreshToken ?? null;
  const usingGbpSpecificClient =
    Boolean(clientIdSource?.startsWith("GOOGLE_GBP_")) ||
    Boolean(clientSecretSource?.startsWith("GOOGLE_GBP_"));
  const usingGbpSpecificRefreshToken = Boolean(
    refreshTokenSource?.startsWith("GOOGLE_GBP_")
  );

  return {
    clientIdSource,
    clientSecretSource,
    refreshTokenSource,
    usingGbpSpecificClient,
    usingGbpSpecificRefreshToken,
    usingAnyGbpSpecificCredential: usingGbpSpecificClient || usingGbpSpecificRefreshToken,
    requiredScope: BUSINESS_MANAGE_SCOPE,
  };
};

/**
 * Local-only auth diagnostic. Never includes secret values and never contacts Google.
 */
export const buildAuthInfoReport = (config) => {
  const auth = describeGbpAuthSources(config);
  const missingOauthLabels = listMissingGbpOauthLabels(config);
  return {
    generatedAt: new Date().toISOString(),
    mode: "local-config-only",
    contactsGoogle: false,
    auth,
    oauthValuesConfigured: {
      clientId: Boolean(config.clientId),
      clientSecret: Boolean(config.clientSecret),
      refreshToken: Boolean(config.refreshToken),
    },
    missingOauthLabels,
    hasAccountName: Boolean(config.accountName),
    hasLocationName: Boolean(config.locationName),
    accountNameSet: Boolean(config.accountName),
    locationNameSet: Boolean(config.locationName),
  };
};

/** Normalize to `locations/{locationId}` for Performance + Business Information APIs. */
export const toLocationResourceName = (locationName) => {
  if (!locationName || typeof locationName !== "string") {
    throw new Error("Location name is required (GOOGLE_GBP_LOCATION_NAME).");
  }

  const trimmed = locationName.trim();
  if (!trimmed) {
    throw new Error("Location name is required (GOOGLE_GBP_LOCATION_NAME).");
  }

  const accountsMatch = trimmed.match(/^accounts\/[^/]+\/locations\/([^/]+)$/);
  if (accountsMatch) {
    return `locations/${accountsMatch[1]}`;
  }

  if (trimmed.startsWith("locations/")) {
    const id = trimmed.slice("locations/".length);
    if (!id || id.includes("/")) {
      throw new Error(`Invalid location resource name: ${trimmed}`);
    }
    return `locations/${id}`;
  }

  if (trimmed.includes("/")) {
    throw new Error(`Invalid location resource name: ${trimmed}`);
  }

  return `locations/${trimmed}`;
};

/**
 * Normalize to `accounts/{accountId}/locations/{locationId}` for legacy v4 APIs
 * (reviews, localPosts).
 */
export const toAccountLocationParent = (locationName, accountName) => {
  if (!locationName || typeof locationName !== "string") {
    throw new Error("Location name is required (GOOGLE_GBP_LOCATION_NAME).");
  }

  const trimmed = locationName.trim();
  if (trimmed.startsWith("accounts/") && /\/locations\/[^/]+$/.test(trimmed)) {
    return trimmed;
  }

  const locationResource = toLocationResourceName(trimmed);
  if (!accountName || typeof accountName !== "string" || !accountName.trim()) {
    throw new Error(
      "Set GOOGLE_GBP_ACCOUNT_NAME (accounts/{id}) when GOOGLE_GBP_LOCATION_NAME is locations/{id}."
    );
  }

  const account = accountName.trim();
  if (!account.startsWith("accounts/")) {
    throw new Error(`Invalid account name: expected accounts/{{id}}, got ${account}`);
  }

  return `${account}/${locationResource}`;
};

export const parseIsoDateParts = (isoDate) => {
  if (typeof isoDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    throw new Error(`Expected YYYY-MM-DD date, got: ${isoDate}`);
  }
  const [year, month, day] = isoDate.split("-").map(Number);
  return { year, month, day };
};

export const formatDateParts = (parts) => {
  const year = String(parts.year).padStart(4, "0");
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const shiftUtcDate = (date, dayDelta) => {
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  next.setUTCDate(next.getUTCDate() + dayDelta);
  return next;
};

export const toIsoDateUtc = (date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate()
  ).padStart(2, "0")}`;

/**
 * Count inclusive UTC calendar dates between YYYY-MM-DD bounds.
 * Google Business Profile Performance DailyRange treats both ends as inclusive.
 */
export const countInclusiveUtcDays = (startDate, endDate) => {
  const start = parseIsoDateParts(startDate);
  const end = parseIsoDateParts(endDate);
  const startMs = Date.UTC(start.year, start.month - 1, start.day);
  const endMs = Date.UTC(end.year, end.month - 1, end.day);
  if (endMs < startMs) {
    throw new Error("endDate must be on or after startDate");
  }
  return Math.floor((endMs - startMs) / 86400000) + 1;
};

/**
 * Default performance window: exactly 28 inclusive completed UTC days.
 * endDate = yesterday UTC (avoids partial "today" data)
 * startDate = endDate - 27 days
 */
export const defaultDailyRange = (now = new Date()) => {
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = shiftUtcDate(todayUtc, -1);
  const start = shiftUtcDate(end, -27);
  return {
    startDate: toIsoDateUtc(start),
    endDate: toIsoDateUtc(end),
  };
};

export const defaultMonthlyRange = (now = new Date()) => {
  const endYear = now.getUTCFullYear();
  const endMonth = now.getUTCMonth() + 1;
  const startAnchor = new Date(Date.UTC(endYear, now.getUTCMonth() - 2, 1));
  return {
    startMonth: {
      year: startAnchor.getUTCFullYear(),
      month: startAnchor.getUTCMonth() + 1,
    },
    endMonth: { year: endYear, month: endMonth },
  };
};

export const buildMultiDailyMetricsUrl = (
  locationName,
  { startDate, endDate, dailyMetrics = DEFAULT_DAILY_METRICS } = {}
) => {
  const location = toLocationResourceName(locationName);
  if (!startDate || !endDate) {
    throw new Error("startDate and endDate are required for performance metrics.");
  }
  if (!Array.isArray(dailyMetrics) || dailyMetrics.length === 0) {
    throw new Error("At least one dailyMetrics value is required.");
  }

  const start = parseIsoDateParts(startDate);
  const end = parseIsoDateParts(endDate);
  const params = new URLSearchParams();
  for (const metric of dailyMetrics) {
    params.append("dailyMetrics", metric);
  }
  params.set("dailyRange.start_date.year", String(start.year));
  params.set("dailyRange.start_date.month", String(start.month));
  params.set("dailyRange.start_date.day", String(start.day));
  params.set("dailyRange.end_date.year", String(end.year));
  params.set("dailyRange.end_date.month", String(end.month));
  params.set("dailyRange.end_date.day", String(end.day));

  return `https://businessprofileperformance.googleapis.com/v1/${location}:fetchMultiDailyMetricsTimeSeries?${params.toString()}`;
};

export const buildSearchKeywordsUrl = (
  locationName,
  { startMonth, endMonth, pageSize = 100, pageToken } = {}
) => {
  const location = toLocationResourceName(locationName);
  if (!startMonth?.year || !startMonth?.month || !endMonth?.year || !endMonth?.month) {
    throw new Error("startMonth and endMonth with year/month are required for search keywords.");
  }

  const params = new URLSearchParams({
    "monthlyRange.start_month.year": String(startMonth.year),
    "monthlyRange.start_month.month": String(startMonth.month),
    "monthlyRange.end_month.year": String(endMonth.year),
    "monthlyRange.end_month.month": String(endMonth.month),
    pageSize: String(pageSize),
  });
  if (pageToken) {
    params.set("pageToken", pageToken);
  }

  return `https://businessprofileperformance.googleapis.com/v1/${location}/searchkeywords/impressions/monthly?${params.toString()}`;
};

export const buildReviewsListUrl = (
  locationName,
  accountName,
  { pageSize = 50, pageToken, orderBy = "updateTime desc" } = {}
) => {
  const parent = toAccountLocationParent(locationName, accountName);
  const params = new URLSearchParams({
    pageSize: String(pageSize),
    orderBy,
  });
  if (pageToken) {
    params.set("pageToken", pageToken);
  }
  return `https://mybusiness.googleapis.com/v4/${parent}/reviews?${params.toString()}`;
};

export const buildProfileGetUrl = (locationName, readMask = PROFILE_AUDIT_READ_MASK) => {
  const location = toLocationResourceName(locationName);
  const params = new URLSearchParams({ readMask });
  return `https://mybusinessbusinessinformation.googleapis.com/v1/${location}?${params.toString()}`;
};

export const normalizeDateValue = (datedValue = {}) => {
  const date = datedValue.date ?? {};
  if (!date.year || !date.month || !date.day) {
    return null;
  }
  return {
    date: formatDateParts(date),
    value: Number(datedValue.value ?? 0),
  };
};

export const normalizeDailyMetricsResponse = (raw) => {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Malformed performance response: expected an object.");
  }

  const series = [];
  const multi = Array.isArray(raw.multiDailyMetricTimeSeries)
    ? raw.multiDailyMetricTimeSeries
    : [];

  for (const multiEntry of multi) {
    const dailySeries = Array.isArray(multiEntry?.dailyMetricTimeSeries)
      ? multiEntry.dailyMetricTimeSeries
      : [];
    for (const entry of dailySeries) {
      const points = (entry?.timeSeries?.datedValues ?? [])
        .map(normalizeDateValue)
        .filter(Boolean);
      series.push({
        dailyMetric: entry?.dailyMetric ?? "UNKNOWN",
        dailySubEntityType: entry?.dailySubEntityType ?? null,
        points,
        total: points.reduce((sum, point) => sum + point.value, 0),
      });
    }
  }

  return { series };
};

export const normalizeSearchKeywordCount = (entry = {}) => {
  const insights = entry.insightsValue ?? {};
  const value =
    insights.value !== undefined && insights.value !== null
      ? Number(insights.value)
      : null;
  const threshold =
    insights.threshold !== undefined && insights.threshold !== null
      ? Number(insights.threshold)
      : null;

  return {
    searchKeyword: entry.searchKeyword ?? "",
    impressions: value,
    threshold,
    belowThreshold: value === null && threshold !== null,
  };
};

export const normalizeSearchKeywordsResponse = (raw) => {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Malformed search-keywords response: expected an object.");
  }

  const counts = Array.isArray(raw.searchKeywordsCounts) ? raw.searchKeywordsCounts : [];
  return {
    keywords: counts.map(normalizeSearchKeywordCount),
    nextPageToken: raw.nextPageToken ?? null,
  };
};

export const normalizeReview = (review = {}) => {
  const reply = review.reviewReply ?? null;
  const hasOwnerReply = Boolean(reply && (reply.comment || reply.updateTime));

  return {
    name: review.name ?? "",
    reviewId: review.reviewId ?? "",
    starRating: review.starRating ?? null,
    comment: review.comment ?? "",
    createTime: review.createTime ?? null,
    updateTime: review.updateTime ?? null,
    reviewerDisplayName: review.reviewer?.displayName ?? null,
    hasOwnerReply,
    ownerReply: hasOwnerReply
      ? {
          comment: reply.comment ?? "",
          updateTime: reply.updateTime ?? null,
        }
      : null,
  };
};

export const normalizeReviewsResponse = (raw) => {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Malformed reviews response: expected an object.");
  }

  const reviews = Array.isArray(raw.reviews) ? raw.reviews.map(normalizeReview) : [];
  const unreplied = reviews.filter((review) => !review.hasOwnerReply);

  return {
    reviews,
    averageRating: raw.averageRating ?? null,
    totalReviewCount: raw.totalReviewCount ?? reviews.length,
    nextPageToken: raw.nextPageToken ?? null,
    unrepliedCount: unreplied.length,
    unrepliedReviewIds: unreplied.map((review) => review.reviewId).filter(Boolean),
  };
};

const hasText = (value) => typeof value === "string" && value.trim().length > 0;

const hasStorefrontAddress = (location) =>
  Boolean(location?.storefrontAddress?.addressLines?.length);

const hasServiceArea = (location) => Boolean(location?.serviceArea);

/**
 * Classify presence model from Business Information evidence only.
 * Returns unknown when the API payload is insufficient to decide safely.
 */
export const classifyLocationPresenceModel = (location) => {
  const addressPresent = hasStorefrontAddress(location);
  const serviceAreaPresent = hasServiceArea(location);
  const businessType = location?.serviceArea?.businessType ?? null;

  if (businessType === "CUSTOMER_LOCATION_ONLY") {
    return "service_area_only";
  }
  if (businessType === "CUSTOMER_AND_BUSINESS_LOCATION") {
    return "hybrid";
  }
  if (addressPresent && serviceAreaPresent) {
    return "hybrid";
  }
  if (addressPresent && !serviceAreaPresent) {
    return "storefront";
  }
  return "unknown";
};

const buildCheck = ({ id, label, present, value, applicable = true, status }) => {
  let resolvedStatus = status;
  if (!resolvedStatus) {
    if (!applicable) resolvedStatus = "not_applicable";
    else resolvedStatus = present ? "pass" : "fail";
  }
  return {
    id,
    label,
    applicable,
    present,
    status: resolvedStatus,
    value,
  };
};

export const auditProfileCompleteness = (location) => {
  if (location == null || typeof location !== "object" || Array.isArray(location)) {
    throw new Error("Malformed profile response: expected a location object.");
  }

  const presenceModel = classifyLocationPresenceModel(location);
  const addressPresent = hasStorefrontAddress(location);
  const serviceAreaPresent = hasServiceArea(location);
  const businessType = location.serviceArea?.businessType ?? null;

  const addressApplicable =
    presenceModel === "storefront" || presenceModel === "hybrid";
  const serviceAreaApplicable =
    presenceModel === "service_area_only" || presenceModel === "hybrid";

  const checks = [
    buildCheck({
      id: "title",
      label: "Business title",
      present: hasText(location.title),
      value: location.title ?? null,
    }),
    buildCheck({
      id: "primaryPhone",
      label: "Primary phone",
      present: hasText(location.phoneNumbers?.primaryPhone),
      value: location.phoneNumbers?.primaryPhone ?? null,
    }),
    buildCheck({
      id: "websiteUri",
      label: "Website URI",
      present: hasText(location.websiteUri),
      value: location.websiteUri ?? null,
    }),
    buildCheck({
      id: "storefrontAddress",
      label: "Storefront address",
      applicable: addressApplicable,
      present: addressPresent,
      value: location.storefrontAddress ?? null,
      status:
        presenceModel === "unknown"
          ? "unknown"
          : presenceModel === "service_area_only"
            ? "not_applicable"
            : addressPresent
              ? "pass"
              : "fail",
    }),
    buildCheck({
      id: "serviceArea",
      label: "Service area",
      applicable: serviceAreaApplicable,
      present: serviceAreaPresent,
      value: serviceAreaPresent
        ? { present: true, businessType }
        : null,
      status:
        presenceModel === "unknown"
          ? "unknown"
          : presenceModel === "storefront"
            ? "not_applicable"
            : serviceAreaPresent
              ? "pass"
              : "fail",
    }),
    buildCheck({
      id: "primaryCategory",
      label: "Primary category",
      present:
        hasText(location.categories?.primaryCategory?.displayName) ||
        hasText(location.categories?.primaryCategory?.name),
      value: location.categories?.primaryCategory ?? null,
    }),
    buildCheck({
      id: "regularHours",
      label: "Regular hours",
      present: Boolean(location.regularHours?.periods?.length),
      value: location.regularHours ?? null,
    }),
    buildCheck({
      id: "profileDescription",
      label: "Profile description",
      present: hasText(location.profile?.description),
      value: location.profile?.description ?? null,
    }),
    buildCheck({
      id: "latlng",
      label: "Lat/lng",
      present:
        location.latlng?.latitude !== undefined && location.latlng?.longitude !== undefined,
      value: location.latlng ?? null,
    }),
    buildCheck({
      id: "openInfo",
      label: "Open info status",
      present: hasText(location.openInfo?.status),
      value: location.openInfo ?? null,
    }),
    buildCheck({
      id: "serviceItems",
      label: "Service items",
      present: Array.isArray(location.serviceItems) && location.serviceItems.length > 0,
      value: Array.isArray(location.serviceItems) ? location.serviceItems.length : 0,
    }),
  ];

  // Only score checks that are explicitly applicable. Unknown/not_applicable
  // presence fields are informational and excluded from the denominator.
  const scoredChecks = checks.filter((check) => check.applicable && check.status !== "unknown");
  const missing = scoredChecks.filter((check) => check.status === "fail").map((check) => check.id);
  const presentCount = scoredChecks.length - missing.length;
  const internalAuditHeuristicScore =
    scoredChecks.length === 0
      ? null
      : Number((presentCount / scoredChecks.length).toFixed(2));

  return {
    name: location.name ?? null,
    title: location.title ?? null,
    presenceModel,
    presenceModelNote:
      presenceModel === "unknown"
        ? "Insufficient API evidence to classify storefront vs service-area vs hybrid; address/service-area checks are informational only."
        : presenceModel === "service_area_only"
          ? "Service-area-only model: hidden/absent storefront address is not treated as incompleteness."
          : null,
    checks,
    missing,
    // Internal heuristic only — not a Google-provided completeness score.
    internalAuditHeuristicScore,
    completenessScore: internalAuditHeuristicScore,
    scoreKind: "internal_audit_heuristic",
    scoredCheckCount: scoredChecks.length,
    snapshot: {
      websiteUri: location.websiteUri ?? null,
      primaryPhone: location.phoneNumbers?.primaryPhone ?? null,
      primaryCategory: location.categories?.primaryCategory ?? null,
      storefrontAddress: location.storefrontAddress ?? null,
      hasServiceArea: serviceAreaPresent,
      serviceAreaBusinessType: businessType,
      regularHoursPeriods: location.regularHours?.periods?.length ?? 0,
      serviceItemCount: Array.isArray(location.serviceItems) ? location.serviceItems.length : 0,
      openStatus: location.openInfo?.status ?? null,
      mapsUri: location.metadata?.mapsUri ?? null,
      newReviewUri: location.metadata?.newReviewUri ?? null,
    },
  };
};

export const collectSecretValues = (config = {}) =>
  [config.clientId, config.clientSecret, config.refreshToken].filter(
    (value) => typeof value === "string" && value.length > 0
  );

export const redactSecrets = (input, secretValues = []) => {
  let text = typeof input === "string" ? input : String(input ?? "");

  for (const secret of secretValues) {
    if (!secret || secret.length < 4) continue;
    text = text.split(secret).join("[REDACTED]");
  }

  text = text.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]");
  text = text.replace(
    /("?(?:access_token|refresh_token|client_secret)"?\s*[:=]\s*")([^"]+)(")/gi,
    '$1[REDACTED]$3'
  );
  text = text.replace(
    /((?:access_token|refresh_token|client_secret)=)([^&\s]+)/gi,
    "$1[REDACTED]"
  );

  for (const hint of SECRET_KEY_HINTS) {
    if (hint === "Bearer" || hint === "Authorization") continue;
  }

  return text;
};

export const formatGoogleApiError = (status, url, bodyText, secretValues = []) => {
  const safeUrl = redactSecrets(url, secretValues);
  const safeBody = redactSecrets(bodyText ?? "", secretValues);
  return `Google Business Profile API error ${status} for ${safeUrl}: ${safeBody}`;
};

/**
 * Paginate a Google list endpoint. `fetchPage(pageToken)` must return
 * `{ items, nextPageToken }` where items is an array.
 */
export const paginateGoogleList = async (fetchPage, { maxPages = 20 } = {}) => {
  if (typeof fetchPage !== "function") {
    throw new Error("fetchPage function is required for pagination.");
  }

  const allItems = [];
  let pageToken = undefined;
  let pages = 0;

  do {
    pages += 1;
    if (pages > maxPages) {
      throw new Error(`Pagination exceeded maxPages=${maxPages}.`);
    }
    const page = await fetchPage(pageToken);
    if (page == null || typeof page !== "object" || Array.isArray(page)) {
      throw new Error("Malformed paginated page: expected an object.");
    }
    const items = Array.isArray(page.items) ? page.items : [];
    allItems.push(...items);
    pageToken = page.nextPageToken || undefined;
  } while (pageToken);

  return { items: allItems, pages };
};
