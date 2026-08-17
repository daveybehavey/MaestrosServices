/**
 * Lead Ops v1: read-only, evidence-based lead opportunity discovery and ranking.
 * Reuses Growth Ops weekly fail-closed inputs and review opportunity helpers.
 * Never contacts prospects, mutates Google, publishes, creates ads/pages, or deploys.
 */

import { findByStatus, verifiedOnly } from "./growth-facts.mjs";
import {
  QUOTE_FUNNEL_CAVEAT,
  buildPostOpportunity,
  buildReviewOpportunity,
  buildWeeklyIntelligence,
  computeGa4LeadKpis,
  diagnoseQuoteFunnel,
} from "./growth-weekly.mjs";

export const LEAD_OPS_SAFETY = Object.freeze({
  mode: "lead_ops",
  contactsProspects: false,
  sendsEmail: false,
  sendsSms: false,
  publishes: false,
  mutatesGoogle: false,
  createsAds: false,
  createsSeoPages: false,
  deploys: false,
  requiresHumanReview: true,
  executionEligible: false,
});

export const OPPORTUNITY_TYPES = Object.freeze([
  "organic_search_demand",
  "gbp_search_demand",
  "conversion_improvement",
  "review_reputation",
  "content_evidence_gap",
  "seasonal_service_opportunity",
]);

const PRIORITY_WEIGHT = Object.freeze({ high: 3, medium: 2, low: 1 });
const CONFIDENCE_WEIGHT = Object.freeze({ high: 3, medium: 2, low: 1 });

/**
 * Deterministic ranking (no AI scores):
 * 1) priority label (high > medium > low)
 * 2) confidence label (high > medium > low)
 * 3) numeric impact (documented per opportunity builder)
 * 4) stable id ascending
 *
 * Impact policy (higher = more lead/growth actionable):
 * - unreplied reviews / lead decline: 85–90
 * - quote-funnel diagnostic (non-tiny): 70
 * - GBP demand with verified service: 68
 * - organic query with verified serviceRefs: 66
 * - organic page weak-CTR (no service map): 62
 * - evidence gap with demand: 60
 * - seasonal verified: 55
 * - evidence gap without demand / thin review volume: 35–40
 * - seasonal research_required: 25 (never a topAction)
 */
export const LEAD_OPS_RANKING_RULES = Object.freeze({
  order: ["priority", "confidence", "impact", "id"],
  impact: Object.freeze({
    reviewUnreplied: 85,
    leadDecline: 90,
    quoteFunnelDiagnostic: 70,
    gbpDemand: 68,
    organicQueryVerified: 66,
    organicPageWeakCtr: 62,
    evidenceGapWithDemand: 60,
    seasonalVerified: 55,
    evidenceGapNoDemand: 40,
    reviewVolumeThin: 35,
    seasonalResearch: 25,
  }),
});

/** GSC thresholds reused from weekly engine semantics (impressions floor + CTR ceiling). */
export const LEAD_OPS_GSC_MIN_PAGE_IMPRESSIONS = 25;
export const LEAD_OPS_GSC_MIN_QUERY_IMPRESSIONS = 30;
export const LEAD_OPS_GSC_LOW_CTR = 0.02;

