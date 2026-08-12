import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const envPath = path.join(rootDir, ".env.local");
const reportsDir = path.join(rootDir, "qa-reports");
const command = process.argv[2] ?? "summary";

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

const requiredEnv = [
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_OAUTH_REFRESH_TOKEN",
  "GOOGLE_GA4_PROPERTY_ID",
];

const missingEnv = requiredEnv.filter((key) => !process.env[key]);
if (missingEnv.length > 0) {
  console.error(`Missing required environment values: ${missingEnv.join(", ")}`);
  process.exit(1);
}

const siteUrl = process.env.SITE_URL ?? "https://maestrosservices.com";
const siteHost = new URL(siteUrl).host;
const searchConsoleProperty =
  process.env.GOOGLE_SEARCH_CONSOLE_PROPERTY ?? `sc-domain:${siteHost}`;

const formatDate = (date) => date.toISOString().slice(0, 10);
const shiftDays = (date, days) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};
const today = new Date();
const yesterday = shiftDays(today, -1);
const start28 = new Date(today);
start28.setDate(start28.getDate() - 28);
const start90 = new Date(today);
start90.setDate(start90.getDate() - 90);
const GSC_LAG_DAYS = 3;

const writeReport = (fileName, data) => {
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }
  const reportPath = path.join(reportsDir, fileName);
  fs.writeFileSync(reportPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return reportPath;
};

const getAccessToken = async () => {
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN,
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
    throw new Error(`Failed to refresh Google access token: ${response.status} ${text}`);
  }

  const result = await response.json();
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
    throw new Error(`Google API error ${response.status} for ${url}: ${text}`);
  }

  return response.json();
};

const mapRows = (rows = [], dimensions = [], metrics = []) =>
  rows.map((row) => {
    const mapped = {};
    dimensions.forEach((name, index) => {
      mapped[name] = row.dimensionValues?.[index]?.value ?? "";
    });
    metrics.forEach((name, index) => {
      mapped[name] = row.metricValues?.[index]?.value ?? "0";
    });
    return mapped;
  });

