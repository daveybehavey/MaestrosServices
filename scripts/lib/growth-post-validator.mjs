/**
 * Deterministic GBP STANDARD post validator.
 * Fail closed on unverified / ambiguous claims. Never publishes.
 */

import { validateGbpCtaUrl } from "./growth-cta.mjs";
import { findDuplicateMatch, normalizePostText } from "./growth-duplicate.mjs";

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const compilePatterns = (patterns = []) =>
  patterns.map((source) => new RegExp(source, "i"));

const matchesAny = (text, regexes) => {
  for (const regex of regexes) {
    if (regex.test(text)) return regex;
  }
  return null;
};

const collectMentions = (text, catalog, { requireVerified = true } = {}) => {
  const normalized = ` ${normalizePostText(text)} `;
  const matched = [];
  const blocked = [];

  for (const item of catalog) {
    const labels = [item.name, item.slug, ...(item.aliases ?? [])]
      .filter(Boolean)
      .map((label) => normalizePostText(label))
      .filter((label) => label.length >= 3);
    const hit = labels.some((label) => normalized.includes(` ${label} `));
    if (!hit) continue;

    if (item.status === "verified") {
      matched.push(item);
    } else if (item.status === "rejected" || item.status === "unsupported") {
      blocked.push({ item, reason: `status:${item.status}` });
    } else if (requireVerified) {
      blocked.push({ item, reason: "not_verified" });
    }
  }

  return { matched, blocked };
};

const hasVerifiedEvidence = (facts, predicate) =>
  (facts.businessFacts ?? []).some(
    (fact) => fact.status === "verified" && predicate(fact)
  ) ||
  (facts.projects ?? []).some(
    (project) => project.status === "verified" && predicate(project)
  );

const availabilityEvidenceCurrent = (facts, now = new Date()) => {
  const today = now.toISOString().slice(0, 10);
  return (facts.businessFacts ?? []).some((fact) => {
    if (fact.kind !== "availability" || fact.status !== "verified") return false;
    if (!fact.value) return false;
    if (fact.validUntil && fact.validUntil < today) return false;
    return true;
  });
};

