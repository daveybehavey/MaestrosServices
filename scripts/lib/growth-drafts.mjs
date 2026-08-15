/**
 * Human-review Growth Ops draft generation.
 * Produces drafts/recommendations only. Never publishes, sends, mutates, or deploys.
 */

import { buildCanonicalGbpQuoteUrl } from "./growth-cta.mjs";
import { verifiedOnly } from "./growth-facts.mjs";
import { validateGbpPost } from "./growth-post-validator.mjs";
import { redactCollectorText } from "./growth-collector-diagnostics.mjs";
import { stripSensitiveFields } from "./growth-weekly-ci.mjs";

export const DRAFT_SAFETY = Object.freeze({
  mode: "human_review_drafts",
  publishes: false,
  repliesToReviews: false,
  mutatesGoogle: false,
  deploys: false,
  createsPullRequests: false,
  requiresHumanReview: true,
  autoPublishEligible: false,
  sendEligible: false,
});

export const WEBSITE_ACTION_TYPES = Object.freeze([
  "lead_conversion",
  "organic_opportunity",
]);

const INCENTIVE_OR_RATING_PATTERN =
  /\b(discount|coupon|gift card|free estimate gift|leave (us )?a (5|five)[- ]star|update (your )?rating|change (your )?review|please edit (your )?review)\b/i;

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_PATTERN = /\b(?:\+?1[\s.-]?)?(?:\(?250\)?[\s.-]?)?\d{3}[\s.-]?\d{4}\b/;

const POSITIVE_GENERIC_REPLY =
  "Thank you for the kind review. We appreciate you taking the time to share it. Please reach out if you need anything else.";

export const NEUTRAL_REPLY =
  "Thank you for taking the time to share your feedback. We appreciate hearing from you and would welcome the opportunity to better understand your experience. Please reach out directly if you'd like to discuss it further.";

const POSITIVE_OUTCOME_PATTERN =
  /\b(kind review|went smoothly|we are glad|glad the|satisfied|happy with your)\b/i;

const NATURAL_WORK_PHRASE = Object.freeze({
  "svc.seasonal-cleanups": "yard cleanup",
  "svc.lawn-mowing": "lawn mowing",
  "svc.hedge-trimming": "hedge trimming",
  "svc.garden-bed-maintenance": "garden bed work",
  "svc.weed-control": "weeding",
  "svc.power-washing": "power washing",
  "svc.gravel-driveway-installation": "gravel driveway work",
  "svc.fence-work-minor-repairs": "fence repair work",
});


const EXTRA_SERVICE_PHRASES = Object.freeze({
  "svc.hedge-trimming": ["bush trimming", "trimmed the bushes", "trimming bushes"],
  "svc.seasonal-cleanups": ["raking", "rake", "yard tidy", "tidy-up", "tidy up", "yard tidy-up"],
  "svc.garden-bed-maintenance": ["bark mulch"],
  "svc.weed-control": ["weeding", "weeded"],
  "svc.lawn-mowing": ["mowing", "mowed"],
});

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const hasText = (value) => typeof value === "string" && value.trim().length > 0;

const wordIncludes = (haystack, needle) => {
  if (!hasText(haystack) || !hasText(needle) || needle.trim().length < 3) return false;
  const pattern = new RegExp(`\\b${escapeRegExp(needle.trim())}\\b`, "i");
  return pattern.test(haystack);
};

export const matchVerifiedServicesFromComment = (comment, services = []) => {
  const text = String(comment ?? "");
  if (!text.trim()) return [];
  const matched = [];
  for (const service of verifiedOnly(services)) {
    const labels = [service.name, service.slug, ...(service.aliases ?? [])].filter(Boolean);
    const extras = EXTRA_SERVICE_PHRASES[service.id] ?? [];
    const hit = [...labels, ...extras].some((label) => wordIncludes(text, label));
    if (hit) matched.push(service);
  }
  return matched;
};

const hasLongVerbatimCopy = (reply, comment, minChars = 24) => {
  const source = String(comment ?? "").toLowerCase();
  const target = String(reply ?? "").toLowerCase();
  if (source.length < minChars) return false;
  for (let i = 0; i <= source.length - minChars; i += 1) {
    if (target.includes(source.slice(i, i + minChars))) return true;
  }
  return false;
};

