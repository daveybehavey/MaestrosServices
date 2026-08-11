/**
 * Deterministic GBP STANDARD post validator.
 * Fail closed on unverified / ambiguous claims. Never publishes.
 *
 * Sensitive claims require explicit evidence references on the draft.
 * Unrelated verified facts in the same broad category never authorize a claim.
 */

import { validateGbpCtaUrl } from "./growth-cta.mjs";
import { findDuplicateMatch, normalizePostText } from "./growth-duplicate.mjs";

const compilePatterns = (patterns = []) =>
  patterns.map((source) => new RegExp(source, "i"));

const matchesAny = (text, regexes) => {
  for (const regex of regexes) {
    if (regex.test(text)) return regex;
  }
  return null;
};

const todayIso = (now) => now.toISOString().slice(0, 10);

const emptyAudit = () => ({
  requestedEvidenceIds: [],
  matchedEvidenceIds: [],
  rejectedEvidence: [],
  unsupportedClaims: [],
  evidenceBindings: [],
  failClosed: true,
  publishes: false,
  contactsGoogle: false,
});

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

const indexEvidence = (facts) => {
  const byId = new Map();
  for (const fact of facts.businessFacts ?? []) {
    if (fact?.id) byId.set(fact.id, { ...fact, _source: "businessFacts" });
  }
  for (const project of facts.projects ?? []) {
    if (project?.id) byId.set(project.id, { ...project, _source: "projects" });
  }
  return byId;
};

const pushUnique = (list, value) => {
  if (value == null || value === "") return;
  if (!list.includes(value)) list.push(value);
};

const collectRequestedIds = (draft) => {
  const ids = [];
  for (const id of draft.claimRefs ?? []) pushUnique(ids, id);
  pushUnique(ids, draft.offerRef);
  pushUnique(ids, draft.availabilityRef);
  pushUnique(ids, draft.projectRef);
  pushUnique(ids, draft.testimonialRef);
  return ids;
};

const isExpired = (record, now) => {
  const today = todayIso(now);
  if (record.validUntil && record.validUntil < today) return true;
  if (record.validFrom && record.validFrom > today) return true;
  return false;
};

const resolveEvidence = ({
  id,
  evidenceById,
  audit,
  errors,
  expectedKinds = null,
  bindingRole,
}) => {
  audit.requestedEvidenceIds.push(id);

  if (!id || typeof id !== "string") {
    const reason = "missing_evidence_id";
    audit.rejectedEvidence.push({ id: id ?? null, reason, bindingRole });
    errors.push(`Evidence reference is required for ${bindingRole}.`);
    return null;
  }

  const record = evidenceById.get(id);
  if (!record) {
    audit.rejectedEvidence.push({ id, reason: "unknown_evidence_id", bindingRole });
    audit.unsupportedClaims.push({
      claim: bindingRole,
      reason: "unknown_evidence_id",
      evidenceId: id,
    });
    errors.push(`Unknown evidence id "${id}" for ${bindingRole}.`);
    return null;
  }

  if (record.status !== "verified") {
    audit.rejectedEvidence.push({
      id,
      reason: `status:${record.status ?? "missing"}`,
      bindingRole,
      kind: record.kind ?? null,
    });
    audit.unsupportedClaims.push({
      claim: bindingRole,
      reason: "evidence_not_verified",
      evidenceId: id,
    });
    errors.push(
      `Evidence "${id}" is not verified (status=${record.status ?? "missing"}) for ${bindingRole}.`
    );
    return null;
  }

  if (expectedKinds && !expectedKinds.includes(record.kind)) {
    audit.rejectedEvidence.push({
      id,
      reason: "kind_mismatch",
      bindingRole,
      kind: record.kind ?? null,
      expectedKinds,
    });
    audit.unsupportedClaims.push({
      claim: bindingRole,
      reason: "kind_mismatch",
      evidenceId: id,
    });
    errors.push(
      `Evidence "${id}" kind "${record.kind}" does not match required kinds [${expectedKinds.join(", ")}] for ${bindingRole}.`
    );
    return null;
  }

  return record;
};

