import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

// Compile the real, import-free handler in memory. No native fetch, process,
// credentials or require is exposed to it; every delivery is a recorded fake.
const source = readFileSync(new URL('../../functions/api/quote.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('quote.ts', source, ts.ScriptTarget.Latest, true);
assert.equal(parsed.statements.some(node => ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)), false,
  'Review the isolation harness before adding handler imports');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const now = 1800000000000;
const origin = 'https://maestros.example.test';
const syntheticEnv = { RESEND_API_KEY: 'synthetic-not-a-key', TO_EMAIL: 'quotes@example.test', FROM_EMAIL: 'sender@example.test' };

function harness(respond = async () => ({ ok: true })) {
  const calls = [];
  class Clock extends Date { static now() { return now; } }
  const context = {
    exports: {}, Request, Response, FormData, URL, URLSearchParams, Date: Clock,
    fetch: async (url, options) => {
      assert.ok(['https://api.resend.com/emails', 'https://challenges.cloudflare.com/turnstile/v0/siteverify'].includes(url));
      calls.push({ url, options });
      return respond(url, options);
    },
  };
  vm.runInNewContext(compiled, context, { timeout: 1000 });
  return {
    calls,
    async submit(fields = {}, env = syntheticEnv, headers = {}) {
      const body = new URLSearchParams({ name: 'Synthetic Customer', phone: '2505550100', area: 'Test Area', service: 'Test Service',
        details: 'Synthetic fixture only', form_started_at: String(now - 10000), ...fields });
      const request = new Request(origin + '/api/quote', { method: 'POST', body, headers });
      return context.exports.onRequestPost({ request, env });
    },
  };
}

function redirect(response, status) {
  assert.equal(response.status, 303);
  const target = new URL(response.headers.get('location'));
  assert.equal(target.origin, origin);
  assert.equal(target.searchParams.get(status), '1');
  assert.equal(target.searchParams.has(status === 'error' ? 'submitted' : 'error'), false);
  return target;
}

test('quote sends one synthetic delivery with escaped HTML and a clean local success redirect', async () => {
  const h = harness();
  const target = redirect(await h.submit({ name: '<b>Fixture & Name</b>', details: '<script>fixture</script>',
    return_to: '/quote/?error=1&submitted=old&lead_event_id=old#form' }), 'submitted');
  assert.equal(target.pathname, '/quote/');
  assert.equal(target.hash, '#form');
  assert.equal(target.searchParams.get('lead_event_id'), 'lead_' + now.toString(36));
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, 'https://api.resend.com/emails');
  const message = JSON.parse(h.calls[0].options.body);
  assert.deepEqual(message.to, ['quotes@example.test']);
  assert.equal(message.from, 'sender@example.test');
  assert.ok(message.html.includes('&lt;b&gt;Fixture &amp; Name&lt;/b&gt;'));
  assert.ok(message.html.includes('&lt;script&gt;fixture&lt;/script&gt;'));
  assert.equal(message.html.includes('<script>'), false);
  assert.ok(message.text.includes('<script>fixture</script>'));
});

for (const fields of [{ name: '' }, { phone: '' }, { area: '' }, { service: '' }, { phone: '123' },
  { phone: '1234567890123456' }, { email: 'invalid@' }, { name: 'x'.repeat(81) }, { details: 'x'.repeat(2001) }]) {
  test('quote rejects invalid ' + Object.keys(fields)[0] + ' fixture ' + JSON.stringify(fields).slice(0, 45), async () => {
    const h = harness();
    redirect(await h.submit(fields), 'error');
    assert.equal(h.calls.length, 0);
  });
}

test('quote rejects missing delivery configuration without sending', async () => {
  const h = harness();
  redirect(await h.submit({}, {}), 'error');
  assert.equal(h.calls.length, 0);
});

for (const failure of ['non-ok', 'throw']) {
  test('quote returns an error when delivery is ' + failure, async () => {
    const h = harness(async () => { if (failure === 'throw') throw new Error('synthetic delivery failure'); return { ok: false }; });
    const target = redirect(await h.submit({ return_to: '/quote/?submitted=1&lead_event_id=old' }), 'error');
    assert.equal(target.searchParams.has('lead_event_id'), false);
    assert.equal(h.calls.length, 1);
  });
}

test('quote external return destinations fall back to the same host', async () => {
  const h = harness();
  const target = redirect(await h.submit({ return_to: 'https://external.example.test/path' }), 'submitted');
  assert.equal(target.pathname, '/');
  assert.equal(target.hash, '#quote');
  assert.equal(h.calls.length, 1);
});

