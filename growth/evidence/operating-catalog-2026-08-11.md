# Operating catalog evidence pass — 2026-08-11

Fail-closed promotion of the smallest high-confidence Maestro Growth Ops catalog.

Live reads used (read-only, local reports under gitignored `qa-reports/`):

- `npm run gbp:profile-audit` → `qa-reports/gbp-profile-audit.json`
- `npm run gbp:list-posts` → `qa-reports/gbp-list-posts.json` (9 LIVE posts)
- `npm run gbp:reviews` → `qa-reports/gbp-reviews.json` (2 reviews)

Hierarchy applied:

1. Live GBP business/service messaging and posts
2. Genuine public reviews of completed work
3. Multiple consistent first-party sources
4. Website catalog alone = candidate support, not automatic verification

Generic GBP landscaper category `serviceTypes` were **not** treated as offered-service proof.

## Services

| id | prior | decision | strongest provenance |
| --- | --- | --- | --- |
| svc.power-washing | candidate | **verified** | Multiple LIVE GBP posts (2026-03-02 … 2026-05-29) |
| svc.gravel-driveway-installation | candidate | **verified** | Dedicated 2026-06-01 gravel-driveway post + 2026-02-27 specialties list |
| svc.driveway-grading | candidate | **verified** | 2026-05 openings posts + live profile description |
| svc.fence-work-minor-repairs | candidate | **verified** | Repeated fence refresh/repair posts (scope notes: minor repair/refresh) |
| svc.garden-bed-maintenance | candidate | **verified** | Mulch Refresh posts + review bark-mulch confirmation |
| svc.rock-work-walls | candidate | **verified** | Rock Work Refresh / rockwork posts |
| svc.seasonal-cleanups | candidate | **verified** | Exterior/property cleanup posts + completed yard tidy review |
| svc.lawn-mowing | candidate | **verified** | Completed-job review explicitly includes mowing |
| svc.hedge-trimming | candidate | **verified** | Completed-job review explicitly includes trimming bushes |
| svc.weed-control | candidate | **verified** | Completed-job review explicitly includes weeding |
| svc.yard-waste-removal | candidate | remain candidate | Website only |
| svc.brush-clearing | candidate | remain candidate | Website only |
| svc.gutter-cleaning-ground-access | candidate | remain candidate | Website only |
| svc.light-pruning | candidate | remain candidate | Website only; bush trimming credited to hedge-trimming |
| svc.moss-algae-treatment | candidate | remain candidate | Moss wording in power-wash posts is cleanup context, not treatment verification |
| svc.large-tree-felling | rejected | remain **rejected** | Website policy; no contrary evidence |

## Service areas

| id | prior | decision | strongest provenance |
| --- | --- | --- | --- |
| area.shawnigan-lake | candidate | **verified** | Base locality + GBP post “Established in Shawnigan Lake” |
| area.cordova-bay | *(new Growth Ops locality)* | **verified** | Completed Cordova Bay job review (exact locality only; no SEO page) |
| area.saanich | candidate | remain **candidate** | Cordova Bay evidence exists but is not generalized to municipality-wide Saanich |
| area.victoria | candidate | remain candidate | “Victoria” appears as general marketing context only |
| all other municipalities | candidate | remain candidate | Website location catalog / broad Island copy only |
| area.vancouver | rejected | remain **rejected** | Outside footprint |

Broad “lower-mid Vancouver Island” language was **not** used to verify municipalities such as Langford, Sooke, Duncan, etc.

Cordova Bay evidence authorizes **Cordova Bay** only. It does **not** automatically authorize “Saanich”.

## Identity facts re-check

Re-checked against live profile-audit and `src/data/business.ts`:

- Name, phone, website host, Shawnigan Lake base locality: still aligned → kept verified (verifiedAt refreshed)
- years-in-business / dollar pricing / current openings: remain **unsupported**
- Historical openings wording in old GBP posts is **not** current availability evidence

## Review / reputation (sanitized)

See `growth/evidence/review-action-report-2026-08-11.json`.

- Total reviews: 2
- Average rating: 5
- Unreplied: 2
- No replies published in this slice
- No customer names or full review text committed

## Validator reality check

Production `growth/` facts now support truthful drafts for verified services near Shawnigan Lake / Cordova Bay without weakening gates. Remaining candidates (including municipality-wide Saanich) still fail closed.