/** Deterministic seasonal themes by UTC month (1-12). Catalog status still governs marketability. */
export const SEASONAL_THEMES_BY_MONTH = Object.freeze({
  1: [
    {
      themeId: "winter.cleanup_care",
      title: "Winter exterior property care",
      catalogServiceIds: ["svc.seasonal-cleanups", "svc.moss-algae-treatment"],
      researchTopics: ["snow clearing", "ice salting / de-icing"],
    },
    {
      themeId: "winter.driveway_drainage",
      title: "Winter driveway and drainage readiness",
      catalogServiceIds: ["svc.gravel-driveway-installation", "svc.driveway-grading"],
      researchTopics: [],
    },
  ],
  2: [
    {
      themeId: "winter.cleanup_care",
      title: "Late-winter exterior cleanup",
      catalogServiceIds: ["svc.seasonal-cleanups", "svc.moss-algae-treatment"],
      researchTopics: ["snow clearing", "ice salting / de-icing"],
    },
  ],
  3: [
    {
      themeId: "spring.landscaping",
      title: "Early-spring landscaping demand window",
      catalogServiceIds: [
        "svc.lawn-mowing",
        "svc.hedge-trimming",
        "svc.garden-bed-maintenance",
        "svc.seasonal-cleanups",
      ],
      researchTopics: [],
    },
  ],
  4: [
    {
      themeId: "spring.landscaping",
      title: "Spring landscaping and cleanup",
      catalogServiceIds: [
        "svc.lawn-mowing",
        "svc.hedge-trimming",
        "svc.garden-bed-maintenance",
        "svc.seasonal-cleanups",
        "svc.power-washing",
      ],
      researchTopics: [],
    },
  ],
  5: [
    {
      themeId: "summer.landscaping",
      title: "Late-spring / early-summer outdoor services",
      catalogServiceIds: [
        "svc.lawn-mowing",
        "svc.hedge-trimming",
        "svc.garden-bed-maintenance",
        "svc.power-washing",
        "svc.gravel-driveway-installation",
      ],
      researchTopics: [],
    },
  ],
  6: [
    {
      themeId: "summer.landscaping",
      title: "Summer landscaping and exterior cleaning",
      catalogServiceIds: [
        "svc.lawn-mowing",
        "svc.hedge-trimming",
        "svc.garden-bed-maintenance",
        "svc.power-washing",
        "svc.driveway-grading",
        "svc.gravel-driveway-installation",
      ],
      researchTopics: [],
    },
  ],
  7: [
    {
      themeId: "summer.landscaping",
      title: "Peak summer landscaping and power washing",
      catalogServiceIds: [
        "svc.lawn-mowing",
        "svc.hedge-trimming",
        "svc.garden-bed-maintenance",
        "svc.power-washing",
        "svc.seasonal-cleanups",
      ],
      researchTopics: [],
    },
  ],
  8: [
    {
      themeId: "summer.early_fall",
      title: "Late-summer / early-fall outdoor services",
      catalogServiceIds: [
        "svc.lawn-mowing",
        "svc.hedge-trimming",
        "svc.garden-bed-maintenance",
        "svc.power-washing",
        "svc.gravel-driveway-installation",
        "svc.seasonal-cleanups",
      ],
      researchTopics: [],
    },
  ],
  9: [
    {
      themeId: "summer.early_fall",
      title: "Early-fall cleanup and exterior work",
      catalogServiceIds: [
        "svc.seasonal-cleanups",
        "svc.lawn-mowing",
        "svc.hedge-trimming",
        "svc.power-washing",
        "svc.driveway-grading",
      ],
      researchTopics: ["leaf/debris cleanup", "storm cleanup"],
    },
  ],
  10: [
    {
      themeId: "fall.cleanup",
      title: "Fall cleanup and property readiness",
      catalogServiceIds: [
        "svc.seasonal-cleanups",
        "svc.fence-work-minor-repairs",
        "svc.gravel-driveway-installation",
        "svc.driveway-grading",
      ],
      researchTopics: ["leaf/debris cleanup", "storm cleanup"],
    },
  ],
  11: [
    {
      themeId: "fall.cleanup",
      title: "Late-fall cleanup and driveway care",
      catalogServiceIds: [
        "svc.seasonal-cleanups",
        "svc.moss-algae-treatment",
        "svc.gravel-driveway-installation",
        "svc.fence-work-minor-repairs",
      ],
      researchTopics: ["snow clearing", "ice salting / de-icing"],
    },
  ],
  12: [
    {
      themeId: "winter.cleanup_care",
      title: "Winter exterior readiness themes",
      catalogServiceIds: ["svc.seasonal-cleanups", "svc.moss-algae-treatment"],
      researchTopics: ["snow clearing", "ice salting / de-icing"],
    },
  ],
});

const EVIDENCE_GAP_PRIORITY_SERVICES = Object.freeze([
  "svc.power-washing",
  "svc.gravel-driveway-installation",
  "svc.driveway-grading",
  "svc.seasonal-cleanups",
  "svc.lawn-mowing",
]);

const makeOpportunity = ({
  id,
  type,
  title,
  priority,
  confidence,
  rationale,
  evidence,
  serviceRefs = [],
  areaRefs = [],
  recommendedAction,
  status = "recommended",
  impact = 50,
}) => {
  if (!OPPORTUNITY_TYPES.includes(type)) {
    throw new Error(`Unknown Lead Ops opportunity type: ${type}`);
  }
  return {
    id,
    type,
    title,
    priority,
    confidence,
    rationale,
    evidence: Array.isArray(evidence) ? evidence : [],
    serviceRefs: [...new Set(serviceRefs.filter(Boolean))],
    areaRefs: [...new Set(areaRefs.filter(Boolean))],
    recommendedAction,
    status,
    requiresHumanReview: true,
    executionEligible: false,
    _impact: impact,
  };
};

