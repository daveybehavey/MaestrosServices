import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createD1QuoteStore,
  createMemoryQuoteStore,
  onRequest,
  onRequestPost,
  serializeEnquiryContent,
} from "../../functions/api/quote.ts";

// Behavioural tests for the S55-6A no-silent-discard quote handler.
// Every scenario asserts a terminal state backed by the durable record:
// DELIVERED only with a provider message ID, otherwise an explicit
// rejection/unconfirmed result. Each test gets a fresh intake store, so
// isolation does not depend on IPs or phone numbers.

const HOST = "https://maestrosservices.example";
const T = 1800000000000;

const realFetch = globalThis.fetch;
const realDateNow = Date.now;

const TURNSTILE_OK = { success: true, hostname: "maestrosservices.example", action: "quote_form" };

// Controllable stubs for the handler's two outbound calls. Resend behaviors:
// { status, body } | { status, rawBody } | "throw". Turnstile results are
// outcome objects, "throw", or "badjson".
const installFetchStub = ({ turnstile = [TURNSTILE_OK], resend = [{ status: 200 }] } = {}) => {
  const calls = { turnstile: 0, resend: 0, resendBodies: [], resendKeys: [] };
  let resendSeq = 0;
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.startsWith("https://challenges.cloudflare.com/")) {
      const behavior = turnstile[Math.min(calls.turnstile, turnstile.length - 1)];
      calls.turnstile += 1;
      if (behavior === "throw") throw new Error("turnstile network failure");
      if (behavior === "badjson") return new Response("not json", { status: 200 });
      return new Response(JSON.stringify(behavior), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (target === "https://api.resend.com/emails") {
      const behavior = resend[Math.min(calls.resend, resend.length - 1)];
      calls.resend += 1;
      calls.resendBodies.push(JSON.parse(init.body));
      calls.resendKeys.push(init.headers["Idempotency-Key"] ?? null);
      if (behavior === "throw") throw new Error("resend network failure");
      resendSeq += 1;
      const body = behavior.rawBody ?? JSON.stringify(behavior.body ?? { id: `msg_${resendSeq}` });
      return new Response(body, {
        status: behavior.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`Unexpected fetch in test: ${target}`);
  };
  return calls;
};

const freezeNow = (ms) => {
  Date.now = () => ms;
};
const unfreezeNow = () => {
  Date.now = realDateNow;
};

const BASE_FIELDS = {
  name: "Alice Example",
  phone: "2505550100",
  email: "alice@example.com",
  area: "Victoria",
  service: "fence",
  timeline: "flexible",
  preferred_contact: "text",
  details: "Repair the front gate.",
  company: "",
  website: "",
  return_to: "/quote#quote",
};

let submissionSeq = 0;
const nextSubmissionId = () => `sub_test_${(submissionSeq += 1)}`;

const makeHarness = (envOverrides = {}) => {
  const store = createMemoryQuoteStore();
  const env = {
    TURNSTILE_SECRET: "test-turnstile-secret",
    RESEND_API_KEY: "test-resend-key",
    __quoteStore: store,
    ...envOverrides,
  };
  let ipSeq = 0;
  const post = (fields = {}, { headers = {}, ip, url = `${HOST}/api/quote` } = {}) => {
    // Each post defaults to its own IP so the shared rate limit only bites
    // in the tests that exercise it on purpose.
    const effectiveIp = ip ?? `203.0.113.${(ipSeq += 1)}`;
    const form = new FormData();
    const merged = { form_started_at: String(T - 5000), ...BASE_FIELDS, ...fields };
    if (!("submission_id" in merged)) merged.submission_id = nextSubmissionId();
    for (const [key, value] of Object.entries(merged)) {
      if (value !== null && value !== undefined) form.set(key, String(value));
    }
    if (!("cf-turnstile-response" in merged)) form.set("cf-turnstile-response", "test-token");
    const request = new Request(url, {
      method: "POST",
      headers: {
        Origin: HOST,
        Referer: `${HOST}/quote`,
        "CF-Connecting-IP": effectiveIp,
        ...headers,
      },
      body: form,
    });
    return onRequestPost({ request, env });
  };
  const get = (query, { format } = {}) => {
    const request = new Request(`${HOST}/api/quote?${query}`, { method: "GET" });
    return onRequest({ request, env });
  };
  return { store, env, post, get };
};

const refFromRedirect = (response) => {
  assert.equal(response.status, 303, "expected a 303 redirect to the result page");
  const location = response.headers.get("location");
  const ref = new URL(location).searchParams.get("ref");
  assert.ok(ref, "redirect must carry the result reference");
  return ref;
};

const resultJson = async (harness, response) => {
  const ref = refFromRedirect(response);
  const page = await harness.get(`ref=${ref}&format=json`);
  assert.equal(page.status, 200);
  return { ref, json: await page.json() };
};

const resultHtml = async (harness, response) => {
  const ref = refFromRedirect(response);
  const page = await harness.get(`ref=${ref}`);
  assert.equal(page.status, 200);
  return { ref, html: await page.text() };
};

const withStub = async (stubOptions, fn) => {
  const calls = installFetchStub(stubOptions);
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = realFetch;
    unfreezeNow();
  }
};

// --- Checklist 2: confirmed handoff ---------------------------------------

test("confirmed handoff: one provider call, durable record with message ID, design success copy", async () => {
  freezeNow(T);
  const harness = makeHarness();
  await withStub({}, async (calls) => {
    const response = await harness.post();
    const { ref, html } = await resultHtml(harness, response);
    assert.match(html, /Your quote request was accepted by our email service for delivery\. Reference:/);
    assert.equal(html.includes("within 1 hour"), false, "success copy must not promise a reply time");
    assert.equal(calls.resend, 1);
    const record = await harness.store.getAttemptByReference(ref);
    assert.equal(record.status, "delivered");
    assert.equal(record.providerMessageId, "msg_1");
    assert.equal(record.recipient, "quotes@maestrosservices.com");
    const verify = await harness.get(`ref=${ref}&format=json`);
    assert.equal((await verify.json()).conversionEligible, true);
  });
});

test("score 0 with Turnstile not configured delivers without a challenge", async () => {
  freezeNow(T);
  const harness = makeHarness({ TURNSTILE_SECRET: "", TURNSTILE_REQUIRED: "" });
  await withStub({}, async (calls) => {
    const response = await harness.post();
    const { json } = await resultJson(harness, response);
    assert.equal(json.status, "delivered");
    assert.equal(calls.turnstile, 0);
  });
});

// --- Checklist 3: method handling -----------------------------------------

test("non-POST/GET methods return 405 with Allow and a durable record", async () => {
  const harness = makeHarness();
  for (const method of ["PUT", "PATCH", "DELETE", "HEAD"]) {
    const request = new Request(`${HOST}/api/quote`, { method });
    const response = await onRequest({ request, env: harness.env });
    assert.equal(response.status, 405, method);
    assert.match(response.headers.get("allow") ?? "", /POST/);
  }
  const record = await harness.store.getLatestAttemptBySubmissionId("");
  assert.equal(record.reasonCode, "method_not_allowed");
});

// --- Checklist 4: source verification -------------------------------------

test("cross-host Origin is visibly rejected, never quietly accepted", async () => {
  freezeNow(T);
  const harness = makeHarness();
  await withStub({}, async (calls) => {
    const response = await harness.post({}, { headers: { Origin: "https://evil.example" } });
    const { html } = await resultHtml(harness, response);
    assert.match(html, /did not pass our source check/);
    assert.equal(calls.resend, 0);
    assert.equal(calls.turnstile, 0);
  });
});

test("malformed Referer is visibly rejected; missing headers alone still deliver", async () => {
  freezeNow(T);
  const harness = makeHarness();
  await withStub({}, async (calls) => {
    const bad = await harness.post({}, { headers: { Referer: "::not a url::" } });
    const { json } = await resultJson(harness, bad);
    assert.equal(json.reasonCode, "source_rejected");
    assert.equal(calls.resend, 0);

    const form = new FormData();
    for (const [key, value] of Object.entries({
      ...BASE_FIELDS,
      form_started_at: String(T - 5000),
      submission_id: nextSubmissionId(),
      "cf-turnstile-response": "test-token",
    })) form.set(key, value);
    const request = new Request(`${HOST}/api/quote`, { method: "POST", body: form });
    const ok = await onRequestPost({ request, env: harness.env });
    const { json: okJson } = await resultJson(harness, ok);
    assert.equal(okJson.status, "delivered");
  });
});

// --- Checklist 5: safe return destination ---------------------------------

test("an external return_to falls back to the form anchor; a same-host one is kept", async () => {
  freezeNow(T);
  const harness = makeHarness();
  await withStub({}, async () => {
    const external = await harness.post({ return_to: "https://evil.example/phish" });
    const { html } = await resultHtml(harness, external);
    assert.ok(html.includes('href="/#quote"'), "external return_to must fall back");
    assert.equal(html.includes("evil.example"), false);

    const internal = await harness.post({ details: "A different job.", return_to: "/quote#quote" });
    const { html: internalHtml } = await resultHtml(harness, internal);
    assert.ok(internalHtml.includes('href="/quote#quote"'));
  });
});

// --- Checklist 6: shared rate limit ---------------------------------------

test("fifth enquiry from one IP in the window is a visible 429; the store is shared across env contexts", async () => {
  freezeNow(T);
  const harness = makeHarness();
  await withStub({}, async (calls) => {
    const ip = "198.51.100.7";
    for (let i = 0; i < 4; i += 1) {
      const response = await harness.post({ phone: `250555030${i}`, details: `Job number ${i}` }, { ip });
      const { json } = await resultJson(harness, response);
      assert.equal(json.status, "delivered");
    }
    assert.equal(calls.resend, 4);
    // A second "instance" (fresh env object) sharing the same store.
    const otherEnv = { ...harness.env };
    const form = new FormData();
    for (const [key, value] of Object.entries({
      ...BASE_FIELDS,
      phone: "2505550399",
      details: "Fifth job",
      form_started_at: String(T - 5000),
      submission_id: nextSubmissionId(),
      "cf-turnstile-response": "test-token",
    })) form.set(key, value);
    const request = new Request(`${HOST}/api/quote`, {
      method: "POST",
      headers: { Origin: HOST, Referer: `${HOST}/quote`, "CF-Connecting-IP": ip },
      body: form,
    });
    const limited = await onRequestPost({ request, env: otherEnv });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
    const html = await limited.text();
    assert.match(html, /Too many requests/);
    assert.equal(calls.resend, 4, "rate-limited request must not reach the provider");
  });
});

// --- Checklist 7: malformed form body -------------------------------------

test("malformed multipart body is visibly rejected with a metadata-only record", async () => {
  freezeNow(T);
  const harness = makeHarness();
  await withStub({}, async (calls) => {
    const request = new Request(`${HOST}/api/quote`, {
      method: "POST",
      headers: { Origin: HOST, "Content-Type": "multipart/form-data" },
      body: "garbage without a boundary",
    });
    const response = await onRequestPost({ request, env: harness.env });
    const { json } = await resultJson(harness, response);
    assert.equal(json.reasonCode, "malformed_request");
    assert.equal(calls.resend, 0);
  });
});

// --- Checklist 8: required fields -----------------------------------------

test("each missing required field is identified, with no provider or challenge call", async () => {
  freezeNow(T);
  const harness = makeHarness();
  await withStub({}, async (calls) => {
    for (const field of ["name", "phone", "area", "service"]) {
      const response = await harness.post({ [field]: "" });
      const { ref, json } = await resultJson(harness, response);
      assert.equal(json.reasonCode, "validation_failed", field);
      assert.ok(
        json.fieldErrors.some((entry) => entry.field === field),
        `field error must name ${field}`
      );
      const record = await harness.store.getAttemptByReference(ref);
      assert.equal(record.status, "rejected");
    }
    assert.equal(calls.resend, 0);
    assert.equal(calls.turnstile, 0);
  });
});

// --- Checklist 9: length boundaries ---------------------------------------

test("length boundaries: at-limit values pass, one-over values name the field and limit", async () => {
  freezeNow(T);
  const harness = makeHarness();
  await withStub({}, async (calls) => {
    const cases = [
      { field: "name", atLimit: "N".repeat(80), over: "N".repeat(81) },
      { field: "phone", atLimit: `2505550100${"-".repeat(20)}`, over: `2505550100${"-".repeat(21)}` },
      { field: "email", atLimit: `${"a".repeat(242)}@example.com`, over: `${"a".repeat(243)}@example.com` },
      { field: "area", atLimit: "A".repeat(180), over: "A".repeat(181) },
      { field: "details", atLimit: "D".repeat(2000), over: "D".repeat(2001) },
      { field: "page_title", atLimit: "P".repeat(180), over: "P".repeat(181) },
      { field: "utm_source", atLimit: "U".repeat(400), over: "U".repeat(401) },
    ];
    for (const { field, atLimit, over } of cases) {
      const okFields = field === "details" ? { details: atLimit } : { [field]: atLimit, details: `Boundary job for ${field}` };
      const okResponse = await harness.post(okFields);
      const { json: okJson } = await resultJson(harness, okResponse);
      assert.equal(okJson.status, "delivered", `${field} at limit must deliver`);
      const overResponse = await harness.post({ [field]: over });
      const { json: overJson } = await resultJson(harness, overResponse);
      assert.equal(overJson.reasonCode, "validation_failed", `${field} over limit`);
      assert.ok(overJson.fieldErrors.some((entry) => entry.field === field), `${field} must be named`);
    }
    // Service/timeline/preferred-contact length is enforced before the enum
    // check, and before Turnstile (the previous fail-closed ordering).
    const turnstileBefore = calls.turnstile;
    const overService = await harness.post({ service: "S".repeat(181) });
    const { json } = await resultJson(harness, overService);
    assert.equal(json.reasonCode, "validation_failed");
    assert.ok(json.fieldErrors.some((entry) => entry.field === "service"));
    assert.equal(calls.turnstile, turnstileBefore, "length validation must reject before Turnstile");
  });
});

test("the form's client maxlength attributes match the server limits", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = fs.readFileSync(path.join(here, "../../src/components/QuoteForm.astro"), "utf8");
  for (const attribute of ['maxlength="80"', 'maxlength="30"', 'maxlength="254"', 'maxlength="180"', 'maxlength="2000"']) {
    assert.ok(source.includes(attribute), `QuoteForm must carry ${attribute}`);
  }
});

