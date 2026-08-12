/**
 * Helpers for weekly intelligence fixtures (no PII).
 */

export const VERIFIED_CATALOG = {
  services: [
    {
      id: "svc.power-washing",
      slug: "power-washing",
      name: "Power Washing",
      aliases: ["power washing", "pressure washing"],
      status: "verified",
    },
    {
      id: "svc.gravel-driveway-installation",
      slug: "gravel-driveway-installation",
      name: "Gravel Driveway Installation",
      aliases: ["gravel driveway", "driveway gravel"],
      status: "verified",
    },
    {
      id: "svc.seasonal-cleanups",
      slug: "seasonal-cleanups",
      name: "Seasonal Cleanups",
      aliases: ["seasonal cleanup", "yard cleanup"],
      status: "verified",
    },
  ],
  areas: [
    {
      id: "area.shawnigan-lake",
      slug: "shawnigan-lake",
      name: "Shawnigan Lake",
      aliases: ["shawnigan"],
      status: "verified",
    },
    {
      id: "area.cordova-bay",
      slug: "cordova-bay",
      name: "Cordova Bay",
      aliases: ["cordova bay"],
      status: "verified",
    },
  ],
};

export const buildDailyPoints = (endDate, values) => {
  const end = new Date(`${endDate}T00:00:00Z`);
  const points = [];
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const d = new Date(end);
    d.setUTCDate(end.getUTCDate() - (values.length - 1 - i));
    points.push({ date: d.toISOString().slice(0, 10), value: values[i] });
  }
  return points;
};

export const buildGbpPerformance = ({
  endDate = "2026-08-11",
  callClicks = Array(28).fill(0),
  websiteClicks = Array(28).fill(0),
  impressions = Array(28).fill(1),
} = {}) => {
  const start = buildDailyPoints(endDate, callClicks)[0].date;
  const mk = (dailyMetric, values) => {
    const points = buildDailyPoints(endDate, values);
    return {
      dailyMetric,
      dailySubEntityType: null,
      points,
      total: points.reduce((acc, p) => acc + Number(p.value || 0), 0),
    };
  };
  return {
    generatedAt: "2026-08-12T12:00:00.000Z",
    location: "locations/fixture",
    dateRange: { startDate: start, endDate },
    series: [
      mk("CALL_CLICKS", callClicks),
      mk("WEBSITE_CLICKS", websiteClicks),
      mk("BUSINESS_IMPRESSIONS_MOBILE_SEARCH", impressions),
      mk("BUSINESS_IMPRESSIONS_DESKTOP_SEARCH", impressions),
      mk("BUSINESS_IMPRESSIONS_MOBILE_MAPS", Array(28).fill(0)),
      mk("BUSINESS_IMPRESSIONS_DESKTOP_MAPS", Array(28).fill(0)),
      mk("BUSINESS_DIRECTION_REQUESTS", Array(28).fill(0)),
      mk("BUSINESS_CONVERSATIONS", Array(28).fill(0)),
    ],
  };
};

export const buildGa4WithWindows = ({
  recent = { generate_lead: 2, phone_click: 1, sms_click: 0, quote_form_start: 4 },
  prior = { generate_lead: 5, phone_click: 2, sms_click: 0, quote_form_start: 6 },
  days28 = null,
} = {}) => {
  const toRows = (map) =>
    Object.entries(map).map(([eventName, eventCount]) => ({
      eventName,
      eventCount: String(eventCount),
    }));
  const d28 = days28 ?? {
    generate_lead: recent.generate_lead + prior.generate_lead,
    phone_click: recent.phone_click + prior.phone_click,
    sms_click: (recent.sms_click ?? 0) + (prior.sms_click ?? 0),
    quote_form_start: recent.quote_form_start + prior.quote_form_start,
  };
  return {
    dateRange: { startDate: "2026-07-15", endDate: "2026-08-12" },
    leadEvents: toRows(d28),
    leadEventsByWindow: {
      windows: {
        recent7: { startDate: "2026-08-05", endDate: "2026-08-11" },
        prior7: { startDate: "2026-07-29", endDate: "2026-08-04" },
        days28: { startDate: "2026-07-15", endDate: "2026-08-11" },
      },
      recent7: toRows(recent),
      prior7: toRows(prior),
      days28: toRows(d28),
    },
  };
};