const serviceById = (services = [], id) => services.find((s) => s?.id === id) ?? null;

const onlyVerifiedRefs = (refs = [], catalogItems = []) =>
  refs.filter((id) => catalogItems.some((item) => item.id === id && item.status === "verified"));

const stripInternal = (row) => {
  const { _impact, ...rest } = row;
  return rest;
};

const rankOpportunities = (opportunities) =>
  [...opportunities].sort((a, b) => {
    const pw = (PRIORITY_WEIGHT[b.priority] ?? 0) - (PRIORITY_WEIGHT[a.priority] ?? 0);
    if (pw !== 0) return pw;
    const cw = (CONFIDENCE_WEIGHT[b.confidence] ?? 0) - (CONFIDENCE_WEIGHT[a.confidence] ?? 0);
    if (cw !== 0) return cw;
    if ((b._impact ?? 0) !== (a._impact ?? 0)) return (b._impact ?? 0) - (a._impact ?? 0);
    return String(a.id).localeCompare(String(b.id));
  });

const toTopActions = (ranked) =>
  ranked
    // watch/research_required/abstain stay in the opportunity list but are not top actions.
    .filter(
      (row) =>
        row.status !== "research_required" &&
        row.status !== "abstain" &&
        row.status !== "watch"
    )
    .slice(0, 3)
    .map((row, index) => ({
      priority: index + 1,
      opportunityId: row.id,
      type: row.type,
      title: row.title,
      confidence: row.confidence,
      recommendedAction: row.recommendedAction,
      serviceRefs: row.serviceRefs,
      areaRefs: row.areaRefs,
      requiresHumanReview: true,
      executionEligible: false,
    }));

/**
 * Resolve seasonal themes for a date. Unverified catalog services and
 * non-catalog research topics are labeled research_required only.
 */
export const buildSeasonalOpportunities = ({
  now = new Date(),
  services = [],
} = {}) => {
  const month = now.getUTCMonth() + 1;
  const themes = SEASONAL_THEMES_BY_MONTH[month] ?? [];
  const opportunities = [];

  for (const theme of themes) {
    const verifiedRefs = [];
    const researchCatalog = [];
    for (const serviceId of theme.catalogServiceIds ?? []) {
      const service = serviceById(services, serviceId);
      if (!service) {
        researchCatalog.push({
          serviceId,
          reason: "not_in_catalog",
        });
        continue;
      }
      if (service.status === "verified") {
        verifiedRefs.push(serviceId);
      } else if (service.status === "rejected" || service.status === "unsupported") {
        // Never promote rejected/unsupported services.
        continue;
      } else {
        researchCatalog.push({
          serviceId,
          status: service.status,
          reason: "catalog_not_verified",
        });
      }
    }

    if (verifiedRefs.length) {
      opportunities.push(
        makeOpportunity({
          id: `opp.seasonal.verified.${theme.themeId}`,
          type: "seasonal_service_opportunity",
          title: theme.title,
          priority: "medium",
          confidence: "medium",
          rationale: `Seasonal window (UTC month ${month}) aligns with verified catalog services.`,
          evidence: [
            {
              source: "seasonal_calendar",
              month,
              themeId: theme.themeId,
              verifiedServiceIds: verifiedRefs,
            },
          ],
          serviceRefs: verifiedRefs,
          recommendedAction:
            "Human-review which verified seasonal services to emphasize in next-week marketing; do not invent offers.",
          status: "recommended",
          impact: LEAD_OPS_RANKING_RULES.impact.seasonalVerified,
        })
      );
    }

    const researchTopics = [
      ...(theme.researchTopics ?? []).map((topic) => ({ topic, reason: "theme_research" })),
      ...researchCatalog.map((row) => ({
        topic: row.serviceId,
        reason: row.reason,
        catalogStatus: row.status ?? null,
      })),
    ];

    if (researchTopics.length) {
      opportunities.push(
        makeOpportunity({
          id: `opp.seasonal.research.${theme.themeId}`,
          type: "seasonal_service_opportunity",
          title: `Research seasonal viability: ${theme.title}`,
          priority: "low",
          confidence: "low",
          rationale:
            "Seasonal theme includes services or topics that are not verified marketable offers. Investigate before catalog promotion.",
          evidence: [
            {
              source: "seasonal_calendar",
              month,
              themeId: theme.themeId,
              researchTopics,
            },
          ],
          serviceRefs: [],
          recommendedAction:
            "Investigate snow/ice or unverified seasonal service viability before adding to the verified catalog. Do not claim Maestros offers unverified services.",
          status: "research_required",
          impact: LEAD_OPS_RANKING_RULES.impact.seasonalResearch,
        })
      );
    }
  }

  return opportunities;
};

