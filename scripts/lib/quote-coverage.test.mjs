import assert from "node:assert/strict";
import test from "node:test";

import {
  createMemoryQuoteStore,
  onRequestPost,
  serializeEnquiryContent,
} from "../../functions/api/quote.ts";

// Coverage expansion for quote-adjacent pure logic exercised through the
// existing fake-store / fake-provider seams. Each test names the regression
// it catches; expectations are hand-computed from the documented rules in
// functions/api/quote.ts (outer trim + line endings; honeypot +2, timing +1,
// link +1; challenge when score ≥ 1; provider acceptance requires a
// non-empty trimmed message ID).

const HOST = "https://maestrosservices.example";
const T = 1800000000000;

const realFetch = globalThis.fetch;
const realDateNow = Date.now;

const TURNSTILE_OK = {
  success: true,
  hostname: "maestrosservices.example",
  action: "quote_form",
};

const installFetchStub = ({ turnstile = [TURNSTILE_OK], resend = [{ status: 200 }] } = {}) => {
  const calls = { turnstile: 0, resend: 0, resendBodies: [], resendKeys: [] };
  let resendSeq = 0;
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.startsWith("https://challenges.cloudflare.com/")) {
      const behavior = turnstile[Math.min(calls.turnstile, turnstile.length - 1)];
      calls.turnstile += 1;
      if (behavior === "throw") throw new Error("turnstile network failure");
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
const nextSubmissionId = () => `sub_cov_${(submissionSeq += 1)}`;

const makeHarness = (envOverrides = {}) => {
  const store = createMemoryQuoteStore();
  const env = {
    TURNSTILE_SECRET: "test-turnstile-secret",
    RESEND_API_KEY: "test-resend-key",
    __quoteStore: store,
    ...envOverrides,
  };
  let ipSeq = 0;
  const post = (fields = {}, { headers = {}, ip } = {}) => {
    const effectiveIp = ip ?? `198.51.100.${(ipSeq += 1)}`;
    const form = new FormData();
    const merged = { form_started_at: String(T - 5000), ...BASE_FIELDS, ...fields };
    if (!("submission_id" in merged)) merged.submission_id = nextSubmissionId();
    for (const [key, value] of Object.entries(merged)) {
      if (value !== null && value !== undefined) form.set(key, String(value));
    }
    if (!("cf-turnstile-response" in merged)) form.set("cf-turnstile-response", "test-token");
    const request = new Request(`${HOST}/api/quote`, {
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
  return { store, env, post };
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

const refFromRedirect = (response) => {
  assert.equal(response.status, 303);
  return new URL(response.headers.get("location")).searchParams.get("ref");
};

// --- Duplicate normalization (outer trim + line endings) -------------------

test("duplicate identity: outer trim alone equates two submissions (regression: padded whitespace creating a second send)", async () => {
  // Documented rule: getValue outer-trims every field before serializeEnquiryContent.
  // Hand-computed: "  Alice Example  " trims to "Alice Example", so content matches.
  await withStub({}, async (calls) => {
    freezeNow(T);
    const harness = makeHarness();
    const first = await harness.post({ name: "Alice Example" });
    const ref = refFromRedirect(first);
    const second = await harness.post({
      name: "  Alice Example  ",
      submission_id: nextSubmissionId(),
    });
    const secondRef = refFromRedirect(second);
    const duplicate = await harness.store.getAttemptByReference(secondRef);
    assert.equal(duplicate.status, "rejected");
    assert.equal(duplicate.reasonCode, "duplicate");
    assert.equal(duplicate.separateOf, ref);
    assert.equal(calls.resend, 1, "padded-whitespace repeat must not send again");
  });
});

test("duplicate identity: CRLF and CR normalize to LF so only line-ending transport differs (regression: OS line endings double-sending)", () => {
  // Hand-computed: normalize replaces \r\n and lone \r with \n before JSON.stringify.
  const base = {
    name: "Alice Example",
    phone: "2505550100",
    email: "alice@example.com",
    area: "Victoria",
    service: "fence",
    timeline: "flexible",
    preferredContact: "text",
    details: "line one\nline two",
    tracking: {},
  };
  const crlf = serializeEnquiryContent({ ...base, details: "line one\r\nline two" });
  const cr = serializeEnquiryContent({ ...base, details: "line one\rline two" });
  const lf = serializeEnquiryContent(base);
  assert.equal(crlf, lf);
  assert.equal(cr, lf);
  assert.match(lf, /^v1:/);
  // A real content change still differs.
  assert.notEqual(
    serializeEnquiryContent({ ...base, details: "line one\nline two!" }),
    lf
  );
});

test("duplicate identity: leading/trailing newlines inside a field survive trim-of-whole-value only — interior newlines stay (regression: over-normalizing details)", () => {
  // getValue trims the whole field; interior newlines remain after serialize normalize.
  const withInterior = serializeEnquiryContent({
    name: "Alice",
    phone: "2505550100",
    email: "",
    area: "Victoria",
    service: "fence",
    timeline: "",
    preferredContact: "text",
    details: "para1\n\npara2",
    tracking: {},
  });
  assert.equal(
    withInterior,
    `v1:${JSON.stringify(["Alice", "2505550100", "", "Victoria", "fence", "", "text", "para1\n\npara2"])}`
  );
});

// --- Deterministic spam score ----------------------------------------------

test("spam score: honeypot alone is exactly +2 and forces a challenge (regression: honeypot silently discarded or under-scored)", async () => {
  // Hand-computed: company populated → score 2, flags ["honeypot_populated"].
  // Challenge threshold is score >= 1, so Turnstile must run.
  await withStub({}, async (calls) => {
    freezeNow(T);
    const harness = makeHarness();
    const response = await harness.post({
      company: "Bot Corp",
      form_started_at: String(T - 5000),
    });
    const ref = refFromRedirect(response);
    const record = await harness.store.getAttemptByReference(ref);
    assert.equal(record.status, "delivered");
    assert.equal(record.riskScore, 2);
    assert.deepEqual(record.riskFlags, ["honeypot_populated"]);
    assert.equal(calls.turnstile, 1, "score 2 must challenge");
    assert.equal(calls.resend, 1);
  });
});

test("spam score: timing anomaly alone is exactly +1 (fast < 3500ms) (regression: fast forms bypassing challenge)", async () => {
  // Hand-computed: elapsed 3499 → fast_completion +1; no honeypot/links.
  await withStub({}, async (calls) => {
    freezeNow(T);
    const harness = makeHarness();
    const response = await harness.post({ form_started_at: String(T - 3499) });
    const ref = refFromRedirect(response);
    const record = await harness.store.getAttemptByReference(ref);
    assert.equal(record.riskScore, 1);
    assert.deepEqual(record.riskFlags, ["fast_completion"]);
    assert.equal(calls.turnstile, 1);
  });
});

test("spam score: link pattern alone is exactly +1 when name+details contain ≥2 URL-like matches (regression: link spam under-scored)", async () => {
  // Hand-computed: two https:// matches → link_pattern +1.
  await withStub({}, async (calls) => {
    freezeNow(T);
    const harness = makeHarness();
    const response = await harness.post({
      details: "See https://example.com/a and https://example.com/b for photos.",
      form_started_at: String(T - 5000),
    });
    const ref = refFromRedirect(response);
    const record = await harness.store.getAttemptByReference(ref);
    assert.equal(record.riskScore, 1);
    assert.deepEqual(record.riskFlags, ["link_pattern"]);
    assert.equal(calls.turnstile, 1);
  });
});

test("spam score: honeypot + fast + links sums to exactly 4 with all three flags (regression: score components not additive)", async () => {
  // Hand-computed: +2 honeypot +1 timing +1 links = 4.
  await withStub({}, async (calls) => {
    freezeNow(T);
    const harness = makeHarness();
    const response = await harness.post({
      company: "x",
      website: "",
      form_started_at: String(T - 1000),
      details: "www.one.example and www.two.example",
    });
    const ref = refFromRedirect(response);
    const record = await harness.store.getAttemptByReference(ref);
    assert.equal(record.riskScore, 4);
    assert.deepEqual(record.riskFlags, ["honeypot_populated", "fast_completion", "link_pattern"]);
    assert.equal(calls.turnstile, 1);
  });
});

test("challenge threshold: score 0 with Turnstile secret present still challenges when configured; score ≥1 always challenges (regression: flagged path skipping verify)", async () => {
  // Hand-computed: score 0 + secret present → challengeRequired true by config.
  // Separately: with secret cleared and TURNSTILE_REQUIRED off, score 0 delivers
  // with zero Turnstile calls; score 1 still requires secret and rejects.
  await withStub({ turnstile: [TURNSTILE_OK] }, async (calls) => {
    freezeNow(T);
    const clean = makeHarness({ TURNSTILE_SECRET: "", TURNSTILE_REQUIRED: "0" });
    const cleanRes = await clean.post({ form_started_at: String(T - 5000) });
    assert.equal((await clean.store.getAttemptByReference(refFromRedirect(cleanRes))).status, "delivered");
    assert.equal(calls.turnstile, 0);

    const flagged = makeHarness({ TURNSTILE_SECRET: "", TURNSTILE_REQUIRED: "0" });
    const flaggedRes = await flagged.post({ form_started_at: String(T - 1000) });
    const flaggedRecord = await flagged.store.getAttemptByReference(refFromRedirect(flaggedRes));
    assert.equal(flaggedRecord.status, "rejected");
    assert.equal(flaggedRecord.reasonCode, "challenge_not_configured");
    assert.equal(flaggedRecord.riskScore, 1);
    assert.equal(calls.resend, 1, "only the clean score-0 path may send");
  });
});

// --- Validation / MAX_* clamps ---------------------------------------------

test("validation MAX_* clamps: each one-over boundary names its field (regression: silent truncation of oversize fields)", async () => {
  // Hand-computed limits from quote.ts: name 80, phone 30, email 254, area 180,
  // service 180, timeline/contact 180, details 2000, page_title 180, tracking 400.
  await withStub({}, async (calls) => {
    freezeNow(T);
    const harness = makeHarness();
    const cases = [
      ["name", "N".repeat(81), "name"],
      ["phone", "1".repeat(31), "phone"],
      ["email", `${"a".repeat(64)}@${"b".repeat(186)}.com`, "email"], // 64+1+186+4 = 255
      ["area", "A".repeat(181), "area"],
      ["details", "D".repeat(2001), "details"],
      ["page_title", "T".repeat(181), "page_title"],
      ["utm_source", "U".repeat(401), "utm_source"],
    ];
    for (const [field, value, errorField] of cases) {
      const response = await harness.post({ [field]: value, form_started_at: String(T - 5000) });
      const ref = refFromRedirect(response);
      const record = await harness.store.getAttemptByReference(ref);
      assert.equal(record.status, "rejected", `${field} one-over must reject`);
      assert.equal(record.reasonCode, "validation_failed");
      assert.ok(
        record.fieldErrors.some((entry) => entry.field === errorField),
        `${field} must surface field error for ${errorField}, got ${JSON.stringify(record.fieldErrors)}`
      );
    }
    assert.equal(calls.resend, 0);
    assert.equal(calls.turnstile, 0);
  });
});

test("validation at-limit values still deliver (regression: off-by-one rejecting valid max-length input)", async () => {
  await withStub({}, async (calls) => {
    freezeNow(T);
    const harness = makeHarness();
    // phone length ≤ 30 with 7–15 digits: "250-555-0100-99" → 12 digits, 15 chars.
    const response = await harness.post({
      name: "N".repeat(80),
      phone: "250-555-0100-99",
      area: "A".repeat(180),
      details: "D".repeat(2000),
      form_started_at: String(T - 5000),
    });
    const record = await harness.store.getAttemptByReference(refFromRedirect(response));
    assert.equal(record.status, "delivered");
    assert.equal(calls.resend, 1);
  });
});

// --- Provider acceptance rule ----------------------------------------------

test("provider acceptance: empty id, whitespace id, missing id, and non-string id are all unconfirmed (regression: apparent success without usable message ID)", async () => {
  const bodies = [
    { status: 200, body: { id: "" } },
    { status: 200, body: { id: "   " } },
    { status: 200, body: {} },
    { status: 200, body: { id: 12345 } },
  ];
  for (const resend of bodies) {
    await withStub({ resend: [resend] }, async (calls) => {
      freezeNow(T);
      const harness = makeHarness();
      const response = await harness.post({ form_started_at: String(T - 5000) });
      const record = await harness.store.getAttemptByReference(refFromRedirect(response));
      assert.equal(record.status, "unconfirmed", `body ${JSON.stringify(resend.body)} must not deliver`);
      assert.equal(record.reasonCode, "provider_unconfirmed");
      assert.equal(record.providerMessageId, null);
      assert.equal(calls.resend, 1);
    });
  }
});

test("provider acceptance: padded non-empty id is stored trimmed and delivers (regression: storing padded IDs that break reconciliation)", async () => {
  await withStub({ resend: [{ status: 200, body: { id: "  msg_padded_ok  " } }] }, async () => {
    freezeNow(T);
    const harness = makeHarness();
    const response = await harness.post({ form_started_at: String(T - 5000) });
    const record = await harness.store.getAttemptByReference(refFromRedirect(response));
    assert.equal(record.status, "delivered");
    assert.equal(record.providerMessageId, "msg_padded_ok");
  });
});

// --- Delivery path through fake seams only ---------------------------------

test("delivery path: fake store + fake provider yield exactly one terminal delivered state with message ID (regression: double terminal writes)", async () => {
  await withStub({ resend: [{ status: 200, body: { id: "msg_one_terminal" } }] }, async (calls) => {
    freezeNow(T);
    const harness = makeHarness();
    const response = await harness.post({ form_started_at: String(T - 5000) });
    const ref = refFromRedirect(response);
    const record = await harness.store.getAttemptByReference(ref);
    assert.equal(record.status, "delivered");
    assert.equal(record.providerMessageId, "msg_one_terminal");
    assert.equal(calls.resend, 1);
    assert.equal(calls.resendKeys[0], record.id);
    // No second record for the same submission.
    const latest = await harness.store.getLatestContentAttemptBySubmissionId(record.submissionId);
    assert.equal(latest.id, record.id);
  });
});
