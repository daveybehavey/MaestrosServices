import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { serviceLocationPages } from '../src/data/serviceLocationPages.ts';
import { msA9KeepPaths } from '../src/data/msA9KeepList.ts';

const kept = new Set(msA9KeepPaths);
const sitemap = readdirSync('dist').filter((name) => /^sitemap.*\.xml$/.test(name))
  .map((name) => readFileSync(`dist/${name}`, 'utf8')).join('\n');
const sitemapPaths = new Set([...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)]
  .map((m) => new URL(m[1]).pathname.replace(/\/+$/, '')));
for (const { href, service } of serviceLocationPages) {
  const html = readFileSync(`dist${href}/index.html`, 'utf8');
  const robots = html.match(/<meta\s+name="robots"\s+content="([^"]+)"/i)?.[1];
  assert.ok(robots, `Missing robots: ${href}`);
  assert.equal(robots.startsWith('index,'), kept.has(href), `robots: ${href}`);
  assert.equal(robots.startsWith('noindex,'), !kept.has(href), `noindex: ${href}`);
  assert.equal(sitemapPaths.has(href), kept.has(href), `sitemap: ${href}`);
  assert.match(html, /<form\b/, `Live conversion form: ${href}`);
  if (kept.has(href)) {
    const schemas = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
      .flatMap((m) => JSON.parse(m[1]));
    const faq = schemas.find((s) => s['@type'] === 'FAQPage');
    for (const { question, answer } of service.faqs) {
      assert.ok(faq?.mainEntity.some((q) => q.name === question && q.acceptedAnswer.text === answer), `FAQ schema: ${href}: ${question}`);
      const visible = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replaceAll('&#39;', "'").replaceAll('&#x27;', "'").replaceAll('&quot;', '"');
      const escape = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      assert.ok(visible.includes(escape(question)) && visible.includes(escape(answer)), `Visible FAQ: ${href}: ${question}`);
    }
  }
}
console.log(`MS-A9: all ${serviceLocationPages.length} live combos checked; ${kept.size} indexable/in sitemap; ${serviceLocationPages.length - kept.size} noindex/out of sitemap; kept FAQs verified.`);
