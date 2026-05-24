# Maestros Services

Static Astro site for Maestros Services, a residential landscaping business serving lower-mid Vancouver Island.

The site is built around data files in `src/data`, content collections in `src/content`, and a set of reusable Astro templates in `src/components` and `src/pages`.

## What's In The Repo

- `src/pages/` - homepage, service pages, area pages, blog, quote form, FAQ hubs, and 404
- `src/components/` - shared layout, header, footer, SEO, CTA, breadcrumbs, and quote form
- `src/data/` - business profile, services, service areas, homepage copy, projects, and FAQs
- `src/content/blog/` - blog posts
- `src/lib/schema.ts` - JSON-LD helpers for SEO and structured data
- `functions/api/quote.ts` - quote form submission endpoint
- `public/` - images, logos, favicon, sitemap helpers, and static assets
- `scripts/smoke-routes.mjs` - build smoke check

## Key Routes

- `/` - homepage
- `/services` - service index
- `/services/[slug]` - individual service detail pages
- `/services/[serviceSlug]/[locationSlug]` - localized service pages
- `/areas/[slug]` - area landing pages
- `/service-area` - service area hub
- `/services-by-area` - localized service browser
- `/blog` - blog index
- `/blog/[slug]` - blog posts
- `/quote` - quote form
- `/driveway-faq` - driveway FAQ hub
- `/projects` - project profiles
- `/404` - custom 404 page

## Local Development

```sh
npm install
npm run dev
```

Astro dev server runs on `http://localhost:4321`.

## Validation

```sh
npm run build
npm run astro -- check
npm run smoke
```

For a full production validation:

```sh
npm run build:smoke
```

## Content Model

Most site content is generated from the files below:

- `src/data/business.ts` - business name, phone, email, social links, and site metadata
- `src/data/services.ts` - services, FAQs, features, and before/after scenarios
- `src/data/locations.ts` - service areas and regions
- `src/data/homepage.ts` - homepage copy and homepage highlights
- `src/data/projects.ts` - project profile cards
- `src/data/faqs.ts` - homepage and area FAQ content

If you add a new service or area, update the relevant data file first and then let the page templates generate the route output.

## Quote Flow

The quote form posts to `functions/api/quote.ts`. That endpoint handles the lead payload and is used by the quote page and the embedded quote forms on service and area pages.

## Notes

- The repo currently uses an npm override for `shiki` so Astro can build cleanly in this workspace.
- The site is intended to stay static, so the production build is the most important test.
- If you change routes or add new content families, update `scripts/smoke-routes.mjs` so the smoke test keeps covering the important pages.
