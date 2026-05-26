import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const envPath = path.join(rootDir, ".env.local");
const command = process.argv[2] ?? "smoke";
const todayStamp = new Date().toISOString().slice(0, 10);

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

const mutate = async (accessToken, operations) => {
  if (!customerId) {
    throw new Error("GOOGLE_ADS_CUSTOMER_ID is required for mutate operations.");
  }

  return googleAdsApi(`v22/customers/${customerId}/googleAds:mutate`, accessToken, {
    method: "POST",
    body: {
      mutateOperations: operations,
      partialFailure: false,
      validateOnly: false,
    },
  });
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

const firstResult = async (accessToken, query) => {
  const rows = await runSearch(accessToken, query);
  return rows[0] ?? null;
};

const createPowerWashingSearchCampaign = async (accessToken) => {
  if (!customerId) {
    throw new Error("GOOGLE_ADS_CUSTOMER_ID is required to create a campaign.");
  }

  const campaignLabel = `Search | Power Washing | Core | ${todayStamp}`;
  const existingCampaign = await firstResult(
    accessToken,
    [
      "SELECT campaign.resource_name, campaign.id, campaign.name",
      "FROM campaign",
      `WHERE campaign.name = '${campaignLabel}'`,
      "LIMIT 1",
    ].join("\n")
  );

  let budgetResourceName = null;
  let campaignResourceName = existingCampaign?.campaign?.resourceName ?? null;

  if (!campaignResourceName) {
    const budgetResult = await mutate(accessToken, [
      {
        campaignBudgetOperation: {
          create: {
            name: `${campaignLabel} | Budget`,
            amountMicros: "20000000",
            deliveryMethod: "STANDARD",
            explicitlyShared: false,
          },
        },
      },
    ]);

    budgetResourceName =
      budgetResult.mutateOperationResponses?.[0]?.campaignBudgetResult?.resourceName ?? null;
    if (!budgetResourceName) {
      throw new Error("Failed to create campaign budget.");
    }

    const campaignResult = await mutate(accessToken, [
      {
        campaignOperation: {
          create: {
            name: campaignLabel,
            status: "PAUSED",
            advertisingChannelType: "SEARCH",
            containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
            campaignBudget: budgetResourceName,
            manualCpc: {},
            networkSettings: {
              targetGoogleSearch: true,
              targetSearchNetwork: false,
              targetContentNetwork: false,
              targetPartnerSearchNetwork: false,
            },
            geoTargetTypeSetting: {
              positiveGeoTargetType: "PRESENCE",
              negativeGeoTargetType: "PRESENCE",
            },
            startDate: todayStamp.replace(/-/g, ""),
          },
        },
      },
    ]);

    campaignResourceName =
      campaignResult.mutateOperationResponses?.[0]?.campaignResult?.resourceName ?? null;
    if (!campaignResourceName) {
      throw new Error("Failed to create campaign.");
    }
  }

  const geoTargets = [
    "geoTargetConstants/1001973", // Victoria, BC
    "geoTargetConstants/9105154", // Saanich, BC
    "geoTargetConstants/1001955", // Shawnigan Lake, BC
    "geoTargetConstants/1001925", // Mill Bay, BC
    "geoTargetConstants/1001893", // Duncan, BC
    "geoTargetConstants/9219967", // Chemainus, BC
  ];

  if (!existingCampaign) {
    await mutate(
      accessToken,
      geoTargets.map((geoTargetConstant) => ({
        campaignCriterionOperation: {
          create: {
            campaign: campaignResourceName,
            location: { geoTargetConstant },
          },
        },
      }))
    );
  }

  const negativeKeywords = [
    "jobs",
    "job",
    "career",
    "careers",
    "salary",
    "washer",
    "pressure washer",
    "power washer",
    "rent",
    "rental",
    "home depot",
    "lowes",
    "equipment",
    "parts",
    "how to",
    "diy",
  ];

  if (!existingCampaign) {
    await mutate(
      accessToken,
      negativeKeywords.map((text) => ({
        campaignCriterionOperation: {
          create: {
            campaign: campaignResourceName,
            negative: true,
            keyword: {
              text,
              matchType: "BROAD",
            },
          },
        },
      }))
    );
  }

  const adGroupLabel = `${campaignLabel} | Main`;
  const existingAdGroup = await firstResult(
    accessToken,
    [
      "SELECT ad_group.resource_name, ad_group.id, ad_group.name",
      "FROM ad_group",
      `WHERE ad_group.name = '${adGroupLabel}'`,
      "LIMIT 1",
    ].join("\n")
  );

  let adGroupResourceName = existingAdGroup?.adGroup?.resourceName ?? null;
  if (!adGroupResourceName) {
    const adGroupResult = await mutate(accessToken, [
      {
        adGroupOperation: {
          create: {
            campaign: campaignResourceName,
            name: adGroupLabel,
            status: "ENABLED",
            type: "SEARCH_STANDARD",
            cpcBidMicros: "2500000",
          },
        },
      },
    ]);

    adGroupResourceName =
      adGroupResult.mutateOperationResponses?.[0]?.adGroupResult?.resourceName ?? null;
    if (!adGroupResourceName) {
      throw new Error("Failed to create ad group.");
    }
  }

  const keywords = [
    { text: "power washing", matchType: "PHRASE" },
    { text: "pressure washing", matchType: "PHRASE" },
    { text: "power washing near me", matchType: "PHRASE" },
    { text: "pressure washing near me", matchType: "PHRASE" },
    { text: "deck cleaning service", matchType: "PHRASE" },
    { text: "patio cleaning service", matchType: "PHRASE" },
    { text: "driveway cleaning service", matchType: "PHRASE" },
    { text: "power washing victoria", matchType: "EXACT" },
    { text: "pressure washing saanich", matchType: "EXACT" },
    { text: "deck cleaning victoria", matchType: "EXACT" },
    { text: "power washing", matchType: "EXACT" },
    { text: "pressure washing", matchType: "EXACT" },
  ];

  if (!existingAdGroup) {
    await mutate(
      accessToken,
      keywords.map(({ text, matchType }) => ({
        adGroupCriterionOperation: {
          create: {
            adGroup: adGroupResourceName,
            status: "ENABLED",
            keyword: { text, matchType },
          },
        },
      }))
    );
  }

  const headlines = [
    "Power Washing Near You",
    "Driveways, Decks and Patios",
    "Fast, Honest Local Quotes",
    "Pressure Washing in Victoria",
    "Deck and Patio Cleaning",
    "Owner Replies Directly",
    "Low-Pressure Quote Process",
    "Cleaner Exterior Surfaces",
    "Book Local Power Washing",
    "Driveway Cleaning Quotes",
  ];

  const descriptions = [
    "Owner replies directly with low-pressure quotes for driveways, patios and decks.",
    "Send details or photos for clear next steps on power washing and deck cleaning.",
    "Local residential power washing with honest quoting and tidy finished results.",
    "Book driveway, patio or deck cleaning with a straightforward local team.",
  ];

  const existingAd = await firstResult(
    accessToken,
    [
      "SELECT ad_group_ad.ad.id, ad_group_ad.resource_name",
      "FROM ad_group_ad",
      `WHERE ad_group.id = ${adGroupResourceName.split("/").pop()}`,
      "LIMIT 1",
    ].join("\n")
  );

  let adResourceName = existingAd?.adGroupAd?.resourceName ?? null;
  if (!adResourceName) {
    const adResult = await mutate(accessToken, [
      {
        adGroupAdOperation: {
          create: {
            adGroup: adGroupResourceName,
            status: "PAUSED",
            ad: {
              finalUrls: ["https://maestrosservices.com/services/power-washing/"],
              responsiveSearchAd: {
                headlines: headlines.map((text) => ({ text })),
                descriptions: descriptions.map((text) => ({ text })),
              },
            },
          },
        },
      },
    ]);

    adResourceName =
      adResult.mutateOperationResponses?.[0]?.adGroupAdResult?.resourceName ?? null;
  }

  const trustVariantQuery = await firstResult(
    accessToken,
    [
      "SELECT ad_group_ad.resource_name, ad_group_ad.ad.id",
      "FROM ad_group_ad",
      `WHERE ad_group.id = ${adGroupResourceName.split("/").pop()}`,
      "AND ad_group_ad.ad.type = RESPONSIVE_SEARCH_AD",
      "ORDER BY ad_group_ad.ad.id DESC",
      "LIMIT 2",
    ].join("\n")
  );

  if (trustVariantQuery && existingAd) {
    const adRows = await runSearch(
      accessToken,
      [
        "SELECT ad_group_ad.resource_name, ad_group_ad.ad.id",
        "FROM ad_group_ad",
        `WHERE ad_group.id = ${adGroupResourceName.split("/").pop()}`,
        "AND ad_group_ad.ad.type = RESPONSIVE_SEARCH_AD",
      ].join("\n")
    );

    if (adRows.length < 2) {
      const trustHeadlines = [
        "Power Washing Quotes Fast",
        "Owner Replies Directly",
        "Text Photos for a Quote",
        "Driveway and Patio Cleaning",
        "Pressure Washing Near You",
        "Low-Pressure Local Service",
        "Deck Cleaning in Victoria",
        "Patio Cleaning in Saanich",
        "Cleaner Exteriors, Less Hassle",
        "Book Local Power Washing",
      ];

      const trustDescriptions = [
        "Send details or photos for a clear next step from the owner, not a call center.",
        "Low-pressure residential power washing for driveways, decks, patios and more.",
        "If the job is not the right fit, we will say so early and point you the right way.",
        "Fast local quotes for power washing and deck cleaning across lower-mid Vancouver Island.",
      ];

      const trustAdResult = await mutate(accessToken, [
        {
          adGroupAdOperation: {
            create: {
              adGroup: adGroupResourceName,
              status: "PAUSED",
              ad: {
                finalUrls: ["https://maestrosservices.com/services/power-washing/"],
                responsiveSearchAd: {
                  headlines: trustHeadlines.map((text) => ({ text })),
                  descriptions: trustDescriptions.map((text) => ({ text })),
                },
              },
            },
          },
        },
      ]);

      const trustAdResourceName =
        trustAdResult.mutateOperationResponses?.[0]?.adGroupAdResult?.resourceName ?? null;

      if (trustAdResourceName) {
        adResourceName = `${adResourceName},${trustAdResourceName}`;
      }
    }
  }

  return {
    budgetResourceName,
    campaignResourceName,
    adGroupResourceName,
    adResourceName,
  };
};

const addSitelinksToCampaign = async (accessToken, campaignId) => {
  const campaignResourceName = `customers/${customerId}/campaigns/${campaignId}`;
  const sitelinks = [
    {
      linkText: "Get a Quote",
      finalUrls: ["https://maestrosservices.com/quote/"],
      description1: "Send details or photos",
      description2: "Owner replies directly",
    },
    {
      linkText: "Power Washing",
      finalUrls: ["https://maestrosservices.com/services/power-washing/"],
      description1: "Driveways patios decks",
      description2: "Practical local quotes",
    },
    {
      linkText: "Gravel Driveways",
      finalUrls: ["https://maestrosservices.com/services/gravel-driveway-installation/"],
      description1: "Repairs grading refreshes",
      description2: "Help for ruts and puddles",
    },
    {
      linkText: "Read Reviews",
      finalUrls: ["https://maestrosservices.com/review/"],
      description1: "Check Google reviews first",
      description2: "Low-pressure local service",
    },
  ];

  const createdAssets = [];
  for (const sitelink of sitelinks) {
    const existingAsset = await firstResult(
      accessToken,
      [
        "SELECT asset.resource_name, asset.id, asset.sitelink_asset.link_text",
        "FROM asset",
        `WHERE asset.sitelink_asset.link_text = '${sitelink.linkText}'`,
        "LIMIT 1",
      ].join("\n")
    );

    let assetResourceName = existingAsset?.asset?.resourceName ?? null;
    if (!assetResourceName) {
      const assetResult = await mutate(accessToken, [
        {
          assetOperation: {
            create: {
              finalUrls: sitelink.finalUrls,
              sitelinkAsset: {
                linkText: sitelink.linkText,
                description1: sitelink.description1,
                description2: sitelink.description2,
              },
            },
          },
        },
      ]);

      assetResourceName = assetResult.mutateOperationResponses?.[0]?.assetResult?.resourceName ?? null;
    }

    if (!assetResourceName) {
      throw new Error(`Failed to create or locate sitelink asset: ${sitelink.linkText}`);
    }

    const existingCampaignAsset = await firstResult(
      accessToken,
      [
        "SELECT campaign_asset.asset, campaign_asset.field_type, campaign_asset.resource_name",
        "FROM campaign_asset",
        `WHERE campaign_asset.campaign = '${campaignResourceName}'`,
        `AND campaign_asset.asset = '${assetResourceName}'`,
        "LIMIT 1",
      ].join("\n")
    );

    if (!existingCampaignAsset) {
      await mutate(accessToken, [
        {
          campaignAssetOperation: {
            create: {
              campaign: campaignResourceName,
              asset: assetResourceName,
              fieldType: "SITELINK",
            },
          },
        },
      ]);
    }

    createdAssets.push(assetResourceName);
  }

  return createdAssets;
};

const ensureCallAssetForBusiness = async (accessToken) => {
  const existingCallAsset = await firstResult(
    accessToken,
    [
      "SELECT asset.resource_name, asset.id, asset.type, asset.call_asset.country_code, asset.call_asset.phone_number",
      "FROM asset",
      "WHERE asset.type = CALL",
      "LIMIT 1",
    ].join("\n")
  );

  if (existingCallAsset?.asset?.resourceName) {
    return existingCallAsset.asset.resourceName;
  }

  const result = await mutate(accessToken, [
    {
      assetOperation: {
        create: {
          callAsset: {
            countryCode: "CA",
            phoneNumber: "(250) 858-1781",
            callConversionAction: `customers/${customerId}/conversionActions/7625124937`,
          },
        },
      },
    },
  ]);

  const resourceName = result.mutateOperationResponses?.[0]?.assetResult?.resourceName ?? null;
  if (!resourceName) {
    throw new Error("Failed to create call asset.");
  }
  return resourceName;
};

const ensureCalloutAsset = async (accessToken, calloutText) => {
  const existingAsset = await firstResult(
    accessToken,
    [
      "SELECT asset.resource_name, asset.id, asset.type, asset.callout_asset.callout_text",
      "FROM asset",
      `WHERE asset.callout_asset.callout_text = '${calloutText.replace(/'/g, "\\'")}'`,
      "LIMIT 1",
    ].join("\n")
  );

  if (existingAsset?.asset?.resourceName) {
    return existingAsset.asset.resourceName;
  }

  const result = await mutate(accessToken, [
    {
      assetOperation: {
        create: {
          calloutAsset: {
            calloutText,
          },
        },
      },
    },
  ]);

  const resourceName = result.mutateOperationResponses?.[0]?.assetResult?.resourceName ?? null;
  if (!resourceName) {
    throw new Error(`Failed to create callout asset: ${calloutText}`);
  }
  return resourceName;
};

const ensureCampaignAsset = async (accessToken, campaignResourceName, assetResourceName, fieldType) => {
  const existingCampaignAsset = await firstResult(
    accessToken,
    [
      "SELECT campaign.id, campaign_asset.asset, campaign_asset.field_type, campaign_asset.resource_name",
      "FROM campaign_asset",
      `WHERE campaign_asset.campaign = '${campaignResourceName}'`,
      `AND campaign_asset.asset = '${assetResourceName}'`,
      `AND campaign_asset.field_type = ${fieldType}`,
      "LIMIT 1",
    ].join("\n")
  );

  if (existingCampaignAsset) {
    return existingCampaignAsset.campaignAsset.resourceName;
  }

  const result = await mutate(accessToken, [
    {
      campaignAssetOperation: {
        create: {
          campaign: campaignResourceName,
          asset: assetResourceName,
          fieldType,
        },
      },
    },
  ]);

  return result.mutateOperationResponses?.[0]?.campaignAssetResult?.resourceName ?? null;
};

const addTrustAssetsToCampaign = async (accessToken, campaignId) => {
  const campaignResourceName = `customers/${customerId}/campaigns/${campaignId}`;
  const callAssetResourceName = await ensureCallAssetForBusiness(accessToken);
  const calloutTexts = [
    "Owner Replies Directly",
    "Low-Pressure Quotes",
    "Text Photos for a Quote",
    "Vancouver Island Local",
  ];

  const attached = [];
  const callAssetAttachment = await ensureCampaignAsset(
    accessToken,
    campaignResourceName,
    callAssetResourceName,
    "CALL"
  );
  if (callAssetAttachment) attached.push(callAssetAttachment);

  for (const calloutText of calloutTexts) {
    const assetResourceName = await ensureCalloutAsset(accessToken, calloutText);
    const attachment = await ensureCampaignAsset(
      accessToken,
      campaignResourceName,
      assetResourceName,
      "CALLOUT"
    );
    if (attachment) attached.push(attachment);
  }

  return attached;
};

const listConversionActions = async (accessToken) => {
  const rows = await runSearch(
    accessToken,
    [
      "SELECT",
      "  conversion_action.id,",
      "  conversion_action.name,",
      "  conversion_action.status,",
      "  conversion_action.type,",
      "  conversion_action.category,",
      "  conversion_action.primary_for_goal,",
      "  conversion_action.resource_name",
      "FROM conversion_action",
      "ORDER BY conversion_action.id DESC",
      "LIMIT 50",
    ].join("\n")
  );

  return rows.map((row) => row.conversionAction).filter(Boolean);
};

const findConversionActionByName = async (accessToken, name) =>
  firstResult(
    accessToken,
    [
      "SELECT",
      "  conversion_action.id,",
      "  conversion_action.name,",
      "  conversion_action.status,",
      "  conversion_action.type,",
      "  conversion_action.category,",
      "  conversion_action.primary_for_goal,",
      "  conversion_action.resource_name",
      "FROM conversion_action",
      `WHERE conversion_action.name = '${name.replace(/'/g, "\\'")}'`,
      "LIMIT 1",
    ].join("\n")
  ).then((row) => row?.conversionAction ?? null);

const createWebsiteConversions = async (accessToken) => {
  const desiredActions = [
    {
      name: "Website Quote Submit",
      category: "SUBMIT_LEAD_FORM",
      primaryForGoal: true,
      valueSettings: {
        defaultValue: 1,
        alwaysUseDefaultValue: true,
      },
    },
    {
      name: "Website Phone Click",
      category: "CONTACT",
      primaryForGoal: false,
      valueSettings: {
        defaultValue: 0.5,
        alwaysUseDefaultValue: true,
      },
    },
    {
      name: "Website SMS Click",
      category: "CONTACT",
      primaryForGoal: false,
      valueSettings: {
        defaultValue: 0.5,
        alwaysUseDefaultValue: true,
      },
    },
  ];

  const createdOrExisting = [];

  for (const desiredAction of desiredActions) {
    const existing = await findConversionActionByName(accessToken, desiredAction.name);
    if (existing) {
      createdOrExisting.push(existing);
      continue;
    }

    const result = await mutate(accessToken, [
      {
        conversionActionOperation: {
          create: {
            name: desiredAction.name,
            status: "ENABLED",
            type: "WEBPAGE",
            category: desiredAction.category,
            primaryForGoal: desiredAction.primaryForGoal,
            countingType: "ONE_PER_CLICK",
            clickThroughLookbackWindowDays: 30,
            valueSettings: desiredAction.valueSettings,
          },
        },
      },
    ]);

    const resourceName =
      result.mutateOperationResponses?.[0]?.conversionActionResult?.resourceName ?? null;

    if (!resourceName) {
      throw new Error(`Failed to create conversion action ${desiredAction.name}.`);
    }

    const created = await findConversionActionByName(accessToken, desiredAction.name);
    if (!created) {
      throw new Error(`Created conversion action ${desiredAction.name}, but could not re-query it.`);
    }
    createdOrExisting.push(created);
  }

  return createdOrExisting;
};

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

  if (command === "create-power-washing-search") {
    const result = await createPowerWashingSearchCampaign(accessToken);
    console.log("Created paused power washing Search campaign:");
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "add-sitelinks") {
    const campaignId = process.argv[3];
    if (!campaignId) {
      throw new Error("Provide a campaign ID, e.g. npm run ads:add:sitelinks -- 23882682845");
    }
    const result = await addSitelinksToCampaign(accessToken, campaignId);
    console.log(`Attached ${result.length} sitelink assets to campaign ${campaignId}`);
    return;
  }

  if (command === "add-trust-assets") {
    const campaignId = process.argv[3];
    if (!campaignId) {
      throw new Error("Provide a campaign ID, e.g. npm run ads:add:trust-assets -- 23882682845");
    }
    const result = await addTrustAssetsToCampaign(accessToken, campaignId);
    console.log(`Attached ${result.length} trust assets to campaign ${campaignId}`);
    return;
  }

  if (command === "conversions") {
    const conversions = await listConversionActions(accessToken);
    console.log(`Conversion actions for customer ${customerId}:`);
    for (const conversion of conversions) {
      console.log(
        `- ${conversion.id}: ${conversion.name} [${conversion.status}] (${conversion.type}/${conversion.category}) primary=${conversion.primaryForGoal}`
      );
    }
    return;
  }

  if (command === "create-website-conversions") {
    const conversions = await createWebsiteConversions(accessToken);
    console.log("Ensured website conversion actions exist:");
    for (const conversion of conversions) {
      console.log(
        `- ${conversion.id}: ${conversion.name} [${conversion.status}] (${conversion.type}/${conversion.category}) primary=${conversion.primaryForGoal}`
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
