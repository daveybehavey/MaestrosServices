/**
 * Growth Ops daily review-watch packet builder.
 * Reuses P2B review-reply draft semantics. Never sends replies or mutates Google.
 */

import {
  WORKFLOW_FORBIDDEN_COMMAND_PATTERNS,
  listWorkflowActionUses,
  stripSensitiveFields,
} from "./growth-weekly-ci.mjs";
import {
  buildReviewReplyDraftsFromReviews,
  sanitizeReviewReplyDraftsForCi,
} from "./growth-drafts.mjs";

export const REVIEW_WATCH_SAFETY = Object.freeze({
  mode: "review_watch",
  repliesToReviews: false,
  mutatesGoogle: false,
  publishes: false,
  deploys: false,
  requiresHumanReview: true,
  sendEligible: false,
});

export const GROWTH_REVIEW_WATCH_WORKFLOW_PATH =
  ".github/workflows/growth-ops-review-watch.yml";

export const REVIEW_WATCH_REQUIRED_SECRET_NAMES = Object.freeze([
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_OAUTH_REFRESH_TOKEN",
  "GOOGLE_GBP_OAUTH_REFRESH_TOKEN",
  "GOOGLE_GBP_LOCATION_NAME",
  "GOOGLE_GBP_ACCOUNT_NAME",
]);

export const REVIEW_WATCH_CONFIG_LABELS = Object.freeze([
  ...REVIEW_WATCH_REQUIRED_SECRET_NAMES,
  "GOOGLE_GBP_OAUTH_CLIENT_ID",
  "GOOGLE_GBP_OAUTH_CLIENT_SECRET",
]);

const SHA40 = /^[0-9a-f]{40}$/i;

const hasConfiguredValue = (env, name) => {
  const raw = env?.[name];
  return typeof raw === "string" ? raw.trim().length > 0 : Boolean(raw);
};

/**
 * Assess review-watch CI config by label only (never returns values).
 * Does not require GA4/GSC secrets.
 */
export const assessReviewWatchConfig = (env = process.env) => {
  const labels = {};
  for (const name of REVIEW_WATCH_CONFIG_LABELS) {
    labels[name] = hasConfiguredValue(env, name) ? "yes" : "no";
  }
  const missingRequired = REVIEW_WATCH_REQUIRED_SECRET_NAMES.filter(
    (name) => labels[name] === "no"
  );
  return {
    configured: missingRequired.length === 0,
    labels,
    missingRequired,
    failureClass: missingRequired.length ? "configuration_failure" : null,
  };
};

