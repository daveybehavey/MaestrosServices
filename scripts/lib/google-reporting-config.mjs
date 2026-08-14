/**
 * Pure optional-env resolution for GA4/GSC reporting collectors.
 * Empty GitHub Actions secrets must fall back like missing values.
 */

import { nonEmptyEnvValue } from "./env-value.mjs";

export const DEFAULT_SITE_URL = "https://maestrosservices.com";

/**
 * Resolve SITE_URL and Search Console property with empty-string-as-unset semantics.
 */
export const resolveReportingSiteConfig = (env = process.env) => {
  const siteUrl = nonEmptyEnvValue(env, "SITE_URL") ?? DEFAULT_SITE_URL;
  const siteHost = new URL(siteUrl).host;
  const searchConsoleProperty =
    nonEmptyEnvValue(env, "GOOGLE_SEARCH_CONSOLE_PROPERTY") ??
    `sc-domain:${siteHost}`;
  return {
    siteUrl,
    siteHost,
    searchConsoleProperty,
  };
};