/**
 * Evidence-gap opportunities for verified services lacking project proof records.
 * Does not fabricate projects.
 */
export const buildEvidenceGapOpportunities = ({
  services = [],
  projects = [],
  demandServiceIds = [],
} = {}) => {
  const verified = verifiedOnly(services);
  const projectText = JSON.stringify(projects ?? []);
  const opportunities = [];
  const demandSet = new Set(demandServiceIds);

  for (const service of verified) {
    const mentionedInProjects =
      projectText.includes(service.id) ||
      (service.slug && projectText.includes(service.slug)) ||
      (service.name && projectText.toLowerCase().includes(String(service.name).toLowerCase()));

    if (mentionedInProjects) continue;

    const inPriorityList = EVIDENCE_GAP_PRIORITY_SERVICES.includes(service.id);
    const hasDemand = demandSet.has(service.id);
    if (!inPriorityList && !hasDemand) continue;

    opportunities.push(
      makeOpportunity({
        id: `opp.evidence_gap.${service.id}`,
        type: "content_evidence_gap",
        title: `Collect real proof for ${service.name}`,
        priority: hasDemand ? "medium" : "low",
        confidence: "medium",
        rationale: hasDemand
          ? `${service.name} shows demand evidence but lacks verified project proof records in growth/projects.`
          : `${service.name} is verified in the catalog but has no project evidence records yet.`,
        evidence: [
          {
            source: "growth_facts",
            serviceId: service.id,
            catalogStatus: service.status,
            projectEvidenceCount: 0,
            sourceReference: service.sourceReference ?? null,
          },
        ],
        serviceRefs: [service.id],
        recommendedAction: `Collect before/after photos and a short job note from the next verified ${service.name} job. Do not invent project evidence.`,
        status: "recommended",
        impact: hasDemand
          ? LEAD_OPS_RANKING_RULES.impact.evidenceGapWithDemand
          : LEAD_OPS_RANKING_RULES.impact.evidenceGapNoDemand,
      })
    );
  }

  return opportunities;
};