const runGa4Report = async (accessToken, body) => {
  const propertyId = process.env.GOOGLE_GA4_PROPERTY_ID;
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;
  const result = await googleApi(url, accessToken, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return mapRows(
    result.rows,
    (body.dimensions ?? []).map((entry) => entry.name),
    (body.metrics ?? []).map((entry) => entry.name)
  );
};

const runSearchConsoleQuery = async (accessToken, body) => {
  const property = encodeURIComponent(searchConsoleProperty);
  const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${property}/searchAnalytics/query`;
  const result = await googleApi(url, accessToken, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return (result.rows ?? []).map((row) => ({
    keys: row.keys ?? [],
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
    ctr: row.ctr ?? 0,
    position: row.position ?? 0,
  }));
};

const leadEventFilter = {
  filter: {
    fieldName: "eventName",
    inListFilter: {
      values: ["generate_lead", "phone_click", "sms_click", "quote_form_start"],
    },
  },
};

const fetchLeadEventsForRange = async (accessToken, startDate, endDate) =>
  runGa4Report(accessToken, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: "eventName" }],
    metrics: [{ name: "eventCount" }],
    dimensionFilter: leadEventFilter,
    orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
    limit: 10,
  });

const buildGa4Summary = async (accessToken) => {
  const dateRanges = [{ startDate: formatDate(start28), endDate: formatDate(today) }];

  const trafficBySource = await runGa4Report(accessToken, {
    dateRanges,
    dimensions: [{ name: "sessionSourceMedium" }],
    metrics: [{ name: "sessions" }, { name: "totalUsers" }],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 10,
  });

  const landingPages = await runGa4Report(accessToken, {
    dateRanges,
    dimensions: [{ name: "landingPagePlusQueryString" }],
    metrics: [{ name: "sessions" }, { name: "totalUsers" }],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 10,
  });

  const eventCounts = await runGa4Report(accessToken, {
    dateRanges,
    dimensions: [{ name: "eventName" }],
    metrics: [{ name: "eventCount" }],
    orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
    limit: 15,
  });

  const leadEvents = await runGa4Report(accessToken, {
    dateRanges,
    dimensions: [{ name: "eventName" }],
    metrics: [{ name: "eventCount" }],
    dimensionFilter: leadEventFilter,
    orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
    limit: 10,
  });

  // Additive comparable windows ending yesterday (complete days only).
  const recent7 = {
    startDate: formatDate(shiftDays(yesterday, -6)),
    endDate: formatDate(yesterday),
  };
  const prior7 = {
    startDate: formatDate(shiftDays(yesterday, -13)),
    endDate: formatDate(shiftDays(yesterday, -7)),
  };
  const days28Complete = {
    startDate: formatDate(shiftDays(yesterday, -27)),
    endDate: formatDate(yesterday),
  };
  const recent7Leads = await fetchLeadEventsForRange(
    accessToken,
    recent7.startDate,
    recent7.endDate
  );
  const prior7Leads = await fetchLeadEventsForRange(
    accessToken,
    prior7.startDate,
    prior7.endDate
  );
  const days28Leads = await fetchLeadEventsForRange(
    accessToken,
    days28Complete.startDate,
    days28Complete.endDate
  );

  return {
    dateRange: dateRanges[0],
    trafficBySource,
    landingPages,
    eventCounts,
    leadEvents,
    leadEventsByWindow: {
      windows: { recent7, prior7, days28: days28Complete },
      recent7: recent7Leads,
      prior7: prior7Leads,
      days28: days28Leads,
    },
  };
};

const buildSearchConsoleSummary = async (accessToken) => {
  const startDate = formatDate(start28);
  const endDate = formatDate(today);

  const topQueries = await runSearchConsoleQuery(accessToken, {
    startDate,
    endDate,
    dimensions: ["query"],
    rowLimit: 15,
    startRow: 0,
  });

  const topPages = await runSearchConsoleQuery(accessToken, {
    startDate,
    endDate,
    dimensions: ["page"],
    rowLimit: 15,
    startRow: 0,
  });

  const topQueries90d = await runSearchConsoleQuery(accessToken, {
    startDate: formatDate(start90),
    endDate,
    dimensions: ["query"],
    rowLimit: 15,
    startRow: 0,
  });

  // Additive lag-safe comparable windows (avoid treating partial fresh days as declines).
  const gscEnd = shiftDays(today, -GSC_LAG_DAYS);
  const recent28 = {
    startDate: formatDate(shiftDays(gscEnd, -27)),
    endDate: formatDate(gscEnd),
  };
  const prior28 = {
    startDate: formatDate(shiftDays(gscEnd, -55)),
    endDate: formatDate(shiftDays(gscEnd, -28)),
  };
  const recentQueries = await runSearchConsoleQuery(accessToken, {
    ...recent28,
    dimensions: ["query"],
    rowLimit: 25,
    startRow: 0,
  });
  const recentPages = await runSearchConsoleQuery(accessToken, {
    ...recent28,
    dimensions: ["page"],
    rowLimit: 25,
    startRow: 0,
  });
  const priorQueries = await runSearchConsoleQuery(accessToken, {
    ...prior28,
    dimensions: ["query"],
    rowLimit: 25,
    startRow: 0,
  });
  const priorPages = await runSearchConsoleQuery(accessToken, {
    ...prior28,
    dimensions: ["page"],
    rowLimit: 25,
    startRow: 0,
  });

  return {
    property: searchConsoleProperty,
    dateRange: { startDate, endDate },
    topQueries,
    topPages,
    topQueries90d,
    comparison: {
      lagDays: GSC_LAG_DAYS,
      recent28: { dateRange: recent28, topQueries: recentQueries, topPages: recentPages },
      prior28: { dateRange: prior28, topQueries: priorQueries, topPages: priorPages },
    },
  };
};

const summarizeToConsole = (summary) => {
  console.log("Google reporting summary");
  console.log(`GA4 property: ${process.env.GOOGLE_GA4_PROPERTY_ID}`);
  console.log(`Search Console property: ${searchConsoleProperty}`);
  console.log("");
  console.log("Top lead events (last 28 days):");
  for (const row of summary.ga4.leadEvents) {
    console.log(`- ${row.eventName}: ${row.eventCount}`);
  }
  console.log("");
  console.log("Top traffic sources (last 28 days):");
  for (const row of summary.ga4.trafficBySource.slice(0, 5)) {
    console.log(`- ${row.sessionSourceMedium}: ${row.sessions} sessions`);
  }
  console.log("");
  console.log("Top Search Console queries (last 28 days):");
  for (const row of summary.searchConsole.topQueries.slice(0, 5)) {
    console.log(
      `- ${row.keys[0]}: ${row.clicks} clicks, ${row.impressions} impressions, ${(row.ctr * 100).toFixed(1)}% CTR`
    );
  }
};

const main = async () => {
  const accessToken = await getAccessToken();

  if (command === "ga4") {
    const ga4 = await buildGa4Summary(accessToken);
    const reportPath = writeReport("ga4-summary.json", ga4);
    console.log(`Wrote GA4 report to ${reportPath}`);
    console.log(JSON.stringify(ga4, null, 2));
    return;
  }

  if (command === "gsc") {
    const searchConsole = await buildSearchConsoleSummary(accessToken);
    const reportPath = writeReport("search-console-summary.json", searchConsole);
    console.log(`Wrote Search Console report to ${reportPath}`);
    console.log(JSON.stringify(searchConsole, null, 2));
    return;
  }

  const ga4 = await buildGa4Summary(accessToken);
  const searchConsole = await buildSearchConsoleSummary(accessToken);
  const summary = {
    generatedAt: new Date().toISOString(),
    ga4,
    searchConsole,
  };
  const reportPath = writeReport("google-reporting-summary.json", summary);
  summarizeToConsole(summary);
  console.log("");
  console.log(`Full report written to ${reportPath}`);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
