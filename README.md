<div align="center">

# Maestros Services

**Production local-business website and growth tooling for a Vancouver Island landscaping company.**

[Live Site](https://maestrosservices.com) · [EuroDigital Portfolio](https://eurodigital.ca)

</div>

---

## Overview

Maestros Services is a production Astro/TypeScript website built around local lead generation, search visibility, reusable content, and measurable growth workflows.

Rather than treating the site as a small collection of static pages, the project uses structured service/location data, reusable templates, automated validation, Google reporting integrations, and business-profile tooling to support ongoing local marketing and operations.

## Product Highlights

- Responsive service-business website with quote/contact flows
- Structured service, location, project, FAQ, and blog content
- Reusable localized service/location page generation
- Schema.org / JSON-LD structured data for SEO
- Google Business Profile API tooling
- GA4 and Search Console reporting workflows
- Google Ads campaign/conversion tooling
- Review, keyword, and business-profile monitoring helpers
- Automated route smoke tests and production build validation
- Lighthouse mobile/desktop performance auditing

## Tech Stack

| Area | Technology |
| --- | --- |
| Framework | Astro 5 |
| Language | TypeScript |
| Styling | Tailwind CSS |
| SEO | Sitemap, structured data, localized content architecture |
| Analytics | GA4, Google Search Console |
| Local Search | Google Business Profile APIs |
| Advertising | Google Ads API tooling |
| QA | Node tests, route smoke tests, Lighthouse, Astro checks |

## Site Architecture

The site is data-driven. Shared service, location, project, FAQ, and business information is stored centrally and rendered through reusable templates.

Key surfaces include:

- service and service-detail pages
- localized service-by-area pages
- area landing pages
- blog and project profiles
- quote flows
- FAQ hubs
- custom 404 handling

This architecture makes it possible to expand coverage without duplicating page logic or manually maintaining hundreds of disconnected pages.

## Growth & Reporting Tooling

The repository includes scripts for read-only and operational workflows around:

- Google Business Profile accounts and locations
- profile performance and search keywords
- reviews and profile audits
- GA4 and Search Console reporting
- Google Ads customers, campaigns, search terms, and conversions
- website conversion configuration and campaign assets

Automated tests cover the supporting growth/reporting logic so marketing tooling is not treated as unverified scripting.

## Quality Checks

```bash
npm run build:smoke
npm run test
npm run lighthouse:mobile
npm run lighthouse:desktop
```

The production build and route smoke checks are the primary release validation gates for this static-first site.

## Local Development

```bash
npm install
npm run dev
```

Astro runs locally on `http://localhost:4321` by default.

## Production

**Live:** https://maestrosservices.com

The project demonstrates small-business web development, scalable content architecture, technical SEO, analytics/reporting integration, automated QA, and practical growth tooling.

---

<div align="center">

Built and maintained as part of **EuroDigital** client work.

</div>
