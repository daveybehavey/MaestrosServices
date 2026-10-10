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
