import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const envPath = path.join(rootDir, ".env.local");
const command = process.argv[2] ?? "smoke";

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

const oauthClientId =
  process.env.GOOGLE_ADS_OAUTH_CLIENT_ID ?? process.env.GOOGLE_OAUTH_CLIENT_ID;
const oauthClientSecret =
  process.env.GOOGLE_ADS_OAUTH_CLIENT_SECRET ?? process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const oauthRefreshToken =
  process.env.GOOGLE_ADS_OAUTH_REFRESH_TOKEN ?? process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID?.replace(/-/g, "");
const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/-/g, "");

const requiredEnv = [
  ["oauth client ID", oauthClientId],
  ["oauth client secret", oauthClientSecret],
  ["oauth refresh token", oauthRefreshToken],
  ["developer token", developerToken],
];

const missingEnv = requiredEnv.filter(([, value]) => !value).map(([label]) => label);
if (missingEnv.length > 0) {
  console.error(`Missing Google Ads environment values: ${missingEnv.join(", ")}`);
  process.exit(1);
}

const getAccessToken = async () => {
  const body = new URLSearchParams({
    client_id: oauthClientId,
    client_secret: oauthClientSecret,
    refresh_token: oauthRefreshToken,
    grant_type: "refresh_token",
  });

  const response = await fetch("https://www.googleapis.com/oauth2/v3/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to refresh Google Ads access token: ${response.status} ${text}`);
  }

  const result = await response.json();
  return result.access_token;
};

const googleAdsApi = async (endpoint, accessToken, options = {}) => {
  const response = await fetch(`https://googleads.googleapis.com/${endpoint}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": developerToken,
      ...(loginCustomerId ? { "login-customer-id": loginCustomerId } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers ?? {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Ads API error ${response.status} for ${endpoint}: ${text}`);
  }

  return response.json();
};

const listAccessibleCustomers = async (accessToken) => {
  const result = await googleAdsApi("v22/customers:listAccessibleCustomers", accessToken, {
    method: "GET",
  });
  return result.resourceNames ?? [];
};

const runSearch = async (accessToken, query) => {
  if (!customerId) {
    throw new Error("GOOGLE_ADS_CUSTOMER_ID is required for search queries.");
  }

  const result = await googleAdsApi(`v22/customers/${customerId}/googleAds:search`, accessToken, {
    method: "POST",
    body: { query },
  });

  return result.results ?? [];
};

const formatCustomerResource = (resourceName) => resourceName.split("/").pop() ?? resourceName;

const main = async () => {
  const accessToken = await getAccessToken();

  if (command === "customers") {
    const customers = await listAccessibleCustomers(accessToken);
    console.log("Accessible Google Ads customers:");
    for (const resourceName of customers) {
      console.log(`- ${formatCustomerResource(resourceName)}`);
    }
    return;
  }

  if (command === "campaigns") {
    const rows = await runSearch(
      accessToken,
      [
        "SELECT",
        "  campaign.id,",
        "  campaign.name,",
        "  campaign.status,",
        "  campaign.advertising_channel_type",
        "FROM campaign",
        "ORDER BY campaign.id DESC",
        "LIMIT 20",
      ].join("\n")
    );

    console.log(`Campaigns for customer ${customerId}:`);
    for (const row of rows) {
      console.log(
        `- ${row.campaign?.id}: ${row.campaign?.name} [${row.campaign?.status}] (${row.campaign?.advertisingChannelType})`
      );
    }
    return;
  }

  const customers = await listAccessibleCustomers(accessToken);
  console.log("Google Ads API smoke check");
  console.log(`Accessible customers: ${customers.length}`);
  for (const resourceName of customers.slice(0, 10)) {
    console.log(`- ${formatCustomerResource(resourceName)}`);
  }

  if (!customerId) {
    console.log("");
    console.log(
      "Set GOOGLE_ADS_CUSTOMER_ID in .env.local to run campaign-level checks against a specific account."
    );
    return;
  }

  const rows = await runSearch(
    accessToken,
    [
      "SELECT",
      "  customer.id,",
      "  customer.descriptive_name,",
      "  customer.currency_code,",
      "  customer.time_zone",
      "FROM customer",
      "LIMIT 1",
    ].join("\n")
  );

  const account = rows[0]?.customer;
  console.log("");
  console.log(`Target customer: ${account?.descriptiveName ?? "Unknown"} (${account?.id ?? customerId})`);
  console.log(`Currency / time zone: ${account?.currencyCode ?? "?"} / ${account?.timeZone ?? "?"}`);
  console.log("Smoke check passed.");
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
