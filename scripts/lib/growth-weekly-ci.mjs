/**
 * Pure helpers for Growth Ops GitHub Actions shadow mode.
 * No network. Never prints secret values. Sanitizes weekly reports for CI artifacts.
 */

import { WEEKLY_SAFETY } from "./growth-weekly.mjs";

export const GROWTH_CI_SOURCE = "github_actions_shadow";

export const GROWTH_SHADOW_WORKFLOW_PATH = ".github/workflows/growth-ops-shadow.yml";

/** Labels checked before live collection. Values are never logged. */
export const CI_CONFIG_LABELS = Object.freeze([
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_OAUTH_REFRESH_TOKEN",
  "GOOGLE_GA4_PROPERTY_ID",
  "GOOGLE_GBP_LOCATION_NAME",
  "GOOGLE_GBP_ACCOUNT_NAME",
  "GOOGLE_SEARCH_CONSOLE_PROPERTY",
  "GOOGLE_GBP_OAUTH_CLIENT_ID",
  "GOOGLE_GBP_OAUTH_CLIENT_SECRET",
  "GOOGLE_GBP_OAUTH_REFRESH_TOKEN",
  "SITE_URL",
]);

/**
 * Must be present for live collection (reporting + GBP collectors).
 * Shared OAuth client + dedicated GBP refresh token (business.manage).
 */
export const CI_REQUIRED_SECRET_NAMES = Object.freeze([
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_OAUTH_REFRESH_TOKEN",
  "GOOGLE_GBP_OAUTH_REFRESH_TOKEN",
  "GOOGLE_GA4_PROPERTY_ID",
  "GOOGLE_GBP_LOCATION_NAME",
  "GOOGLE_GBP_ACCOUNT_NAME",
]);

export const CI_OPTIONAL_SECRET_NAMES = Object.freeze([
  "GOOGLE_SEARCH_CONSOLE_PROPERTY",
  "SITE_URL",
  "GOOGLE_GBP_OAUTH_CLIENT_ID",
  "GOOGLE_GBP_OAUTH_CLIENT_SECRET",
]);

const FORBIDDEN_KEY_PATTERN =
  /^(reviewerdisplayname|comment|ownerreply|client_secret|clientsecret|refresh_token|refreshtoken|access_token|accesstoken|authorization|password|passwd|api[_-]?key|private[_-]?key|secret|token)$/i;

const FORBIDDEN_KEY_FRAGMENTS = [
  "client_secret",
  "refresh_token",
  "access_token",
  "reviewerdisplayname",
  "ownerreply",
];

const MAX_ACTIONS = 3;

const isPlainObject = (value) =>
  value != null && typeof value === "object" && !Array.isArray(value);

const keyLooksSensitive = (key) => {
  const normalized = String(key).replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  if (FORBIDDEN_KEY_PATTERN.test(String(key))) return true;
  if (FORBIDDEN_KEY_PATTERN.test(normalized)) return true;
  return FORBIDDEN_KEY_FRAGMENTS.some((frag) =>
    normalized.includes(frag.replace(/_/g, ""))
  );
};

/**
 * Deep-clone while dropping sensitive keys. Does not coerce missing numerics to zero.
 */
export const stripSensitiveFields = (value, { depth = 0 } = {}) => {
  if (depth > 40) return null;
  if (value == null) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => stripSensitiveFields(item, { depth: depth + 1 }));
  }
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (keyLooksSensitive(key)) continue;
    out[key] = stripSensitiveFields(child, { depth: depth + 1 });
  }
  return out;
};

const hasConfiguredValue = (env, name) => {
  const raw = env?.[name];
  return typeof raw === "string" ? raw.trim().length > 0 : Boolean(raw);
};

/**
 * Assess CI configuration presence by label only (never returns values).
 */
export const assessCiConfig = (env = process.env) => {
  const labels = {};
  for (const name of CI_CONFIG_LABELS) {
    labels[name] = hasConfiguredValue(env, name) ? "yes" : "no";
  }
  const missingRequired = CI_REQUIRED_SECRET_NAMES.filter(
    (name) => labels[name] === "no"
  );
  const optionalPresent = CI_OPTIONAL_SECRET_NAMES.filter(
    (name) => labels[name] === "yes"
  );
  return {
    configured: missingRequired.length === 0,
    labels,
    missingRequired,
    optionalPresent,
    failureClass: missingRequired.length ? "configuration_failure" : null,
  };
};

