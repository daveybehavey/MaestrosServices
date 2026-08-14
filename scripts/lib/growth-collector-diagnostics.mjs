/**
 * Sanitized collector failure diagnostics for Growth Ops weekly runs.
 * Redact before any reporting. Never return unredacted child output.
 */

export const COLLECTOR_DIAGNOSTIC_MAX_CHARS = 1500;

export const COLLECTOR_SECRET_ENV_NAMES = Object.freeze([
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_OAUTH_REFRESH_TOKEN",
  "GOOGLE_GBP_OAUTH_REFRESH_TOKEN",
  "GOOGLE_GBP_OAUTH_CLIENT_ID",
  "GOOGLE_GBP_OAUTH_CLIENT_SECRET",
  "GOOGLE_GA4_PROPERTY_ID",
  "GOOGLE_GBP_LOCATION_NAME",
  "GOOGLE_GBP_ACCOUNT_NAME",
  "GOOGLE_SEARCH_CONSOLE_PROPERTY",
  "GOOGLE_ADS_OAUTH_CLIENT_ID",
  "GOOGLE_ADS_OAUTH_CLIENT_SECRET",
  "GOOGLE_ADS_OAUTH_REFRESH_TOKEN",
  "GOOGLE_ADS_DEVELOPER_TOKEN",
]);

export const COLLECTOR_FAILURE_CLASSES = Object.freeze([
  "oauth_invalid_grant",
  "oauth_invalid_client",
  "oauth_unauthorized",
  "missing_configuration",
  "api_permission_denied",
  "api_not_enabled_or_quota",
  "resource_not_found",
  "network_failure",
  "command_start_failure",
  "unknown_collector_failure",
]);

const REDACTED = "[REDACTED]";

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const stripAnsi = (text) =>
  String(text ?? "").replace(
    // eslint-disable-next-line no-control-regex
    /\u001b\[[0-9;]*[a-zA-Z]|\u001b\][^\u0007]*\u0007|\u001b[@-Z\\-_]/g,
    ""
  );

/**
 * Redact configured secret values and common credential patterns from text.
 * Always operate on a copy; never mutate inputs.
 */
export const redactCollectorText = (rawText, env = process.env) => {
  let text = stripAnsi(rawText ?? "");
  if (!text) return "";

  // Longest-first so overlapping secrets redact fully.
  const secretValues = COLLECTOR_SECRET_ENV_NAMES.map((name) => env?.[name])
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim())
    .sort((a, b) => b.length - a.length);

  for (const value of secretValues) {
    text = text.split(value).join(REDACTED);
  }

  // Generic credential patterns (after exact secret substitution).
  text = text.replace(
    /Authorization:\s*Bearer\s+[^\s]+/gi,
    `Authorization: Bearer ${REDACTED}`
  );
  text = text.replace(
    /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
    `Bearer ${REDACTED}`
  );
  text = text.replace(
    /("?(?:access_token|refresh_token|client_secret|id_token|api[_-]?key|private[_-]?key|password|passwd)"?\s*[:=]\s*)("?)[^"\s,}]+\2/gi,
    `$1${REDACTED}`
  );
  text = text.replace(
    /((?:access_token|refresh_token|client_secret|api[_-]?key|private[_-]?key)=)[^&\s]+/gi,
    `$1${REDACTED}`
  );

  // Strip review/customer preview fragments (plain + JSON-ish forms).
  // Prefer losing diagnostic context over retaining customer content.
  // Quoted JSON string values.
  text = text.replace(
    /"reviewer(?:DisplayName|_display_name)"\s*:\s*"(?:\\.|[^"\\])*"/gi,
    `"reviewerDisplayName":"${REDACTED}"`
  );
  text = text.replace(
    /"comment"\s*:\s*"(?:\\.|[^"\\])*"/gi,
    `"comment":"${REDACTED}"`
  );
  // ownerReply object or string — fail closed on the whole value fragment.
  text = text.replace(
    /"owner(?:Reply|_reply)"\s*:\s*\{[\s\S]*?\}(?=\s*[,}\]]|$)/gi,
    `"ownerReply":{"comment":"${REDACTED}"}`
  );
  text = text.replace(
    /"owner(?:Reply|_reply)"\s*:\s*"(?:\\.|[^"\\])*"/gi,
    `"ownerReply":"${REDACTED}"`
  );

  // Unquoted / plain key forms (with optional surrounding quotes on the key).
  text = text.replace(
    /"?reviewer(?:DisplayName|_display_name)"?\s*[:=]\s*("?)(?:\\.|[^"\n,;|}]*)\1/gi,
    `reviewerDisplayName=${REDACTED}`
  );
  text = text.replace(
    /"?owner(?:Reply|_reply)"?\s*[:=]\s*\{[\s\S]*?\}(?=\s*[,}\]\n]|$)/gi,
    `ownerReply={comment:${REDACTED}}`
  );
  text = text.replace(
    /"?owner(?:Reply|_reply)"?\s*[:=]\s*[^\n]*/gi,
    `ownerReply=${REDACTED}`
  );
  text = text.replace(
    /"?comment"?\s*[:=]\s*("?)(?:\\.|[^"\n]*)\1/gi,
    `comment=${REDACTED}`
  );

  return text;
};