export const draftReplyLooksUnsafe = ({
  draftReply,
  reviewerDisplayName,
  comment,
} = {}) => {
  const text = String(draftReply ?? "");
  if (!text.trim()) return "empty_reply";
  if (INCENTIVE_OR_RATING_PATTERN.test(text)) return "incentive_or_rating_language";
  if (EMAIL_PATTERN.test(text) || PHONE_PATTERN.test(text)) return "contact_pii";
  const name = String(reviewerDisplayName ?? "").trim();
  if (name.length >= 3 && wordIncludes(text, name)) return "reviewer_name";
  if (hasText(comment) && hasLongVerbatimCopy(text, comment)) {
    return "verbatim_review_copy";
  }
  return null;
};

export const normalizeStarRating = (raw) => {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const n = Math.trunc(raw);
    return n >= 1 && n <= 5 ? n : null;
  }
  const text = String(raw).trim().toUpperCase();
  const named = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  if (named[text]) return named[text];
  if (/^[1-5]$/.test(text)) return Number(text);
  const asNumber = Number(text);
  if (Number.isFinite(asNumber)) {
    const n = Math.trunc(asNumber);
    return n >= 1 && n <= 5 ? n : null;
  }
  return null;
};

export const isPositiveStarRating = (raw) => {
  const stars = normalizeStarRating(raw);
  return stars === 4 || stars === 5;
};

export const naturalWorkPhrase = (matchedServices = []) => {
  const ids = matchedServices.map((service) => service.id).filter(Boolean);
  if (!ids.length) return null;
  if (ids.includes("svc.seasonal-cleanups")) return "yard cleanup";
  if (ids.length === 1) {
    return NATURAL_WORK_PHRASE[ids[0]] ?? null;
  }
  return null;
};

export const buildReviewReplyText = ({ matchedServices = [], starRating } = {}) => {
  if (!isPositiveStarRating(starRating)) return NEUTRAL_REPLY;
  const work = naturalWorkPhrase(matchedServices);
  if (!work) return POSITIVE_GENERIC_REPLY;
  return `Thank you for the kind review. We are glad the ${work} went smoothly. Please reach out if you need anything else.`;
};

export const buildReviewReplyDrafts = ({
  weekly,
  reviewsReport,
  facts,
} = {}) => {
  if (!weekly?.reviewOpportunity?.actionRecommended) return [];
  const reviews = Array.isArray(reviewsReport?.reviews) ? reviewsReport.reviews : null;
  if (!reviews) return [];

  const drafts = [];
  for (const review of reviews) {
    if (!review || review.hasOwnerReply) continue;
    const reviewId = hasText(review.reviewId) ? String(review.reviewId) : null;
    if (!reviewId) continue;

    const matchedServices = matchVerifiedServicesFromComment(
      review.comment,
      facts?.services ?? []
    );
    let draftReply = buildReviewReplyText({
      matchedServices,
      starRating: review.starRating,
    });
    const unsafe = draftReplyLooksUnsafe({
      draftReply,
      reviewerDisplayName: review.reviewerDisplayName,
      comment: review.comment,
    });
    if (unsafe) {
      draftReply = isPositiveStarRating(review.starRating)
        ? POSITIVE_GENERIC_REPLY
        : NEUTRAL_REPLY;
    }
    if (
      !isPositiveStarRating(review.starRating) &&
      POSITIVE_OUTCOME_PATTERN.test(draftReply)
    ) {
      draftReply = NEUTRAL_REPLY;
    }

    drafts.push({
      kind: "review_reply_draft",
      status: "draft",
      reviewId,
      starRating: review.starRating ?? null,
      draftReply,
      serviceRefs: matchedServices.map((service) => service.id),
      evidenceIds: matchedServices
        .map((service) => service.sourceReference)
        .filter(Boolean),
      requiresHumanReview: true,
      sendEligible: false,
    });
  }
  return drafts;
};

const verifiedById = (catalog, id) =>
  verifiedOnly(catalog).find((item) => item.id === id) ?? null;