// --- Checklist 10: phone/email validation ---------------------------------

test("phone digit boundaries 6/7/15/16 and email shapes", async () => {
  freezeNow(T);
  const harness = makeHarness();
  await withStub({}, async () => {
    const six = await harness.post({ phone: "123456" });
    assert.equal((await resultJson(harness, six)).json.fieldErrors[0].field, "phone");
    const seven = await harness.post({ phone: "1234567", details: "Seven digit job" });
    assert.equal((await resultJson(harness, seven)).json.status, "delivered");
    const fifteen = await harness.post({ phone: "123456789012345", details: "Fifteen digit job" });
    assert.equal((await resultJson(harness, fifteen)).json.status, "delivered");
    const sixteen = await harness.post({ phone: "1234567890123456" });
    assert.equal((await resultJson(harness, sixteen)).json.fieldErrors[0].field, "phone");

    const noEmail = await harness.post({ email: "", details: "No email job" });
    assert.equal((await resultJson(harness, noEmail)).json.status, "delivered");
    const badEmail = await harness.post({ email: "alice@" });
    const { json } = await resultJson(harness, badEmail);
    assert.ok(json.fieldErrors.some((entry) => entry.field === "email"));
  });
});

// --- Checklist 11: enums and contact preference ---------------------------

test("every rendered enum value delivers; unknown values get a field-specific correction", async () => {
  freezeNow(T);
  const harness = makeHarness();
  await withStub({}, async () => {
    const services = [
      "not-sure", "mowing", "trim", "cleanup", "mulch", "powerwash", "rock", "fence",
      "gutter", "pruning", "moss", "driveway", "gravel", "ongoing", "other",
    ];
    for (const service of services) {
      const response = await harness.post({ service, details: `Enum job ${service}` });
      assert.equal((await resultJson(harness, response)).json.status, "delivered", service);
    }
    for (const timeline of ["", "as-soon-as-possible", "this-week", "next-1-2-weeks", "flexible"]) {
      const response = await harness.post({ timeline, details: `Timeline job ${timeline || "empty"}` });
      assert.equal((await resultJson(harness, response)).json.status, "delivered", timeline);
    }
    for (const contact of ["text", "call", "email", "any"]) {
      const response = await harness.post({ preferred_contact: contact, details: `Contact job ${contact}` });
      assert.equal((await resultJson(harness, response)).json.status, "delivered", contact);
    }
    const badService = await harness.post({ service: "unknown" });
    assert.ok((await resultJson(harness, badService)).json.fieldErrors.some((e) => e.field === "service"));
    const badTimeline = await harness.post({ timeline: "unknown" });
    assert.ok((await resultJson(harness, badTimeline)).json.fieldErrors.some((e) => e.field === "timeline"));
    const badContact = await harness.post({ preferred_contact: "unknown" });
    assert.ok((await resultJson(harness, badContact)).json.fieldErrors.some((e) => e.field === "preferred_contact"));
    const emailNoEmail = await harness.post({ preferred_contact: "email", email: "" });
    const { json } = await resultJson(harness, emailNoEmail);
    assert.ok(json.fieldErrors.some((e) => e.field === "email"), "email preference without an email must request correction");
  });
});

// --- Checklist 12/13/14: timing signals -----------------------------------

test("fast completion (0ms and 3499ms) delivers with the flag; 3500ms is the unflagged boundary", async () => {
  const harness = makeHarness();
  await withStub({}, async (calls) => {
    freezeNow(T);
    const zero = await harness.post({ form_started_at: String(T), details: "Zero ms job" });
    const { ref: zeroRef, json: zeroJson } = await resultJson(harness, zero);
    assert.equal(zeroJson.status, "delivered");
    assert.ok((await harness.store.getAttemptByReference(zeroRef)).riskFlags.includes("fast_completion"));

    const fast = await harness.post({ form_started_at: String(T - 3499), details: "Fast job" });
    const { ref: fastRef } = await resultJson(harness, fast);
    assert.ok((await harness.store.getAttemptByReference(fastRef)).riskFlags.includes("fast_completion"));

    const boundary = await harness.post({ form_started_at: String(T - 3500), details: "Boundary job" });
    const { ref: boundaryRef, json: boundaryJson } = await resultJson(harness, boundary);
    assert.equal(boundaryJson.status, "delivered");
    assert.equal((await harness.store.getAttemptByReference(boundaryRef)).riskFlags.includes("fast_completion"), false);
    assert.ok(calls.resend >= 3);
    // Flagged deliveries are marked for review in the business email.
    assert.match(calls.resendBodies[0].subject, /Review requested/);
    assert.match(calls.resendBodies[0].text, /fast_completion/);
  });
});

test("stale tab: 86400001ms delivers flagged; exactly 86400000ms delivers unflagged", async () => {
  const harness = makeHarness();
  await withStub({}, async () => {
    freezeNow(T);
    const stale = await harness.post({ form_started_at: String(T - 86400001), details: "Stale job" });
    const { ref: staleRef, json: staleJson } = await resultJson(harness, stale);
    assert.equal(staleJson.status, "delivered");
    assert.ok((await harness.store.getAttemptByReference(staleRef)).riskFlags.includes("stale_form"));

    const boundary = await harness.post({ form_started_at: String(T - 86400000), details: "Stale boundary job" });
    const { ref: boundaryRef } = await resultJson(harness, boundary);
    assert.equal((await harness.store.getAttemptByReference(boundaryRef)).riskFlags.includes("stale_form"), false);
  });
});

test("untrusted timestamps (omitted, empty, non-numeric, future) flag but never silently discard", async () => {
  const harness = makeHarness();
  await withStub({}, async () => {
    freezeNow(T);
    const variants = [
      { form_started_at: null, details: "Omitted timestamp job" },
      { form_started_at: "", details: "Empty timestamp job" },
      { form_started_at: "not-a-number", details: "NaN timestamp job" },
      { form_started_at: String(T + 1000), details: "Future timestamp job" },
    ];
    for (const variant of variants) {
      const response = await harness.post(variant);
      const { ref, json } = await resultJson(harness, response);
      assert.equal(json.status, "delivered", variant.details);
      assert.ok((await harness.store.getAttemptByReference(ref)).riskFlags.includes("timing_untrusted"), variant.details);
    }
  });
});

// --- Checklist 15/16: honeypot + links ------------------------------------

test("honeypot autofill delivers flagged with a valid challenge; a failed challenge visibly rejects", async () => {
  const harness = makeHarness();
  freezeNow(T);
  await withStub({}, async (calls) => {
    for (const [index, honeypot] of [
      { company: "Example Household" },
      { website: "https://example.com" },
      { company: "Example Household", website: "https://example.com" },
    ].entries()) {
      const response = await harness.post({ ...honeypot, details: `Honeypot job ${index}` });
      const { ref, json } = await resultJson(harness, response);
      assert.equal(json.status, "delivered");
      assert.ok((await harness.store.getAttemptByReference(ref)).riskFlags.includes("honeypot_populated"));
    }
    assert.match(calls.resendBodies[0].subject, /Review requested/);
    assert.match(calls.resendBodies[0].text, /REVIEW REQUESTED/);
    assert.match(calls.resendBodies[0].text, /honeypot_populated/);
  });

  const failing = makeHarness();
  freezeNow(T);
  await withStub({ turnstile: [{ success: false, hostname: "maestrosservices.example", action: "quote_form" }] }, async (calls) => {
    const response = await failing.post({ company: "Example Household" });
    const { json } = await resultJson(failing, response);
    assert.equal(json.reasonCode, "challenge_failed");
    assert.equal(calls.resend, 0);
  });
});

test("two legitimate project links deliver flagged with the links preserved and escaped", async () => {
  const harness = makeHarness();
  freezeNow(T);
  await withStub({}, async (calls) => {
    const details = "Front: https://example.com/front\nRear: https://example.com/rear";
    const response = await harness.post({ details });
    const { ref, json } = await resultJson(harness, response);
    assert.equal(json.status, "delivered");
    assert.ok((await harness.store.getAttemptByReference(ref)).riskFlags.includes("link_pattern"));
    assert.ok(calls.resendBodies[0].text.includes("https://example.com/front"));
    assert.ok(calls.resendBodies[0].text.includes("https://example.com/rear"));
  });
});

// --- Checklist 17: Turnstile failures and configuration -------------------