export const formatReviewWatchConfigSummary = (assessment) => {
  const lines = [
    "# Maestro Growth Ops Review Watch — configuration preflight",
    "",
    "Secret values are never printed. Labels only.",
    "",
  ];
  for (const [name, present] of Object.entries(assessment.labels ?? {})) {
    lines.push(`- ${name}: ${present}`);
  }
  lines.push("");
  if (assessment.configured) {
    lines.push("Required GBP/OAuth configuration: present");
  } else {
    lines.push("Required GBP/OAuth configuration: missing");
    for (const name of assessment.missingRequired ?? []) {
      lines.push(`  - missing: ${name}`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

/**
 * Count unreplied reviews from a live reviews report.
 * Returns null when the reviews array is unavailable (never coerce to 0).
 */
export const countUnrepliedReviews = (reviewsReport) => {
  if (!reviewsReport || !Array.isArray(reviewsReport.reviews)) return null;
  return reviewsReport.reviews.filter(
    (review) => review && !review.hasOwnerReply && String(review.reviewId ?? "").trim()
  ).length;
};

export const buildReviewWatchPacket = ({
  reviewsReport,
  facts,
  now = new Date(),
  source = null,
} = {}) => {
  if (!reviewsReport || !Array.isArray(reviewsReport.reviews)) {
    const error = new Error(
      "Reviews report unavailable or malformed: expected reviews array."
    );
    error.failureClass = "reviews_unavailable";
    throw error;
  }

  const unrepliedCount = countUnrepliedReviews(reviewsReport);
  const drafts = buildReviewReplyDraftsFromReviews({ reviewsReport, facts });

  return {
    mode: REVIEW_WATCH_SAFETY.mode,
    generatedAt: now.toISOString(),
    unrepliedCount,
    draftCount: drafts.length,
    drafts,
    safety: { ...REVIEW_WATCH_SAFETY },
    source: source ?? {
      generatedAt: reviewsReport.generatedAt ?? null,
    },
    failureClass: null,
  };
};

export const sanitizeReviewWatchPacketForCi = (packet, env = process.env) => {
  const cleaned = stripSensitiveFields(packet ?? {});
  return {
    mode: REVIEW_WATCH_SAFETY.mode,
    generatedAt: cleaned.generatedAt ?? new Date().toISOString(),
    unrepliedCount:
      cleaned.unrepliedCount == null ? null : Number(cleaned.unrepliedCount),
    draftCount: Array.isArray(cleaned.drafts) ? cleaned.drafts.length : 0,
    drafts: sanitizeReviewReplyDraftsForCi(cleaned.drafts, env),
    safety: { ...REVIEW_WATCH_SAFETY },
    source: cleaned.source ?? null,
    failureClass: cleaned.failureClass ?? null,
  };
};

export const formatReviewWatchJobSummaryMarkdown = (packet) => {
  const unreplied =
    packet?.unrepliedCount == null ? "unavailable" : String(packet.unrepliedCount);
  const drafts = packet?.draftCount ?? packet?.drafts?.length ?? 0;
  const lines = [
    "## Review Watch",
    `- Unreplied reviews: ${unreplied}`,
    `- Human-review drafts: ${drafts}`,
    "- Requires human review: yes",
    "- Replies sent: 0",
    "",
  ];
  return `${lines.join("\n")}\n`;
};

export const formatReviewWatchMarkdown = (packet) => {
  const lines = [
    "# Maestro Growth Ops — review watch",
    "",
    `Generated: ${packet.generatedAt}`,
    `Mode: ${packet.mode}`,
    "",
    "## Safety",
    `- repliesToReviews: ${packet.safety?.repliesToReviews}`,
    `- mutatesGoogle: ${packet.safety?.mutatesGoogle}`,
    `- publishes: ${packet.safety?.publishes}`,
    `- deploys: ${packet.safety?.deploys}`,
    `- requiresHumanReview: ${packet.safety?.requiresHumanReview}`,
    `- sendEligible: ${packet.safety?.sendEligible}`,
    "",
    formatReviewWatchJobSummaryMarkdown(packet).trim(),
    "",
    "## Human-review reply drafts",
  ];
  const drafts = packet.drafts ?? [];
  if (!drafts.length) {
    lines.push("- None.");
  } else {
    for (const row of drafts) {
      lines.push(`- reviewId: ${row.reviewId}`);
      lines.push(`  - starRating: ${row.starRating ?? "(none)"}`);
      lines.push(`  - sendEligible: ${row.sendEligible}`);
      lines.push(
        `  - serviceRefs: ${
          Array.isArray(row.serviceRefs) && row.serviceRefs.length
            ? row.serviceRefs.join(", ")
            : "(none)"
        }`
      );
      lines.push(`  - draftReply: ${row.draftReply}`);
    }
  }
  lines.push("");
  lines.push(
    "Reviewer names, raw comments, and customer PII are excluded from this artifact."
  );
  lines.push("");
  return `${lines.join("\n")}\n`;
};

/**
 * Static safety audit for the review-watch workflow YAML.
 */
export const auditGrowthReviewWatchWorkflow = (yamlText = "") => {
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
  const runsReviewWatch = /growth:review-watch\b/.test(active);
  const runsGbpReviews = /gbp:reviews\b/.test(active);
  const runsWeeklyStack =
    /growth:weekly\b/.test(active) ||
    /reporting:ga4\b/.test(active) ||
    /reporting:gsc\b/.test(active) ||
    /gbp:performance\b/.test(active) ||
    /gbp:search-keywords\b/.test(active) ||
    /gbp:list-posts\b/.test(active);
  const hasConcurrency = /concurrency\s*:/.test(active);

  const actionUses = listWorkflowActionUses(yamlText);
  const unpinnedActions = actionUses.filter((ref) => {
    const at = ref.lastIndexOf("@");
    if (at < 0) return true;
    return !SHA40.test(ref.slice(at + 1));
  });
  const allActionsPinnedToSha = actionUses.length > 0 && unpinnedActions.length === 0;
  const checkoutPersistCredentialsFalse =
    /actions\/checkout@[0-9a-f]{40}/i.test(yamlText) &&
    /persist-credentials:\s*false/.test(active);

  if (!hasWorkflowDispatch) violations.push("Missing workflow_dispatch trigger.");
  if (!hasSchedule) violations.push("Missing daily schedule cron.");
  if (!hasContentsRead) violations.push("Missing permissions.contents: read.");
  if (hasContentsWrite) violations.push("permissions.contents: write is not allowed.");
  if (hasPullRequestsWrite) {
    violations.push("permissions.pull-requests: write is not allowed.");
  }
  if (hasDeploymentsWrite) {
    violations.push("permissions.deployments: write is not allowed.");
  }
  if (hasIssuesWrite) {
    violations.push("permissions.issues: write is not allowed.");
  }
  if (!runsReviewWatch) violations.push("Workflow must invoke growth:review-watch.");
  if (!runsGbpReviews) violations.push("Workflow must invoke gbp:reviews.");
  if (runsWeeklyStack) {
    violations.push("Review-watch must not run the weekly Growth Ops collector stack.");
  }
  if (!hasConcurrency) violations.push("Missing concurrency group.");
  if (!allActionsPinnedToSha) {
    violations.push(
      `External actions must be pinned to 40-char SHAs. Unpinned: ${unpinnedActions.join(", ") || "(none)"}`
    );
  }
  if (!checkoutPersistCredentialsFalse) {
    violations.push("checkout must set persist-credentials: false.");
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
      hasIssuesWrite,
      runsReviewWatch,
      runsGbpReviews,
      runsWeeklyStack,
      allActionsPinnedToSha,
      checkoutPersistCredentialsFalse,
    },
  };
};