export const renderGbpPostCandidate = ({
  serviceRefs = [],
  areaRefs = [],
  facts,
} = {}) => {
  const services = [];
  for (const id of serviceRefs) {
    const item = verifiedById(facts?.services, id);
    if (item) services.push(item);
  }
  const areas = [];
  for (const id of areaRefs) {
    const item = verifiedById(facts?.areas, id);
    if (item) areas.push(item);
  }
  if (!services.length) {
    return {
      ok: false,
      reason: "No verified serviceRefs remain after filtering candidates/rejected/unknown ids.",
    };
  }

  const serviceNames = services.map((item) => item.name);
  const areaNames = areas.map((item) => item.name);
  const servicePhrase =
    serviceNames.length === 1
      ? serviceNames[0]
      : `${serviceNames.slice(0, -1).join(", ")} and ${serviceNames.at(-1)}`;
  const summary = areaNames.length
    ? `${servicePhrase} around ${areaNames.join(" and ")} helps keep a residential property in practical shape. Send photos and your location for a quote.`
    : `${servicePhrase} is practical residential work we already do. Send photos for a practical quote.`;

  return {
    ok: true,
    draft: {
      summary,
      topicType: "STANDARD",
      languageCode: "en-US",
      contentIntent: "service",
      serviceRefs: services.map((item) => item.id),
      areaRefs: areas.map((item) => item.id),
      callToAction: {
        actionType: "LEARN_MORE",
        url: buildCanonicalGbpQuoteUrl({ campaign: "gbp_growth_ops" }),
      },
    },
  };
};

export const buildGbpPostDraft = ({
  weekly,
  facts,
  recentPosts = [],
  now = new Date(),
} = {}) => {
  const opportunity = weekly?.postOpportunity;
  if (!opportunity?.shouldDraft) return null;

  const rendered = renderGbpPostCandidate({
    serviceRefs: Array.isArray(opportunity.serviceRefs) ? opportunity.serviceRefs : [],
    areaRefs: Array.isArray(opportunity.areaRefs) ? opportunity.areaRefs : [],
    facts,
  });
  if (!rendered.ok) {
    return {
      kind: "gbp_post_draft",
      status: "invalid",
      reason: rendered.reason,
      requiresHumanReview: true,
      autoPublishEligible: false,
      publishEligible: false,
      validator: { valid: false, errors: [rendered.reason] },
    };
  }

  const validation = validateGbpPost({
    draft: rendered.draft,
    facts,
    recentPosts,
    now,
  });
  if (!validation.valid) {
    return {
      kind: "gbp_post_draft",
      status: "invalid",
      reason: "GBP validator rejected the candidate draft.",
      requiresHumanReview: true,
      autoPublishEligible: false,
      publishEligible: false,
      validator: {
        valid: false,
        errors: validation.errors ?? [],
      },
    };
  }

  return {
    kind: "gbp_post_draft",
    status: "review_ready",
    requiresHumanReview: true,
    autoPublishEligible: false,
    publishEligible: false,
    draft: rendered.draft,
    validator: {
      valid: true,
      errors: [],
      matchedFactIds: validation.matchedFactIds ?? [],
    },
  };
};

const sanitizeGa4Evidence = (evidence = []) =>
  (Array.isArray(evidence) ? evidence : [])
    .filter((row) => row && row.source === "ga4")
    .map((row) => ({
      source: "ga4",
      event: row.event ?? null,
      current7: row.current7 ?? null,
      prior7: row.prior7 ?? null,
      days28: row.days28 ?? null,
      comparable: row.comparable ?? null,
    }));

export const buildWebsiteOpportunity = ({ weekly } = {}) => {
  const actions = Array.isArray(weekly?.actions) ? weekly.actions : [];
  const action = actions.find((row) => WEBSITE_ACTION_TYPES.includes(row?.type));
  if (!action) return null;

  const isQuoteGap = action.id === "action.quote_funnel_gap";
  const submitEvidence = (action.evidence ?? []).find((row) => row?.event === "form_submit");
  const submitCount = submitEvidence?.current7;
  const stage =
    submitCount == null
      ? "submit_unavailable"
      : submitCount === 0
        ? "pre_submit"
        : "post_submit";

  const quoteHypotheses =
    stage === "post_submit"
      ? [
          "Successful server acceptance or generate_lead firing may be incomplete for some submits.",
          "Submit and lead events may fall in different comparison windows.",
          "Sample size may be too small for a firm conclusion.",
        ]
      : stage === "pre_submit"
        ? [
            "Visitors may leave before submitting, or continue via phone/SMS instead.",
            "quote_form_start can fire once per page load, so raw start counts may exceed unique sessions.",
            "UX friction before submit may interrupt completion.",
            "Sample size may be too small for a firm conclusion.",
          ]
        : [
            "form_submit evidence is incomplete, so start-vs-lead claims should stay withheld.",
            "Tracking or comparability limits may explain the observation.",
            "Sample size may be too small for a firm conclusion.",
          ];

  return {
    status: "review_recommended",
    actionId: action.id ?? null,
    title: action.title ?? "Website investigation",
    observation: isQuoteGap
      ? action.reason ??
        "GA4 recorded quote-form interaction activity. Raw event counts are not session-level funnel conversion data."
      : action.reason ?? action.title ?? "",
    evidence: sanitizeGa4Evidence(action.evidence),
    hypotheses: isQuoteGap
      ? quoteHypotheses
      : [
          "The weekly signal may reflect a real user-path issue.",
          "Tracking or comparability limits may explain the observation.",
          "Sample size may be too small for a firm conclusion.",
        ],
    suggestedInvestigation:
      action.recommendedNextStep ??
      "Human-review the existing page or form path. Do not change the website automatically.",
    suggestedSuccessMetric: action.targetKpi ?? "generate_lead",
    createsPullRequest: false,
    requiresHumanReview: true,
  };
};

