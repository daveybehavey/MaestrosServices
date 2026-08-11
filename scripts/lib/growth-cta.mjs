/**
 * Deterministic GBP CTA URL validation and normalization reporting.
 * Does not silently repair invalid URLs into a publishable pass.
 */

const DEFAULT_REQUIRED_UTM = {
  utm_source: "google_business_profile",
  utm_medium: "organic",
};

const sanitizeCampaign = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");

export const validateGbpCtaUrl = (rawUrl, rules = {}) => {
  const errors = [];
  const warnings = [];
  let parsed = null;

  if (rawUrl == null || String(rawUrl).trim() === "") {
    return {
      ok: false,
      errors: ["CTA URL is required."],
      warnings,
      normalizedCta: null,
      parsed: null,
    };
  }

  const value = String(rawUrl).trim();
  if (/^(javascript|data|vbscript):/i.test(value)) {
    return {
      ok: false,
      errors: [`CTA URL uses a forbidden scheme.`],
      warnings,
      normalizedCta: null,
      parsed: null,
    };
  }

  try {
    parsed = new URL(value);
  } catch {
    return {
      ok: false,
      errors: ["CTA URL is malformed."],
      warnings,
      normalizedCta: null,
      parsed: null,
    };
  }

  const requireHttps = rules.requireHttps !== false;
  if (requireHttps && parsed.protocol !== "https:") {
    errors.push("CTA URL must use HTTPS.");
  }

  const approvedHosts = rules.approvedHosts ?? ["maestrosservices.com", "www.maestrosservices.com"];
  const host = parsed.hostname.toLowerCase();
  if (!approvedHosts.includes(host)) {
    errors.push(`CTA hostname is not approved: ${host}`);
  }

  const pathName = parsed.pathname || "/";
  const prefixes = rules.approvedPathPrefixes ?? ["/"];
  const pathAllowed = prefixes.some((prefix) => {
    if (prefix === "/") return true;
    return pathName === prefix || pathName.startsWith(`${prefix}/`);
  });
  if (!pathAllowed) {
    errors.push(`CTA path is not on the approved list: ${pathName}`);
  }

  const requiredUtm = { ...DEFAULT_REQUIRED_UTM, ...(rules.requiredUtm ?? {}) };
  for (const [key, expected] of Object.entries(requiredUtm)) {
    const actual = parsed.searchParams.get(key);
    if (!actual) {
      errors.push(`CTA is missing required query param ${key}.`);
    } else if (expected && actual !== expected) {
      errors.push(`CTA ${key} must be "${expected}" (got "${actual}").`);
    }
  }

  const campaign = parsed.searchParams.get("utm_campaign");
  const allowedCampaigns = rules.allowedUtmCampaigns ?? ["gbp_posts", "gbp_profile", "gbp_growth_ops"];
  if (!campaign) {
    errors.push("CTA is missing required query param utm_campaign.");
  } else {
    const sanitized = sanitizeCampaign(campaign);
    if (sanitized !== campaign) {
      errors.push(
        `CTA utm_campaign must already be sanitized (expected like "${sanitized}").`
      );
    }
    if (!allowedCampaigns.includes(campaign)) {
      errors.push(`CTA utm_campaign is not allowed: ${campaign}`);
    }
  }

  // Report a normalized representation for audit only. Presence of normalizedCta
  // does not override errors — callers must treat ok===false as fail closed.
  const normalized = new URL(parsed.toString());
  if (host === "www.maestrosservices.com") {
    normalized.hostname = "maestrosservices.com";
  }
  if (!normalized.pathname) normalized.pathname = "/";

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    normalizedCta: errors.length === 0 ? normalized.toString() : null,
    parsed: {
      protocol: parsed.protocol,
      host,
      pathname: pathName,
      hash: parsed.hash || "",
      utm_source: parsed.searchParams.get("utm_source"),
      utm_medium: parsed.searchParams.get("utm_medium"),
      utm_campaign: parsed.searchParams.get("utm_campaign"),
    },
  };
};

export const buildCanonicalGbpQuoteUrl = ({
  campaign = "gbp_posts",
  content,
  hash = "#quote",
} = {}) => {
  const params = new URLSearchParams({
    utm_source: "google_business_profile",
    utm_medium: "organic",
    utm_campaign: sanitizeCampaign(campaign) || "gbp_posts",
  });
  if (content) params.set("utm_content", sanitizeCampaign(content));
  const hashPart = hash && !hash.startsWith("#") ? `#${hash}` : hash || "";
  return `https://maestrosservices.com/quote?${params.toString()}${hashPart}`;
};
