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

## Google Reporting

If `.env.local` contains the Google OAuth values and GA4 property ID, you can pull reporting data locally:

```sh
npm run reporting:summary
```

Other options:

```sh
npm run reporting:ga4
npm run reporting:gsc
```

Reports are written to `qa-reports/` as JSON for later review.

## Google Tags

The site supports both GA4 and Google Ads tags through environment variables:

- `PUBLIC_GA_ID`
- `PUBLIC_GOOGLE_ADS_ID`

If both are present, the shared `gtag.js` loader is injected once and configured for both properties.

## Google Ads API

If `.env.local` contains the Google Ads API values, you can verify account access locally:

```sh
npm run ads:smoke
```

Other options:

```sh
npm run ads:customers
npm run ads:campaigns
npm run ads:create:power-washing
```

Expected environment values:

- `GOOGLE_ADS_DEVELOPER_TOKEN`
- `GOOGLE_ADS_CUSTOMER_ID`
- `GOOGLE_ADS_LOGIN_CUSTOMER_ID`
- `GOOGLE_ADS_OAUTH_CLIENT_ID`
- `GOOGLE_ADS_OAUTH_CLIENT_SECRET`
- `GOOGLE_ADS_OAUTH_REFRESH_TOKEN`

If you reuse the general Google OAuth app, the ads script will fall back to `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and `GOOGLE_OAUTH_REFRESH_TOKEN`, but the refresh token still needs the Google Ads scope: `https://www.googleapis.com/auth/adwords`.

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