const mapWeeklySignalsToOpportunities = ({
  weekly,
  services = [],
  areas = [],
}) => {
  const opportunities = [];
  const abstentions = [];
  const verifiedServices = verifiedOnly(services);
  const verifiedAreas = verifiedOnly(areas);
  const signals = weekly?.signals ?? [];
  const reviewOpportunity = weekly?.reviewOpportunity;
  const postOpportunity = weekly?.postOpportunity;
  const dataQuality = weekly?.dataQuality;

  if (reviewOpportunity) {
    if (reviewOpportunity.unrepliedCount == null) {
      abstentions.push({
        type: "review_reputation",
        reason: reviewOpportunity.reason,
        evidence: reviewOpportunity.evidence,
      });
    } else if (reviewOpportunity.actionRecommended) {
      opportunities.push(
        makeOpportunity({
          id: "opp.review.unreplied",
          type: "review_reputation",
          title: "Respond to unreplied Google reviews",
          priority: "high",
          confidence: "high",
          rationale: reviewOpportunity.reason,
          evidence: reviewOpportunity.evidence,
          recommendedAction:
            "Use growth:review-watch drafts for human review. Do not auto-send replies.",
          status: "recommended",
          impact: LEAD_OPS_RANKING_RULES.impact.reviewUnreplied,
        })
      );
    }

    const total = reviewOpportunity.evidence?.[0]?.totalReviewCount;
    if (
      typeof total === "number" &&
      Number.isFinite(total) &&
      total >= 0 &&
      total < 5 &&
      reviewOpportunity.unrepliedCount != null
    ) {
      opportunities.push(
        makeOpportunity({
          id: "opp.review.volume_low",
          type: "review_reputation",
          title: "Review volume is still thin",
          priority: "low",
          confidence: "medium",
          rationale: `Current snapshot has ${total} public review(s). This is an operational observation only — not a competitor benchmark or ranking claim.`,
          evidence: reviewOpportunity.evidence,
          recommendedAction:
            "After completed jobs, manually ask satisfied customers for a Google review. No incentives or rating gating.",
          status: "recommended",
          impact: LEAD_OPS_RANKING_RULES.impact.reviewVolumeThin,
        })
      );
    }
  }

  for (const signal of signals) {
    if (signal.id === "signal.gsc.page_low_ctr" || signal.id === "signal.gsc.query_opportunity") {
      const row = signal.evidence?.[0] ?? {};
      const impressions = Number(row.impressions);
      const minImpressions =
        signal.id === "signal.gsc.query_opportunity"
          ? LEAD_OPS_GSC_MIN_QUERY_IMPRESSIONS
          : LEAD_OPS_GSC_MIN_PAGE_IMPRESSIONS;
      // Defense in depth: weekly already thresholds, but Lead Ops refuses noisy rows.
      if (!Number.isFinite(impressions) || impressions < minImpressions) {
        abstentions.push({
          type: "organic_search_demand",
          reason: `Organic signal below Lead Ops impression floor (${minImpressions}).`,
          evidence: signal.evidence,
        });
        continue;
      }
      if (row.ctr == null || !Number.isFinite(Number(row.ctr))) {
        abstentions.push({
          type: "organic_search_demand",
          reason: "Organic CTR unavailable; not inventing a CTR comparison.",
          evidence: signal.evidence,
        });
        continue;
      }
      const serviceRefs = onlyVerifiedRefs(row.serviceIds ?? [], verifiedServices);
      if (signal.id === "signal.gsc.query_opportunity" && !serviceRefs.length) {
        abstentions.push({
          type: "organic_search_demand",
          reason: "Query opportunity lacked verified service refs after catalog filter.",
          evidence: signal.evidence,
        });
        continue;
      }
      const isQuery = signal.id === "signal.gsc.query_opportunity";
      opportunities.push(
        makeOpportunity({
          id: `opp.organic.${signal.id}`,
          type: "organic_search_demand",
          title: isQuery
            ? "Organic query demand with weak CTR"
            : "Existing page has impressions with weak CTR",
          priority: "medium",
          confidence: "medium",
          rationale: `${signal.summary} Treat as an investigation opportunity, not proof the page is defective. GSC floor: >=${minImpressions} impressions and CTR <= ${LEAD_OPS_GSC_LOW_CTR}.`,
          evidence: signal.evidence,
          serviceRefs,
          areaRefs: [],
          recommendedAction:
            "Human-review the existing page/query path and improve clarity/CTA. Do not generate programmatic location or service pages.",
          status: "recommended",
          impact: isQuery
            ? LEAD_OPS_RANKING_RULES.impact.organicQueryVerified
            : LEAD_OPS_RANKING_RULES.impact.organicPageWeakCtr,
        })
      );
    }

    if (
      signal.id === "signal.leads.quote_pre_submit_gap" ||
      signal.id === "signal.leads.quote_post_submit_gap" ||
      signal.id === "signal.leads.quote_funnel_submit_unavailable" ||
      signal.id === "signal.leads.quote_funnel_tiny_sample" ||
      signal.id === "signal.leads.decline"
    ) {
      const confidence =
        signal.confidence ??
        (signal.id === "signal.leads.quote_funnel_tiny_sample" ||
        signal.id === "signal.leads.quote_funnel_submit_unavailable"
          ? "low"
          : "medium");
      const priority =
        signal.id === "signal.leads.decline"
          ? "high"
          : confidence === "low"
            ? "low"
            : "medium";
      opportunities.push(
        makeOpportunity({
          id: `opp.conversion.${signal.id}`,
          type: "conversion_improvement",
          title:
            signal.id === "signal.leads.decline"
              ? "Investigate week-over-week lead decline"
              : "Quote-funnel diagnostic worth human review",
          priority,
          confidence,
          rationale: `${signal.summary} ${QUOTE_FUNNEL_CAVEAT}`,
          evidence: signal.evidence,
          recommendedAction:
            "Treat this as a hypothesis only. Inspect quote UX/tracking with human judgment; do not open website PRs from Lead Ops.",
          status: confidence === "low" ? "watch" : "recommended",
          impact:
            signal.id === "signal.leads.decline"
              ? LEAD_OPS_RANKING_RULES.impact.leadDecline
              : LEAD_OPS_RANKING_RULES.impact.quoteFunnelDiagnostic,
        })
      );
    }
  }

  if (postOpportunity?.shouldDraft) {
    const serviceRefs = onlyVerifiedRefs(postOpportunity.serviceRefs ?? [], verifiedServices);
    const areaRefs = onlyVerifiedRefs(postOpportunity.areaRefs ?? [], verifiedAreas);
    if (!serviceRefs.length) {
      abstentions.push({
        type: "gbp_search_demand",
        reason: "GBP post opportunity lacked verified service refs.",
        evidence: postOpportunity.evidence,
      });
    } else {
      opportunities.push(
        makeOpportunity({
          id: "opp.gbp.demand",
          type: "gbp_search_demand",
          title: "GBP search demand for a verified service",
          priority: "medium",
          confidence: "medium",
          rationale: postOpportunity.reason,
          evidence: postOpportunity.evidence,
          serviceRefs,
          areaRefs,
          recommendedAction:
            "Human-review a GBP post draft offline via growth:drafts. Do not auto-publish.",
          status: "recommended",
          impact: LEAD_OPS_RANKING_RULES.impact.gbpDemand,
        })
      );
    }
  } else if (dataQuality && !dataQuality.available?.gbpKeywords) {
    abstentions.push({
      type: "gbp_search_demand",
      reason: "GBP keyword source unavailable; not interpreting as zero demand.",
      evidence: [{ source: "gbpKeywords", status: "unavailable" }],
    });
  }

  if (dataQuality && !dataQuality.available?.gsc) {
    abstentions.push({
      type: "organic_search_demand",
      reason: "GSC source unavailable; not interpreting as zero organic demand.",
      evidence: [{ source: "gsc", status: "unavailable" }],
    });
  }

  if (dataQuality && !dataQuality.available?.ga4) {
    abstentions.push({
      type: "conversion_improvement",
      reason: "GA4 source unavailable; not interpreting lead metrics as zero.",
      evidence: [{ source: "ga4", status: "unavailable" }],
    });
  }

  return { opportunities, abstentions };
};