test("turnstile failure matrix: every variant is an explicit rejection with no provider call", async () => {
  freezeNow(T);
  const cases = [
    {
      name: "required but secret missing",
      env: { TURNSTILE_SECRET: "", TURNSTILE_REQUIRED: "1" },
      stub: {},
      reason: "challenge_not_configured",
    },
    { name: "missing token", env: {}, fields: { "cf-turnstile-response": null }, stub: {}, reason: "challenge_missing" },
    {
      name: "unsuccessful verification",
      env: {},
      stub: { turnstile: [{ success: false, hostname: "maestrosservices.example", action: "quote_form" }] },
      reason: "challenge_failed",
    },
    {
      name: "wrong hostname",
      env: {},
      stub: { turnstile: [{ success: true, hostname: "other.example", action: "quote_form" }] },
      reason: "challenge_failed",
    },
    {
      name: "missing hostname",
      env: {},
      stub: { turnstile: [{ success: true, action: "quote_form" }] },
      reason: "challenge_failed",
    },
    {
      name: "wrong action",
      env: {},
      stub: { turnstile: [{ success: true, hostname: "maestrosservices.example", action: "other" }] },
      reason: "challenge_failed",
    },
    {
      name: "missing action",
      env: {},
      stub: { turnstile: [{ success: true, hostname: "maestrosservices.example" }] },
      reason: "challenge_failed",
    },
    { name: "network failure", env: {}, stub: { turnstile: ["throw"] }, reason: "challenge_unavailable" },
    { name: "invalid JSON", env: {}, stub: { turnstile: ["badjson"] }, reason: "challenge_unavailable" },
  ];
  for (const testCase of cases) {
    const harness = makeHarness(testCase.env ?? {});
    await withStub(testCase.stub, async (calls) => {
      freezeNow(T);
      const response = await harness.post(testCase.fields ?? {});
      const { json } = await resultJson(harness, response);
      assert.equal(json.reasonCode, testCase.reason, testCase.name);
      assert.equal(calls.resend, 0, testCase.name);
    });
  }
});

test("flagged submission with no challenge available is visibly rejected, never fake-accepted", async () => {
  freezeNow(T);
  const harness = makeHarness({ TURNSTILE_SECRET: "", TURNSTILE_REQUIRED: "" });
  await withStub({}, async (calls) => {
    const response = await harness.post({ company: "Example Household" });
    const { json } = await resultJson(harness, response);
    assert.equal(json.reasonCode, "challenge_not_configured");
    assert.equal(calls.resend, 0);
  });
});

// --- Checklist 18/19/20: duplicate identity --------------------------------

test("changed name, email, timeline, or reply preference each deliver independently", async () => {
  freezeNow(T);
  const harness = makeHarness();
  await withStub({}, async (calls) => {
    const first = await harness.post();
    assert.equal((await resultJson(harness, first)).json.status, "delivered");
    const variants = [
      { name: "Bob Example" },
      { email: "bob@example.com" },
      { timeline: "as-soon-as-possible" },
      { preferred_contact: "call" },
    ];
    for (const variant of variants) {
      const response = await harness.post(variant);
      assert.equal((await resultJson(harness, response)).json.status, "delivered", JSON.stringify(variant));
    }
    assert.equal(calls.resend, 5, "every materially different enquiry must send its own email");
  });
});

test("details differing only after character 160 deliver independently", async () => {
  freezeNow(T);
  const harness = makeHarness();
  await withStub({}, async (calls) => {
    const prefix = "A".repeat(160);
    const first = await harness.post({ details: `${prefix} Repair the front gate.` });
    assert.equal((await resultJson(harness, first)).json.status, "delivered");
    const second = await harness.post({ details: `${prefix} Repair the rear fence.` });
    assert.equal((await resultJson(harness, second)).json.status, "delivered");
    assert.equal(calls.resend, 2);
  });
});

test("normalization and delimiter collisions from the audit do not compare equal", async () => {
  freezeNow(T);
  const harness = makeHarness();
  await withStub({}, async (calls) => {
    // Phone formatting only: the exact submitted string is part of identity.
    const plain = await harness.post({ phone: "2505550100", details: "Phone format job" });
    assert.equal((await resultJson(harness, plain)).json.status, "delivered");
    const formatted = await harness.post({ phone: "(250) 555-0100", details: "Phone format job" });
    assert.equal((await resultJson(harness, formatted)).json.status, "delivered");

    // Case-sensitive details.
    const upper = await harness.post({ details: "Preserve panel A." });
    assert.equal((await resultJson(harness, upper)).json.status, "delivered");
    const lower = await harness.post({ details: "Preserve panel a." });
    assert.equal((await resultJson(harness, lower)).json.status, "delivered");
    assert.equal(calls.resend, 4);

    // Delimiter pair: A is a valid enquiry; B's service is not a rendered
    // enum value, so B must fail validation visibly — neither may be
    // swallowed as an "unchanged repeat" of the other.
    const a = await harness.post({ area: "Victoria|fence", service: "rock", details: "Delimiter job" });
    assert.equal((await resultJson(harness, a)).json.status, "delivered");
    const b = await harness.post({ area: "Victoria", service: "fence|rock", details: "Delimiter job" });
    const { json: bJson } = await resultJson(harness, b);
    assert.equal(bJson.reasonCode, "validation_failed");
    assert.equal(calls.resend, 5);
  });
});

test("enquiry identity serialization is exact: versioned, untruncated, case- and format-sensitive", () => {
  const payload = {
    name: "Alice Example",
    phone: "2505550100",
    email: "alice@example.com",
    area: "Victoria",
    service: "fence",
    timeline: "flexible",
    preferredContact: "text",
    details: "Repair the front gate.",
    tracking: {},
  };
  const base = serializeEnquiryContent(payload);
  assert.ok(base.startsWith("v1:"));
  assert.notEqual(serializeEnquiryContent({ ...payload, phone: "(250) 555-0100" }), base);
  assert.notEqual(serializeEnquiryContent({ ...payload, details: "Repair the front gate" }), base);
  assert.notEqual(serializeEnquiryContent({ ...payload, details: `${"A".repeat(160)} Repair the rear fence.` }),
    serializeEnquiryContent({ ...payload, details: `${"A".repeat(160)} Repair the front gate.` }));
  // Only line-ending normalization is applied.
  assert.equal(serializeEnquiryContent({ ...payload, details: "line one\r\nline two" }),
    serializeEnquiryContent({ ...payload, details: "line one\nline two" }));
});

// --- Checklist 21/22: unchanged repeat + separate enquiry ------------------

test("unchanged repeat: no new email, design copy, original reference, no conversion", async () => {
  freezeNow(T);
  const harness = makeHarness();
  await withStub({}, async (calls) => {
    const first = await harness.post();
    const { ref: originalRef } = await resultJson(harness, first);

    const repeatNewId = await harness.post();
    const { html } = await resultHtml(harness, repeatNewId);
    assert.match(html, /No new email was sent because this matches an earlier request accepted by our email service\. Reference:/);
    assert.ok(html.includes(originalRef), "repeat result must link the original reference");
    assert.ok(html.includes("Send as a separate enquiry"), "repeat result must offer the separate-enquiry action");
    assert.equal(calls.resend, 1, "an unchanged repeat must not send another email");

    const { json } = await resultJson(harness, repeatNewId);
    assert.equal(json.conversionEligible, false, "a duplicate refusal must never convert");

    // Same submission id, same content: same duplicate outcome.
    const sameId = await harness.post({ submission_id: "sub_repeat_same", details: "Same-id job" });
    assert.equal((await resultJson(harness, sameId)).json.status, "delivered");
    const sameIdRepeat = await harness.post({ submission_id: "sub_repeat_same", details: "Same-id job" });
    const { json: sameIdJson } = await resultJson(harness, sameIdRepeat);
    assert.equal(sameIdJson.reasonCode, "duplicate");
    assert.equal(calls.resend, 2);
  });
});

test("explicit separate enquiry with identical content delivers independently", async () => {
  freezeNow(T);
  const harness = makeHarness();
  await withStub({}, async (calls) => {
    await harness.post();
    assert.equal(calls.resend, 1);
    const separate = await harness.post({ separate_enquiry: "1" });
    const { json } = await resultJson(harness, separate);
    assert.equal(json.status, "delivered");
    assert.equal(calls.resend, 2);
    assert.match(calls.resendBodies[1].text, /separate enquiry/);
  });
});

test("a repeat after the 24-hour window delivers again", async () => {
  const harness = makeHarness();
  await withStub({}, async (calls) => {
    freezeNow(T);
    await harness.post();
    assert.equal(calls.resend, 1);
    freezeNow(T + 86400001);
    const later = await harness.post({ form_started_at: String(T + 86400001 - 5000) });
    assert.equal((await resultJson(harness, later)).json.status, "delivered");
    assert.equal(calls.resend, 2);
  });
});

// --- Checklist 23/24: retry + concurrency ----------------------------------

test("a failed attempt never consumes the duplicate slot: the retry delivers (provider and challenge failures)", async () => {
  freezeNow(T);
  const harness = makeHarness();
  await withStub({ resend: [{ status: 500 }, { status: 200 }] }, async (calls) => {
    const first = await harness.post();
    assert.equal((await resultJson(harness, first)).json.reasonCode, "provider_failed");
    const retry = await harness.post();
    assert.equal((await resultJson(harness, retry)).json.status, "delivered");
    assert.equal(calls.resend, 2);
  });

  const harness2 = makeHarness();
  freezeNow(T);
  await withStub(
    {
      turnstile: [{ success: false, hostname: "maestrosservices.example", action: "quote_form" }, TURNSTILE_OK],
      resend: [{ status: 200 }],
    },
    async (calls) => {
      const first = await harness2.post();
      assert.equal((await resultJson(harness2, first)).json.reasonCode, "challenge_failed");
      const retry = await harness2.post();
      assert.equal((await resultJson(harness2, retry)).json.status, "delivered");
      assert.equal(calls.resend, 1);
    }
  );
});

test("concurrent identical attempts: exactly one provider send, the other is explicitly refused", async () => {
  freezeNow(T);
  const harness = makeHarness();
  await withStub({}, async (calls) => {
    const [a, b] = await Promise.all([harness.post(), harness.post()]);
    assert.equal(calls.resend, 1, "concurrent identical attempts must produce one send");
    const outcomes = [];
    for (const response of [a, b]) {
      const { json } = await resultJson(harness, response);
      outcomes.push(`${json.status}:${json.reasonCode ?? ""}`);
    }
    assert.ok(outcomes.some((entry) => entry.startsWith("delivered")), outcomes.join(", "));
    assert.ok(
      outcomes.some(
        (entry) => entry.includes("delivery_unconfirmed_exists") || entry.includes("duplicate")
      ),
      outcomes.join(", ")
    );
  });
});

test("concurrent retries of one submission id reconcile to a single send", async () => {
  freezeNow(T);
  const harness = makeHarness();
  await withStub({}, async (calls) => {
    const [a, b] = await Promise.all([
      harness.post({ submission_id: "sub_concurrent_one" }),
      harness.post({ submission_id: "sub_concurrent_one" }),
    ]);
    assert.equal(calls.resend, 1);
    const outcomes = [];
    for (const response of [a, b]) {
      outcomes.push((await resultJson(harness, response)).json);
    }
    assert.ok(outcomes.some((entry) => entry.status === "delivered"), "one attempt must own the delivery");
    assert.ok(
      outcomes.every((entry) => entry.status === "delivered" || entry.reasonCode === "duplicate"),
      "the other response must reconcile (same result page) or report the duplicate — never a second send"
    );
  });
});

// --- Checklist 25/26: provider errors, ambiguity, reconciliation -----------

