import { serviceLocationPages } from '../data/serviceLocationPages';
import { msA9KeepPaths } from '../data/msA9KeepList';

const combos = new Set(serviceLocationPages.map((page) => page.href));
const kept = new Set(msA9KeepPaths);

// Only current combo routes are eligible; hubs and legacy redirects are untouched.
export function isMsA9Noindex(url: string): boolean {
  const path = new URL(url, 'https://maestrosservices.com').pathname.replace(/\/+$/, '');
  return combos.has(path) && !kept.has(path);
}
