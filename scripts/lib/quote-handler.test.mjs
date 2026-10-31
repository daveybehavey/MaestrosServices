import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
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
