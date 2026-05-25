const RESEND_ENDPOINT = "https://api.resend.com/emails";
const RATE_WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 4;
const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;
const MIN_COMPLETION_MS = 3500;
const MAX_NAME_LENGTH = 80;
const MAX_PHONE_LENGTH = 30;
const MAX_EMAIL_LENGTH = 254;
const MAX_DETAILS_LENGTH = 2000;
const MAX_TRACKING_VALUE_LENGTH = 400;
const MAX_SHORT_VALUE_LENGTH = 180;

const recentRequestsByIp = new Map<string, number[]>();
const recentSubmissions = new Map<string, number>();

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

const getValue = (formData: FormData, key: string) =>
  (formData.get(key) ?? "").toString().trim();

const getIpAddress = (request: Request) => {
  const cfIp = request.headers.get("CF-Connecting-IP")?.trim();
  if (cfIp) return cfIp;
  const forwarded = request.headers.get("X-Forwarded-For") ?? "";
  return forwarded.split(",")[0]?.trim() || "";
};

const isSameHost = (candidateUrl: string | null, requestUrl: string) => {
  if (!candidateUrl) return true;
  try {
    const candidate = new URL(candidateUrl);
    const current = new URL(requestUrl);
    return candidate.host === current.host;
  } catch {
    return false;
  }
};

const isRateLimited = (ipAddress: string, now: number) => {
  if (!ipAddress) return false;
  const windowStart = now - RATE_WINDOW_MS;
  const recent = (recentRequestsByIp.get(ipAddress) ?? []).filter((timestamp) => timestamp >= windowStart);
  if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
    recentRequestsByIp.set(ipAddress, recent);
    return true;
  }
  recent.push(now);
  recentRequestsByIp.set(ipAddress, recent);
  return false;
};

const wasRecentlySubmitted = (signature: string, now: number) => {
  for (const [entrySignature, timestamp] of recentSubmissions.entries()) {
    if (now - timestamp > DUPLICATE_WINDOW_MS) {
      recentSubmissions.delete(entrySignature);
    }
  }
  const previous = recentSubmissions.get(signature);
  if (previous && now - previous <= DUPLICATE_WINDOW_MS) {
    return true;
  }
  recentSubmissions.set(signature, now);
  return false;
};

const isLikelyLinkSpam = (value: string) => {
  const matches = value.match(/https?:\/\/|www\./gi);
  return (matches?.length ?? 0) >= 2;
};

const isTruthyFlag = (value: string | undefined) =>
  /^(1|true|yes|on)$/i.test((value ?? "").trim());

const buildRedirectUrl = (
  requestUrl: string,
  returnTo: string,
  statusKey: "submitted" | "error",
  eventId?: string
) => {
  const fallbackPath = "/#quote";
  const fallback = new URL(fallbackPath, requestUrl);

  let target = fallback;
  if (returnTo) {
    try {
      const candidate = new URL(returnTo, requestUrl);
      const current = new URL(requestUrl);
      if (candidate.host === current.host && /^https?:$/.test(candidate.protocol)) {
        target = candidate;
      }
    } catch {
      target = fallback;
    }
  }

  target.searchParams.delete("submitted");
  target.searchParams.delete("error");
  target.searchParams.delete("lead_event_id");
  target.searchParams.set(statusKey, "1");
  if (statusKey === "submitted" && eventId) {
    target.searchParams.set("lead_event_id", eventId);
  }
  if (!target.hash) {
    target.hash = "#quote";
  }

  return target;
};

