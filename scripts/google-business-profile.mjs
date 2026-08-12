import fs from "node:fs";
import path from "node:path";

import {
  DEFAULT_DAILY_METRICS,
  auditProfileCompleteness,
  buildAuthInfoReport,
  buildMultiDailyMetricsUrl,
  buildProfileGetUrl,
  buildReviewsListUrl,
  buildSearchKeywordsUrl,
  collectSecretValues,
  defaultDailyRange,
  defaultMonthlyRange,
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
} from "./lib/gbp.mjs";

const rootDir = process.cwd();
const envPath = path.join(rootDir, ".env.local");
const reportsDir = path.join(rootDir, "qa-reports");
const command = process.argv[2] ?? "accounts";

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || /^\s*#/.test(line)) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const rawValue = line.slice(index + 1).trim();
    const value = rawValue.replace(/^['"]|['"]$/g, "");
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
};

loadEnvFile(envPath);

const oauthConfig = resolveGbpOAuthConfig(process.env);
const secretValues = collectSecretValues(oauthConfig);
const missingEnv = listMissingGbpOauthLabels(oauthConfig);

const accountName = oauthConfig.accountName;
const locationName = oauthConfig.locationName;

const writeReport = (fileName, data) => {
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }
  const reportPath = path.join(reportsDir, fileName);
  fs.writeFileSync(reportPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return reportPath;
};

const safeErrorMessage = (error) => {
  const message = error instanceof Error ? error.message : String(error);
  return redactSecrets(message, secretValues);
};

const getAccessToken = async () => {
  const body = new URLSearchParams({
    client_id: oauthConfig.clientId,
    client_secret: oauthConfig.clientSecret,
    refresh_token: oauthConfig.refreshToken,
    grant_type: "refresh_token",
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      redactSecrets(
        `Failed to refresh Google Business Profile access token: ${response.status} ${text}`,
        secretValues
      )
    );
  }

  const result = await response.json();
  if (!result?.access_token) {
    throw new Error("Failed to refresh Google Business Profile access token: missing access_token.");
  }
  return result.access_token;
};

const googleApi = async (url, accessToken, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(formatGoogleApiError(response.status, url, text, [...secretValues, accessToken]));
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
};

const listAccounts = async (accessToken) =>
  googleApi("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", accessToken);

const listLocations = async (accessToken, parentAccountName) => {
  const baseUrl = `https://mybusinessbusinessinformation.googleapis.com/v1/${parentAccountName}/locations`;
  const params = new URLSearchParams({
    readMask: "name,title,storefrontAddress,metadata",
    pageSize: "100",
  });
  return googleApi(`${baseUrl}?${params.toString()}`, accessToken);
};

const toLocalPostParent = (targetLocationName) =>
  toAccountLocationParent(targetLocationName, accountName);

const createLocalPost = async (accessToken, { locationName: targetLocationName, summary, ctaUrl, mediaUrl }) => {
  const parent = toLocalPostParent(targetLocationName);
  const payload = {
    languageCode: "en-US",
    summary,
    callToAction: {
      actionType: "LEARN_MORE",
      url: ctaUrl,
    },
    topicType: "STANDARD",
  };

  if (mediaUrl) {
    payload.media = [
      {
        mediaFormat: "PHOTO",
        sourceUrl: mediaUrl,
      },
    ];
  }

  return googleApi(
    `https://mybusiness.googleapis.com/v4/${parent}/localPosts`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
};

const listLocalPosts = async (accessToken, targetLocationName) => {
  const parent = toLocalPostParent(targetLocationName);
  return googleApi(
    `https://mybusiness.googleapis.com/v4/${parent}/localPosts?pageSize=20`,
    accessToken
  );
};

const requireLocationName = () => {
  if (!locationName) {
    throw new Error("Set GOOGLE_GBP_LOCATION_NAME in .env.local before running this command.");
  }
  return locationName;
};

const requireAccountName = () => {
  if (!accountName) {
    throw new Error("Set GOOGLE_GBP_ACCOUNT_NAME in .env.local before running this command.");
  }
  return accountName;
};

const fetchPerformance = async (accessToken, targetLocationName) => {
  const range = defaultDailyRange();
  const url = buildMultiDailyMetricsUrl(targetLocationName, {
    ...range,
    dailyMetrics: DEFAULT_DAILY_METRICS,
  });
  const raw = await googleApi(url, accessToken);
  const normalized = normalizeDailyMetricsResponse(raw);
  return {
    generatedAt: new Date().toISOString(),
    location: toLocationResourceName(targetLocationName),
    dateRange: range,
    dailyMetrics: DEFAULT_DAILY_METRICS,
    ...normalized,
    auth: describeGbpAuthSources(oauthConfig),
  };
};

const fetchSearchKeywords = async (accessToken, targetLocationName) => {
  const monthlyRange = defaultMonthlyRange();
  const { items, pages } = await paginateGoogleList(async (pageToken) => {
    const url = buildSearchKeywordsUrl(targetLocationName, {
      ...monthlyRange,
      pageToken,
    });
    const raw = await googleApi(url, accessToken);
    const normalized = normalizeSearchKeywordsResponse(raw);
    return {
      items: normalized.keywords,
      nextPageToken: normalized.nextPageToken,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    location: toLocationResourceName(targetLocationName),
    monthlyRange,
    pages,
    keywords: items,
    keywordCount: items.length,
    auth: describeGbpAuthSources(oauthConfig),
  };
};

const fetchReviews = async (accessToken, targetLocationName, parentAccountName) => {
  let averageRating = null;
  let totalReviewCount = null;

  const { items, pages } = await paginateGoogleList(async (pageToken) => {
    const url = buildReviewsListUrl(targetLocationName, parentAccountName, { pageToken });
    const raw = await googleApi(url, accessToken);
    const normalized = normalizeReviewsResponse(raw);
    if (averageRating === null && normalized.averageRating !== null) {
      averageRating = normalized.averageRating;
    }
    if (totalReviewCount === null && normalized.totalReviewCount !== null) {
      totalReviewCount = normalized.totalReviewCount;
    }
    return {
      items: normalized.reviews,
      nextPageToken: normalized.nextPageToken,
    };
  });

  const unreplied = items.filter((review) => !review.hasOwnerReply);

  return {
    generatedAt: new Date().toISOString(),
    location: toAccountLocationParent(targetLocationName, parentAccountName),
    pages,
    averageRating,
    totalReviewCount: totalReviewCount ?? items.length,
    reviews: items,
    unrepliedCount: unreplied.length,
    unrepliedReviewIds: unreplied.map((review) => review.reviewId).filter(Boolean),
    auth: describeGbpAuthSources(oauthConfig),
  };
};

const fetchProfileAudit = async (accessToken, targetLocationName) => {
  const url = buildProfileGetUrl(targetLocationName);
  const raw = await googleApi(url, accessToken);
  const audit = auditProfileCompleteness(raw);

  return {
    generatedAt: new Date().toISOString(),
    location: toLocationResourceName(targetLocationName),
    mutation: false,
    readOnly: true,
    audit,
    auth: describeGbpAuthSources(oauthConfig),
  };
};

const main = async () => {
  // Local diagnostic only: never refresh tokens or call Google.
  if (command === "auth-info") {
    console.log(JSON.stringify(buildAuthInfoReport(oauthConfig), null, 2));
    return;
  }

  if (missingEnv.length > 0) {
    console.error(`Missing Google Business Profile environment values: ${missingEnv.join(", ")}`);
    process.exit(1);
  }

  const accessToken = await getAccessToken();

  if (command === "accounts") {
    const result = await listAccounts(accessToken);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "locations") {
    requireAccountName();
    const result = await listLocations(accessToken, accountName);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "create-post") {
    requireLocationName();

    const summary = process.argv[3];
    const ctaUrl = process.argv[4];
    const mediaUrl = process.argv[5] ?? "";

    if (!summary || !ctaUrl) {
      throw new Error(
        "Usage: npm run gbp:create-post -- \"Summary text\" \"https://example.com\" \"https://example.com/image.png\""
      );
    }

    const result = await createLocalPost(accessToken, {
      locationName,
      summary,
      ctaUrl,
      mediaUrl,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "list-posts") {
    requireLocationName();
    const result = await listLocalPosts(accessToken, locationName);
    const report = {
      generatedAt: new Date().toISOString(),
      location: toLocationResourceName(locationName),
      localPosts: result?.localPosts ?? [],
      auth: describeGbpAuthSources(oauthConfig),
    };
    const reportPath = writeReport("gbp-list-posts.json", report);
    console.log(`Wrote GBP list-posts report to ${reportPath}`);
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (command === "performance") {
    requireLocationName();
    const report = await fetchPerformance(accessToken, locationName);
    const reportPath = writeReport("gbp-performance.json", report);
    console.log(`Wrote GBP performance report to ${reportPath}`);
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (command === "search-keywords") {
    requireLocationName();
    const report = await fetchSearchKeywords(accessToken, locationName);
    const reportPath = writeReport("gbp-search-keywords.json", report);
    console.log(`Wrote GBP search-keywords report to ${reportPath}`);
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (command === "reviews") {
    requireLocationName();
    requireAccountName();
    const report = await fetchReviews(accessToken, locationName, accountName);
    const reportPath = writeReport("gbp-reviews.json", report);
    console.log(`Wrote GBP reviews report to ${reportPath}`);
    console.log(
      JSON.stringify(
        {
          generatedAt: report.generatedAt,
          location: report.location,
          averageRating: report.averageRating,
          totalReviewCount: report.totalReviewCount,
          unrepliedCount: report.unrepliedCount,
          unrepliedReviewIds: report.unrepliedReviewIds,
          reviews: report.reviews.map((review) => ({
            reviewId: review.reviewId,
            starRating: review.starRating,
            createTime: review.createTime,
            hasOwnerReply: review.hasOwnerReply,
            commentPreview: (review.comment ?? "").slice(0, 120),
          })),
        },
        null,
        2
      )
    );
    return;
  }

  if (command === "profile-audit") {
    requireLocationName();
    const report = await fetchProfileAudit(accessToken, locationName);
    const reportPath = writeReport("gbp-profile-audit.json", report);
    console.log(`Wrote GBP profile-audit report to ${reportPath}`);
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  throw new Error(`Unknown Google Business Profile command: ${command}`);
};

main().catch((error) => {
  console.error(safeErrorMessage(error));
  process.exit(1);
});