export const truncateDiagnostic = (
  text,
  maxChars = COLLECTOR_DIAGNOSTIC_MAX_CHARS
) => {
  const value = String(text ?? "").trim();
  if (!value) return "";
  if (value.length <= maxChars) return value;
  const sliced = value.slice(value.length - maxChars);
  return `…[truncated]…\n${sliced}`;
};

/**
 * Prefer stderr; fall back to stdout only when stderr is empty.
 * Take the trailing window before redaction to keep failure-relevant lines.
 */
export const selectCollectorFailureRawText = ({
  stdout = "",
  stderr = "",
  error = null,
  maxChars = COLLECTOR_DIAGNOSTIC_MAX_CHARS * 2,
} = {}) => {
  const errText = String(stderr ?? "").trim();
  const outText = String(stdout ?? "").trim();
  const errorText =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : error
        ? String(error)
        : "";

  let combined = errText || outText || errorText || "";
  if (errText && errorText && !errText.includes(errorText)) {
    combined = `${errText}\n${errorText}`;
  } else if (!errText && outText && errorText) {
    combined = `${outText}\n${errorText}`;
  }

  combined = stripAnsi(combined);
  if (combined.length > maxChars) {
    combined = combined.slice(combined.length - maxChars);
  }
  return combined;
};

export const classifyCollectorFailure = ({
  text = "",
  status = null,
  error = null,
} = {}) => {
  const hay = `${text}\n${error instanceof Error ? error.message : error ?? ""}`.toLowerCase();

  if (
    error &&
    (error.code === "ENOENT" ||
      /spawn\s+enoent/i.test(String(error.message ?? "")))
  ) {
    return "command_start_failure";
  }

  if (/invalid_grant/.test(hay)) return "oauth_invalid_grant";
  if (/invalid_client/.test(hay)) return "oauth_invalid_client";
  if (
    /\bunauthorized\b/.test(hay) ||
    /\b401\b/.test(hay) ||
    /invalid_token/.test(hay) ||
    /unauthenticated/.test(hay)
  ) {
    return "oauth_unauthorized";
  }
  if (
    /missing required environment/.test(hay) ||
    /missing required/.test(hay) ||
    /missing google business profile environment/.test(hay) ||
    /set google_gbp_/.test(hay) ||
    (/is required/.test(hay) && /google_|oauth|location|account/.test(hay))
  ) {
    return "missing_configuration";
  }

  // Specific enablement/quota signals before generic 403/permission checks.
  if (
    /service_disabled/.test(hay) ||
    /api has not been used/.test(hay) ||
    /accessnotconfigured/.test(hay) ||
    /quota/.test(hay) ||
    /rate[_ ]?limit/.test(hay)
  ) {
    return "api_not_enabled_or_quota";
  }

  if (
    /\b403\b/.test(hay) ||
    /permission[_\s-]?denied/.test(hay) ||
    /insufficientpermissions/.test(hay)
  ) {
    return "api_permission_denied";
  }
  if (/\b404\b/.test(hay) || /not[_ ]found/.test(hay) || /Resource not found/i.test(hay)) {
    return "resource_not_found";
  }
  if (
    /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(hay) ||
    /network|fetch failed|socket hang up|getaddrinfo/i.test(hay)
  ) {
    return "network_failure";
  }

  if (status == null && error) return "command_start_failure";
  return "unknown_collector_failure";
};

/**
 * Build a collector result with sanitized failure diagnostic.
 * Redaction happens before the diagnostic is returned or stored.
 */
export const buildCollectorResult = ({
  script,
  status = null,
  stdout = "",
  stderr = "",
  error = null,
  env = process.env,
  maxChars = COLLECTOR_DIAGNOSTIC_MAX_CHARS,
} = {}) => {
  const ok = status === 0 && !error;
  if (ok) {
    return {
      script,
      ok: true,
      status: 0,
      failureClass: null,
      diagnostic: null,
    };
  }

  const raw = selectCollectorFailureRawText({ stdout, stderr, error });
  const redacted = redactCollectorText(raw, env);
  const diagnostic = truncateDiagnostic(redacted, maxChars) || null;
  const failureClass = classifyCollectorFailure({
    text: redacted,
    status,
    error,
  });

  return {
    script,
    ok: false,
    status: status == null ? null : Number(status),
    failureClass,
    diagnostic,
  };
};

/**
 * Second-pass sanitation for CI artifacts / summaries.
 */
export const sanitizeCollectorResultForCi = (row, env = process.env) => {
  if (!row || typeof row !== "object") {
    return {
      script: "unknown",
      ok: false,
      status: null,
      failureClass: "unknown_collector_failure",
      diagnostic: null,
    };
  }
  if (row.ok) {
    return {
      script: String(row.script ?? "unknown"),
      ok: true,
      status: row.status == null ? 0 : Number(row.status),
      failureClass: null,
      diagnostic: null,
    };
  }
  const diagnostic =
    row.diagnostic == null
      ? null
      : truncateDiagnostic(redactCollectorText(String(row.diagnostic), env), 800);
  return {
    script: String(row.script ?? "unknown"),
    ok: false,
    status: row.status == null ? null : Number(row.status),
    failureClass:
      typeof row.failureClass === "string" && row.failureClass
        ? row.failureClass
        : "unknown_collector_failure",
    diagnostic,
  };
};
