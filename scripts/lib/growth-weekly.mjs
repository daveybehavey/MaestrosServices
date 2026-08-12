/**
 * Pure weekly Growth Ops decision engine.
 * No network. No filesystem writes. Never publishes or mutates Google.
 */

import { normalizePostText, scorePostSimilarity } from "./growth-duplicate.mjs";

export const WEEKLY_SAFETY = Object.freeze({
  mode: "shadow_read_only",
  publishes: false,
  mutatesGoogle: false,
  deploys: false,
  requiresHumanReview: true,
  autoPublishEligible: false,
});

export const SEMANTIC_COVERAGE = "catalog_refs_and_known_mentions";

/** Collector script -> decision-engine report key / filename. */
export const COLLECTOR_REPORT_MAP = Object.freeze({
  "gbp:performance": { key: "gbpPerformance", file: "gbp-performance.json" },
  "gbp:search-keywords": { key: "gbpKeywords", file: "gbp-search-keywords.json" },
  "gbp:reviews": { key: "gbpReviews", file: "gbp-reviews.json" },
  "gbp:list-posts": { key: "gbpPosts", file: "gbp-list-posts.json" },
  "reporting:ga4": { key: "ga4", file: "ga4-summary.json" },
  "reporting:gsc": { key: "gsc", file: "search-console-summary.json" },
});

export const GSC_LAG_DAYS = 3;
/** Weekly live reports older than this are treated as stale (timezone-tolerant). */
export const MAX_REPORT_AGE_HOURS = 72;
/** Allowed skew between expected complete-day window end and report window end. */
export const MAX_WINDOW_END_SKEW_DAYS = 2;

const LEAD_EVENTS = ["generate_lead", "phone_click", "sms_click", "quote_form_start"];

const ACTION_TYPE_RANK = Object.freeze({
  review_reply: 1,
  lead_conversion: 2,
  organic_opportunity: 3,
  gbp_post: 4,
  gbp_demand: 5,
  maintenance: 9,
  insufficient_data: 99,
});

const MIN_GSC_IMPRESSIONS_QUERY = 30;
const MIN_GSC_IMPRESSIONS_PAGE = 25;
const LOW_CTR_THRESHOLD = 0.02;
const LEAD_DECLINE_RATIO = 0.35;
const LEAD_IMPROVE_RATIO = 0.35;
const MIN_LEAD_SAMPLE = 3;
const POST_STALE_DAYS = 14;
const NEAR_DUPLICATE_THRESHOLD = 0.82;

