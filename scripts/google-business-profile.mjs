import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const envPath = path.join(rootDir, ".env.local");
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

const oauthClientId =
  process.env.GOOGLE_GBP_OAUTH_CLIENT_ID ?? process.env.GOOGLE_OAUTH_CLIENT_ID;
const oauthClientSecret =
  process.env.GOOGLE_GBP_OAUTH_CLIENT_SECRET ?? process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const oauthRefreshToken =
  process.env.GOOGLE_GBP_OAUTH_REFRESH_TOKEN ?? process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
const accountName = process.env.GOOGLE_GBP_ACCOUNT_NAME;
const locationName = process.env.GOOGLE_GBP_LOCATION_NAME;

const requiredEnv = [
  ["oauth client ID", oauthClientId],
  ["oauth client secret", oauthClientSecret],
  ["oauth refresh token", oauthRefreshToken],
];

const missingEnv = requiredEnv.filter(([, value]) => !value).map(([label]) => label);
if (missingEnv.length > 0) {
  console.error(`Missing Google Business Profile environment values: ${missingEnv.join(", ")}`);
  process.exit(1);
}

const getAccessToken = async () => {
  const body = new URLSearchParams({
    client_id: oauthClientId,
    client_secret: oauthClientSecret,
    refresh_token: oauthRefreshToken,
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
    throw new Error(`Failed to refresh Google Business Profile access token: ${response.status} ${text}`);
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
    throw new Error(`Google Business Profile API error ${response.status} for ${url}: ${text}`);
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

const toLocalPostParent = (targetLocationName) => {
  if (targetLocationName.startsWith("accounts/")) return targetLocationName;
  if (targetLocationName.startsWith("locations/") && accountName) {
    return `${accountName}/${targetLocationName}`;
  }
  return targetLocationName;
};

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

const main = async () => {
  const accessToken = await getAccessToken();

  if (command === "accounts") {
    const result = await listAccounts(accessToken);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "locations") {
    if (!accountName) {
      throw new Error("Set GOOGLE_GBP_ACCOUNT_NAME in .env.local before listing locations.");
    }
    const result = await listLocations(accessToken, accountName);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "create-post") {
    if (!locationName) {
      throw new Error("Set GOOGLE_GBP_LOCATION_NAME in .env.local before creating a post.");
    }

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
    if (!locationName) {
      throw new Error("Set GOOGLE_GBP_LOCATION_NAME in .env.local before listing posts.");
    }

    const result = await listLocalPosts(accessToken, locationName);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  throw new Error(`Unknown Google Business Profile command: ${command}`);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