export const formatCiConfigSummary = (assessment) => {
  const lines = ["# Maestro Growth Ops — configuration preflight", ""];
  lines.push("Configured (yes/no only; values never printed):");
  for (const name of CI_CONFIG_LABELS) {
    lines.push(`- ${name}: ${assessment.labels[name]}`);
  }
  lines.push("");
  if (assessment.configured) {
    lines.push("Required configuration: present. Live read-only collection may proceed.");
  } else {
    lines.push("Required configuration: MISSING.");
    lines.push("Live collection stopped. Fixture data was not substituted.");
    lines.push("");
    lines.push("Configure these GitHub Actions secret NAMES (values never logged):");
    for (const name of assessment.missingRequired) {
      lines.push(`- ${name}`);
    }
    lines.push("");
    lines.push("Failure class: configuration_failure");
  }
  return `${lines.join("\n")}\n`;
};

const sanitizeReviewOpportunity = (reviewOpportunity) => {
  if (!reviewOpportunity) {
    return {
      unrepliedCount: null,
      actionRecommended: false,
      reason: "Reviews report missing; not interpreting as zero unreplied.",
    };
  }
  return {
    unrepliedCount:
      reviewOpportunity.unrepliedCount == null
        ? null
        : Number(reviewOpportunity.unrepliedCount),
    actionRecommended: Boolean(reviewOpportunity.actionRecommended),
    reason: String(reviewOpportunity.reason ?? ""),
  };
};

const sanitizePostOpportunity = (postOpportunity) => {
  if (!postOpportunity) {
    return {
      shouldDraft: false,
      reason: "Post opportunity unavailable.",
      serviceRefs: [],
      areaRefs: [],
      maintenanceSignal: false,
    };
  }
  return {
    shouldDraft: Boolean(postOpportunity.shouldDraft),
    reason: String(postOpportunity.reason ?? ""),
    serviceRefs: Array.isArray(postOpportunity.serviceRefs)
      ? postOpportunity.serviceRefs.map(String)
      : [],
    areaRefs: Array.isArray(postOpportunity.areaRefs)
      ? postOpportunity.areaRefs.map(String)
      : [],
    maintenanceSignal: Boolean(postOpportunity.maintenanceSignal),
  };
};

const sanitizeActions = (actions = []) =>
  (Array.isArray(actions) ? actions : [])
    .slice(0, MAX_ACTIONS)
    .map((action, index) => ({
      id: action?.id != null ? String(action.id) : `action.${index + 1}`,
      type: action?.type != null ? String(action.type) : "unknown",
      title: action?.title != null ? String(action.title) : "Untitled",
      reason: action?.reason != null ? String(action.reason) : "",
      recommendedNextStep:
        action?.recommendedNextStep != null ? String(action.recommendedNextStep) : "",
      targetKpi: action?.targetKpi != null ? String(action.targetKpi) : "",
      confidence: action?.confidence != null ? String(action.confidence) : "",
      impact: action?.impact == null ? null : Number(action.impact),
      priority: action?.priority == null ? index + 1 : Number(action.priority),
    }));

const sanitizeCollection = (collection) => {
  if (!collection) {
    return { attempted: false, results: [] };
  }
  return {
    attempted: Boolean(collection.attempted),
    results: Array.isArray(collection.results)
      ? collection.results.map((row) => ({
          script: row?.script != null ? String(row.script) : "unknown",
          ok: Boolean(row?.ok),
          status: row?.status == null ? null : Number(row.status),
        }))
      : [],
  };
};

const sanitizeDataQuality = (dataQuality) => {
  if (!dataQuality) {
    return { available: {}, issues: [] };
  }
  return {
    available: isPlainObject(dataQuality.available) ? { ...dataQuality.available } : {},
    issues: Array.isArray(dataQuality.issues)
      ? dataQuality.issues.map((issue) => ({
          source: issue?.source != null ? String(issue.source) : "unknown",
          code: issue?.code != null ? String(issue.code) : "unknown",
          detail: issue?.detail != null ? String(issue.detail) : "",
        }))
      : [],
  };
};

const sanitizeKpis = (kpis) => {
  if (!kpis) return { ga4Leads: null, gbp: null, primaryNote: null };
  const cleaned = stripSensitiveFields(kpis);
  return cleaned;
};