/**
 * Guard: candidate/rejected services must never become execution-ready opportunities.
 */
export const assertOpportunityCatalogSafety = (opportunity, services = []) => {
  for (const id of opportunity.serviceRefs ?? []) {
    const service = serviceById(services, id);
    if (!service) {
      return {
        ok: false,
        detail: `Unknown serviceRef ${id}`,
      };
    }
    if (service.status !== "verified") {
      return {
        ok: false,
        detail: `Non-verified serviceRef ${id} status=${service.status}`,
      };
    }
  }
  if (opportunity.executionEligible !== false) {
    return { ok: false, detail: "executionEligible must be false" };
  }
  if (opportunity.requiresHumanReview !== true) {
    return { ok: false, detail: "requiresHumanReview must be true" };
  }
  return { ok: true, detail: null };
};

export const buildLeadOpsPacket = ({
  reports = {},
  catalog = null,
  facts = null,
  now = new Date(),
  collectorResults = [],
} = {}) => {
  const services = facts?.services ?? catalog?.services ?? [];
  const areas = facts?.areas ?? catalog?.areas ?? [];
  const projects = facts?.projects ?? [];
  const verifiedCatalog = {
    services: verifiedOnly(services),
    areas: verifiedOnly(areas),
  };

  const weekly = buildWeeklyIntelligence({
    reports,
    catalog: verifiedCatalog,
    now,
    collectorResults,
  });

  const mapped = mapWeeklySignalsToOpportunities({
    weekly,
    services,
    areas,
  });

  const demandServiceIds = [
    ...(weekly.postOpportunity?.serviceRefs ?? []),
    ...mapped.opportunities.flatMap((o) => o.serviceRefs ?? []),
  ];

  const seasonal = buildSeasonalOpportunities({ now, services });
  const evidenceGaps = buildEvidenceGapOpportunities({
    services,
    projects,
    demandServiceIds,
  });

  const combined = [...mapped.opportunities, ...seasonal, ...evidenceGaps];

  // Fail closed: drop any opportunity that somehow acquired non-verified refs
  // except research_required rows which must keep serviceRefs empty.
  const safe = [];
  for (const opp of combined) {
    if (opp.status === "research_required") {
      safe.push({ ...opp, serviceRefs: [], areaRefs: [], executionEligible: false });
      continue;
    }
    const check = assertOpportunityCatalogSafety(opp, services);
    if (!check.ok) continue;
    safe.push(opp);
  }

  const ranked = rankOpportunities(safe).map(stripInternal);
  const topActions = toTopActions(ranked);

  const period = {
    asOf: now.toISOString(),
    windows: weekly.kpis?.ga4?.windows ?? weekly.quoteFunnel?.recent7 ?? null,
  };

  return {
    mode: LEAD_OPS_SAFETY.mode,
    generatedAt: now.toISOString(),
    period,
    dataQuality: weekly.dataQuality,
    opportunities: ranked,
    topActions,
    abstentions: mapped.abstentions,
    reviewOpportunity: weekly.reviewOpportunity,
    quoteFunnel: weekly.quoteFunnel,
    safety: { ...LEAD_OPS_SAFETY },
    failureClass: null,
  };
};

