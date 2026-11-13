import { readFileSync } from 'node:fs';
import { serviceLocationPages } from '../src/data/serviceLocationPages.ts';
import { msA9KeepPaths } from '../src/data/msA9KeepList.ts';

// Deterministic sample: first five kept paths alphabetically per service.
// Jaccard similarity of sets of lowercase word 5-grams in rendered <main> text.
const groups = new Map();
for (const href of [...msA9KeepPaths].sort()) {
  const slug = serviceLocationPages.find((p) => p.href === href).service.slug;
  const group = groups.get(slug) ?? [];
  if (group.length < 5) group.push(href);
  groups.set(slug, group);
}
const grams = (href) => {
  const html = readFileSync(`dist${href}/index.html`, 'utf8');
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
  if (!main) throw new Error(`Missing main: ${href}`);
  const words = main.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&[^;]+;/g, ' ').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(words.slice(0, -4).map((_, i) => words.slice(i, i + 5).join(' ')));
};
const pairs = [];
for (const paths of groups.values()) {
  const sets = paths.map(grams);
  for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) {
    const intersection = [...sets[i]].filter((g) => sets[j].has(g)).length;
    pairs.push(intersection / (sets[i].size + sets[j].size - intersection));
  }
}
pairs.sort((a, b) => a - b);
const middle = Math.floor(pairs.length / 2);
console.log(JSON.stringify({ sample: Object.fromEntries(groups), pages: [...groups.values()].flat().length,
  pairs: pairs.length, median: pairs.length % 2 ? pairs[middle] : (pairs[middle - 1] + pairs[middle]) / 2 }, null, 2));
