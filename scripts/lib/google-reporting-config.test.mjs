import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SITE_URL,
  resolveReportingSiteConfig,
} from "./google-reporting-config.mjs";
import { resolveGbpOAuthConfig, listMissingGbpOauthLabels } from "./gbp.mjs";

test("SITE_URL missing uses default Maestro URL", () => {
  const config = resolveReportingSiteConfig({});
  assert.equal(config.siteUrl, DEFAULT_SITE_URL);
  assert.equal(config.siteHost, "maestrosservices.com");
});

test("SITE_URL empty string uses default Maestro URL", () => {
  const config = resolveReportingSiteConfig({ SITE_URL: "" });
  assert.equal(config.siteUrl, DEFAULT_SITE_URL);
  assert.equal(config.siteHost, "maestrosservices.com");
});

test("non-empty SITE_URL is preserved", () => {
  const config = resolveReportingSiteConfig({
    SITE_URL: "https://example.test",
  });
  assert.equal(config.siteUrl, "https://example.test");
  assert.equal(config.siteHost, "example.test");
});

test("GOOGLE_SEARCH_CONSOLE_PROPERTY missing uses sc-domain default", () => {
  const config = resolveReportingSiteConfig({});
  assert.equal(config.searchConsoleProperty, "sc-domain:maestrosservices.com");
});

test("GOOGLE_SEARCH_CONSOLE_PROPERTY empty string uses sc-domain default", () => {
  const config = resolveReportingSiteConfig({
    GOOGLE_SEARCH_CONSOLE_PROPERTY: "",
  });
  assert.equal(config.searchConsoleProperty, "sc-domain:maestrosservices.com");
});

test("non-empty GOOGLE_SEARCH_CONSOLE_PROPERTY is preserved", () => {
  const config = resolveReportingSiteConfig({
    GOOGLE_SEARCH_CONSOLE_PROPERTY: "sc-domain:custom.example",
  });
  assert.equal(config.searchConsoleProperty, "sc-domain:custom.example");
});

test("Actions-shaped empty optional env resolves valid reporting and GBP fallbacks", () => {
  const env = {
    GOOGLE_OAUTH_CLIENT_ID: "shared-client",
    GOOGLE_OAUTH_CLIENT_SECRET: "shared-secret",
    GOOGLE_OAUTH_REFRESH_TOKEN: "shared-refresh",
    GOOGLE_GA4_PROPERTY_ID: "properties/123",
    GOOGLE_GBP_LOCATION_NAME: "locations/2",
    GOOGLE_GBP_ACCOUNT_NAME: "accounts/1",
    GOOGLE_GBP_OAUTH_REFRESH_TOKEN: "gbp-refresh",
    GOOGLE_GBP_OAUTH_CLIENT_ID: "",
    GOOGLE_GBP_OAUTH_CLIENT_SECRET: "",
    SITE_URL: "",
    GOOGLE_SEARCH_CONSOLE_PROPERTY: "",
  };

  const site = resolveReportingSiteConfig(env);
  assert.equal(site.siteUrl, DEFAULT_SITE_URL);
  assert.equal(site.searchConsoleProperty, "sc-domain:maestrosservices.com");

  const gbp = resolveGbpOAuthConfig(env);
  assert.equal(gbp.clientId, "shared-client");
  assert.equal(gbp.clientSecret, "shared-secret");
  assert.equal(gbp.refreshToken, "gbp-refresh");
  assert.deepEqual(listMissingGbpOauthLabels(gbp), []);
});