export const formatLeadOpsMarkdown = (packet) => {
  const lines = [
    "# Maestro Lead Ops v1",
    "",
    `Generated: ${packet.generatedAt}`,
    `Mode: ${packet.mode}`,
    "",
    "## Safety",
  ];
  for (const [key, value] of Object.entries(packet.safety ?? {})) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");
  lines.push("## Top actions");
  if (!packet.topActions?.length) {
    lines.push("- None (insufficient evidence-backed actions).");
  } else {
    for (const action of packet.topActions) {
      lines.push(
        `- ${action.priority}. [${action.confidence}] ${action.title} (${action.opportunityId})`
      );
      lines.push(`  - ${action.recommendedAction}`);
    }
  }
  lines.push("");
  lines.push("## Opportunities");
  if (!packet.opportunities?.length) {
    lines.push("- None.");
  } else {
    for (const opp of packet.opportunities) {
      lines.push(`### ${opp.id}`);
      lines.push(`- type: ${opp.type}`);
      lines.push(`- status: ${opp.status}`);
      lines.push(`- priority: ${opp.priority}`);
      lines.push(`- confidence: ${opp.confidence}`);
      lines.push(`- title: ${opp.title}`);
      lines.push(`- rationale: ${opp.rationale}`);
      lines.push(
        `- serviceRefs: ${opp.serviceRefs?.length ? opp.serviceRefs.join(", ") : "(none)"}`
      );
      lines.push(`- areaRefs: ${opp.areaRefs?.length ? opp.areaRefs.join(", ") : "(none)"}`);
      lines.push(`- recommendedAction: ${opp.recommendedAction}`);
      lines.push(`- requiresHumanReview: ${opp.requiresHumanReview}`);
      lines.push(`- executionEligible: ${opp.executionEligible}`);
      lines.push("");
    }
  }
  if (packet.abstentions?.length) {
    lines.push("## Abstentions / insufficient evidence");
    for (const row of packet.abstentions) {
      lines.push(`- [${row.type}] ${row.reason}`);
    }
    lines.push("");
  }
  lines.push("## Data quality issues");
  const issues = packet.dataQuality?.issues ?? [];
  if (!issues.length) {
    lines.push("- None recorded.");
  } else {
    for (const issue of issues) {
      lines.push(`- ${issue.source}: ${issue.code}`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

export const formatLeadOpsConsoleSummary = (packet) => {
  const lines = [
    `Lead Ops: mode=${packet.mode}`,
    `Opportunities: ${packet.opportunities?.length ?? 0}`,
    `Top actions: ${packet.topActions?.length ?? 0}`,
    `Contacts prospects: no`,
    `Execution eligible: no`,
    `Human review required: yes`,
  ];
  for (const action of packet.topActions ?? []) {
    lines.push(`  ${action.priority}. [${action.confidence}] ${action.title}`);
  }
  return lines.join("\n");
};

// Re-export helpers used by tests to prove reuse without duplication.
export {
  buildReviewOpportunity,
  buildPostOpportunity,
  computeGa4LeadKpis,
  diagnoseQuoteFunnel,
  findByStatus,
};