export const validateGbpPost = ({
  draft,
  facts,
  recentPosts = [],
  now = new Date(),
  allowDuplicateOverride = false,
} = {}) => {
  const errors = [];
  const warnings = [];
  const matchedFactIds = [];

  if (!facts || !facts.rules) {
    return {
      valid: false,
      errors: ["Growth facts/rules are required."],
      warnings,
      matchedFactIds,
      duplicateScore: 0,
      duplicateMatch: null,
      normalizedCta: null,
      audit: { failClosed: true },
    };
  }

  if (draft == null || typeof draft !== "object" || Array.isArray(draft)) {
    return {
      valid: false,
      errors: ["Draft post must be an object."],
      warnings,
      matchedFactIds,
      duplicateScore: 0,
      duplicateMatch: null,
      normalizedCta: null,
      audit: { failClosed: true },
    };
  }

  const rules = facts.rules;
  const summary = typeof draft.summary === "string" ? draft.summary.trim() : "";
  const minChars = rules.summaryMinChars ?? 20;
  const maxChars = rules.summaryMaxChars ?? 1500;

  if (!summary) {
    errors.push("Post summary text is required.");
  } else {
    if (summary.length < minChars) {
      errors.push(`Post summary is shorter than ${minChars} characters.`);
    }
    if (summary.length > maxChars) {
      errors.push(`Post summary exceeds ${maxChars} characters.`);
    }
  }

  const topicType = draft.topicType ?? "STANDARD";
  const allowedTopics = rules.allowedTopicTypes ?? ["STANDARD"];
  if (!allowedTopics.includes(topicType)) {
    errors.push(`topicType "${topicType}" is not allowed.`);
  }

  const cta = draft.callToAction ?? {};
  const actionType = cta.actionType ?? "LEARN_MORE";
  const allowedActions = rules.allowedCtaActionTypes ?? ["LEARN_MORE"];
  if (!allowedActions.includes(actionType)) {
    errors.push(`CTA actionType "${actionType}" is not allowed.`);
  }

  const ctaResult = validateGbpCtaUrl(cta.url, rules);
  errors.push(...ctaResult.errors);
  warnings.push(...ctaResult.warnings);

  const phonePatterns = compilePatterns(rules.forbiddenBodyPatterns?.phone ?? []);
  if (summary && matchesAny(summary, phonePatterns)) {
    errors.push("Post body must not contain a phone number.");
  }

  // Also block known verified phone values literally.
  for (const fact of facts.businessFacts ?? []) {
    if (fact.kind === "phone" && fact.value && summary.includes(String(fact.value))) {
      errors.push("Post body must not contain the business phone number.");
      break;
    }
  }

  const pricePatterns = compilePatterns(rules.forbiddenBodyPatterns?.priceOrDiscount ?? []);
  if (summary && matchesAny(summary, pricePatterns)) {
    const hasPriceEvidence = hasVerifiedEvidence(
      facts,
      (item) => item.kind === "price" || item.kind === "discount" || item.allowsPricing === true
    );
    if (!hasPriceEvidence) {
      errors.push("Price/discount language requires verified pricing evidence.");
    }
  }

  const availabilityPatterns = compilePatterns(
    rules.forbiddenBodyPatterns?.availability ?? []
  );
  if (summary && matchesAny(summary, availabilityPatterns)) {
    if (!availabilityEvidenceCurrent(facts, now)) {
      errors.push(
        "Availability/openings language requires a current verified availability fact."
      );
    }
  }

  const guaranteePatterns = compilePatterns(
    rules.forbiddenBodyPatterns?.guaranteeOrSuperlative ?? []
  );
  if (summary && matchesAny(summary, guaranteePatterns)) {
    const supported = hasVerifiedEvidence(
      facts,
      (item) =>
        item.kind === "guarantee" ||
        item.kind === "credential" ||
        item.kind === "claim" && item.status === "verified"
    );
    if (!supported) {
      errors.push(
        "Guarantee, credential, years-in-business, or superlative claims require verified evidence."
      );
    }
  }

  const testimonialPatterns = compilePatterns(
    rules.forbiddenBodyPatterns?.testimonialLanguage ?? []
  );
  if (summary && matchesAny(summary, testimonialPatterns)) {
    const supported = hasVerifiedEvidence(
      facts,
      (item) => item.kind === "testimonial" || item.kind === "review_quote"
    );
    if (!supported) {
      errors.push("Testimonial/review language requires verified evidence.");
    }
  }

  const serviceMentions = collectMentions(summary, facts.services ?? [], {
    requireVerified: true,
  });
  for (const blocked of serviceMentions.blocked) {
    errors.push(
      `Service mention "${blocked.item.name}" is not verified for automation (${blocked.reason}).`
    );
  }
  for (const service of serviceMentions.matched) {
    matchedFactIds.push(service.id);
  }

  const areaMentions = collectMentions(summary, facts.areas ?? [], {
    requireVerified: true,
  });
  for (const blocked of areaMentions.blocked) {
    errors.push(
      `Service-area mention "${blocked.item.name}" is not verified for automation (${blocked.reason}).`
    );
  }
  for (const area of areaMentions.matched) {
    matchedFactIds.push(area.id);
  }

  // Project-specific phrasing: recent job / we just finished / completed project without evidence.
  if (
    /\b(we just (finished|completed)|recent (job|project)|this (homeowner|customer)'s|last week we)\b/i.test(
      summary
    )
  ) {
    const verifiedProjects = (facts.projects ?? []).filter((p) => p.status === "verified");
    if (verifiedProjects.length === 0) {
      errors.push("Project/job-specific claims require an approved project evidence record.");
    } else {
      matchedFactIds.push(...verifiedProjects.map((p) => p.id));
      warnings.push(
        "Project-specific language detected; ensure the draft maps to a verified project record."
      );
    }
  }

  const duplicateThreshold = rules.duplicate?.nearDuplicateThreshold ?? 0.82;
  const duplicateMatch = findDuplicateMatch(summary, recentPosts, {
    nearDuplicateThreshold: duplicateThreshold,
  });
  if (duplicateMatch.isDuplicate) {
    if (allowDuplicateOverride) {
      warnings.push(
        `Duplicate/near-duplicate detected (score=${duplicateMatch.score}) but override enabled.`
      );
    } else {
      errors.push(
        duplicateMatch.exact
          ? "Exact duplicate of a recent post (fail closed)."
          : `Near-duplicate of a recent post (score=${duplicateMatch.score}, threshold=${duplicateThreshold}).`
      );
    }
  }

  const uniqueFactIds = [...new Set(matchedFactIds)];
  const valid = errors.length === 0;

  return {
    valid,
    errors,
    warnings,
    matchedFactIds: uniqueFactIds,
    duplicateScore: duplicateMatch.score ?? 0,
    duplicateMatch,
    normalizedCta: ctaResult.normalizedCta,
    audit: {
      failClosed: true,
      topicType,
      actionType,
      summaryLength: summary.length,
      publishes: false,
      contactsGoogle: false,
      checkedAt: now.toISOString(),
    },
  };
};
