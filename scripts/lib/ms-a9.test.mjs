import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generatedSource, decisions, priorityServices } from '../ms-a9-generate.mjs';
import { msA9KeepPaths } from '../../src/data/msA9KeepList.ts';
import { isMsA9Noindex } from '../../src/lib/msA9Indexing.ts';

test('MS-A9 checked-in list reproduces the baseline rules and current priority configuration', () => {
  assert.equal(readFileSync(new URL('../../src/data/msA9KeepList.ts', import.meta.url), 'utf8').replaceAll('\r\n', '\n'), generatedSource);
  assert.equal(priorityServices.length, 6);
  assert.equal(decisions.length, 315);
  for (const { href, a, b, c } of decisions) {
    assert.equal(msA9KeepPaths.includes(href), a || b || c, href);
    for (const suffix of ['', '/', '/?test=1#quote']) {
      assert.equal(isMsA9Noindex(href + suffix), !(a || b || c), href);
    }
  }
});

test('MS-A9 never noindexes core pages, hubs, or legacy redirect paths', () => {
  for (const path of ['/', '/quote', '/services', '/areas/victoria', '/services/lawn-mowing',
    '/services/power-washing/victoria', '/services/gutter-cleaning-ground-access/victoria']) {
    assert.equal(isMsA9Noindex(path), false, path);
  }
});