test("provider error matrix: explicit failures and unconfirmed outcomes, never success", async () => {
  freezeNow(T);
  const cases = [
    { name: "HTTP 400", resend: [{ status: 400 }], status: "rejected", reason: "provider_failed" },
    { name: "HTTP 429", resend: [{ status: 429 }], status: "rejected", reason: "provider_failed" },
    { name: "HTTP 500", resend: [{ status: 500 }], status: "rejected", reason: "provider_failed" },
    { name: "network exception", resend: ["throw"], status: "unconfirmed", reason: "provider_unconfirmed" },
    { name: "OK with empty body", resend: [{ status: 200, rawBody: "" }], status: "unconfirmed", reason: "provider_unconfirmed" },
    { name: "OK with malformed JSON", resend: [{ status: 200, rawBody: "not json" }], status: "unconfirmed", reason: "provider_unconfirmed" },
    { name: "OK without message ID", resend: [{ status: 200, body: {} }], status: "unconfirmed", reason: "provider_unconfirmed" },
  ];
  for (const testCase of cases) {
    const harness = makeHarness();
    await withStub({ resend: testCase.resend }, async (calls) => {
      freezeNow(T);
      const response = await harness.post();
      const { ref, json } = await resultJson(harness, response);
      assert.equal(json.status, testCase.status, testCase.name);
      assert.equal(json.reasonCode, testCase.reason, testCase.name);
      assert.equal(json.conversionEligible, false, testCase.name);
      const record = await harness.store.getAttemptByReference(ref);
      assert.equal(record.providerMessageId, null, testCase.name);
      assert.equal(calls.resend, 1, testCase.name);
      // Entered values survive on the result page.
      const { html } = await resultHtml(harness, response);
      assert.ok(html.includes("Alice Example"), `${testCase.name}: values must be preserved`);
    });
  }

  const noKey = makeHarness({ RESEND_API_KEY: "" });
  freezeNow(T);
  await withStub({}, async (calls) => {
    const response = await noKey.post();
    assert.equal((await resultJson(noKey, response)).json.reasonCode, "provider_not_configured");
    assert.equal(calls.resend, 0);
  });
});

test("ambiguous acceptance reconciles on retry with the same idempotency key — no blind resend", async () => {
  freezeNow(T);
  const harness = makeHarness();
  await withStub({ resend: ["throw", { status: 200 }] }, async (calls) => {
    const first = await harness.post({ submission_id: "sub_ambiguous" });
    const { html } = await resultHtml(harness, first);
    assert.match(html, /could not confirm delivery/i);
    assert.equal(calls.resend, 1);

    const retry = await harness.post({ submission_id: "sub_ambiguous" });
    const { json } = await resultJson(harness, retry);
    assert.equal(json.status, "delivered");
    assert.equal(calls.resend, 2, "reconciliation re-contacts the provider once");
    assert.ok(calls.resendKeys[0], "first attempt must carry an idempotency key");
    assert.equal(calls.resendKeys[1], calls.resendKeys[0], "the retry must reuse the same idempotency key");
  });
});

test("while an identical enquiry is unconfirmed, a different submission is told so — not fake-accepted", async () => {
  freezeNow(T);
  const harness = makeHarness();
  await withStub({ resend: ["throw"] }, async (calls) => {
    await harness.post({ submission_id: "sub_stuck" });
    const other = await harness.post();
    const { json } = await resultJson(harness, other);
    assert.equal(json.reasonCode, "delivery_unconfirmed_exists");
    assert.equal(calls.resend, 1);
  });
});

// --- Checklist 27: storage outage ------------------------------------------

test("without a durable intake store the endpoint fails closed with a visible 503", async () => {
  freezeNow(T);
  const harness = makeHarness({ __quoteStore: undefined, QUOTE_DB: undefined, QUOTE_ALLOW_MEMORY_STORE: "" });
  await withStub({}, async (calls) => {
    const response = await harness.post();
    assert.equal(response.status, 503);
    const html = await response.text();
    assert.match(html, /temporarily unavailable/);
    assert.equal(calls.resend, 0);
    assert.equal(calls.turnstile, 0);
  });
});

// --- Checklist 30: forged success URLs -------------------------------------

test("forged result references and bare status params confirm nothing", async () => {
  const harness = makeHarness();
  const forged = await harness.get("submitted=1&lead_event_id=lead_forged");
  assert.equal(forged.status, 404);
  const forgedHtml = await forged.text();
  assert.equal(forgedHtml.includes("accepted by our email service"), false);

  const unknown = await harness.get("ref=MS-DOESNOTEXIST");
  assert.equal(unknown.status, 404);
  const unknownJson = await harness.get("ref=MS-DOESNOTEXIST&format=json");
  assert.equal(unknownJson.status, 404);
  assert.deepEqual(await unknownJson.json(), { error: "not_found" });
});

// --- Fix round (Codex P1): ambiguous state survives failed verification ----
// A resumed `unconfirmed` attempt may already have been accepted by the
// provider. A missing/failed/unavailable challenge on the retry establishes
// nothing about that earlier send, so the record must stay unconfirmed with
// its content claim held — overwriting it as rejected would release the
// claim and let a fresh submission re-send under a new idempotency key.

test("resumed unconfirmed attempt: a missing challenge preserves state, claim, and idempotency key", async () => {
  freezeNow(T);
  const harness = makeHarness();
  await withStub({ resend: ["throw", { status: 200 }] }, async (calls) => {
    const first = await harness.post({ submission_id: "sub_p1_missing" });
    const firstRef = refFromRedirect(first);
    const stuck = await harness.store.getAttemptByReference(firstRef);
    assert.equal(stuck.status, "unconfirmed");
    assert.equal(stuck.claimActive, true);
    assert.equal(calls.resend, 1);

    // Retry of the same submission without a challenge token.
    const retry = await harness.post({ submission_id: "sub_p1_missing", "cf-turnstile-response": null });
    assert.equal(refFromRedirect(retry), firstRef, "the retry must land on the original attempt");
    const preserved = await harness.store.getAttemptByReference(firstRef);
    assert.equal(preserved.status, "unconfirmed", "ambiguous state must survive a missing challenge");
    assert.equal(preserved.reasonCode, "provider_unconfirmed");
    assert.equal(preserved.claimActive, true, "the content claim must stay held");
    assert.equal(calls.resend, 1, "no second provider send may occur");
    assert.equal(calls.turnstile, 1, "a missing token short-circuits before verification");

    // A fresh submission of the same content is still suppressed — no send
    // under a new idempotency key.
    const fresh = await harness.post();
    assert.equal((await resultJson(harness, fresh)).json.reasonCode, "delivery_unconfirmed_exists");
    assert.equal(calls.resend, 1);

    // A retry that passes the challenge reconciles with the SAME key.
    const reconciled = await harness.post({ submission_id: "sub_p1_missing" });
    assert.equal((await resultJson(harness, reconciled)).json.status, "delivered");
    assert.equal(calls.resend, 2);
    assert.equal(calls.resendKeys[1], calls.resendKeys[0], "the reconciling retry reuses the original idempotency key");
  });
});

test("resumed unconfirmed attempt: a failed challenge verification preserves state and claim", async () => {
  freezeNow(T);
  const harness = makeHarness();
  await withStub(
    {
      turnstile: [TURNSTILE_OK, { success: false, hostname: "maestrosservices.example", action: "quote_form" }],
      resend: ["throw"],
    },
    async (calls) => {
      const first = await harness.post({ submission_id: "sub_p1_failed" });
      const firstRef = refFromRedirect(first);
      assert.equal((await harness.store.getAttemptByReference(firstRef)).status, "unconfirmed");

      const retry = await harness.post({ submission_id: "sub_p1_failed" });
      assert.equal(refFromRedirect(retry), firstRef);
      const preserved = await harness.store.getAttemptByReference(firstRef);
      assert.equal(preserved.status, "unconfirmed", "a failed verification must not overwrite the ambiguous attempt");
      assert.equal(preserved.claimActive, true);
      assert.equal(calls.resend, 1, "no second provider send may occur");

      const fresh = await harness.post();
      assert.equal((await resultJson(harness, fresh)).json.reasonCode, "delivery_unconfirmed_exists");
      assert.equal(calls.resend, 1, "a fresh submission must not send while the claim is held");
    }
  );
});

test("resumed unconfirmed attempt: an unavailable challenge verification preserves state and claim", async () => {
  freezeNow(T);
  const harness = makeHarness();
  await withStub({ turnstile: [TURNSTILE_OK, "throw"], resend: ["throw"] }, async (calls) => {
    const first = await harness.post({ submission_id: "sub_p1_unavailable" });
    const firstRef = refFromRedirect(first);
    const retry = await harness.post({ submission_id: "sub_p1_unavailable" });
    assert.equal(refFromRedirect(retry), firstRef);
    const preserved = await harness.store.getAttemptByReference(firstRef);
    assert.equal(preserved.status, "unconfirmed");
    assert.equal(preserved.claimActive, true);
    assert.equal(calls.resend, 1);
  });
});

test("resumed stale sending attempt: a missing challenge normalizes to unconfirmed and holds the claim", async () => {
  const harness = makeHarness();
  const payload = {
    name: "Alice Example",
    phone: "2505550100",
    email: "alice@example.com",
    area: "Victoria",
    service: "fence",
    timeline: "flexible",
    preferredContact: "text",
    details: "Repair the front gate.",
    tracking: {},
  };
  const content = serializeEnquiryContent(payload);
  // Seed the record a crashed invocation would leave behind: created as
  // "sending", never finalized, claim held.
  const { createHash } = await import("node:crypto");
  const contentHash = createHash("sha256").update(content).digest("hex");
  await harness.store.createAttempt({
    id: "att_stale_sending_seed",
    submissionId: "sub_p1_stale",
    reference: "MS-STALESEED1",
    createdAt: T,
    updatedAt: T,
    status: "sending",
    reasonCode: null,
    fieldErrors: [],
    riskScore: 0,
    riskFlags: [],
    contentHash,
    content,
    payload,
    providerMessageId: null,
    providerStatus: null,
    recipient: null,
    separateOf: null,
    retryAfterSeconds: null,
    returnTo: "/quote#quote",
    claimActive: true,
    deliveredAt: null,
  });
  // Resume it after the sending window has gone stale, with no token.
  freezeNow(T + 16 * 60 * 1000);
  await withStub({}, async (calls) => {
    const retry = await harness.post({ submission_id: "sub_p1_stale", "cf-turnstile-response": null });
    assert.equal(refFromRedirect(retry), "MS-STALESEED1");
    const preserved = await harness.store.getAttemptByReference("MS-STALESEED1");
    assert.equal(preserved.status, "unconfirmed", "a stale sending attempt is ambiguous, not rejected");
    assert.equal(preserved.reasonCode, "provider_unconfirmed");
    assert.equal(preserved.claimActive, true);
    assert.equal(calls.resend, 0, "no provider send may occur");
  });
});

// --- Fix round (Codex P2): result-page resubmission conversion tracking ----
// Result pages are standalone documents: the resubmission form must carry
// the same confirmed-delivery tracking path as the main quote form
// (verify the durable record, then fire generate_lead + the Ads conversion,
// deduplicated by reference), while the delivered result page itself stays
// inert — a bare page view fires nothing (checklist 30).

const ANALYTICS_ENV = {
  PUBLIC_GA_ID: "G-TEST123",
  PUBLIC_GOOGLE_ADS_ID: "AW-TEST456",
  PUBLIC_GOOGLE_ADS_QUOTE_LABEL: "AW-TEST456/quote-label",
};