export const onRequestPost = async ({ request, env }: { request: Request; env: Record<string, string> }) => {
  let redirectOk = new URL("/?submitted=1#quote", request.url);
  let redirectError = new URL("/?error=1#quote", request.url);
  const now = Date.now();
  const requestHost = new URL(request.url).host;
  const turnstileSecret = (env.TURNSTILE_SECRET ?? "").trim();
  const turnstileRequired = isTruthyFlag(env.TURNSTILE_REQUIRED) || Boolean(turnstileSecret);

  if (request.method !== "POST") {
    return Response.redirect(redirectError, 303);
  }

  if (!isSameHost(request.headers.get("Origin"), request.url) || !isSameHost(request.headers.get("Referer"), request.url)) {
    // Quietly accept to avoid giving bots signal they were blocked.
    return Response.redirect(redirectOk, 303);
  }

  const ipAddress = getIpAddress(request);
  if (isRateLimited(ipAddress, now)) {
    return Response.redirect(redirectOk, 303);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.redirect(redirectError, 303);
  }

  const returnTo = getValue(formData, "return_to");
  const leadEventId = `lead_${now.toString(36)}`;
  redirectOk = buildRedirectUrl(request.url, returnTo, "submitted", leadEventId);
  redirectError = buildRedirectUrl(request.url, returnTo, "error");

  const honeypot = getValue(formData, "company");
  const secondaryHoneypot = getValue(formData, "website");
  if (honeypot || secondaryHoneypot) {
    return Response.redirect(redirectOk, 303);
  }

  const startedAtRaw = getValue(formData, "form_started_at");
  const startedAt = Number.parseInt(startedAtRaw, 10);
  if (Number.isFinite(startedAt)) {
    const completionMs = now - startedAt;
    if (completionMs < MIN_COMPLETION_MS || completionMs > DUPLICATE_WINDOW_MS) {
      return Response.redirect(redirectOk, 303);
    }
  }

  const name = getValue(formData, "name");
  const phone = getValue(formData, "phone");
  const email = getValue(formData, "email");
  const area = getValue(formData, "area");
  const service = getValue(formData, "service");
  const timeline = getValue(formData, "timeline");
  const preferredContact = getValue(formData, "preferred_contact");
  const details = getValue(formData, "details");
  const utmSource = getValue(formData, "utm_source");
  const utmMedium = getValue(formData, "utm_medium");
  const utmCampaign = getValue(formData, "utm_campaign");
  const utmContent = getValue(formData, "utm_content");
  const utmTerm = getValue(formData, "utm_term");
  const gclid = getValue(formData, "gclid");
  const fbclid = getValue(formData, "fbclid");
  const msclkid = getValue(formData, "msclkid");
  const landingPage = getValue(formData, "landing_page");
  const referrer = getValue(formData, "referrer");
  const pageTitle = getValue(formData, "page_title");
  const pagePath = getValue(formData, "page_path");

  const trackingValues = [
    utmSource,
    utmMedium,
    utmCampaign,
    utmContent,
    utmTerm,
    gclid,
    fbclid,
    msclkid,
    landingPage,
    referrer,
    pagePath,
  ];

  if (!name || !phone || !area || !service) {
    return Response.redirect(redirectError, 303);
  }

  if (
    name.length > MAX_NAME_LENGTH ||
    phone.length > MAX_PHONE_LENGTH ||
    email.length > MAX_EMAIL_LENGTH ||
    timeline.length > MAX_SHORT_VALUE_LENGTH ||
    preferredContact.length > MAX_SHORT_VALUE_LENGTH ||
    details.length > MAX_DETAILS_LENGTH ||
    pageTitle.length > MAX_SHORT_VALUE_LENGTH ||
    trackingValues.some((value) => value.length > MAX_TRACKING_VALUE_LENGTH)
  ) {
    return Response.redirect(redirectError, 303);
  }

  const phoneDigits = phone.replace(/\D/g, "");
  if (phoneDigits.length < 7 || phoneDigits.length > 15) {
    return Response.redirect(redirectError, 303);
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.redirect(redirectError, 303);
  }

  if (isLikelyLinkSpam(`${name}\n${details}`)) {
    return Response.redirect(redirectOk, 303);
  }

  const duplicateSignature = [phoneDigits, area.toLowerCase(), service.toLowerCase(), details.toLowerCase().slice(0, 160)].join("|");
  if (wasRecentlySubmitted(duplicateSignature, now)) {
    return Response.redirect(redirectOk, 303);
  }

  if (turnstileRequired && !turnstileSecret) {
    return Response.redirect(redirectError, 303);
  }

  if (turnstileRequired) {
    const token = getValue(formData, "cf-turnstile-response");
    if (!token) {
      return Response.redirect(redirectError, 303);
    }
    const body = new URLSearchParams({
      secret: turnstileSecret,
      response: token,
      remoteip: ipAddress,
    });
    try {
      const verify = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        body,
      });
      const outcome = (await verify.json()) as {
        success?: boolean;
        hostname?: string;
        action?: string;
      };
      if (
        !outcome.success ||
        (outcome.hostname && outcome.hostname !== requestHost) ||
        (outcome.action && outcome.action !== "quote_form")
      ) {
        return Response.redirect(redirectError, 303);
      }
    } catch {
      return Response.redirect(redirectError, 303);
    }
  }

  const resendKey = env.RESEND_API_KEY;
  if (!resendKey) {
    return Response.redirect(redirectError, 303);
  }

  const toEmail = env.TO_EMAIL ?? "quotes@maestrosservices.com";
  const fromEmail = env.FROM_EMAIL ?? "Maestros Services <quotes@maestrosservices.com>";

  const safeName = escapeHtml(name);
  const safePhone = escapeHtml(phone);
  const safeEmail = escapeHtml(email || "Not provided");
  const safeArea = escapeHtml(area);
  const safeService = escapeHtml(service);
  const safeTimeline = escapeHtml(timeline || "Not provided");
  const safePreferredContact = escapeHtml(preferredContact || "Not provided");
  const safeDetails = escapeHtml(details || "Not provided");
  const trackingRows: Array<[string, string]> = [
    ["UTM source", utmSource],
    ["UTM medium", utmMedium],
    ["UTM campaign", utmCampaign],
    ["UTM content", utmContent],
    ["UTM term", utmTerm],
    ["gclid", gclid],
    ["fbclid", fbclid],
    ["msclkid", msclkid],
    ["Landing page", landingPage],
    ["Referrer", referrer],
    ["Page title", pageTitle],
    ["Page path", pagePath],
  ];
  const populatedTrackingRows = trackingRows.filter(([, value]) => Boolean(value));
  const hasTrackingData = populatedTrackingRows.length > 0;

  const text = [
    "New quote request",
    `Name: ${name}`,
    `Phone: ${phone}`,
    `Email: ${email || "Not provided"}`,
    `Service area: ${area}`,
    `Service: ${service}`,
    `Timeline: ${timeline || "Not provided"}`,
    `Preferred contact: ${preferredContact || "Not provided"}`,
    `Details: ${details || "Not provided"}`,
    ...(hasTrackingData
      ? ["", "Attribution:", ...populatedTrackingRows.map(([label, value]) => `${label}: ${value}`)]
      : []),
  ].join("\n");

  const html = `
    <h2>New quote request</h2>
    <p><strong>Name:</strong> ${safeName}</p>
    <p><strong>Phone:</strong> ${safePhone}</p>
    <p><strong>Email:</strong> ${safeEmail}</p>
    <p><strong>Service area:</strong> ${safeArea}</p>
    <p><strong>Service:</strong> ${safeService}</p>
    <p><strong>Timeline:</strong> ${safeTimeline}</p>
    <p><strong>Preferred contact:</strong> ${safePreferredContact}</p>
    <p><strong>Details:</strong><br />${safeDetails.replace(/\n/g, "<br />")}</p>
    ${
      hasTrackingData
        ? `<h3>Attribution</h3><ul>${populatedTrackingRows
            .map(
              ([label, value]) =>
                `<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</li>`
            )
            .join("")}</ul>`
        : ""
    }
  `;

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [toEmail],
        subject: `New quote request - ${name}`,
        html,
        text,
      }),
    });

    if (!response.ok) {
      return Response.redirect(redirectError, 303);
    }
  } catch {
    return Response.redirect(redirectError, 303);
  }

  return Response.redirect(redirectOk, 303);
};
