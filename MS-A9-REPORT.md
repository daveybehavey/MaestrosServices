# MS-A9 — local bundle handoff

Date: 2026-11-13. Branch: `feat/ms-a9-noindex-split`; worktree: `C:\Users\ReuseTechBC\projects\ms-a9`.
Fetched base: `d1d539696f5921002ddcd8ef4009993621e349e6`. Its history includes #36 (`a6988c8`), #37 (`050fa55`), #38 (`75acda2`), #39 (`095a4ea`), and #40 (`d1d5396`).
Bundle: `C:\Users\ReuseTechBC\projects\qmsa9.bundle`, incremental from that base. No push, merge, deployment, sends, or paid actions.

## Input and reproducibility

The supplied baseline was copied into `docs/ms-a9-baseline-2026-11-13.json` before investigation. It contains 398 page rows for 2026-10-16 through 2026-11-12. SHA256 of supplied bytes: `61a6a8c2737c721cd545df355f1f34d4606396084a01ad2923a269d58897c7d9`.
The options-paper facts and settled legacy-redirect constraints were read from the brief.

Run `npm run ms-a9:generate` to regenerate `src/data/msA9KeepList.ts`. The generator reads the baseline, normalizes URL path/trailing slash/query/fragment, and evaluates only current `serviceLocationPages` entries. It fails for missing baseline combo rows, duplicate normalized baseline paths, or an unexpected priority configuration. It does not transfer legacy-slug metrics onto successor routes.

Priority services, verified from source:

- `pressure-washing`, `gutter-cleaning`, `moss-algae-treatment`, `fence-work-minor-repairs`: `featuredServiceSlugs` in `src/pages/index.astro` (the four winter homepage features).
- `driveway-grading`, `gravel-driveway-installation`: the two driveway slugs in `src/data/services.ts`, also explicitly paired by `isDrivewayService` in the combo template.

Keep if priority service (a), baseline position 8–25 inclusive (b), OR baseline clicks > 0 (c). Null positions do not qualify. No manual overrides.

## Counts

315 current combos: **160 kept, 155 noindexed**. Inclusive rule totals: a = 126, b = 46, c = 9.

| Exclusive membership | Count |
| --- | ---: |
| a only | 106 |
| b only | 27 |
| c only | 6 |
| a + b only | 18 |
| a + c only | 2 |
| b + c only | 1 |
| a + b + c | 0 |
| None | 155 |

Rules b/c retain 34 combos beyond the 126 priority combos. Both robots and sitemap consult the same generated list through `isMsA9Noindex`. All 315 routes and quote forms remain rendered and linked by the unchanged navigation data. Hubs/core routes and legacy redirects cannot enter the noindex set because membership requires an exact current combo path. Pressure-washing and gutter-cleaning combos qualify through rule a, without bespoke exclusions. Redirect files and service/location data are unchanged.

## FAQs and similarity limitation

All 160 kept combos now append their service's existing FAQs to both the visible FAQ section and FAQPage JSON-LD. Existing local questions, including Chemainus qualifications, remain intact. No subset excluded and no new marketing copy authored.

`node --import ./scripts/lib/ts-extensionless-hook.mjs scripts/ms-a9-similarity.mjs` reproduces the post-change spot-check. Deterministic sample: first five alphabetically sorted kept paths per service (all when fewer exist), 60 pages across 15 services, 106 same-service pairs. Extract rendered `<main>` text, remove scripts/styles/tags, normalize entities to spaces, lowercase Unicode word tokens, form unique contiguous word 5-gram sets, then compute pairwise Jaccard similarity and the pooled median. Same paths and method were measured against the unmodified base build before rebuilding the changed source.

Base median: **0.8506825485**. Changed median: **0.8604208991**. The paper target **< 0.75 was not met**. Shared service FAQs add useful answers but also shared text; they do not differentiate locations. This is a measured limitation, not a claim that the duplication problem is solved. Broader local content changes are outside this brief. The paper's exact extraction method was unavailable, so its reported median is context rather than a formally identical benchmark.

## Windows validation

Environment: Windows PowerShell, Node v26.13.0, npm 11.20.0; dependencies installed with `npm ci`. Base was measured before changing application source/configuration/package scripts.

| Command | Unmodified base | Changed branch |
| --- | --- | --- |
| `npm test` | 355 tests passed, 0 failed | 357 tests passed, 0 failed |
| `npm run build:smoke` | Passed | Passed, including all 315 robots/sitemap/form checks and kept FAQ/schema checks |
| Failure-name set | Empty | Empty |

New unit coverage regenerates the expected list from baseline/configuration, checks all combo decisions and URL normalization, and protects hubs/core/legacy paths. New smoke coverage reads actual built HTML and sitemap XML for every combo using the checked-in list; it checks both inclusion and exclusion and verifies existing service FAQ question/answer text in visible output and schema. An initial assertion needed to decode Astro's escaped apostrophes; after correcting that test, the full suite and build:smoke passed. `git diff --check` passed. Node emitted an existing module.register deprecation warning; no test/build failures remain.

## Files changed

- `docs/ms-a9-baseline-2026-11-13.json`: supplied baseline input.
- `scripts/ms-a9-generate.mjs`: reproducible keep-list generator and rule counts.
- `src/data/msA9KeepList.ts`: generated keep paths with rule/window header.
- `src/lib/msA9Indexing.ts`: current-combo-only decision shared by page and sitemap.
- `astro.config.mjs`: exclude noindexed combos from sitemap.
- `src/pages/services/[serviceSlug]/[locationSlug].astro`: existing noindex prop and service FAQ surfacing.
- `scripts/lib/ms-a9.test.mjs`: baseline/configuration consistency and scope tests.
- `scripts/ms-a9-check-build.mjs`: exhaustive rendered output checks.
- `scripts/ms-a9-similarity.mjs`: deterministic similarity spot-check.
- `package.json`: generation/test commands and build-smoke integration.
- `MS-A9-REPORT.md`: this handoff.

Human review remains the boundary for any later merge/deployment. This bundle is local implementation evidence only.
