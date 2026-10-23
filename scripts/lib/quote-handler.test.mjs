import assert from "node:assert/strict";
import test from "node:test";

import { onRequestPost } from "../../functions/api/quote.ts";

// Behavioural tests for the quote-form Pages Function. Regression target:
// a failed attempt must never consume the duplicate-suppression slot, or the
// customer's retry is answered with a fake success and the lead is lost.
//
// The handler keeps its rate-limit and duplicate state in module-level maps,
// so every scenario uses its own IP (rate-limit bucket) and phone number
// (duplicate signature) to stay isolated inside this shared process.

const ENV = {
  TURNSTILE_SECRET: "test-turnstile-secret",
  RESEND_API_KEY: "test-resend-key",
};

const realFetch = globalThis.fetch;

// Routes the handler's two outbound calls (Turnstile siteverify, Resend) to
// controllable stubs and counts how many emails were attempted.
const installFetchStub = ({ turnstileResults, resendStatuses }) => {
  const calls = { turnstile: 0, resend: 0 };
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.startsWith("https://challenges.cloudflare.com/")) {
      const result = turnstileResults[Math.min(calls.turnstile, turnstileResults.length - 1)];
      calls.turnstile += 1;
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (target === "https://api.resend.com/emails") {
      const status = resendStatuses[Math.min(calls.resend, resendStatuses.length - 1)];
      calls.resend += 1;
      return new Response(JSON.stringify({ id: "test-email" }), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`Unexpected fetch in test: ${target}`);
  };
  return calls;
};

const TURNSTILE_OK = { success: true, hostname: "maestrosservices.com", action: "quote_form" };
const TURNSTILE_FAIL = { success: false, hostname: "maestrosservices.com", action: "quote_form" };

const postQuote = ({ ip, phone, details = "Please trim the hedge along the driveway." }) => {
  const form = new FormData();
  form.set("name", "Test Person");
  form.set("phone", phone);
  form.set("area", "Victoria");
  form.set("service", "Hedge Trimming");
  form.set("details", details);
  form.set("cf-turnstile-response", "test-token");
  const request = new Request("https://maestrosservices.com/api/quote", {
    method: "POST",
    headers: {
      Origin: "https://maestrosservices.com",
      Referer: "https://maestrosservices.com/",
      "CF-Connecting-IP": ip,
    },
    body: form,
  });
  return onRequestPost({ request, env: { ...ENV } });
};

const redirectParams = (response) => {
  assert.equal(response.status, 303);
  return new URL(response.headers.get("location")).searchParams;
};

test("failed delivery does not consume the duplicate slot: the retry delivers", async () => {
  const calls = installFetchStub({ turnstileResults: [TURNSTILE_OK], resendStatuses: [500, 200] });
  try {
    const attempt = { ip: "203.0.113.11", phone: "2505550111" };

    const first = await postQuote(attempt);
    assert.equal(redirectParams(first).get("error"), "1");
    assert.equal(calls.resend, 1);

    const retry = await postQuote(attempt);
    assert.equal(redirectParams(retry).get("submitted"), "1");
    assert.equal(calls.resend, 2, "retry must reach the email provider instead of being suppressed");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("duplicate after a successful delivery is still suppressed", async () => {
  const calls = installFetchStub({ turnstileResults: [TURNSTILE_OK], resendStatuses: [200] });
  try {
    const attempt = { ip: "203.0.113.12", phone: "2505550112" };

    const first = await postQuote(attempt);
    assert.equal(redirectParams(first).get("submitted"), "1");
    assert.equal(calls.resend, 1);

    const duplicate = await postQuote(attempt);
    assert.equal(redirectParams(duplicate).get("submitted"), "1");
    assert.equal(calls.resend, 1, "an exact repeat of a delivered lead must not send a second email");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("Turnstile failure does not consume the duplicate slot: the retry delivers", async () => {
  const calls = installFetchStub({
    turnstileResults: [TURNSTILE_FAIL, TURNSTILE_OK],
    resendStatuses: [200],
  });
  try {
    const attempt = { ip: "203.0.113.13", phone: "2505550113" };

    const first = await postQuote(attempt);
    assert.equal(redirectParams(first).get("error"), "1");
    assert.equal(calls.resend, 0);

    const retry = await postQuote(attempt);
    assert.equal(redirectParams(retry).get("submitted"), "1");
    assert.equal(calls.resend, 1, "retry after a Turnstile failure must reach the email provider");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a rate-limited request gets a visible error instead of a silent success", async () => {
  const calls = installFetchStub({ turnstileResults: [TURNSTILE_OK], resendStatuses: [200] });
  try {
    const ip = "203.0.113.14";
    // Four distinct customers from one shared IP fill the rate window.
    for (let i = 0; i < 4; i += 1) {
      const response = await postQuote({ ip, phone: `250555021${i}` });
      assert.equal(redirectParams(response).get("submitted"), "1");
    }
    assert.equal(calls.resend, 4);

    const limited = await postQuote({ ip, phone: "2505550299" });
    assert.equal(redirectParams(limited).get("error"), "1");
    assert.equal(redirectParams(limited).get("submitted"), null);
    assert.equal(calls.resend, 4, "a rate-limited request must not send an email");
  } finally {
    globalThis.fetch = realFetch;
  }
});