const toNumber = (value) => {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const pctChange = (current, prior) => {
  if (current == null || prior == null) return null;
  if (prior === 0) return current === 0 ? 0 : null;
  return (current - prior) / prior;
};

const isoDate = (date) => date.toISOString().slice(0, 10);

const daysBetween = (laterIso, earlierIso) => {
  if (!laterIso || !earlierIso) return null;
  const later = Date.parse(`${String(laterIso).slice(0, 10)}T00:00:00Z`);
  const earlier = Date.parse(`${String(earlierIso).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(later) || !Number.isFinite(earlier)) return null;
  return Math.round((later - earlier) / 86400000);
};

const sumPointsInRange = (points = [], startDate, endDate) => {
  let total = 0;
  let count = 0;
  for (const point of points) {
    const date = point?.date;
    const value = toNumber(point?.value) ?? 0;
    if (!date) continue;
    if (startDate && date < startDate) continue;
    if (endDate && date > endDate) continue;
    total += value;
    count += 1;
  }
  return { total, dayCount: count };
};

const splitTrailingWindows = (points = [], recentDays = 7, priorDays = 7) => {
  const dates = [...new Set(points.map((p) => p?.date).filter(Boolean))].sort();
  if (dates.length < recentDays + priorDays) {
    return {
      ok: false,
      reason: "date_range_too_short",
      recent: null,
      prior: null,
      context: null,
    };
  }
  const end = dates[dates.length - 1];
  const recentStartIdx = dates.length - recentDays;
  const priorStartIdx = dates.length - recentDays - priorDays;
  const recentStart = dates[recentStartIdx];
  const priorStart = dates[priorStartIdx];
  const priorEnd = dates[recentStartIdx - 1];
  const contextStart = dates[0];
  return {
    ok: true,
    reason: null,
    recent: { startDate: recentStart, endDate: end, ...sumPointsInRange(points, recentStart, end) },
    prior: {
      startDate: priorStart,
      endDate: priorEnd,
      ...sumPointsInRange(points, priorStart, priorEnd),
    },
    context: {
      startDate: contextStart,
      endDate: end,
      ...sumPointsInRange(points, contextStart, end),
    },
  };
};

const eventMap = (rows = [], { absentAsZero = false } = {}) => {
  const map = Object.create(null);
  for (const name of LEAD_EVENTS) map[name] = absentAsZero ? 0 : null;
  for (const row of rows) {
    const name = row?.eventName;
    if (!LEAD_EVENTS.includes(name)) continue;
    map[name] = toNumber(row.eventCount);
  }
  return map;
};

const qualityIssue = (source, code, detail) => ({ source, code, detail });

const parseIsoDateOnly = (value) => {
  if (!value || typeof value !== "string") return null;
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const ms = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(ms) ? new Date(ms) : null;
};

const utcDayNumber = (date) =>
  Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86400000);

const absDaySkew = (left, right) => {
  if (!left || !right) return null;
  return Math.abs(utcDayNumber(left) - utcDayNumber(right));
};

const shiftUtcDays = (date, days) => {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const reportAgeHours = (generatedAt, now) => {
  const ms = Date.parse(generatedAt);
  if (!Number.isFinite(ms)) return null;
  return (now.getTime() - ms) / 3600000;
};

/**
 * Fail-closed input preparation:
 * - collector failures suppress that source even if an old file remains on disk
 * - freshness checks suppress clearly stale sources
 */
export const prepareWeeklyInputs = (
  reports = {},
  { now = new Date(), collectorResults = [] } = {}
) => {
  const usable = {
    ga4: reports.ga4 ?? null,
    gsc: reports.gsc ?? null,
    gbpPerformance: reports.gbpPerformance ?? null,
    gbpKeywords: reports.gbpKeywords ?? null,
    gbpReviews: reports.gbpReviews ?? null,
    gbpPosts: reports.gbpPosts ?? null,
  };
  const issues = [];
  const available = {
    ga4: false,
    gsc: false,
    gbpPerformance: false,
    gbpKeywords: false,
    gbpReviews: false,
    gbpPosts: false,
  };

  const suppress = (key, code, detail) => {
    usable[key] = null;
    available[key] = false;
    issues.push(qualityIssue(key, code, detail));
  };

  for (const result of collectorResults ?? []) {
    const mapping = COLLECTOR_REPORT_MAP[result?.script];
    if (!mapping) continue;
    if (result.ok === false) {
      suppress(
        mapping.key,
        "collector_failed",
        `Collector ${result.script} failed; ignoring any on-disk report for this run.`
      );
    }
  }

  const markPresent = (key) => {
    if (usable[key] != null) available[key] = true;
  };

  // GBP generatedAt freshness (reviews/keywords/posts/performance).
  for (const key of ["gbpReviews", "gbpKeywords", "gbpPosts", "gbpPerformance"]) {
    if (usable[key] == null) {
      if (!issues.some((i) => i.source === key && i.code === "collector_failed")) {
        issues.push(qualityIssue(key, "missing", "Report not provided."));
      }
      continue;
    }
    const generatedAt = usable[key].generatedAt;
    if (!generatedAt) {
      suppress(key, "stale_or_incomplete", "Missing generatedAt metadata.");
      continue;
    }
    const age = reportAgeHours(generatedAt, now);
    if (age == null || age > MAX_REPORT_AGE_HOURS || age < -MAX_REPORT_AGE_HOURS) {
      suppress(
        key,
        "stale",
        `Report generatedAt is outside the ${MAX_REPORT_AGE_HOURS}h freshness window.`
      );
      continue;
    }
    markPresent(key);
  }

  // GBP performance dateRange end must be recent enough for a weekly run.
  if (usable.gbpPerformance) {
    const end = parseIsoDateOnly(usable.gbpPerformance.dateRange?.endDate);
    const expectedEnd = shiftUtcDays(now, -1);
    const skew = absDaySkew(end, expectedEnd);
    if (end == null || skew == null || skew > MAX_WINDOW_END_SKEW_DAYS) {
      suppress(
        "gbpPerformance",
        "stale",
        "GBP performance dateRange.endDate is not recent enough for weekly comparison."
      );
    } else if (!Array.isArray(usable.gbpPerformance.series)) {
      suppress("gbpPerformance", "incomplete", "No daily series present.");
    }
  }

  // GA4
  if (usable.ga4 == null) {
    if (!issues.some((i) => i.source === "ga4" && i.code === "collector_failed")) {
      issues.push(qualityIssue("ga4", "missing", "Report not provided."));
    }
  } else if (!usable.ga4.leadEventsByWindow && !usable.ga4.leadEvents) {
    suppress("ga4", "incomplete", "No leadEvents present.");
  } else {
    const recentEnd = parseIsoDateOnly(usable.ga4.leadEventsByWindow?.windows?.recent7?.endDate);
    const expectedEnd = shiftUtcDays(now, -1);
    if (usable.ga4.leadEventsByWindow?.windows?.recent7) {
      const skew = absDaySkew(recentEnd, expectedEnd);
      if (recentEnd == null || skew == null || skew > MAX_WINDOW_END_SKEW_DAYS) {
        suppress(
          "ga4",
          "stale",
          "GA4 recent7 window does not end at the expected latest complete day."
        );
      } else {
        available.ga4 = true;
      }
    } else {
      // Legacy single-window reports remain usable but flagged.
      available.ga4 = true;
      issues.push(
        qualityIssue("ga4", "no_prior_period_comparator", "Comparable recent7/prior7 windows absent.")
      );
    }
  }

  // GSC
  if (usable.gsc == null) {
    if (!issues.some((i) => i.source === "gsc" && i.code === "collector_failed")) {
      issues.push(qualityIssue("gsc", "missing", "Report not provided."));
    }
  } else {
    const lag = usable.gsc.comparison?.lagDays ?? GSC_LAG_DAYS;
    const recentEnd = parseIsoDateOnly(usable.gsc.comparison?.recent28?.dateRange?.endDate);
    const expectedEnd = shiftUtcDays(now, -Number(lag) || -GSC_LAG_DAYS);
    if (usable.gsc.comparison?.recent28?.dateRange) {
      const skew = absDaySkew(recentEnd, expectedEnd);
      if (recentEnd == null || skew == null || skew > MAX_WINDOW_END_SKEW_DAYS) {
        suppress(
          "gsc",
          "stale",
          `GSC recent28 window does not respect the configured lag (${lag}d).`
        );
      } else {
        available.gsc = true;
      }
    } else if (usable.gsc.topQueries || usable.gsc.topPages) {
      available.gsc = true;
      issues.push(
        qualityIssue("gsc", "no_prior_period_comparator", "Lag-safe comparison windows absent.")
      );
    } else {
      suppress("gsc", "incomplete", "No Search Console rows present.");
    }
  }

  return {
    usableReports: usable,
    dataQuality: { available, issues },
  };
};

export const assessInputQuality = (reports = {}, options = {}) =>
  prepareWeeklyInputs(reports, options).dataQuality;

export const computeGbpKpis = (performance, { now = new Date() } = {}) => {
  if (!performance?.series) {
    return { ok: false, reason: "missing", metrics: {} };
  }
  const metrics = {};
  let anyOk = false;
  for (const series of performance.series) {
    const metric = series.dailyMetric;
    const windows = splitTrailingWindows(series.points ?? [], 7, 7);
    const current = windows.ok ? windows.recent.total : null;
    const prior = windows.ok ? windows.prior.total : null;
    const context28 = windows.ok ? windows.context.total : toNumber(series.total);
    metrics[metric] = {
      current7: current,
      prior7: prior,
      days28: context28,
      absChange: current != null && prior != null ? current - prior : null,
      pctChange: pctChange(current, prior),
      windowOk: windows.ok,
      windowReason: windows.reason,
      recentRange: windows.recent
        ? { startDate: windows.recent.startDate, endDate: windows.recent.endDate }
        : null,
      priorRange: windows.prior
        ? { startDate: windows.prior.startDate, endDate: windows.prior.endDate }
        : null,
    };
    if (windows.ok) anyOk = true;
  }

  const impressionKeys = [
    "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
    "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
    "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
    "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  ];
  const sumField = (field) =>
    impressionKeys.reduce((acc, key) => {
      const v = metrics[key]?.[field];
      return v == null ? acc : (acc ?? 0) + v;
    }, null);

  metrics.IMPRESSIONS_TOTAL = {
    current7: sumField("current7"),
    prior7: sumField("prior7"),
    days28: sumField("days28"),
    absChange:
      sumField("current7") != null && sumField("prior7") != null
        ? sumField("current7") - sumField("prior7")
        : null,
    pctChange: pctChange(sumField("current7"), sumField("prior7")),
    windowOk: anyOk,
  };

  return {
    ok: anyOk,
    reason: anyOk ? null : "date_range_too_short",
    asOf: performance.dateRange?.endDate ?? isoDate(now),
    metrics,
  };
};

export const computeGa4LeadKpis = (ga4) => {
  const emptyEvents = () => {
    const events = {};
    for (const name of LEAD_EVENTS) {
      events[name] = {
        current7: null,
        prior7: null,
        days28: null,
        absChange: null,
        pctChange: null,
        comparable: false,
      };
    }
    return events;
  };

  if (!ga4) return { ok: false, reason: "missing", events: emptyEvents() };

  const byWindow = ga4.leadEventsByWindow;
  if (byWindow?.recent7 && byWindow?.prior7) {
    const recent = eventMap(byWindow.recent7, { absentAsZero: true });
    const prior = eventMap(byWindow.prior7, { absentAsZero: true });
    const days28 = eventMap(byWindow.days28 ?? ga4.leadEvents ?? [], { absentAsZero: true });
    const events = {};
    for (const name of LEAD_EVENTS) {
      events[name] = {
        current7: recent[name],
        prior7: prior[name],
        days28: days28[name],
        absChange:
          recent[name] != null && prior[name] != null ? recent[name] - prior[name] : null,
        pctChange: pctChange(recent[name], prior[name]),
        comparable: recent[name] != null && prior[name] != null,
      };
    }
    return {
      ok: true,
      reason: null,
      windows: byWindow.windows ?? null,
      events,
    };
  }

  // Single 28-day blob: report totals but mark comparisons unavailable.
  const days28 = eventMap(ga4.leadEvents ?? []);
  const events = emptyEvents();
  for (const name of LEAD_EVENTS) {
    events[name] = {
      current7: null,
      prior7: null,
      days28: days28[name],
      absChange: null,
      pctChange: null,
      comparable: false,
    };
  }
  return {
    ok: Object.values(days28).some((v) => v != null),
    reason: "no_prior_period_comparator",
    windows: { days28: ga4.dateRange ?? null },
    events,
  };
};

const matchVerifiedService = (text, services = []) => {
  const normalized = ` ${normalizePostText(text)} `;
  const hits = [];
  for (const service of services) {
    const aliases = [service.name, service.slug, ...(service.aliases ?? [])]
      .filter(Boolean)
      .map((alias) => normalizePostText(alias))
      .filter((alias) => alias.length >= 3);
    for (const alias of aliases) {
      if (normalized.includes(` ${alias} `) || normalized.includes(` ${alias}`)) {
        hits.push(service);
        break;
      }
    }
  }
  return hits;
};

const matchVerifiedArea = (text, areas = []) => {
  const normalized = ` ${normalizePostText(text)} `;
  const hits = [];
  for (const area of areas) {
    const aliases = [area.name, area.slug, ...(area.aliases ?? [])]
      .filter(Boolean)
      .map((alias) => normalizePostText(alias))
      .filter((alias) => alias.length >= 3);
    for (const alias of aliases) {
      if (normalized.includes(` ${alias} `) || normalized.includes(` ${alias}`)) {
        hits.push(area);
        break;
      }
    }
  }
  return hits;
};

const isProgrammaticLocationPage = (url = "") =>
  /\/services\/[^/]+\/[^/]+\/?$/i.test(String(url)) || /\/areas\/[^/]+\/?$/i.test(String(url));

const pickExistingPageOpportunity = (gsc, { minImpressions = MIN_GSC_IMPRESSIONS_PAGE } = {}) => {
  const pages = gsc?.comparison?.recent28?.topPages ?? gsc?.topPages ?? [];
  const candidates = [];
  for (const row of pages) {
    const url = row.keys?.[0] ?? "";
    const impressions = toNumber(row.impressions) ?? 0;
    const clicks = toNumber(row.clicks) ?? 0;
    const ctr = toNumber(row.ctr);
    if (impressions < minImpressions) continue;
    if (ctr == null || ctr > LOW_CTR_THRESHOLD) continue;
    if (isProgrammaticLocationPage(url)) {
      // Prefer improving an existing hub/service page over location variants.
      continue;
    }
    candidates.push({
      url,
      impressions,
      clicks,
      ctr,
      position: toNumber(row.position),
      score: impressions * (1 - Math.min(ctr, 1)),
    });
  }
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.url).localeCompare(String(b.url));
  });
  return candidates[0] ?? null;
};

const pickQueryOpportunity = (gsc, services, { minImpressions = MIN_GSC_IMPRESSIONS_QUERY } = {}) => {
  const queries = gsc?.comparison?.recent28?.topQueries ?? gsc?.topQueries ?? [];
  const candidates = [];
  for (const row of queries) {
    const query = row.keys?.[0] ?? "";
    const impressions = toNumber(row.impressions) ?? 0;
    const clicks = toNumber(row.clicks) ?? 0;
    const ctr = toNumber(row.ctr);
    if (impressions < minImpressions) continue;
    if (ctr != null && ctr > LOW_CTR_THRESHOLD) continue;
    const matched = matchVerifiedService(query, services);
    if (!matched.length) continue;
    candidates.push({
      query,
      impressions,
      clicks,
      ctr,
      position: toNumber(row.position),
      serviceIds: matched.map((s) => s.id),
      score: impressions,
    });
  }
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.query).localeCompare(String(b.query));
  });
  return candidates[0] ?? null;
};

const sanitizeReviews = (reviewsReport) => {
  if (!reviewsReport) return null;
  return {
    generatedAt: reviewsReport.generatedAt ?? null,
    averageRating: reviewsReport.averageRating ?? null,
    totalReviewCount: reviewsReport.totalReviewCount ?? null,
    unrepliedCount: reviewsReport.unrepliedCount ?? null,
    unrepliedReviewIds: Array.isArray(reviewsReport.unrepliedReviewIds)
      ? reviewsReport.unrepliedReviewIds.map(String)
      : [],
    // Intentionally omit reviewerDisplayName, comment, ownerReply bodies.
  };
};

const daysSinceLatestPost = (postsReport, now) => {
  const posts = postsReport?.localPosts ?? postsReport?.recentPosts ?? [];
  if (!posts.length) return { days: null, latestAt: null, count: 0 };
  let latest = null;
  for (const post of posts) {
    const stamp = post.updateTime || post.createTime;
    if (!stamp) continue;
    const ms = Date.parse(stamp);
    if (!Number.isFinite(ms)) continue;
    if (latest == null || ms > latest) latest = ms;
  }
  if (latest == null) return { days: null, latestAt: null, count: posts.length };
  const days = Math.floor((now.getTime() - latest) / 86400000);
  return { days, latestAt: new Date(latest).toISOString(), count: posts.length };
};

const recentTopics = (postsReport, services) => {
  const posts = postsReport?.localPosts ?? postsReport?.recentPosts ?? [];
  const topics = [];
  for (const post of posts.slice(0, 20)) {
    const matched = matchVerifiedService(post.summary ?? "", services).map((s) => s.id);
    topics.push({
      createTime: post.createTime ?? null,
      updateTime: post.updateTime ?? null,
      serviceIds: matched,
      summaryPreview: normalizePostText(String(post.summary ?? "").slice(0, 80)),
    });
  }
  return topics;
};

const hasNearDuplicateTopic = (postsReport, serviceId, services) => {
  const posts = postsReport?.localPosts ?? postsReport?.recentPosts ?? [];
  const service = services.find((s) => s.id === serviceId);
  if (!service) return false;
  const probe = `${service.name} ${service.aliases?.[0] ?? ""}`.trim();
  for (const post of posts.slice(0, 10)) {
    const score = scorePostSimilarity(probe, post.summary ?? "");
    if (score.score >= NEAR_DUPLICATE_THRESHOLD || score.exact) return true;
  }
  const recentSame = posts.slice(0, 5).filter((post) =>
    matchVerifiedService(post.summary ?? "", services).some((s) => s.id === serviceId)
  );
  return recentSame.length >= 2;
};

const pickGbpDemandService = (keywordsReport, services, areas = []) => {
  const keywords = keywordsReport?.keywords ?? [];
  const scored = [];
  for (const row of keywords) {
    if (row.belowThreshold) continue;
    const impressions = toNumber(row.impressions);
    if (impressions == null || impressions < 5) continue;
    const matched = matchVerifiedService(row.searchKeyword ?? "", services);
    if (!matched.length) continue;
    const matchedAreas = matchVerifiedArea(row.searchKeyword ?? "", areas);
    for (const service of matched) {
      scored.push({
        serviceId: service.id,
        keyword: row.searchKeyword,
        impressions,
        areaIds: matchedAreas.map((area) => area.id),
      });
    }
  }
  scored.sort((a, b) => {
    if (b.impressions !== a.impressions) return b.impressions - a.impressions;
    return String(a.serviceId).localeCompare(String(b.serviceId));
  });
  return scored[0] ?? null;
};

const makeAction = ({
  id,
  type,
  title,
  reason,
  evidence,
  recommendedNextStep,
  targetKpi,
  confidence,
  impact = 50,
}) => ({
  id,
  type,
  title,
  reason,
  evidence,
  recommendedNextStep,
  targetKpi,
  confidence,
  impact,
  _rank: ACTION_TYPE_RANK[type] ?? 50,
});

const rankActions = (actions) =>
  [...actions]
    .sort((a, b) => {
      if (b.impact !== a.impact) return b.impact - a.impact;
      if (a._rank !== b._rank) return a._rank - b._rank;
      return String(a.id).localeCompare(String(b.id));
    })
    .slice(0, 3)
    .map((action, index) => {
      const { _rank, ...rest } = action;
      return { ...rest, priority: index + 1 };
    });

export const buildPostOpportunity = ({
  catalog,
  gbpKeywords,
  gbpPosts,
  gbpKpis,
  now = new Date(),
} = {}) => {
  const services = catalog?.services ?? [];
  const areas = catalog?.areas ?? [];
  const freshness = daysSinceLatestPost(gbpPosts, now);
  const avoidTopics = recentTopics(gbpPosts, services)
    .flatMap((t) => t.serviceIds)
    .filter((id, idx, arr) => arr.indexOf(id) === idx);

  if (!services.length) {
    return {
      shouldDraft: false,
      reason: "No verified services available for structured post opportunity.",
      serviceRefs: [],
      areaRefs: [],
      evidence: [],
      avoidTopics,
    };
  }

  const demand = pickGbpDemandService(gbpKeywords, services, areas);
  const postsHistoryAvailable = gbpPosts != null;
  const stale =
    postsHistoryAvailable && freshness.days != null && freshness.days >= POST_STALE_DAYS
      ? {
          source: "gbpPosts",
          daysSinceLatestPost: freshness.days,
          latestAt: freshness.latestAt,
        }
      : null;

  // Stale posts alone may signal maintenance need, but never invent a topic.
  if (!demand) {
    return {
      shouldDraft: false,
      reason: !postsHistoryAvailable
        ? "No verified GBP demand signal and current post history is unavailable."
        : stale
          ? `GBP posts are stale (${freshness.days} days), but no strong verified topic demand was found.`
          : freshness.count === 0
            ? "No verified GBP demand signal and no recent-post baseline to justify a draft."
            : `Posts are recent (${freshness.days} days) and no verified keyword demand signal is available.`,
      serviceRefs: [],
      areaRefs: [],
      evidence: stale
        ? [stale]
        : postsHistoryAvailable
          ? [{ source: "gbpPosts", daysSinceLatestPost: freshness.days, latestAt: freshness.latestAt }]
          : [{ source: "gbpPosts", status: "unavailable" }],
      avoidTopics,
      maintenanceSignal: Boolean(stale),
    };
  }

  // Demand alone is not enough: duplicate/topic coverage requires usable post history.
  // Empty localPosts [] is usable; null/missing/failed/stale (suppressed) is not.
  if (!postsHistoryAvailable) {
    return {
      shouldDraft: false,
      reason:
        "Verified topic demand exists, but current GBP post history is unavailable so duplicate/topic coverage cannot be safely assessed.",
      serviceRefs: [],
      areaRefs: [],
      evidence: [
        {
          source: "gbpKeywords",
          keyword: demand.keyword,
          impressions: demand.impressions,
          serviceId: demand.serviceId,
        },
        { source: "gbpPosts", status: "unavailable" },
      ],
      avoidTopics: [],
      maintenanceSignal: false,
    };
  }

  if (hasNearDuplicateTopic(gbpPosts, demand.serviceId, services)) {
    return {
      shouldDraft: false,
      reason: `Verified demand for ${demand.serviceId} exists, but recent posts already cover that topic.`,
      serviceRefs: [],
      areaRefs: [],
      evidence: [
        {
          source: "gbpKeywords",
          keyword: demand.keyword,
          impressions: demand.impressions,
          serviceId: demand.serviceId,
        },
        ...(stale ? [stale] : []),
      ],
      avoidTopics,
      maintenanceSignal: Boolean(stale),
    };
  }

  const evidencedAreaIds = (demand.areaIds ?? []).filter((id) =>
    areas.some((area) => area.id === id)
  );

  const evidence = [
    {
      source: "gbpKeywords",
      keyword: demand.keyword,
      impressions: demand.impressions,
      serviceId: demand.serviceId,
      areaIds: evidencedAreaIds,
    },
  ];
  if (stale) evidence.push(stale);
  if (gbpKpis?.metrics?.CALL_CLICKS) {
    evidence.push({
      source: "gbpPerformance",
      callClicks7: gbpKpis.metrics.CALL_CLICKS.current7,
      websiteClicks7: gbpKpis.metrics.WEBSITE_CLICKS?.current7 ?? null,
    });
  }

  return {
    shouldDraft: true,
    reason: `Verified service demand for ${demand.serviceId} via GBP keyword "${demand.keyword}".`,
    serviceRefs: [demand.serviceId],
    areaRefs: evidencedAreaIds.slice(0, 1),
    evidence,
    avoidTopics,
    maintenanceSignal: Boolean(stale),
  };
};

export const buildReviewOpportunity = (reviewsReport) => {
  const sanitized = sanitizeReviews(reviewsReport);
  if (!sanitized) {
    return {
      unrepliedCount: null,
      actionRecommended: false,
      reason: "Reviews report missing; not interpreting as zero unreplied.",
      evidence: [{ source: "gbpReviews", status: "missing" }],
    };
  }
  const unreplied = sanitized.unrepliedCount ?? 0;
  return {
    unrepliedCount: unreplied,
    actionRecommended: unreplied > 0,
    reason:
      unreplied > 0
        ? `${unreplied} unreplied review(s) reduce response coverage and trust signals.`
        : "No unreplied reviews detected in the current read-only snapshot.",
    evidence: [
      {
        source: "gbpReviews",
        totalReviewCount: sanitized.totalReviewCount,
        unrepliedCount: unreplied,
        unrepliedReviewIds: sanitized.unrepliedReviewIds,
        averageRating: sanitized.averageRating,
      },
    ],
  };
};

export const collectSignals = ({
  ga4Kpis,
  gbpKpis,
  gsc,
  catalog,
  reviewOpportunity,
  postOpportunity,
  dataQuality,
}) => {
  const signals = [];

  if (reviewOpportunity.actionRecommended) {
    signals.push({
      id: "signal.reviews.unreplied",
      type: "reviews",
      severity: "high",
      summary: `${reviewOpportunity.unrepliedCount} unreplied review(s).`,
      evidence: reviewOpportunity.evidence,
    });
  }

  const generateLead = ga4Kpis.events?.generate_lead;
  if (generateLead?.comparable) {
    const prior = generateLead.prior7 ?? 0;
    const current = generateLead.current7 ?? 0;
    const sample = Math.max(prior, current);
    if (sample >= MIN_LEAD_SAMPLE) {
      const change = pctChange(current, prior);
      if (change != null && change <= -LEAD_DECLINE_RATIO) {
        signals.push({
          id: "signal.leads.decline",
          type: "leads",
          severity: "high",
          summary: `generate_lead declined from ${prior} to ${current} week-over-week.`,
          evidence: [{ source: "ga4", event: "generate_lead", ...generateLead }],
        });
      } else if (change != null && change >= LEAD_IMPROVE_RATIO) {
        signals.push({
          id: "signal.leads.improve",
          type: "leads",
          severity: "medium",
          summary: `generate_lead improved from ${prior} to ${current} week-over-week.`,
          evidence: [{ source: "ga4", event: "generate_lead", ...generateLead }],
        });
      }
    } else {
      signals.push({
        id: "signal.leads.tiny_sample",
        type: "leads",
        severity: "low",
        summary: "Lead sample too small for a confident week-over-week conclusion.",
        evidence: [{ source: "ga4", event: "generate_lead", ...generateLead }],
      });
    }

    const quoteStarts = ga4Kpis.events?.quote_form_start;
    if (
      quoteStarts?.comparable &&
      (quoteStarts.current7 ?? 0) >= MIN_LEAD_SAMPLE &&
      (generateLead.current7 ?? 0) === 0
    ) {
      signals.push({
        id: "signal.leads.quote_start_no_complete",
        type: "leads",
        severity: "medium",
        summary: "Quote form starts occurred without matching completed generate_lead events.",
        evidence: [
          { source: "ga4", event: "quote_form_start", ...quoteStarts },
          { source: "ga4", event: "generate_lead", ...generateLead },
        ],
      });
    }
  } else if (dataQuality.available.ga4 && ga4Kpis.reason === "no_prior_period_comparator") {
    signals.push({
      id: "signal.leads.no_comparator",
      type: "data_quality",
      severity: "medium",
      summary: "GA4 lead totals exist but lack a comparable prior 7-day window.",
      evidence: [{ source: "ga4", reason: ga4Kpis.reason, days28: generateLead?.days28 ?? null }],
    });
  }

  const pageOpp = pickExistingPageOpportunity(gsc);
  if (pageOpp) {
    signals.push({
      id: "signal.gsc.page_low_ctr",
      type: "organic",
      severity: "medium",
      summary: `Existing page ${pageOpp.url} has ${pageOpp.impressions} impressions with ${(pageOpp.ctr * 100).toFixed(1)}% CTR.`,
      evidence: [{ source: "gsc", ...pageOpp }],
    });
  }

  const queryOpp = pickQueryOpportunity(gsc, catalog?.services ?? []);
  if (queryOpp) {
    signals.push({
      id: "signal.gsc.query_opportunity",
      type: "organic",
      severity: "medium",
      summary: `Query "${queryOpp.query}" shows ${queryOpp.impressions} impressions with weak CTR and aligns to verified services.`,
      evidence: [{ source: "gsc", ...queryOpp }],
    });
  }

  // Explicitly ignore trivial low-volume GSC noise (no signal created below thresholds).

  if (postOpportunity.shouldDraft) {
    signals.push({
      id: "signal.gbp.post_opportunity",
      type: "gbp_post",
      severity: "medium",
      summary: postOpportunity.reason,
      evidence: postOpportunity.evidence,
    });
  } else if (postOpportunity.maintenanceSignal) {
    signals.push({
      id: "signal.gbp.posts_stale",
      type: "gbp_post",
      severity: "low",
      summary: postOpportunity.reason,
      evidence: postOpportunity.evidence,
    });
  }

  if (gbpKpis?.metrics?.CALL_CLICKS?.windowOk) {
    const calls = gbpKpis.metrics.CALL_CLICKS;
    signals.push({
      id: "signal.gbp.calls_context",
      type: "gbp_performance",
      severity: "low",
      summary: `GBP call clicks last 7 complete days: ${calls.current7} (prior ${calls.prior7}).`,
      evidence: [{ source: "gbpPerformance", metric: "CALL_CLICKS", ...calls }],
    });
  }

  return signals;
};

export const selectActions = ({ signals, reviewOpportunity, postOpportunity, ga4Kpis }) => {
  const candidates = [];

  if (reviewOpportunity.actionRecommended) {
    candidates.push(
      makeAction({
        id: "action.review_reply",
        type: "review_reply",
        title: "Reply to unreplied Google reviews",
        reason: reviewOpportunity.reason,
        evidence: reviewOpportunity.evidence,
        recommendedNextStep:
          "Human-review unreplied reviews and draft owner replies offline. Do not auto-publish.",
        targetKpi: "review_response_coverage",
        confidence: "high",
        impact: 80,
      })
    );
  }

  const decline = signals.find((s) => s.id === "signal.leads.decline");
  if (decline) {
    candidates.push(
      makeAction({
        id: "action.lead_decline_investigate",
        type: "lead_conversion",
        title: "Investigate week-over-week lead decline",
        reason: decline.summary,
        evidence: decline.evidence,
        recommendedNextStep:
          "Compare quote-form funnel, phone/SMS clicks, and GBP call clicks for the same windows before changing offers.",
        targetKpi: "generate_lead",
        confidence: "medium",
        impact: 95,
      })
    );
  }

  const improve = signals.find((s) => s.id === "signal.leads.improve");
  if (improve && !decline) {
    candidates.push(
      makeAction({
        id: "action.lead_improve_reinforce",
        type: "lead_conversion",
        title: "Reinforce channels driving lead improvement",
        reason: improve.summary,
        evidence: improve.evidence,
        recommendedNextStep:
          "Identify which source/landing pages contributed to the lift and keep that conversion path clear.",
        targetKpi: "generate_lead",
        confidence: "medium",
        impact: 70,
      })
    );
  }

  const quoteGap = signals.find((s) => s.id === "signal.leads.quote_start_no_complete");
  if (quoteGap) {
    candidates.push(
      makeAction({
        id: "action.quote_funnel_gap",
        type: "lead_conversion",
        title: "Inspect quote-form completion gap",
        reason: quoteGap.summary,
        evidence: quoteGap.evidence,
        recommendedNextStep:
          "Review quote form UX and tracking continuity; do not invent offer changes from this signal alone.",
        targetKpi: "generate_lead",
        confidence: "medium",
        impact: 75,
      })
    );
  }

  const pageOpp = signals.find((s) => s.id === "signal.gsc.page_low_ctr");
  if (pageOpp) {
    const row = pageOpp.evidence?.[0] ?? {};
    candidates.push(
      makeAction({
        id: "action.organic_page_ctr",
        type: "organic_opportunity",
        title: "Improve CTR on an existing high-impression page",
        reason: pageOpp.summary,
        evidence: pageOpp.evidence,
        recommendedNextStep:
          "Human-review title/meta and above-the-fold proof on the existing page. Avoid SEO page proliferation.",
        targetKpi: "organic_clicks",
        confidence: row.impressions >= 40 ? "medium" : "low",
        impact: 60,
      })
    );
  }

  const queryOpp = signals.find((s) => s.id === "signal.gsc.query_opportunity");
  if (queryOpp && !pageOpp) {
    candidates.push(
      makeAction({
        id: "action.organic_query_align",
        type: "organic_opportunity",
        title: "Align existing page copy to a verified-demand query",
        reason: queryOpp.summary,
        evidence: queryOpp.evidence,
        recommendedNextStep:
          "Improve an existing relevant service/hub page and internal links. Avoid SEO page proliferation.",
        targetKpi: "organic_clicks",
        confidence: "medium",
        impact: 55,
      })
    );
  }

  if (postOpportunity.shouldDraft) {
    candidates.push(
      makeAction({
        id: "action.gbp_post_shadow_draft",
        type: "gbp_post",
        title: "Prepare a human-reviewed GBP post draft",
        reason: postOpportunity.reason,
        evidence: postOpportunity.evidence,
        recommendedNextStep:
          "Use postOpportunity.serviceRefs/areaRefs with the fail-closed validator in shadow mode. Do not publish.",
        targetKpi: "gbp_engagement",
        confidence: postOpportunity.evidence.some((e) => e.source === "gbpKeywords")
          ? "medium"
          : "low",
        impact: 50,
      })
    );
  }

  if (!candidates.length) {
    const hasAnyData =
      Boolean(ga4Kpis?.ok) ||
      Boolean(reviewOpportunity.unrepliedCount != null) ||
      Boolean(postOpportunity);
    if (!hasAnyData) {
      candidates.push(
        makeAction({
          id: "action.insufficient_data",
          type: "insufficient_data",
          title: "Insufficient comparable data for weekly recommendations",
          reason: "Required read-only inputs are missing or not comparable.",
          evidence: [],
          recommendedNextStep: "Re-run collectors and retry weekly intelligence.",
          targetKpi: "data_quality",
          confidence: "low",
          impact: 1,
        })
      );
    }
  }

  // Guard: never recommend programmatic location-page creation.
  const filtered = candidates.filter((action) => {
    const step = String(action.recommendedNextStep ?? "");
    const forbids =
      /\bdo not\b.*\b(programmatic )?location pages?\b/i.test(step) ||
      /\bnever\b.*\b(programmatic )?location pages?\b/i.test(step);
    if (forbids) return true;
    return !/\b(create|spawn|add)\b.*\b(programmatic )?location pages?\b/i.test(step);
  });

  return rankActions(filtered);
};

export const formatWeeklyMarkdown = (report) => {
  const lines = [];
  lines.push(`# Growth Ops weekly intelligence`);
  lines.push("");
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Mode: ${report.safety.mode}`);
  lines.push(`- Human review required: yes`);
  lines.push(`- Auto-publish eligible: no`);
  lines.push(`- Publishes / mutates Google / deploys: no`);
  lines.push("");
  lines.push(`## Data quality`);
  if (!report.dataQuality.issues.length) {
    lines.push(`- No blocking input issues recorded.`);
  } else {
    for (const issue of report.dataQuality.issues) {
      lines.push(`- ${issue.source}: ${issue.code} — ${issue.detail}`);
    }
  }
  lines.push("");
  lines.push(`## KPIs (primary leads)`);
  const leads = report.kpis?.ga4Leads?.events ?? {};
  for (const name of LEAD_EVENTS) {
    const row = leads[name];
    if (!row) continue;
    lines.push(
      `- ${name}: 7d=${row.current7 ?? "n/a"} prior7=${row.prior7 ?? "n/a"} 28d=${row.days28 ?? "n/a"}`
    );
  }
  lines.push("");
  lines.push(`## Actions (max 3)`);
  if (!report.actions.length) {
    lines.push(`- None.`);
  } else {
    for (const action of report.actions) {
      lines.push(`### ${action.priority}. ${action.title}`);
      lines.push(`- Type: ${action.type}`);
      lines.push(`- Confidence: ${action.confidence}`);
      lines.push(`- Target KPI: ${action.targetKpi}`);
      lines.push(`- Why: ${action.reason}`);
      lines.push(`- Next: ${action.recommendedNextStep}`);
      lines.push("");
    }
  }
  lines.push(`## Post opportunity`);
  lines.push(`- shouldDraft: ${report.postOpportunity.shouldDraft}`);
  lines.push(`- reason: ${report.postOpportunity.reason}`);
  if (report.postOpportunity.serviceRefs?.length) {
    lines.push(`- serviceRefs: ${report.postOpportunity.serviceRefs.join(", ")}`);
  }
  if (report.postOpportunity.areaRefs?.length) {
    lines.push(`- areaRefs: ${report.postOpportunity.areaRefs.join(", ")}`);
  }
  lines.push("");
  lines.push(`## Review opportunity`);
  lines.push(`- unrepliedCount: ${report.reviewOpportunity.unrepliedCount}`);
  lines.push(`- actionRecommended: ${report.reviewOpportunity.actionRecommended}`);
  lines.push(`- reason: ${report.reviewOpportunity.reason}`);
  return `${lines.join("\n")}\n`;
};

/**
 * Pure weekly decision entrypoint.
 * @param {{ reports: object, catalog: { services: object[], areas: object[] }, now?: Date, collectorResults?: object[] }} input
 */
export const buildWeeklyIntelligence = ({
  reports = {},
  catalog = {},
  now = new Date(),
  collectorResults = [],
} = {}) => {
  const prepared = prepareWeeklyInputs(reports, { now, collectorResults });
  const usable = prepared.usableReports;
  const dataQuality = prepared.dataQuality;

  const ga4Kpis = computeGa4LeadKpis(usable.ga4);
  const gbpKpis = computeGbpKpis(usable.gbpPerformance, { now });
  const reviewOpportunity = buildReviewOpportunity(usable.gbpReviews);
  const postOpportunity = buildPostOpportunity({
    catalog,
    gbpKeywords: usable.gbpKeywords,
    gbpPosts: usable.gbpPosts,
    gbpKpis,
    now,
  });
  const signals = collectSignals({
    ga4Kpis,
    gbpKpis,
    gsc: usable.gsc,
    catalog,
    reviewOpportunity,
    postOpportunity,
    dataQuality,
  });
  const actions = selectActions({
    signals,
    reviewOpportunity,
    postOpportunity,
    ga4Kpis,
  });

  const period = {
    asOf: isoDate(now),
    ga4: usable.ga4?.leadEventsByWindow?.windows ?? usable.ga4?.dateRange ?? null,
    gsc: usable.gsc?.comparison?.recent28?.dateRange ?? usable.gsc?.dateRange ?? null,
    gbpPerformance: usable.gbpPerformance?.dateRange ?? null,
    gbpKeywords: usable.gbpKeywords?.monthlyRange ?? null,
  };

  return {
    generatedAt: now.toISOString(),
    mode: WEEKLY_SAFETY.mode,
    period,
    dataQuality,
    kpis: {
      ga4Leads: ga4Kpis,
      gbp: gbpKpis,
      primaryNote:
        "Lead events outrank impressions/sessions. Missing inputs are not treated as zero.",
    },
    signals,
    actions,
    postOpportunity,
    reviewOpportunity,
    safety: {
      ...WEEKLY_SAFETY,
      semanticCoverage: SEMANTIC_COVERAGE,
    },
  };
};