const recentPostsFromReport = (postsReport) => {
  if (!postsReport) return [];
  if (Array.isArray(postsReport.localPosts)) return postsReport.localPosts;
  if (Array.isArray(postsReport.recentPosts)) return postsReport.recentPosts;
  return [];
};

export const buildDraftPacket = ({
  weekly,
  reviewsReport = null,
  postsReport = null,
  facts,
  now = new Date(),
  sourceWeeklyRun = null,
} = {}) => {
  const reviewReplyDrafts = buildReviewReplyDrafts({ weekly, reviewsReport, facts });
  const gbpPostDraft = buildGbpPostDraft({
    weekly,
    facts,
    recentPosts: recentPostsFromReport(postsReport),
    now,
  });
  const websiteOpportunity = buildWebsiteOpportunity({ weekly });

  return {
    mode: DRAFT_SAFETY.mode,
    generatedAt: now.toISOString(),
    sourceWeeklyRun: sourceWeeklyRun ?? {
      generatedAt: weekly?.generatedAt ?? null,
    },
    reviewReplyDrafts,
    gbpPostDraft,
    websiteOpportunity,
    safety: { ...DRAFT_SAFETY },
  };
};

const piiPatternsInText = (text) => {
  const value = String(text ?? "");
  if (EMAIL_PATTERN.test(value)) return true;
  if (PHONE_PATTERN.test(value)) return true;
  if (/\breviewerDisplayName\b/i.test(value)) return true;
  return false;
};

export const sanitizeDraftPacketForCi = (packet, env = process.env) => {
  const cleaned = stripSensitiveFields(packet ?? {});
  const replies = Array.isArray(cleaned.reviewReplyDrafts)
    ? cleaned.reviewReplyDrafts.map((row) => {
        const draftReply = redactCollectorText(String(row?.draftReply ?? ""), env);
        const safeReply = piiPatternsInText(draftReply) ? NEUTRAL_REPLY : draftReply;
        return {
          kind: "review_reply_draft",
          status: "draft",
          reviewId: row?.reviewId != null ? String(row.reviewId) : null,
          starRating: row?.starRating ?? null,
          draftReply: safeReply,
          serviceRefs: Array.isArray(row?.serviceRefs) ? row.serviceRefs.map(String) : [],
          evidenceIds: Array.isArray(row?.evidenceIds) ? row.evidenceIds.map(String) : [],
          requiresHumanReview: true,
          sendEligible: false,
        };
      })
    : [];

  let gbpPostDraft = cleaned.gbpPostDraft ?? null;
  if (gbpPostDraft && typeof gbpPostDraft === "object") {
    gbpPostDraft = {
      kind: "gbp_post_draft",
      status: gbpPostDraft.status === "review_ready" ? "review_ready" : "invalid",
      reason: gbpPostDraft.reason ?? null,
      requiresHumanReview: true,
      autoPublishEligible: false,
      publishEligible: false,
      draft: gbpPostDraft.status === "review_ready" ? gbpPostDraft.draft ?? null : null,
      validator: {
        valid: Boolean(gbpPostDraft.validator?.valid),
        errors: Array.isArray(gbpPostDraft.validator?.errors)
          ? gbpPostDraft.validator.errors.map(String)
          : [],
      },
    };
  }

  let websiteOpportunity = cleaned.websiteOpportunity ?? null;
  if (websiteOpportunity && typeof websiteOpportunity === "object") {
    websiteOpportunity = {
      status: "review_recommended",
      actionId: websiteOpportunity.actionId ?? null,
      title: websiteOpportunity.title ?? null,
      observation: websiteOpportunity.observation ?? "",
      evidence: sanitizeGa4Evidence(websiteOpportunity.evidence),
      hypotheses: Array.isArray(websiteOpportunity.hypotheses)
        ? websiteOpportunity.hypotheses.map(String)
        : [],
      suggestedInvestigation: websiteOpportunity.suggestedInvestigation ?? "",
      suggestedSuccessMetric: websiteOpportunity.suggestedSuccessMetric ?? null,
      createsPullRequest: false,
      requiresHumanReview: true,
    };
  }

  return {
    mode: DRAFT_SAFETY.mode,
    generatedAt: cleaned.generatedAt ?? new Date().toISOString(),
    sourceWeeklyRun: cleaned.sourceWeeklyRun ?? null,
    reviewReplyDrafts: replies,
    gbpPostDraft,
    websiteOpportunity,
    safety: { ...DRAFT_SAFETY },
  };
};

