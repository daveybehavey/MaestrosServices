import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { business } from "../data/business";
import { SITE_CONTENT_UPDATED } from "../data/siteContentUpdated";

function parseFrontmatterDate(frontmatter: string, key: "pubDate" | "updatedDate"): Date | undefined {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  if (!match) return undefined;
  const value = match[1]?.trim();
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Blog posts are the only pages with genuine per-entry content dates
 * (pubDate / optional updatedDate in the content collection schema).
 * Map absolute sitemap URLs to those dates for the @astrojs/sitemap serialize hook.
 */
export function buildBlogLastmodByUrl(
  siteUrl: string = business.siteUrl,
): Map<string, Date> {
  const blogDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../content/blog",
  );
  const origin = siteUrl.replace(/\/$/, "");
  const byUrl = new Map<string, Date>();

  for (const file of fs.readdirSync(blogDir)) {
    if (!file.endsWith(".md") && !file.endsWith(".mdx")) continue;

    const slug = file.replace(/\.(md|mdx)$/, "");
    const raw = fs.readFileSync(path.join(blogDir, file), "utf8");
    const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fmMatch) continue;

    const frontmatter = fmMatch[1] ?? "";
    const lastmod =
      parseFrontmatterDate(frontmatter, "updatedDate") ??
      parseFrontmatterDate(frontmatter, "pubDate");
    if (!lastmod) continue;

    byUrl.set(`${origin}/blog/${slug}/`, lastmod);
  }

  return byUrl;
}

export function lastmodForSitemapUrl(
  url: string,
  blogLastmodByUrl: Map<string, Date>,
): Date {
  return blogLastmodByUrl.get(url) ?? SITE_CONTENT_UPDATED;
}
