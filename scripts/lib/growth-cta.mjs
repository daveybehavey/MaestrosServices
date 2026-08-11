/**
 * Deterministic GBP CTA validation and normalization reporting.
 * Action-type aware: CALL does not require a website URL; URL CTAs do.
 * Does not silently repair invalid URLs into a publishable pass.
 */

const DEFAULT_REQUIRED_UTM = {
  utm_source: "google_business_profile",
  utm_medium: "organic",
};

/** CTA action types that require an approved website URL + UTMs. */
export const URL_REQUIRED_CTA_ACTIONS = [
  "LEARN_MORE",
  "BOOK",
  "ORDER",
  "SHOP",
  "SIGN_UP",
];

/** CTA action types that must not carry a website URL. */
export const NO_URL_CTA_ACTIONS = ["CALL"];

const sanitizeCampaign = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");

const hasUrlValue = (rawUrl) => rawUrl != null && String(rawUrl).trim() !== "";

/**
 * Validate a website CTA URL (HTTPS, host, path, required UTMs).
 * Used by URL-required action types. Does not interpret actionType.
 */
export const validateGbpCtaUrl = (rawUrl, rules = {}) => {
  const errors = [];
  const warnings = [];
  let parsed = null;

  if (!hasUrlValue(rawUrl)) {
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

/**
 * Action-aware GBP CTA validation.
 *
 * - LEARN_MORE / BOOK / ORDER / SHOP / SIGN_UP: require URL + full website rules
 * - CALL: URL must be absent (GBP CALL uses the profile phone). normalizedCta is null.
 *   If a URL is supplied with CALL, fail as inconsistent (deterministic; no silent ignore).
 */
export const validateGbpCta = ({ actionType = "LEARN_MORE", url } = {}, rules = {}) => {
  const action = String(actionType || "LEARN_MORE").trim().toUpperCase() || "LEARN_MORE";
  const warnings = [];

  if (NO_URL_CTA_ACTIONS.includes(action)) {
    if (hasUrlValue(url)) {
      return {
        ok: false,
        errors: [
          `CTA actionType CALL must not include a website URL (GBP CALL uses the profile phone). Remove url or use a URL-based actionType.`,
        ],
        warnings,
        normalizedCta: null,
        parsed: null,
        actionType: action,
      };
    }
    return {
      ok: true,
      errors: [],
      warnings,
      normalizedCta: null,
      parsed: null,
      actionType: action,
    };
  }

  if (URL_REQUIRED_CTA_ACTIONS.includes(action)) {
    const result = validateGbpCtaUrl(url, rules);
    return { ...result, actionType: action };
  }

  // Unknown action types are not inventively validated here; post validator
  // already rejects actions outside rules.allowedCtaActionTypes. Still require
  // URL semantics if a URL is present, otherwise fail closed on missing URL.
  if (hasUrlValue(url)) {
    const result = validateGbpCtaUrl(url, rules);
    return { ...result, actionType: action };
  }
  return {
    ok: false,
    errors: [`CTA actionType "${action}" requires a website URL.`],
    warnings,
    normalizedCta: null,
    parsed: null,
    actionType: action,
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