const assertResubmissionTracking = (html, label) => {
  assert.ok(html.includes("__MS_QUOTE_RESULT_ANALYTICS__"), `${label}: analytics config must be embedded`);
  assert.ok(html.includes("G-TEST123"), `${label}: GA id must be embedded`);
  assert.ok(html.includes("AW-TEST456/quote-label"), `${label}: Ads quote label must be embedded`);
  assert.ok(html.includes("ms_quote_success:"), `${label}: reference-keyed dedupe must be present`);
  assert.ok(html.includes("format=json"), `${label}: the record must be verified before firing`);
  assert.ok(html.includes('gtag("event", "generate_lead"'), `${label}: generate_lead must be wired`);
  assert.ok(html.includes('gtag("event", "conversion"'), `${label}: the Ads conversion must be wired`);
  assert.equal(
    html.split('gtag("event", "generate_lead"').length - 1,
    1,
    `${label}: exactly one generate_lead call site`
  );
};

test("result-page resubmission forms carry the confirmed-delivery conversion path; delivered pages stay inert", async () => {
  freezeNow(T);
  const harness = makeHarness(ANALYTICS_ENV);
  await withStub({}, async (calls) => {
    // A validation rejection renders the native correction form.
    const bad = await harness.post({ phone: "123" });
    const { html: rejectedHtml } = await resultHtml(harness, bad);
    assertResubmissionTracking(rejectedHtml, "validation result page");

    // A delivered result page viewed bare carries no conversion wiring.
    const good = await harness.post();
    const { html: deliveredHtml } = await resultHtml(harness, good);
    assert.equal(deliveredHtml.includes("__MS_QUOTE_RESULT_ANALYTICS__"), false, "delivered page must not embed the tracker");
    assert.equal(deliveredHtml.includes("generate_lead"), false, "delivered page must not fire on a bare view");

    // A duplicate refusal renders the separate-enquiry form with tracking.
    const repeat = await harness.post();
    const { html: duplicateHtml } = await resultHtml(harness, repeat);
    assert.match(duplicateHtml, /No new email was sent/);
    assertResubmissionTracking(duplicateHtml, "duplicate result page");
    assert.equal(calls.resend, 1);
  });
});

test("result-page resubmission to delivered: exactly one provider send, conversion-eligible for the new reference only", async () => {
  freezeNow(T);
  const harness = makeHarness(ANALYTICS_ENV);
  await withStub({}, async (calls) => {
    const bad = await harness.post({ phone: "123" });
    const badResult = await resultJson(harness, bad);
    assert.equal(badResult.json.reasonCode, "validation_failed");
    assert.equal(badResult.json.conversionEligible, false);
    assert.equal(calls.resend, 0);

    // The corrected resubmission (what the result-page form posts) delivers
    // exactly once and is the one conversion-eligible record.
    const corrected = await harness.post({ submission_id: "sub_corrected_once" });
    const correctedResult = await resultJson(harness, corrected);
    assert.equal(correctedResult.json.status, "delivered");
    assert.equal(correctedResult.json.conversionEligible, true);
    assert.equal(calls.resend, 1, "the resubmission must produce exactly one provider send");

    const record = await harness.store.getAttemptByReference(correctedResult.ref);
    assert.equal(record.providerMessageId, "msg_1");
  });
});

// Holds the first two submission-id lookups for `submissionId` until both
// have arrived, so two concurrent requests both observe "no attempt yet"
// before either can create one — the double-click window, made
// deterministic.
const armLookupBarrier = (store, submissionId) => {
  const original = store.getLatestAttemptBySubmissionId.bind(store);
  let arrived = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  store.getLatestAttemptBySubmissionId = async (id) => {
    if (id === submissionId && arrived < 2) {
      arrived += 1;
      if (arrived === 2) release();
      await gate;
    }
    return original(id);
  };
};

// --- Submission identity conflicts ------------------------------------------

test("the same submission id with changed content is a visible conflict, not a send", async () => {
  freezeNow(T);
  const harness = makeHarness();
  await withStub({}, async (calls) => {
    await harness.post({ submission_id: "sub_conflict" });
    assert.equal(calls.resend, 1);
    const changed = await harness.post({ submission_id: "sub_conflict", details: "A different job entirely." });
    const { json } = await resultJson(harness, changed);
    assert.equal(json.reasonCode, "submission_conflict");
    assert.equal(calls.resend, 1);
  });
});

// --- Fix round 2 (Codex P2-A): replay the original provider payload -------
// The attempt id is the provider idempotency key, and the provider rejects
// a reused key whose payload differs (HTTP 409). Risk flags are
// time-dependent, so rebuilding the email on a reconciling retry can
// change its subject/HTML/text under the same key; the resulting 409 was
// then treated as a definitive failure, marking a possibly accepted
// attempt rejected and releasing its claim. The original payload must be
// persisted and replayed byte-for-byte, and a retry response that does
// not establish the original send's outcome must preserve the ambiguity.

test("reconciling retry replays the original provider payload byte-for-byte under the original key", async () => {
  freezeNow(T);
  const harness = makeHarness();
  await withStub({ resend: ["throw", { status: 200 }] }, async (calls) => {
    // The first submission completes fast, so its email carries the
    // review-requested flag; the send then loses its acceptance response.
    const first = await harness.post({ submission_id: "sub_p2a_replay", form_started_at: String(T - 100) });
    const firstRef = refFromRedirect(first);
    const stuck = await harness.store.getAttemptByReference(firstRef);
    assert.equal(stuck.status, "unconfirmed");
    assert.equal(calls.resend, 1);
    assert.match(calls.resendBodies[0].subject, /^\[Review requested\]/);

    // The retry arrives after the fast-completion window: a fresh risk
    // assessment is unflagged, so rebuilding the email here would change
    // it under the same idempotency key.
    const retry = await harness.post({ submission_id: "sub_p2a_replay", form_started_at: String(T - 10000) });
    assert.equal(refFromRedirect(retry), firstRef);
    assert.equal((await resultJson(harness, retry)).json.status, "delivered");
    assert.equal(calls.resend, 2);
    assert.equal(calls.resendKeys[1], calls.resendKeys[0], "the retry must reuse the original idempotency key");
    assert.equal(
      JSON.stringify(calls.resendBodies[1]),
      JSON.stringify(calls.resendBodies[0]),
      "the retry must replay the original provider payload byte-for-byte"
    );
    const record = await harness.store.getAttemptByReference(firstRef);
    assert.ok(record.providerPayload, "the original provider payload must be persisted on the record");
    assert.deepEqual(JSON.parse(record.providerPayload), calls.resendBodies[0]);
  });
});

test("a non-establishing provider response on a reconciling retry preserves the ambiguous state and claim", async () => {
  freezeNow(T);
  const harness = makeHarness();
  await withStub({ resend: ["throw", { status: 409 }] }, async (calls) => {
    const first = await harness.post({ submission_id: "sub_p2a_conflict" });
    const firstRef = refFromRedirect(first);
    assert.equal((await harness.store.getAttemptByReference(firstRef)).status, "unconfirmed");
    assert.equal(calls.resend, 1);

    // A 409 on the retry establishes only that the idempotency key was
    // already used — nothing about whether the original send was
    // accepted — so it must not resolve the attempt as rejected.
    const retry = await harness.post({ submission_id: "sub_p2a_conflict" });
    assert.equal(refFromRedirect(retry), firstRef);
    const preserved = await harness.store.getAttemptByReference(firstRef);
    assert.equal(preserved.status, "unconfirmed", "a 409 on a reconciling retry must not mark the attempt rejected");
    assert.equal(preserved.reasonCode, "provider_unconfirmed");
    assert.equal(preserved.providerStatus, 409);
    assert.equal(preserved.claimActive, true, "the content claim must stay held");
    assert.equal(calls.resend, 2);

    // The held claim still suppresses a fresh submission of the same
    // content — no send under a new idempotency key.
    const fresh = await harness.post();
    assert.equal((await resultJson(harness, fresh)).json.reasonCode, "delivery_unconfirmed_exists");
    assert.equal(calls.resend, 2);
  });
});

test("a resumed attempt with no persisted payload builds its email from the stored payload and risk, not the retry's", async () => {
  const harness = makeHarness();
  const payload = {
    name: "Alice Example",
    phone: "2505550100",
    email: "alice@example.com",
    area: "Victoria",
    service: "fence",
    timeline: "flexible",
    preferredContact: "text",
    details: "Repair the front gate.",
    tracking: {},
  };
  const content = serializeEnquiryContent(payload);
  const { createHash } = await import("node:crypto");
  const contentHash = createHash("sha256").update(content).digest("hex");
  // Seed a pre-existing ambiguous record with no persisted provider
  // payload (the state an invocation that stopped before its first send
  // leaves behind), assessed unflagged at submission time.
  await harness.store.createAttempt({
    id: "att_p2a_legacy_seed",
    submissionId: "sub_p2a_legacy",
    reference: "MS-LEGACYSEED",
    createdAt: T,
    updatedAt: T,
    status: "sending",
    reasonCode: null,
    fieldErrors: [],
    riskScore: 0,
    riskFlags: [],
    contentHash,
    content,
    payload,
    providerMessageId: null,
    providerStatus: null,
    recipient: null,
    separateOf: null,
    retryAfterSeconds: null,
    returnTo: "/quote#quote",
    claimActive: true,
    deliveredAt: null,
  });
  freezeNow(T + 16 * 60 * 1000);
  await withStub({}, async (calls) => {
    // The retry itself completes instantly (a fresh assessment would flag
    // it), but the email must be the one the original assessment produced.
    const retry = await harness.post({
      submission_id: "sub_p2a_legacy",
      form_started_at: String(T + 16 * 60 * 1000),
    });
    assert.equal(refFromRedirect(retry), "MS-LEGACYSEED");
    assert.equal(calls.resend, 1);
    assert.equal(
      calls.resendBodies[0].subject,
      "New quote request - Alice Example",
      "the email must be built from the stored (unflagged) risk assessment, not the retry's fresh one"
    );
    const record = await harness.store.getAttemptByReference("MS-LEGACYSEED");
    assert.equal(record.status, "delivered");
    assert.ok(record.providerPayload, "the built payload must be persisted for any further retry");
    assert.deepEqual(JSON.parse(record.providerPayload), calls.resendBodies[0]);
  });
});

// --- Fix round 2 (Codex P2-B): separate-enquiry submission identity -------
// The separate-enquiry override deliberately bypasses content-repeat
// suppression, but retries of that ONE separate submission (a double-click
// on the result-page form) must still not multiply: two concurrent
// submissions carrying the same submission id resolve to a single attempt
// and a single provider send.

test("concurrent separate-enquiry submissions of one submission id produce exactly one send", async () => {
  freezeNow(T);
  const harness = makeHarness();
  await withStub({}, async (calls) => {
    // The original enquiry delivers and holds the content claim.
    const original = await harness.post();
    const originalRef = refFromRedirect(original);
    assert.equal(calls.resend, 1);

    // Hold both submission-id lookups until both have arrived, so both
    // requests observe "no attempt yet" before either can create one.
    armLookupBarrier(harness.store, "sub_separate_race");
    const [a, b] = await Promise.all([
      harness.post({ submission_id: "sub_separate_race", separate_enquiry: "1" }),
      harness.post({ submission_id: "sub_separate_race", separate_enquiry: "1" }),
    ]);
    assert.equal(calls.resend, 2, "exactly one separate-enquiry send may occur");
    const refA = refFromRedirect(a);
    const refB = refFromRedirect(b);
    assert.equal(refA, refB, "both submissions must resolve to the same attempt");
    assert.notEqual(refA, originalRef);
    const record = await harness.store.getAttemptByReference(refA);
    assert.equal(record.status, "delivered");
    assert.equal(record.separateOf, originalRef);
  });
});