export const formatDraftsJobSummaryMarkdown = (packet) => {
  const replies = packet?.reviewReplyDrafts?.length ?? 0;
  const gbp = packet?.gbpPostDraft;
  const gbpLine = !gbp
    ? "none — opportunity gate false"
    : gbp.status === "review_ready"
      ? "1 candidate (validator PASS, human review required)"
      : "none — candidate invalid / validator FAIL";
  const website = packet?.websiteOpportunity?.title
    ? packet.websiteOpportunity.title
    : "none";
  const lines = [
    "## Human-review drafts",
    `- Review replies: ${replies}`,
    `- GBP post draft: ${gbpLine}`,
    `- Website opportunity: ${website}`,
    "- Requires human review: yes",
    "- Auto publish/send: no",
    "",
  ];
  return `${lines.join("\n")}\n`;
};

export const formatDraftsMarkdown = (packet) => {
  const lines = [
    "# Maestro Growth Ops — human-review drafts",
    "",
    `Generated: ${packet.generatedAt}`,
    `Mode: ${packet.mode}`,
    "",
    "## Safety",
    `- publishes: ${packet.safety?.publishes}`,
    `- repliesToReviews: ${packet.safety?.repliesToReviews}`,
    `- mutatesGoogle: ${packet.safety?.mutatesGoogle}`,
    `- deploys: ${packet.safety?.deploys}`,
    `- createsPullRequests: ${packet.safety?.createsPullRequests}`,
    `- requiresHumanReview: ${packet.safety?.requiresHumanReview}`,
    `- autoPublishEligible: ${packet.safety?.autoPublishEligible}`,
    "",
    formatDraftsJobSummaryMarkdown(packet).trim(),
    "",
    "## Review reply drafts",
  ];
  const replies = packet.reviewReplyDrafts ?? [];
  if (!replies.length) {
    lines.push("- None.");
  } else {
    for (const row of replies) {
      lines.push(`- reviewId: ${row.reviewId}`);
      lines.push(`  - starRating: ${row.starRating ?? "(none)"}`);
      lines.push(`  - sendEligible: false`);
      lines.push(`  - serviceRefs: ${(row.serviceRefs ?? []).join(", ") || "(none)"}`);
      lines.push(`  - draftReply: ${row.draftReply}`);
    }
  }
  lines.push("");
  lines.push("## GBP post draft");
  if (!packet.gbpPostDraft) {
    lines.push("- null (shouldDraft=false or abstention).");
  } else if (packet.gbpPostDraft.status !== "review_ready") {
    lines.push(`- status: ${packet.gbpPostDraft.status}`);
    lines.push(`- reason: ${packet.gbpPostDraft.reason ?? ""}`);
  } else {
    lines.push("- status: review_ready");
    lines.push(`- serviceRefs: ${(packet.gbpPostDraft.draft?.serviceRefs ?? []).join(", ")}`);
    lines.push(`- areaRefs: ${(packet.gbpPostDraft.draft?.areaRefs ?? []).join(", ")}`);
    lines.push(`- summary: ${packet.gbpPostDraft.draft?.summary ?? ""}`);
  }
  lines.push("");
  lines.push("## Website opportunity");
  if (!packet.websiteOpportunity) {
    lines.push("- None.");
  } else {
    const site = packet.websiteOpportunity;
    lines.push(`- status: ${site.status}`);
    lines.push(`- title: ${site.title}`);
    lines.push(`- observation: ${site.observation}`);
    lines.push("- hypotheses (not conclusions):");
    for (const item of site.hypotheses ?? []) {
      lines.push(`  - ${item}`);
    }
    lines.push(`- suggestedInvestigation: ${site.suggestedInvestigation}`);
    lines.push(`- createsPullRequest: false`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};