test('quote honeypot and foreign origin are suppressed without delivery', async () => {
  for (const [fields, headers] of [[{ company: 'bot fixture' }, {}], [{}, { Origin: 'https://external.example.test' }]]) {
    const h = harness();
    redirect(await h.submit(fields, syntheticEnv, headers), 'submitted');
    assert.equal(h.calls.length, 0);
  }
});

test('quote failed captcha prevents delivery', async () => {
  const h = harness(async () => ({ json: async () => ({ success: false }) }));
  redirect(await h.submit({ 'cf-turnstile-response': 'synthetic-token' }, { ...syntheticEnv, TURNSTILE_SECRET: 'synthetic-secret' }), 'error');
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
});

for (const failure of ['non-ok', 'throw']) {
  test('quote retries identical input after delivery ' + failure, async () => {
    let attempts = 0;
    const h = harness(async () => {
      if (++attempts === 1) {
        if (failure === 'throw') throw new Error('synthetic transport failure');
        return { ok: false };
      }
      return { ok: true };
    });
    redirect(await h.submit(), 'error');
    redirect(await h.submit(), 'submitted');
    redirect(await h.submit(), 'submitted');
    assert.equal(attempts, 2, 'Only the failed attempt and successful retry send');
  });
}

test('quote suppresses an identical successful delivery', async () => {
  const h = harness();
  redirect(await h.submit(), 'submitted');
  redirect(await h.submit(), 'submitted');
  assert.equal(h.calls.length, 1);
});

for (const outcome of ['success', 'non-ok', 'throw']) {
  test('quote concurrent duplicate cannot claim success during ' + outcome, async () => {
    let release;
    let entered;
    const started = new Promise(resolve => { entered = resolve; });
    const pending = new Promise(resolve => { release = resolve; });
    let attempts = 0;
    const h = harness(async () => {
      if (++attempts === 1) {
        entered();
        await pending;
        if (outcome === 'throw') throw new Error('synthetic transport failure');
        return { ok: outcome === 'success' };
      }
      return { ok: true };
    });
    const first = h.submit();
    await started;
    try {
      redirect(await h.submit(), 'error');
      assert.equal(attempts, 1, 'No second delivery while the first is pending');
    } finally {
      release();
    }
    redirect(await first, outcome === 'success' ? 'submitted' : 'error');
    redirect(await h.submit(), 'submitted');
    assert.equal(attempts, outcome === 'success' ? 1 : 2);
  });
}

test('quote missing configuration does not poison an identical retry', async () => {
  const h = harness();
  redirect(await h.submit({}, {}), 'error');
  redirect(await h.submit(), 'submitted');
  assert.equal(h.calls.length, 1);
});

test('quote captcha failure does not poison retry or bypass captcha after success', async () => {
  let checks = 0;
  let deliveries = 0;
  const h = harness(async url => {
    if (url.includes('turnstile')) return { json: async () => ({ success: ++checks === 2 }) };
    deliveries++;
    return { ok: true };
  });
  const env = { ...syntheticEnv, TURNSTILE_SECRET: 'synthetic-secret' };
  const fields = { 'cf-turnstile-response': 'synthetic-token' };
  redirect(await h.submit(fields, env), 'error');
  redirect(await h.submit(fields, env), 'submitted');
  redirect(await h.submit(fields, env), 'error');
  assert.equal(checks, 3);
  assert.equal(deliveries, 1);
});

test('quote rechecks completed duplicate after concurrent captcha validation', async () => {
  let release;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  let checks = 0;
  let deliveries = 0;
  const h = harness(async url => {
    if (url.includes('turnstile')) {
      if (++checks === 1) { entered(); await pending; }
      return { json: async () => ({ success: true }) };
    }
    deliveries++;
    return { ok: true };
  });
  const env = { ...syntheticEnv, TURNSTILE_SECRET: 'synthetic-secret' };
  const fields = { 'cf-turnstile-response': 'synthetic-token' };
  const first = h.submit(fields, env);
  await started;
  try { redirect(await h.submit(fields, env), 'submitted'); }
  finally { release(); }
  redirect(await first, 'submitted');
  assert.equal(checks, 2);
  assert.equal(deliveries, 1);
});

test('quote failed-delivery retries retain the existing per-IP rate limit', async () => {
  const h = harness(async () => ({ ok: false }));
  const headers = { 'CF-Connecting-IP': '192.0.2.10' };
  for (let i = 0; i < 4; i++) redirect(await h.submit({}, syntheticEnv, headers), 'error');
  // Existing anti-abuse behavior quietly suppresses the fifth request.
  redirect(await h.submit({}, syntheticEnv, headers), 'submitted');
  assert.equal(h.calls.length, 4);
});