test("the result-page resubmission script disables its submit button on submit", async () => {
  freezeNow(T);
  const harness = makeHarness();
  await withStub({}, async (calls) => {
    await harness.post();
    const repeat = await harness.post();
    const { html } = await resultHtml(harness, repeat);
    assert.match(html, /No new email was sent/);
    assert.ok(
      html.includes("submitButton.disabled = true"),
      "the resubmission form must disable its submit button on submit (defence in depth)"
    );
    assert.equal(calls.resend, 1);
  });
});

// --- Consolidation pass: the reconciliation state machine -----------------
// Two invariants, proven at the machine level:
//
// I1 (monotonic delivered): once an attempt is delivered, no overlapping
// reconciliation outcome — a provider error, a provider exception, or a
// verification failure landing afterwards — may move it out of delivered.
// I2 (idempotency window): the stored payload may be replayed under the
// original idempotency key only while the first send is inside the
// provider's 24-hour retention window for that key. Past the window a
// replay would be a new send, so nothing is sent and the ambiguous
// outcome is preserved for manual reconciliation.

const PROVIDER_WINDOW_MS = 24 * 60 * 60 * 1000;

const MACHINE_PAYLOAD = {
  name: "Alice Example",
  phone: "2505550100",
  email: "alice@example.com",
  area: "Victoria",
  service: "fence",
  timeline: "flexible",
  preferredContact: "text",
  details: "Repair the front gate.",
  tracking: {},
};

const MACHINE_PROVIDER_BODY = JSON.stringify({
  from: "Maestros Services <quotes@maestrosservices.com>",
  to: ["quotes@maestrosservices.com"],
  subject: "New quote request - Alice Example",
  html: "<p>seeded provider body</p>",
  text: "seeded provider body",
});

// Seeds the record an interrupted first send leaves behind: ambiguous,
// claim held, payload persisted with its first-send stamp.
const seedAmbiguousAttempt = async (harness, overrides = {}) => {
  const { createHash } = await import("node:crypto");
  const content = serializeEnquiryContent(MACHINE_PAYLOAD);
  const record = {
    id: "att_machine_seed",
    submissionId: "sub_machine_seed",
    reference: "MS-MACHINESEED",
    createdAt: T - 60 * 1000,
    updatedAt: T - 60 * 1000,
    status: "unconfirmed",
    reasonCode: "provider_unconfirmed",
    fieldErrors: [],
    riskScore: 0,
    riskFlags: [],
    contentHash: createHash("sha256").update(content).digest("hex"),
    content,
    payload: MACHINE_PAYLOAD,
    providerPayload: MACHINE_PROVIDER_BODY,
    providerSentAt: T - 60 * 1000,
    providerMessageId: null,
    providerStatus: null,
    recipient: null,
    separateOf: null,
    retryAfterSeconds: null,
    returnTo: "/quote#quote",
    claimActive: true,
    deliveredAt: null,
    ...overrides,
  };
  await harness.store.createAttempt(record);
  return record;
};

// A fetch stub whose Resend calls stay pending until the test settles
// them, so two overlapping reconciliations can be interleaved exactly.
// Optionally holds the first Turnstile verification the same way.
const installOverlapStub = ({ holdFirstTurnstile = false } = {}) => {
  const state = {
    turnstile: 0,
    resend: 0,
    resendKeys: [],
    pendingResend: [],
    heldTurnstileResolve: null,
  };
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.startsWith("https://challenges.cloudflare.com/")) {
      state.turnstile += 1;
      if (holdFirstTurnstile && state.turnstile === 1) {
        return new Promise((resolve) => {
          state.heldTurnstileResolve = resolve;
        });
      }
      return new Response(JSON.stringify(TURNSTILE_OK), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (target === "https://api.resend.com/emails") {
      state.resend += 1;
      state.resendKeys.push(init.headers["Idempotency-Key"] ?? null);
      return new Promise((resolve, reject) => {
        state.pendingResend.push({ resolve, reject });
      });
    }
    throw new Error(`Unexpected fetch in test: ${target}`);
  };
  return state;
};

const withOverlapStub = async (options, fn) => {
  const state = installOverlapStub(options);
  try {
    return await fn(state);
  } finally {
    globalThis.fetch = realFetch;
    unfreezeNow();
  }
};