const markMatched = (audit, record, bindingRole, detail = {}) => {
  pushUnique(audit.matchedEvidenceIds, record.id);
  audit.evidenceBindings.push({
    role: bindingRole,
    evidenceId: record.id,
    kind: record.kind ?? null,
    ...detail,
  });
};

const extractDollarAmounts = (text) => {
  const amounts = [];
  const re = /\$\s?(\d+(?:\.\d{1,2})?)/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    amounts.push(Number(match[1]));
  }
  return amounts;
};

const extractDiscountPercents = (text) => {
  const percents = [];
  const re = /\b(\d+)\s?%\s?(?:off|discount)\b/gi;
  let match;
  while ((match = re.exec(text)) !== null) {
    percents.push(Number(match[1]));
  }
  return percents;
};

const detectCredentialClaims = (summary) => {
  const claims = [];
  if (/\blicensed\b/i.test(summary)) claims.push({ type: "licensed", label: "licensed" });
  if (/\binsured\b/i.test(summary)) claims.push({ type: "insured", label: "insured" });
  if (/\bbonded\b/i.test(summary)) claims.push({ type: "bonded", label: "bonded" });
  if (/\bcertified\b/i.test(summary)) claims.push({ type: "certified", label: "certified" });
  if (/\bguaranteed?\b/i.test(summary) || /\bwarrant(y|ies)\b/i.test(summary)) {
    claims.push({ type: "guarantee", label: "guarantee/warranty" });
  }
  if (/\b(best|cheapest|#1|number one|top[- ]rated)\b/i.test(summary)) {
    claims.push({ type: "superlative", label: "superlative" });
  }
  const years = summary.match(/\b(\d+)\+?\s*years?(?:\s+of)?\s+(experience|service)\b/i);
  if (years) {
    claims.push({
      type: "experience",
      label: `${years[1]} years experience`,
      years: Number(years[1]),
    });
  }
  if (/\byears?\s+in\s+business\b/i.test(summary)) {
    claims.push({ type: "experience", label: "years in business" });
  }
  return claims;
};

const claimTypeOf = (record) =>
  record.claimType || record.credentialType || record.value || null;

const supportsCredentialClaim = (record, claim) => {
  if (claim.type === "guarantee") {
    return record.kind === "guarantee" || claimTypeOf(record) === "guarantee";
  }
  if (claim.type === "superlative") {
    return (
      record.kind === "superlative" &&
      (record.claimType === "superlative" ||
        ["best", "cheapest", "#1", "number_one", "top_rated"].includes(
          String(record.claimType || "").toLowerCase()
        ))
    );
  }
  if (claim.type === "experience") {
    if (record.kind !== "experience" && record.kind !== "years_experience") return false;
    if (claim.years != null) {
      const allowed =
        record.years ??
        record.valueYears ??
        (typeof record.value === "number" ? record.value : null);
      return allowed != null && Number(allowed) === Number(claim.years);
    }
    return true;
  }
  // licensed / insured / bonded / certified
  if (record.kind !== "credential" && record.kind !== "claim") return false;
  // Generic kind=claim without matching claimType must NOT authorize.
  const ctype = String(claimTypeOf(record) || "").toLowerCase();
  return ctype === claim.type;
};

const projectLanguageDetected = (summary) =>
  /\b(we just (finished|completed)|recent (job|project)|this (homeowner|customer)'s|last week we)\b/i.test(
    summary
  );

const quoteAppearsInSummary = (summary, quote) => {
  if (!quote || typeof quote !== "string") return false;
  const normSummary = normalizePostText(summary);
  const normQuote = normalizePostText(quote);
  if (!normQuote || normQuote.length < 8) return false;
  return normSummary.includes(normQuote);
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
  const audit = emptyAudit();
  audit.checkedAt = now.toISOString();

  const failEarly = (message) => ({
    valid: false,
    errors: [message],
    warnings,
    matchedFactIds,
    duplicateScore: 0,
    duplicateMatch: null,
    normalizedCta: null,
    audit: {
      ...audit,
      failClosed: true,
    },
  });

  if (!facts || !facts.rules) {
    return failEarly("Growth facts/rules are required.");
  }

  if (draft == null || typeof draft !== "object" || Array.isArray(draft)) {
    return failEarly("Draft post must be an object.");
  }

  const rules = facts.rules;
  const summary = typeof draft.summary === "string" ? draft.summary.trim() : "";
  const minChars = rules.summaryMinChars ?? 20;
  const maxChars = rules.summaryMaxChars ?? 1500;
  const evidenceById = indexEvidence(facts);
  const requested = collectRequestedIds(draft);
  audit.requestedEvidenceIds = [...requested];

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

  for (const fact of facts.businessFacts ?? []) {
    if (fact.kind === "phone" && fact.value && summary.includes(String(fact.value))) {
      errors.push("Post body must not contain the business phone number.");
      break;
    }
  }

  // --- Price / discount binding ---
  const pricePatterns = compilePatterns(rules.forbiddenBodyPatterns?.priceOrDiscount ?? []);
  const hasPriceLanguage = Boolean(summary && matchesAny(summary, pricePatterns));
  if (hasPriceLanguage) {
    if (!draft.offerRef) {
      audit.unsupportedClaims.push({
        claim: "price_or_discount",
        reason: "missing_offerRef",
      });
      errors.push(
        "Price/discount language requires an explicit offerRef to verified pricing/offer evidence."
      );
    } else {
      const offer = resolveEvidence({
        id: draft.offerRef,
        evidenceById,
        audit,
        errors,
        expectedKinds: ["price", "discount", "offer"],
        bindingRole: "offer",
      });
      if (offer) {
        if (isExpired(offer, now)) {
          audit.rejectedEvidence.push({
            id: offer.id,
            reason: "expired_or_not_yet_valid",
            bindingRole: "offer",
          });
          errors.push(`Offer evidence "${offer.id}" is expired or not yet valid.`);
        } else {
          const claimedDollars = extractDollarAmounts(summary);
          const claimedPercents = extractDiscountPercents(summary);
          const structuredAmount =
            draft.claimedPrice?.amount ?? draft.claimedOffer?.amount ?? null;
          const structuredPercent =
            draft.claimedDiscount?.percent ?? draft.claimedOffer?.percent ?? null;

          const evidenceAmounts = [
            offer.amount,
            ...(Array.isArray(offer.allowedAmounts) ? offer.allowedAmounts : []),
          ]
            .filter((n) => n != null)
            .map(Number);

          const evidencePercents = [
            offer.percent,
            ...(Array.isArray(offer.allowedPercents) ? offer.allowedPercents : []),
          ]
            .filter((n) => n != null)
            .map(Number);

          let bindingOk = true;

          if (claimedDollars.length || structuredAmount != null) {
            const toCheck = [
              ...claimedDollars,
              ...(structuredAmount != null ? [Number(structuredAmount)] : []),
            ];
            if (!evidenceAmounts.length) {
              bindingOk = false;
              errors.push(
                `Offer evidence "${offer.id}" does not authorize dollar amounts, but the draft claims one.`
              );
            } else {
              for (const amount of toCheck) {
                if (!evidenceAmounts.includes(amount)) {
                  bindingOk = false;
                  errors.push(
                    `Claimed amount $${amount} does not match offer evidence "${offer.id}" (authorized: ${evidenceAmounts.map((a) => `$${a}`).join(", ")}).`
                  );
                }
              }
            }
          }

          if (claimedPercents.length || structuredPercent != null) {
            const toCheck = [
              ...claimedPercents,
              ...(structuredPercent != null ? [Number(structuredPercent)] : []),
            ];
            if (!evidencePercents.length) {
              bindingOk = false;
              errors.push(
                `Offer evidence "${offer.id}" does not authorize percent discounts, but the draft claims one.`
              );
            } else {
              for (const pct of toCheck) {
                if (!evidencePercents.includes(pct)) {
                  bindingOk = false;
                  errors.push(
                    `Claimed discount ${pct}% does not match offer evidence "${offer.id}" (authorized: ${evidencePercents.map((p) => `${p}%`).join(", ")}).`
                  );
                }
              }
            }
          }

          if (
            /\b(coupon|special offer|limited.time offer)\b/i.test(summary) &&
            offer.couponText
          ) {
            if (!summary.toLowerCase().includes(String(offer.couponText).toLowerCase())) {
              bindingOk = false;
              errors.push(
                `Coupon/offer text must match evidence "${offer.id}" couponText exactly.`
              );
            }
          }

          if (bindingOk) {
            markMatched(audit, offer, "offer", {
              amounts: claimedDollars,
              percents: claimedPercents,
            });
            pushUnique(matchedFactIds, offer.id);
          }
        }
      }
    }
  } else if (draft.offerRef) {
    warnings.push("offerRef present but no price/discount language detected in summary.");
  }

  // --- Availability binding ---
  const availabilityPatterns = compilePatterns(
    rules.forbiddenBodyPatterns?.availability ?? []
  );
  const hasAvailabilityLanguage = Boolean(
    summary && matchesAny(summary, availabilityPatterns)
  );
  if (hasAvailabilityLanguage) {
    if (!draft.availabilityRef) {
      audit.unsupportedClaims.push({
        claim: "availability",
        reason: "missing_availabilityRef",
      });
      errors.push(
        "Availability/openings language requires an explicit availabilityRef to a verified availability record."
      );
    } else {
      const availability = resolveEvidence({
        id: draft.availabilityRef,
        evidenceById,
        audit,
        errors,
        expectedKinds: ["availability"],
        bindingRole: "availability",
      });
      if (availability) {
        if (isExpired(availability, now)) {
          audit.rejectedEvidence.push({
            id: availability.id,
            reason: "expired_or_not_yet_valid",
            bindingRole: "availability",
          });
          errors.push(
            `Availability evidence "${availability.id}" is expired or not yet valid.`
          );
        } else {
          let bindingOk = true;
          const claimKey =
            draft.claimedAvailability?.key ||
            draft.availabilityClaimKey ||
            null;
          const allowedKeys = availability.allowedClaimKeys || availability.claimKeys;
          if (allowedKeys?.length) {
            if (!claimKey) {
              bindingOk = false;
              audit.unsupportedClaims.push({
                claim: "availability",
                reason: "missing_structured_availability_key",
                evidenceId: availability.id,
              });
              errors.push(
                `Availability evidence "${availability.id}" requires draft.claimedAvailability.key matching allowedClaimKeys (fail closed; no NL guesswork).`
              );
            } else if (!allowedKeys.includes(claimKey)) {
              bindingOk = false;
              errors.push(
                `Availability claim key "${claimKey}" is not authorized by evidence "${availability.id}".`
              );
            }
          }

          const mentionedServices = collectMentions(summary, facts.services ?? []).matched;
          if (availability.serviceIds?.length) {
            for (const service of mentionedServices) {
              if (!availability.serviceIds.includes(service.id)) {
                bindingOk = false;
                errors.push(
                  `Availability evidence "${availability.id}" does not cover service "${service.id}".`
                );
              }
            }
          }

          const mentionedAreas = collectMentions(summary, facts.areas ?? []).matched;
          if (availability.areaIds?.length) {
            for (const area of mentionedAreas) {
              if (!availability.areaIds.includes(area.id)) {
                bindingOk = false;
                errors.push(
                  `Availability evidence "${availability.id}" does not cover area "${area.id}".`
                );
              }
            }
          }

          if (bindingOk) {
            markMatched(audit, availability, "availability", {
              claimKey: claimKey ?? null,
            });
            pushUnique(matchedFactIds, availability.id);
          }
        }
      }
    }
  } else if (draft.availabilityRef) {
    warnings.push(
      "availabilityRef present but no availability language detected in summary."
    );
  }

  // --- Credential / guarantee / superlative / experience binding ---
  const credentialClaims = summary ? detectCredentialClaims(summary) : [];
  if (credentialClaims.length) {
    const claimRefs = Array.isArray(draft.claimRefs) ? draft.claimRefs : [];
    if (claimRefs.length === 0) {
      for (const claim of credentialClaims) {
        audit.unsupportedClaims.push({
          claim: claim.label,
          reason: "missing_claimRefs",
        });
      }
      errors.push(
        "Credential, guarantee, experience, or superlative language requires explicit claimRefs to matching verified evidence."
      );
    } else {
      const resolvedClaims = [];
      for (const refId of claimRefs) {
        const record = resolveEvidence({
          id: refId,
          evidenceById,
          audit,
          errors,
          expectedKinds: [
            "credential",
            "guarantee",
            "experience",
            "years_experience",
            "superlative",
            "claim",
          ],
          bindingRole: "claim",
        });
        if (record) {
          if (isExpired(record, now)) {
            audit.rejectedEvidence.push({
              id: record.id,
              reason: "expired_or_not_yet_valid",
              bindingRole: "claim",
            });
            errors.push(`Claim evidence "${record.id}" is expired or not yet valid.`);
          } else {
            resolvedClaims.push(record);
          }
        }
      }

      for (const claim of credentialClaims) {
        const supporter = resolvedClaims.find((record) =>
          supportsCredentialClaim(record, claim)
        );
        if (!supporter) {
          audit.unsupportedClaims.push({
            claim: claim.label,
            reason: "no_matching_claim_evidence",
            claimRefs,
          });
          errors.push(
            `Sensitive claim "${claim.label}" is not supported by the referenced claimRefs (unrelated verified claims do not authorize it).`
          );
        } else {
          markMatched(audit, supporter, "claim", { claimType: claim.type });
          pushUnique(matchedFactIds, supporter.id);
        }
      }
    }
  }

  // --- Testimonial / review binding ---
  const testimonialPatterns = compilePatterns(
    rules.forbiddenBodyPatterns?.testimonialLanguage ?? []
  );
  const hasTestimonialLanguage = Boolean(
    summary && matchesAny(summary, testimonialPatterns)
  );
  if (hasTestimonialLanguage) {
    if (!draft.testimonialRef) {
      audit.unsupportedClaims.push({
        claim: "testimonial",
        reason: "missing_testimonialRef",
      });
      errors.push(
        "Testimonial/review language requires an explicit testimonialRef to verified approved quote evidence."
      );
    } else {
      const testimonial = resolveEvidence({
        id: draft.testimonialRef,
        evidenceById,
        audit,
        errors,
        expectedKinds: ["testimonial", "review_quote"],
        bindingRole: "testimonial",
      });
      if (testimonial) {
        if (testimonial.permissionGranted !== true && testimonial.publicSource !== true) {
          audit.rejectedEvidence.push({
            id: testimonial.id,
            reason: "permission_or_public_source_required",
            bindingRole: "testimonial",
          });
          errors.push(
            `Testimonial evidence "${testimonial.id}" requires permissionGranted or publicSource.`
          );
        } else {
          const approved = [
            testimonial.quote,
            testimonial.approvedText,
            ...(Array.isArray(testimonial.approvedQuotes)
              ? testimonial.approvedQuotes
              : []),
          ].filter(Boolean);

          if (!approved.length) {
            errors.push(
              `Testimonial evidence "${testimonial.id}" has no approved quote text.`
            );
          } else {
            const matchedQuote = approved.find((quote) =>
              quoteAppearsInSummary(summary, quote)
            );
            if (!matchedQuote) {
              audit.unsupportedClaims.push({
                claim: "testimonial",
                reason: "quote_mismatch",
                evidenceId: testimonial.id,
              });
              errors.push(
                `Draft testimonial wording does not match approved quote text on evidence "${testimonial.id}" (exact/approved text required).`
              );
            } else {
              markMatched(audit, testimonial, "testimonial", {
                matchedQuote: matchedQuote.slice(0, 80),
              });
              pushUnique(matchedFactIds, testimonial.id);
            }
          }
        }
      }
    }
  } else if (draft.testimonialRef) {
    warnings.push(
      "testimonialRef present but no testimonial language detected in summary."
    );
  }

  // --- Service / area mentions ---
  const serviceMentions = collectMentions(summary, facts.services ?? [], {
    requireVerified: true,
  });
  for (const blocked of serviceMentions.blocked) {
    errors.push(
      `Service mention "${blocked.item.name}" is not verified for automation (${blocked.reason}).`
    );
  }
  for (const service of serviceMentions.matched) {
    pushUnique(matchedFactIds, service.id);
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
    pushUnique(matchedFactIds, area.id);
  }

  // --- Project binding ---
  const hasProjectLanguage = projectLanguageDetected(summary);
  if (hasProjectLanguage) {
    if (!draft.projectRef) {
      audit.unsupportedClaims.push({
        claim: "project",
        reason: "missing_projectRef",
      });
      errors.push(
        "Project/job-specific claims require an explicit projectRef to a verified project evidence record."
      );
    } else {
      const project = resolveEvidence({
        id: draft.projectRef,
        evidenceById,
        audit,
        errors,
        expectedKinds: null,
        bindingRole: "project",
      });
      if (project) {
        let bindingOk = true;
        if (project._source !== "projects" && project.kind && project.kind !== "project") {
          bindingOk = false;
          audit.rejectedEvidence.push({
            id: project.id,
            reason: "not_a_project_record",
            bindingRole: "project",
          });
          errors.push(`Evidence "${project.id}" is not a project record.`);
        } else if (project.permissionGranted !== true) {
          bindingOk = false;
          audit.rejectedEvidence.push({
            id: project.id,
            reason: "permissionGranted_required",
            bindingRole: "project",
          });
          errors.push(
            `Project evidence "${project.id}" requires permissionGranted=true for publication claims.`
          );
        } else {
          const mentionedServices = serviceMentions.matched.map((s) => s.id);
          const mentionedAreas = areaMentions.matched.map((a) => a.id);
          const projectServices = project.serviceIds ?? [];
          const projectAreas = project.areaIds ?? [];

          for (const serviceId of mentionedServices) {
            if (projectServices.length && !projectServices.includes(serviceId)) {
              bindingOk = false;
              errors.push(
                `Project "${project.id}" does not include mentioned service "${serviceId}".`
              );
            }
          }
          for (const areaId of mentionedAreas) {
            if (projectAreas.length && !projectAreas.includes(areaId)) {
              bindingOk = false;
              errors.push(
                `Project "${project.id}" does not include mentioned area "${areaId}".`
              );
            }
          }

          if (Array.isArray(project.outcomes) && project.outcomes.length) {
            const claimed = draft.claimedOutcomes;
            if (Array.isArray(claimed)) {
              for (const outcome of claimed) {
                if (!project.outcomes.includes(outcome)) {
                  bindingOk = false;
                  errors.push(
                    `Claimed outcome "${outcome}" is not supported by project "${project.id}".`
                  );
                }
              }
            }
          }

          if (bindingOk) {
            markMatched(audit, project, "project", {
              serviceIds: projectServices,
              areaIds: projectAreas,
            });
            pushUnique(matchedFactIds, project.id);
          }
        }
      }
    }
  } else if (draft.projectRef) {
    warnings.push("projectRef present but no project/job-specific language detected.");
  }

  // Reject dangling sensitive refs that were never requested for a language trigger? Not needed.

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

  // Deduplicate requested ids that resolveEvidence may have re-pushed
  audit.requestedEvidenceIds = [...new Set(audit.requestedEvidenceIds.filter(Boolean))];
  audit.matchedEvidenceIds = [...new Set(audit.matchedEvidenceIds)];
  audit.topicType = topicType;
  audit.actionType = actionType;
  audit.summaryLength = summary.length;

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
    audit,
  };
};

// Exported for unit tests of helpers.
export const __test__ = {
  extractDollarAmounts,
  extractDiscountPercents,
  detectCredentialClaims,
  supportsCredentialClaim,
  indexEvidence,
};