const sanitizeSignals = (signals) =>
  (Array.isArray(signals) ? signals : []).map((signal) => ({
    id: signal?.id != null ? String(signal.id) : "signal",
    type: signal?.type != null ? String(signal.type) : "unknown",
    severity: signal?.severity != null ? String(signal.severity) : null,
    summary: signal?.summary != null ? String(signal.summary) : "",
  }));

/**
 * Build a durable, sanitized CI packet from a weekly intelligence report.
 */
export const sanitizeWeeklyForCi = (
  report,
  {
    run = {},
    generatedAt = new Date().toISOString(),
  } = {}
) => {
  const actions = sanitizeActions(report?.actions);
  const packet = {
    generatedAt: report?.generatedAt ?? generatedAt,
    exportedAt: generatedAt,
    source: GROWTH_CI_SOURCE,
    mode: WEEKLY_SAFETY.mode,
    publishes: false,
    mutatesGoogle: false,
    deploys: false,
    requiresHumanReview: true,
    autoPublishEligible: false,
    safety: {
      ...WEEKLY_SAFETY,
      publishes: false,
      mutatesGoogle: false,
      deploys: false,
      requiresHumanReview: true,
      autoPublishEligible: false,
    },
    run: {
      repository: run.repository ?? null,
      workflow: run.workflow ?? null,
      commitSha: run.commitSha ?? null,
      runId: run.runId ?? null,
      runAttempt: run.runAttempt ?? null,
    },
    period: stripSensitiveFields(report?.period ?? null),
    dataQuality: sanitizeDataQuality(report?.dataQuality),
    kpis: sanitizeKpis(report?.kpis),
    signals: sanitizeSignals(report?.signals),
    actions,
    postOpportunity: sanitizePostOpportunity(report?.postOpportunity),
    reviewOpportunity: sanitizeReviewOpportunity(report?.reviewOpportunity),
    collection: sanitizeCollection(report?.collection),
  };

  return stripSensitiveFields(packet);
};

export const formatCiJobSummaryMarkdown = (packet) => {
  const lines = [];
  lines.push("# Maestro Growth Ops Shadow Report");
  lines.push("");
  lines.push(`- Generated: ${packet.generatedAt ?? "unknown"}`);
  lines.push(`- Exported: ${packet.exportedAt ?? "unknown"}`);
  lines.push(`- Mode: ${packet.mode}`);
  lines.push(`- Source: ${packet.source}`);
  lines.push(`- Human review required: yes`);
  lines.push(`- Auto-publish eligible: no`);
  lines.push(`- Publishes: no`);
  lines.push(`- Mutates Google: no`);
  lines.push(`- Deploys: no`);
  if (packet.run?.commitSha) {
    lines.push(`- Commit: ${packet.run.commitSha}`);
  }
  lines.push("");
  lines.push("## Data quality");
  const issues = packet.dataQuality?.issues ?? [];
  if (!issues.length) {
    lines.push("- No data-quality issues recorded.");
  } else {
    lines.push(`- Issues: ${issues.length}`);
    for (const issue of issues.slice(0, 12)) {
      lines.push(`  - ${issue.source}: ${issue.code}`);
    }
  }
  lines.push("");
  lines.push("## Collectors");
  const results = packet.collection?.results ?? [];
  if (!packet.collection?.attempted) {
    lines.push("- Collection not attempted in this packet.");
  } else if (!results.length) {
    lines.push("- No collector results.");
  } else {
    for (const row of results) {
      lines.push(`- ${row.script}: ${row.ok ? "ok" : "failed"} (status=${row.status})`);
    }
  }
  lines.push("");
  lines.push(`## Actions (${packet.actions?.length ?? 0}, max ${MAX_ACTIONS})`);
  if (!packet.actions?.length) {
    lines.push("- None.");
  } else {
    for (const action of packet.actions) {
      lines.push(
        `- ${action.priority}. [${action.confidence}] ${action.title} (${action.type})`
      );
    }
  }
  lines.push("");
  lines.push("## Post opportunity");
  lines.push(`- shouldDraft: ${packet.postOpportunity?.shouldDraft}`);
  lines.push(`- serviceRefs: ${(packet.postOpportunity?.serviceRefs ?? []).join(", ") || "(none)"}`);
  lines.push(`- areaRefs: ${(packet.postOpportunity?.areaRefs ?? []).join(", ") || "(none)"}`);
  lines.push(`- reason: ${packet.postOpportunity?.reason ?? ""}`);
  lines.push("");
  lines.push("## Review opportunity");
  lines.push(`- unrepliedCount: ${packet.reviewOpportunity?.unrepliedCount}`);
  lines.push(`- actionRecommended: ${packet.reviewOpportunity?.actionRecommended}`);
  lines.push("");
  lines.push(
    "Customer review text/names and OAuth values are excluded from this summary and artifact."
  );
  lines.push("");
  lines.push(
    "Next tiny step after a successful manual shadow run: optional GitHub issue publishing (P2A.1) with issues:write — not enabled in this workflow."
  );
  return `${lines.join("\n")}\n`;
};