const waitForCondition = async (condition, label) => {
  for (let i = 0; i < 1000; i += 1) {
    if (condition()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`timed out waiting for ${label}`);
};

const flushAsync = async () => {
  for (let i = 0; i < 25; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

const resendOkResponse = (id) =>
  new Response(JSON.stringify({ id }), { status: 200, headers: { "Content-Type": "application/json" } });
const resendErrorResponse = (status) =>
  new Response(JSON.stringify({ message: "provider error" }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

test("store transitionAttempt: delivered is terminal and a blocked transition reports false", async () => {
  const store = createMemoryQuoteStore();
  const { createHash } = await import("node:crypto");
  const content = serializeEnquiryContent(MACHINE_PAYLOAD);
  await store.createAttempt({
    id: "att_transition_contract",
    submissionId: "sub_transition_contract",
    reference: "MS-TRANSITION1",
    createdAt: T,
    updatedAt: T,
    status: "unconfirmed",
    reasonCode: "provider_unconfirmed",
    fieldErrors: [],
    riskScore: 0,
    riskFlags: [],
    contentHash: createHash("sha256").update(content).digest("hex"),
    content,
    payload: MACHINE_PAYLOAD,
    providerPayload: MACHINE_PROVIDER_BODY,
    providerSentAt: T,
    providerMessageId: null,
    providerStatus: null,
    recipient: null,
    separateOf: null,
    retryAfterSeconds: null,
    returnTo: "/quote#quote",
    claimActive: true,
    deliveredAt: null,
  });
  assert.equal(
    await store.transitionAttempt("att_transition_contract", {
      status: "delivered",
      providerMessageId: "msg_contract",
      deliveredAt: T,
    }),
    true,
    "the first confirmation applies"
  );
  assert.equal(
    await store.transitionAttempt("att_transition_contract", {
      status: "unconfirmed",
      reasonCode: "provider_unconfirmed",
    }),
    false,
    "a later outcome may not move the attempt out of delivered"
  );
  const record = await store.getAttemptById("att_transition_contract");
  assert.equal(record.status, "delivered");
  assert.equal(record.providerMessageId, "msg_contract");
});

test("overlapping reconciliations: a provider error landing after a concurrent confirmation cannot downgrade delivered", async () => {
  freezeNow(T);
  const harness = makeHarness();
  const seed = await seedAmbiguousAttempt(harness, {
    id: "att_overlap_err_after_ok",
    submissionId: "sub_overlap_err_after_ok",
    reference: "MS-OVERLAPEAO",
  });
  await withOverlapStub({}, async (state) => {
    const postA = harness.post({ submission_id: "sub_overlap_err_after_ok" });
    const postB = harness.post({ submission_id: "sub_overlap_err_after_ok" });
    await waitForCondition(() => state.pendingResend.length === 2, "both overlapping sends");
    assert.deepEqual(state.resendKeys, [seed.id, seed.id], "both reconciliations send under the original key");

    state.pendingResend[0].resolve(resendOkResponse("msg_overlap_eao"));
    await flushAsync();
    assert.equal((await harness.store.getAttemptByReference(seed.reference)).status, "delivered");

    state.pendingResend[1].resolve(resendErrorResponse(503));
    await Promise.all([postA, postB]);
    const record = await harness.store.getAttemptByReference(seed.reference);
    assert.equal(record.status, "delivered", "a later provider error must not downgrade a confirmed delivery");
    assert.equal(record.providerMessageId, "msg_overlap_eao");
    assert.equal(record.claimActive, true);
  });
});

test("overlapping reconciliations: a provider exception landing after a concurrent confirmation cannot downgrade delivered", async () => {
  freezeNow(T);
  const harness = makeHarness();
  const seed = await seedAmbiguousAttempt(harness, {
    id: "att_overlap_throw_after_ok",
    submissionId: "sub_overlap_throw_after_ok",
    reference: "MS-OVERLAPTAO",
  });
  await withOverlapStub({}, async (state) => {
    const postA = harness.post({ submission_id: "sub_overlap_throw_after_ok" });
    const postB = harness.post({ submission_id: "sub_overlap_throw_after_ok" });
    await waitForCondition(() => state.pendingResend.length === 2, "both overlapping sends");

    state.pendingResend[0].resolve(resendOkResponse("msg_overlap_tao"));
    await flushAsync();
    assert.equal((await harness.store.getAttemptByReference(seed.reference)).status, "delivered");

    state.pendingResend[1].reject(new Error("resend network failure"));
    await Promise.all([postA, postB]);
    const record = await harness.store.getAttemptByReference(seed.reference);
    assert.equal(record.status, "delivered", "a later provider exception must not downgrade a confirmed delivery");
    assert.equal(record.providerMessageId, "msg_overlap_tao");
  });
});

test("overlapping reconciliations: an error first and a confirmation second still ends delivered", async () => {
  freezeNow(T);
  const harness = makeHarness();
  const seed = await seedAmbiguousAttempt(harness, {
    id: "att_overlap_ok_after_err",
    submissionId: "sub_overlap_ok_after_err",
    reference: "MS-OVERLAPOAE",
  });
  await withOverlapStub({}, async (state) => {
    const postA = harness.post({ submission_id: "sub_overlap_ok_after_err" });
    const postB = harness.post({ submission_id: "sub_overlap_ok_after_err" });
    await waitForCondition(() => state.pendingResend.length === 2, "both overlapping sends");

    state.pendingResend[0].resolve(resendErrorResponse(503));
    await flushAsync();
    assert.equal((await harness.store.getAttemptByReference(seed.reference)).status, "unconfirmed");

    state.pendingResend[1].resolve(resendOkResponse("msg_overlap_oae"));
    await Promise.all([postA, postB]);
    const record = await harness.store.getAttemptByReference(seed.reference);
    assert.equal(record.status, "delivered", "any confirmation among the reconciliations wins");
    assert.equal(record.providerMessageId, "msg_overlap_oae");
  });
});

test("overlapping reconciliations: two provider errors leave the attempt unconfirmed with its claim held", async () => {
  freezeNow(T);
  const harness = makeHarness();
  const seed = await seedAmbiguousAttempt(harness, {
    id: "att_overlap_both_err",
    submissionId: "sub_overlap_both_err",
    reference: "MS-OVERLAPBERR",
  });
  await withOverlapStub({}, async (state) => {
    const postA = harness.post({ submission_id: "sub_overlap_both_err" });
    const postB = harness.post({ submission_id: "sub_overlap_both_err" });
    await waitForCondition(() => state.pendingResend.length === 2, "both overlapping sends");

    state.pendingResend[0].resolve(resendErrorResponse(503));
    state.pendingResend[1].resolve(resendErrorResponse(500));
    await Promise.all([postA, postB]);
    const record = await harness.store.getAttemptByReference(seed.reference);
    assert.equal(record.status, "unconfirmed", "no confirmation among the reconciliations leaves the outcome ambiguous");
    assert.equal(record.reasonCode, "provider_unconfirmed");
    assert.equal(record.providerMessageId, null);
    assert.equal(record.claimActive, true, "the content claim stays held");
  });
});

test("overlapping reconciliations: a verification failure landing after a concurrent delivery cannot downgrade it", async () => {
  freezeNow(T);
  const harness = makeHarness();
  const seed = await seedAmbiguousAttempt(harness, {
    id: "att_overlap_verify_fail",
    submissionId: "sub_overlap_verify_fail",
    reference: "MS-OVERLAPVF1",
  });
  await withOverlapStub({ holdFirstTurnstile: true }, async (state) => {
    // The first request resumes the attempt and parks inside its
    // challenge verification.
    const postB = harness.post({ submission_id: "sub_overlap_verify_fail" });
    await waitForCondition(() => state.turnstile === 1 && state.heldTurnstileResolve, "the held verification");

    // A concurrent retry verifies, replays, and confirms delivery.
    const postA = harness.post({ submission_id: "sub_overlap_verify_fail" });
    await waitForCondition(() => state.pendingResend.length === 1, "the concurrent send");
    state.pendingResend[0].resolve(resendOkResponse("msg_overlap_vf"));
    const responseA = await postA;
    assert.equal(refFromRedirect(responseA), seed.reference);
    assert.equal((await harness.store.getAttemptByReference(seed.reference)).status, "delivered");

    // The parked request's verification now fails. That establishes
    // nothing about the confirmed send and must not move the record.
    state.heldTurnstileResolve(
      new Response(
        JSON.stringify({ success: false, hostname: "maestrosservices.example", action: "quote_form" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    const responseB = await postB;
    assert.equal(refFromRedirect(responseB), seed.reference);
    const record = await harness.store.getAttemptByReference(seed.reference);
    assert.equal(record.status, "delivered", "a late verification failure must not downgrade a confirmed delivery");
    assert.equal(record.providerMessageId, "msg_overlap_vf");
    assert.equal((await resultJson(harness, responseB)).json.conversionEligible, true);
  });
});

test("a replay past the provider idempotency window sends nothing and preserves the ambiguous outcome", async () => {
  freezeNow(T);
  const harness = makeHarness();
  const seed = await seedAmbiguousAttempt(harness, {
    id: "att_window_expired",
    submissionId: "sub_window_expired",
    reference: "MS-WINDOWEXP1",
    createdAt: T - PROVIDER_WINDOW_MS - 5 * 60 * 1000,
    updatedAt: T - PROVIDER_WINDOW_MS - 5 * 60 * 1000,
    providerSentAt: T - PROVIDER_WINDOW_MS - 5 * 60 * 1000,
  });
  await withStub({}, async (calls) => {
    const retry = await harness.post({ submission_id: "sub_window_expired" });
    assert.equal(refFromRedirect(retry), seed.reference);
    assert.equal(calls.resend, 0, "no replay may occur once the provider's idempotency window has expired");
    const record = await harness.store.getAttemptByReference(seed.reference);
    assert.equal(record.status, "unconfirmed", "the ambiguous outcome is preserved for manual reconciliation");
    assert.equal(record.reasonCode, "provider_unconfirmed");
    assert.equal(record.claimActive, true, "the content claim stays held");
    const { html } = await resultHtml(harness, retry);
    assert.match(html, /We could not confirm delivery/, "the submitter lands on the existing unconfirmed result page");
  });
});

test("a stale sending attempt past the provider idempotency window is not replayed either", async () => {
  freezeNow(T);
  const harness = makeHarness();
  const seed = await seedAmbiguousAttempt(harness, {
    id: "att_window_stale_sending",
    submissionId: "sub_window_stale_sending",
    reference: "MS-WINDOWSTALE",
    status: "sending",
    reasonCode: null,
    createdAt: T - PROVIDER_WINDOW_MS - 60 * 1000,
    updatedAt: T - PROVIDER_WINDOW_MS - 60 * 1000,
    providerSentAt: T - PROVIDER_WINDOW_MS - 60 * 1000,
  });
  await withStub({}, async (calls) => {
    const retry = await harness.post({ submission_id: "sub_window_stale_sending" });
    assert.equal(refFromRedirect(retry), seed.reference);
    assert.equal(calls.resend, 0, "a stale sending attempt past the window must not be replayed");
    const record = await harness.store.getAttemptByReference(seed.reference);
    assert.equal(record.status, "unconfirmed", "the resumed attempt is normalized to the ambiguous state, not sent");
    assert.equal(record.reasonCode, "provider_unconfirmed");
    assert.equal(record.claimActive, true);
  });
});

test("a replay inside the provider idempotency window replays the stored payload under the original key", async () => {
  freezeNow(T);
  const harness = makeHarness();
  const seed = await seedAmbiguousAttempt(harness, {
    id: "att_window_open",
    submissionId: "sub_window_open",
    reference: "MS-WINDOWOPEN",
    createdAt: T - (PROVIDER_WINDOW_MS - 60 * 1000),
    updatedAt: T - (PROVIDER_WINDOW_MS - 60 * 1000),
    providerSentAt: T - (PROVIDER_WINDOW_MS - 60 * 1000),
  });
  await withStub({}, async (calls) => {
    const retry = await harness.post({ submission_id: "sub_window_open" });
    assert.equal(refFromRedirect(retry), seed.reference);
    assert.equal(calls.resend, 1, "inside the window the retry reconciles with the provider");
    assert.equal(calls.resendKeys[0], seed.id, "the replay uses the original idempotency key");
    assert.deepEqual(calls.resendBodies[0], JSON.parse(MACHINE_PROVIDER_BODY), "the replayed body is the stored payload");
    const record = await harness.store.getAttemptByReference(seed.reference);
    assert.equal(record.status, "delivered");
  });
});

test("a payload-bearing record with no send stamp is measured from its creation (pre-stamp records)", async () => {
  freezeNow(T);
  const harness = makeHarness();
  const seed = await seedAmbiguousAttempt(harness, {
    id: "att_window_legacy",
    submissionId: "sub_window_legacy",
    reference: "MS-WINDOWLEGACY",
    createdAt: T - PROVIDER_WINDOW_MS - 60 * 1000,
    updatedAt: T - 60 * 1000,
    providerSentAt: null,
  });
  await withStub({}, async (calls) => {
    const retry = await harness.post({ submission_id: "sub_window_legacy" });
    assert.equal(refFromRedirect(retry), seed.reference);
    assert.equal(calls.resend, 0, "a pre-stamp record created past the window must not be replayed");
    const record = await harness.store.getAttemptByReference(seed.reference);
    assert.equal(record.status, "unconfirmed");
    assert.equal(record.claimActive, true);
  });
});

// --- Fix round (Codex P2): result-page resubmissions keep attribution -----
// The POST handler reads attribution exclusively from submitted form
// fields. The main quote form fills its hidden tracking inputs from local
// storage, but the server-rendered result-page forms (validation-error
// correction + "Send as a separate enquiry") only preserved the business
// fields — a campaign-originated lead who resubmitted from a result page
// silently lost every UTM value, click ID, landing page, and referrer in
// the delivered enquiry. The result-page forms now carry the stored
// record's tracking as escaped hidden inputs.

const CAMPAIGN_TRACKING = {
  utm_source: "google",
  utm_medium: "cpc",
  utm_campaign: "spring-cleanup-2026",
  utm_content: "headline-a",
  utm_term: "landscaping victoria",
  gclid: "gclid-abc123",
  fbclid: "fbclid-def456",
  msclkid: "msclkid-ghi789",
  landing_page: "https://maestrosservices.com/landscaping/",
  referrer: "https://www.google.com/",
  page_title: "Landscaping Services | Maestros",
  page_path: "/landscaping/",
};

const decodeHtmlEntities = (value) =>
  value
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

// The fields a browser would submit from the result page's resubmission
// form: every named input's value, each select's chosen option, and each
// textarea's content, with attribute entities decoded the way the HTML
// parser decodes them before submission.
const formFieldsFromHtml = (html) => {
  const formMatch = html.match(/<form method="POST" action="\/api\/quote">([\s\S]*?)<\/form>/);
  assert.ok(formMatch, "result page must render the resubmission form");
  const formHtml = formMatch[1];
  const fields = {};
  for (const match of formHtml.matchAll(/<input\b[^>]*>/g)) {
    const name = match[0].match(/\bname="([^"]+)"/);
    if (!name) continue;
    const value = match[0].match(/\bvalue="([^"]*)"/);
    fields[name[1]] = decodeHtmlEntities(value ? value[1] : "");
  }
  for (const match of formHtml.matchAll(/<select\b[^>]*\bname="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
    const selected = match[2].match(/<option value="([^"]*)" selected>/);
    const first = match[2].match(/<option value="([^"]*)">/);
    fields[match[1]] = decodeHtmlEntities((selected ?? first)?.[1] ?? "");
  }
  for (const match of formHtml.matchAll(/<textarea\b[^>]*\bname="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g)) {
    fields[match[1]] = decodeHtmlEntities(match[2]);
  }
  return fields;
};

const assertAttributionInEmail = (body, label) => {
  assert.ok(body.text.includes("Attribution:"), `${label}: email must carry the attribution section`);
  assert.ok(body.text.includes("UTM source: google"), `${label}: UTM source`);
  assert.ok(body.text.includes("UTM campaign: spring-cleanup-2026"), `${label}: UTM campaign`);
  assert.ok(body.text.includes("gclid: gclid-abc123"), `${label}: gclid`);
  assert.ok(body.text.includes("Landing page: https://maestrosservices.com/landscaping/"), `${label}: landing page`);
  assert.ok(body.text.includes("Referrer: https://www.google.com/"), `${label}: referrer`);
};

test("attribution survives the validation-correction resubmission path end-to-end", async () => {
  freezeNow(T);
  const harness = makeHarness();
  await withStub({}, async (calls) => {
    const bad = await harness.post({ phone: "123", ...CAMPAIGN_TRACKING });
    assert.equal((await resultJson(harness, bad)).json.reasonCode, "validation_failed");
    assert.equal(calls.resend, 0);

    // The correction form renders the stored attribution as hidden inputs.
    const { html } = await resultHtml(harness, bad);
    const formFields = formFieldsFromHtml(html);
    for (const [field, value] of Object.entries(CAMPAIGN_TRACKING)) {
      assert.equal(formFields[field], value, `correction form must carry ${field}`);
    }

    // Submit what the form carries, with the phone corrected — the way a
    // visitor fixing the validation error would.
    const corrected = await harness.post({
      ...formFields,
      phone: "2505550100",
      form_started_at: String(T - 5000),
    });
    const { ref, json } = await resultJson(harness, corrected);
    assert.equal(json.status, "delivered");
    assert.equal(calls.resend, 1);
    const record = await harness.store.getAttemptByReference(ref);
    assert.deepEqual(record.payload.tracking, CAMPAIGN_TRACKING);
    assertAttributionInEmail(calls.resendBodies[0], "corrected resubmission");
  });
});

test("attribution survives the separate-enquiry resubmission path end-to-end", async () => {
  freezeNow(T);
  const harness = makeHarness();
  await withStub({}, async (calls) => {
    const first = await harness.post({ ...CAMPAIGN_TRACKING });
    const { ref: originalRef } = await resultJson(harness, first);
    assert.equal(calls.resend, 1);
    assertAttributionInEmail(calls.resendBodies[0], "original submission");

    // The unchanged repeat is refused as a duplicate and renders the
    // separate-enquiry form — carrying the original attribution.
    const repeat = await harness.post({ ...CAMPAIGN_TRACKING });
    const { html } = await resultHtml(harness, repeat);
    assert.match(html, /No new email was sent/);
    const formFields = formFieldsFromHtml(html);
    assert.equal(formFields.separate_enquiry, "1");
    for (const [field, value] of Object.entries(CAMPAIGN_TRACKING)) {
      assert.equal(formFields[field], value, `separate-enquiry form must carry ${field}`);
    }

    const separate = await harness.post({ ...formFields, form_started_at: String(T - 5000) });
    const { ref, json } = await resultJson(harness, separate);
    assert.equal(json.status, "delivered");
    assert.notEqual(ref, originalRef);
    assert.equal(calls.resend, 2);
    const record = await harness.store.getAttemptByReference(ref);
    assert.equal(record.separateOf, originalRef);
    assert.deepEqual(record.payload.tracking, CAMPAIGN_TRACKING);
    assertAttributionInEmail(calls.resendBodies[1], "separate-enquiry resubmission");
  });
});

test("tracking values with HTML metacharacters are escaped in the form and round-trip intact", async () => {
  freezeNow(T);
  const harness = makeHarness();
  const tricky = {
    utm_source: 'google"><script>alert(1)</script>',
    utm_campaign: "spring & 'cleanup' <2026>",
    referrer: 'https://example.com/?a=1&b="2"',
  };
  await withStub({}, async (calls) => {
    const bad = await harness.post({ phone: "123", ...tricky });
    const { html } = await resultHtml(harness, bad);

    // The rendered hidden inputs escape the values for the attribute
    // context: no raw metacharacter can break out of the value.
    assert.ok(!html.includes('value="google">'), "a raw quote must not terminate the attribute");
    assert.ok(!html.includes("<script>alert(1)</script>"), "no raw markup from a tracking value");
    assert.ok(html.includes("google&quot;&gt;&lt;script&gt;"), "the value must be entity-escaped");
    assert.ok(html.includes("spring &amp; &#39;cleanup&#39; &lt;2026&gt;"), "ampersand, quote, and angles escaped");

    // A browser decodes the entities on submission, so the delivered
    // record carries the original values byte-for-byte.
    const formFields = formFieldsFromHtml(html);
    assert.equal(formFields.utm_source, tricky.utm_source);
    assert.equal(formFields.utm_campaign, tricky.utm_campaign);
    assert.equal(formFields.referrer, tricky.referrer);
    const corrected = await harness.post({
      ...formFields,
      phone: "2505550100",
      form_started_at: String(T - 5000),
    });
    const { ref, json } = await resultJson(harness, corrected);
    assert.equal(json.status, "delivered");
    assert.equal(calls.resend, 1);
    const record = await harness.store.getAttemptByReference(ref);
    assert.equal(record.payload.tracking.utm_source, tricky.utm_source);
    assert.equal(record.payload.tracking.utm_campaign, tricky.utm_campaign);
    assert.equal(record.payload.tracking.referrer, tricky.referrer);
    assert.ok(calls.resendBodies[0].text.includes(`UTM source: ${tricky.utm_source}`));
  });
});

// ---------------------------------------------------------------------------
// D1 store: column-scoped patch writes (Codex P2, PR #31).
//
// Production runs the D1 store, whose read and write are separate steps
// the synchronous memory store cannot interleave — which is why the
// memory-store regression tests could not express this race: a retry's
// telemetry-only updateAttempt read the unconfirmed row, a concurrent
// reconciliation confirmed delivery through transitionAttempt, and the
// telemetry write's full-row UPDATE then restored the stale status and
// null message ID over the confirmed delivery. This fake answers
// SELECTs immediately from the committed rows but captures UPDATE
// executions and applies them only when the test flushes them, so two
// overlapping store writes land in a controlled order against the row
// as committed at that moment — the semantics D1/SQLite gives the real
// statements.
// ---------------------------------------------------------------------------

const normalizeSql = (sql) => sql.replace(/\s+/g, " ").trim();

const createFakeD1 = () => {
  const rows = new Map();
  const statements = [];
  const pendingUpdates = [];

  const applyInsert = (sql, binds) => {
    const match = /^INSERT INTO quote_attempts \(([^)]+)\) VALUES/.exec(normalizeSql(sql));
    assert.ok(match, `fake D1 cannot apply INSERT: ${sql}`);
    const row = {};
    match[1]
      .split(",")
      .map((column) => column.trim())
      .forEach((column, i) => {
        row[column] = binds[i];
      });
    rows.set(row.id, row);
    return 1;
  };

  const applyUpdate = (sql, binds) => {
    const match = /^UPDATE quote_attempts SET (.+) WHERE (.+)$/.exec(normalizeSql(sql));
    assert.ok(match, `fake D1 cannot apply UPDATE: ${sql}`);
    const [, setClause, whereClause] = match;
    let bindIndex = 0;
    const sets = setClause.split(",").map((part) => {
      const assignment = /^([a-z_]+) = (.+)$/.exec(part.trim());
      assert.ok(assignment, `fake D1 cannot parse assignment: ${part}`);
      const value = assignment[2] === "?" ? binds[bindIndex++] : Number(assignment[2]);
      return [assignment[1], value];
    });
    assert.ok(
      whereClause === "id = ?" || whereClause === "id = ? AND status <> 'delivered'",
      `fake D1 cannot apply UPDATE with WHERE: ${whereClause}`
    );
    const row = rows.get(binds[bindIndex]);
    if (!row) return 0;
    if (whereClause.includes("status <> 'delivered'") && row.status === "delivered") return 0;
    for (const [column, value] of sets) row[column] = value;
    return 1;
  };

  const db = {
    prepare(sql) {
      let binds = [];
      const statement = {
        bind(...values) {
          binds = values;
          return statement;
        },
        async first() {
          statements.push({ sql, binds: [...binds] });
          assert.ok(
            /^SELECT \* FROM quote_attempts WHERE id = \?$/.test(normalizeSql(sql)),
            `fake D1 cannot answer SELECT: ${sql}`
          );
          const row = rows.get(binds[0]);
          return row ? { ...row } : null;
        },
        run() {
          statements.push({ sql, binds: [...binds] });
          if (/^UPDATE\b/.test(normalizeSql(sql))) {
            // Deferred: the statement executes only when the test
            // flushes it, against the row committed at that moment.
            return new Promise((resolve) => {
              pendingUpdates.push({ sql, binds: [...binds], resolve });
            });
          }
          return Promise.resolve({ meta: { changes: applyInsert(sql, binds) } });
        },
      };
      return statement;
    },
  };

  // Applies one captured UPDATE (the first matching the predicate) and
  // resolves the store call that issued it.
  const flushUpdate = (predicate) => {
    const index = pendingUpdates.findIndex((entry) => predicate(entry.sql));
    assert.ok(index >= 0, "fake D1 has no pending UPDATE matching the predicate");
    const [entry] = pendingUpdates.splice(index, 1);
    entry.resolve({ meta: { changes: applyUpdate(entry.sql, entry.binds) } });
  };

  return { db, rows, statements, pendingUpdates, flushUpdate };
};

const settleStoreCalls = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

const d1SeedRecord = (overrides = {}) => ({
  id: "att_d1scoped0000000000001",
  submissionId: "sub_d1_scoped",
  reference: "MS-D1SCOPED01",
  createdAt: T,
  updatedAt: T,
  status: "unconfirmed",
  reasonCode: "provider_unconfirmed",
  fieldErrors: [],
  riskScore: 3,
  riskFlags: [],
  contentHash: "d1_scoped_hash",
  content: "v1:[]",
  payload: null,
  providerPayload: "{\"frozen\":true}",
  providerSentAt: T,
  providerMessageId: null,
  providerStatus: null,
  recipient: "owner@example.test",
  separateOf: null,
  retryAfterSeconds: null,
  returnTo: null,
  claimActive: true,
  deliveredAt: null,
  ...overrides,
});

test("D1 store: a telemetry patch landing after a concurrent delivery confirmation cannot erase it", async () => {
  const fake = createFakeD1();
  const store = createD1QuoteStore(fake.db);
  const seed = d1SeedRecord();
  await store.createAttempt(seed);

  // A retry records its risk telemetry (a non-outcome patch)...
  const telemetry = store.updateAttempt(seed.id, {
    riskScore: 41,
    riskFlags: ["burst"],
    updatedAt: T + 1000,
  });
  await settleStoreCalls();
  // ...while an overlapping reconciliation confirms delivery.
  const confirmation = store.transitionAttempt(seed.id, {
    status: "delivered",
    providerMessageId: "msg_race_winner",
    providerStatus: 200,
    deliveredAt: T + 2000,
    updatedAt: T + 2000,
  });
  await settleStoreCalls();
  assert.equal(fake.pendingUpdates.length, 2, "both writes are captured before either lands");

  // The telemetry statement names only its own columns.
  const telemetryStatement = fake.pendingUpdates.find(
    (entry) => !entry.sql.includes("status <> 'delivered'")
  );
  assert.ok(telemetryStatement, "the telemetry UPDATE is pending");
  assert.equal(
    normalizeSql(telemetryStatement.sql),
    "UPDATE quote_attempts SET updated_at = ?, risk_score = ?, risk_flags = ? WHERE id = ?"
  );
  assert.deepEqual(telemetryStatement.binds, [T + 1000, 41, JSON.stringify(["burst"]), seed.id]);

  // Land the confirmation first, then the telemetry write — the order
  // that erased the delivery under the full-row UPDATE.
  fake.flushUpdate((sql) => sql.includes("status <> 'delivered'"));
  fake.flushUpdate(() => true);
  const [, applied] = await Promise.all([telemetry, confirmation]);
  assert.equal(applied, true);

  const final = await store.getAttemptById(seed.id);
  assert.equal(final.status, "delivered");
  assert.equal(final.providerMessageId, "msg_race_winner");
  assert.equal(final.providerStatus, 200);
  assert.equal(final.deliveredAt, T + 2000);
  // The telemetry patch still lands — on its own columns only.
  assert.equal(final.riskScore, 41);
  assert.deepEqual(final.riskFlags, ["burst"]);
});

test("D1 store: transition writes are scoped to the patch columns and the delivered guard still decides", async () => {
  const fake = createFakeD1();
  const store = createD1QuoteStore(fake.db);
  const seed = d1SeedRecord();
  await store.createAttempt(seed);

  const confirm = store.transitionAttempt(seed.id, {
    status: "delivered",
    providerMessageId: "msg_scoped",
    deliveredAt: T + 5000,
    updatedAt: T + 5000,
  });
  await settleStoreCalls();
  assert.equal(fake.pendingUpdates.length, 1);
  assert.equal(
    normalizeSql(fake.pendingUpdates[0].sql),
    "UPDATE quote_attempts SET updated_at = ?, status = ?, provider_message_id = ?, delivered_at = ? WHERE id = ? AND status <> 'delivered'"
  );
  assert.deepEqual(fake.pendingUpdates[0].binds, [T + 5000, "delivered", "msg_scoped", T + 5000, seed.id]);
  fake.flushUpdate(() => true);
  assert.equal(await confirm, true);

  // A second transition against the now-delivered row is refused by the
  // guard, and nothing is rewritten.
  const downgrade = store.transitionAttempt(seed.id, {
    status: "unconfirmed",
    reasonCode: "provider_unconfirmed",
    updatedAt: T + 6000,
  });
  await settleStoreCalls();
  fake.flushUpdate(() => true);
  assert.equal(await downgrade, false);
  const final = await store.getAttemptById(seed.id);
  assert.equal(final.status, "delivered");
  assert.equal(final.providerMessageId, "msg_scoped");
  assert.equal(final.updatedAt, T + 5000);
});

test("D1 store: patch writes against a missing id are no-ops, matching the memory store", async () => {
  const fake = createFakeD1();
  const store = createD1QuoteStore(fake.db);
  const patch = store.updateAttempt("att_missing", { riskScore: 1, updatedAt: T });
  const transition = store.transitionAttempt("att_missing", { status: "delivered", updatedAt: T });
  await settleStoreCalls();
  assert.equal(fake.pendingUpdates.length, 2);
  fake.flushUpdate(() => true);
  fake.flushUpdate(() => true);
  await patch;
  assert.equal(await transition, false);
  assert.equal(await store.getAttemptById("att_missing"), null);
  assert.equal(fake.rows.size, 0);
});
