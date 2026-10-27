// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { buildBlogLastmodByUrl, lastmodForSitemapUrl } from './src/lib/sitemapLastmod.ts';

const blogLastmodByUrl = buildBlogLastmodByUrl();

// https://astro.build/config
export default defineConfig({
  site: "https://maestrosservices.com",
  integrations: [
    sitemap({
      filter: (page) => !page.includes('/404'),
      changefreq: 'weekly',
      priority: 0.7,
      serialize(item) {
        const lastmod = lastmodForSitemapUrl(item.url, blogLastmodByUrl);
        if (!lastmod) {
          const { lastmod: _omitted, ...rest } = item;
          return rest;
        }
        return {
          ...item,
          lastmod,
        };
      },
    }),
  ],
});