export const formatCiMarkdownArtifact = (packet) => {
  const lines = [];
  lines.push("# Maestro Growth Ops — sanitized weekly packet");
  lines.push("");
  lines.push(`Generated: ${packet.generatedAt}`);
  lines.push(`Source: ${packet.source}`);
  lines.push(`Mode: ${packet.mode}`);
  lines.push("");
  lines.push("## Safety");
  lines.push(`- publishes: ${packet.publishes}`);
  lines.push(`- mutatesGoogle: ${packet.mutatesGoogle}`);
  lines.push(`- deploys: ${packet.deploys}`);
  lines.push(`- requiresHumanReview: ${packet.requiresHumanReview}`);
  lines.push(`- autoPublishEligible: ${packet.autoPublishEligible}`);
  lines.push("");
  lines.push(formatCiJobSummaryMarkdown(packet).replace(/^# Maestro Growth Ops Shadow Report\n\n/, ""));
  return `${lines.join("\n")}\n`;
};

/** Commands/patterns forbidden in the shadow workflow file (non-comment lines). */
export const WORKFLOW_FORBIDDEN_COMMAND_PATTERNS = Object.freeze([
  /gbp:create-post/,
  /ads:create/,
  /ads:add/,
  /ads:optimize/,
  /\bwrangler\s+deploy\b/,
  /\bnpm\s+run\s+deploy\b/,
  /\bastro\s+deploy\b/,
  /\bgh\s+workflow\s+run\b.*deploy/i,
  /\bcloudflare\b.*\b(deploy|purge|mutation)\b/i,
]);

export const WORKFLOW_ALLOWED_NPM_SCRIPTS = Object.freeze([
  "growth:weekly",
  "growth:weekly-ci-export",
  "growth:weekly-ci-preflight",
]);

const SHA40 = /^[0-9a-f]{40}$/i;

/**
 * Collect external `uses:` action refs from workflow YAML (comment-stripped lines).
 */
export const listWorkflowActionUses = (yamlText = "") => {
  const refs = [];
  for (const rawLine of String(yamlText).split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "");
    const match = line.match(/^\s*uses:\s*([^\s]+)\s*$/);
    if (!match) continue;
    refs.push(match[1]);
  }
  return refs;
};

/**
 * Static safety audit of workflow YAML text.
 * Ignores full-line and trailing comments.
 */
export const auditGrowthShadowWorkflow = (yamlText = "") => {
  const lines = String(yamlText).split(/\r?\n/);
  const activeLines = lines
    .map((line) => line.replace(/#.*$/, ""))
    .filter((line) => line.trim().length > 0);
  const active = activeLines.join("\n");

  const violations = [];
  for (const pattern of WORKFLOW_FORBIDDEN_COMMAND_PATTERNS) {
    if (pattern.test(active)) {
      violations.push(`Forbidden pattern: ${pattern}`);
    }
  }

  const hasWorkflowDispatch = /workflow_dispatch\s*:/.test(active);
  const hasSchedule = /schedule\s*:/.test(active) && /cron\s*:/.test(active);
  const hasContentsRead = /contents\s*:\s*read/.test(active);
  const hasContentsWrite = /contents\s*:\s*write/.test(active);
  const hasPullRequestsWrite = /pull-requests\s*:\s*write/.test(active);
  const hasDeploymentsWrite = /deployments\s*:\s*write/.test(active);
  const hasIssuesWrite = /issues\s*:\s*write/.test(active);
  const runsGrowthWeekly = /growth:weekly\b/.test(active);
  const hasConcurrency = /concurrency\s*:/.test(active);

  const actionUses = listWorkflowActionUses(yamlText);
  const unpinnedActions = actionUses.filter((ref) => {
    const at = ref.lastIndexOf("@");
    if (at < 0) return true;
    return !SHA40.test(ref.slice(at + 1));
  });
  const allActionsPinnedToSha = actionUses.length > 0 && unpinnedActions.length === 0;

  // Controlled weekly failure: continue-on-error on weekly, then explicit final fail.
  const weeklyStepBlock = (() => {
    const idx = lines.findIndex((line) => /name:\s*Run read-only weekly intelligence/.test(line));
    if (idx < 0) return "";
    const block = [];
    for (let i = idx; i < lines.length; i += 1) {
      const line = lines[i];
      if (i > idx && /^\s*-\s+name:\s*/.test(line)) break;
      block.push(line);
    }
    return block.join("\n");
  })();
  const weeklyHasContinueOnError = /continue-on-error:\s*true/.test(weeklyStepBlock);
  const weeklyHasId = /id:\s*weekly\b/.test(weeklyStepBlock);
  const hasDecisionEngineFailureSummary =
    /Failure class:\s*decision_engine_failure/.test(yamlText) &&
    /steps\.weekly\.outcome\s*==\s*'failure'/.test(active);
  const hasFinalWeeklyFailStep =
    /decision_engine_failure:\s*growth:weekly exited non-zero/.test(yamlText) &&
    /steps\.weekly\.outcome\s*==\s*'failure'/.test(active) &&
    /exit\s+1/.test(yamlText);
  const artifactUploadAfterControlledFailure =
    /id:\s*upload_artifact/.test(active) &&
    /if:\s*always\(\)/.test(active) &&
    /upload-artifact@/.test(yamlText);

  const checkoutPersistCredentialsFalse =
    /actions\/checkout@[0-9a-f]{40}/i.test(yamlText) &&
    /persist-credentials:\s*false/.test(active);

  if (!hasWorkflowDispatch) violations.push("Missing workflow_dispatch trigger.");
  if (!hasSchedule) violations.push("Missing weekly schedule cron.");
  if (!hasContentsRead) violations.push("Missing permissions.contents: read.");
  if (hasContentsWrite) violations.push("permissions.contents: write is not allowed.");
  if (hasPullRequestsWrite) {
    violations.push("permissions.pull-requests: write is not allowed.");
  }
  if (hasDeploymentsWrite) {
    violations.push("permissions.deployments: write is not allowed.");
  }
  if (hasIssuesWrite) {
    violations.push("permissions.issues: write is not allowed in P2A.");
  }
  if (!runsGrowthWeekly) violations.push("Workflow must invoke growth:weekly.");
  if (!hasConcurrency) violations.push("Missing concurrency group.");
  if (!allActionsPinnedToSha) {
    violations.push(
      `External actions must be pinned to 40-char SHAs. Unpinned: ${unpinnedActions.join(", ") || "(none)"}`
    );
  }
  if (!checkoutPersistCredentialsFalse) {
    violations.push("checkout must set persist-credentials: false.");
  }
  if (!weeklyHasId) violations.push("weekly step must keep id: weekly.");
  if (!weeklyHasContinueOnError) {
    violations.push("weekly step must set continue-on-error: true for controlled failure handling.");
  }
  if (!hasDecisionEngineFailureSummary) {
    violations.push("Missing decision_engine_failure summary path after weekly failure.");
  }
  if (!hasFinalWeeklyFailStep) {
    violations.push("Missing final explicit fail when steps.weekly.outcome == 'failure'.");
  }
  if (!artifactUploadAfterControlledFailure) {
    violations.push("Artifact upload must remain available after controlled weekly failure.");
  }

  return {
    ok: violations.length === 0,
    violations,
    checks: {
      hasWorkflowDispatch,
      hasSchedule,
      hasContentsRead,
      hasContentsWrite,
      hasPullRequestsWrite,
      hasDeploymentsWrite,
      hasIssuesWrite,
      runsGrowthWeekly,
      hasConcurrency,
      allActionsPinnedToSha,
      checkoutPersistCredentialsFalse,
      weeklyHasContinueOnError,
      weeklyHasId,
      hasDecisionEngineFailureSummary,
      hasFinalWeeklyFailStep,
      artifactUploadAfterControlledFailure,
      actionUses,
    },
  };
};
