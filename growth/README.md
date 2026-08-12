# Growth Ops verified facts and evidence

Fail-closed foundation for future GBP automation.

**Passing validation does not publish anything.** There is no path from this layer to `gbp:create-post`.

## Layout

| Path | Purpose |
| --- | --- |
| `business-facts.json` | Business identity and policy claim slots |
| `services.json` | Service catalog with provenance/status |
| `service-areas.json` | Area catalog with provenance/status |
| `content-rules.json` | CTA/UTM rules, claim patterns, duplicate threshold |
| `projects/` | Approved project/evidence records only |
| `fixtures/` | Safe dry-run / unit-test fixtures (no secrets/PII) |

## Status model

- `verified` — human/ops-approved for automation use
- `candidate` — discovered from repo/live reads; **not** allowed as supporting evidence
- `rejected` / `unsupported` — forbidden for automation claims

Website marketing copy is **not** automatically verified just because it exists.

## Promoting a candidate to verified

1. Confirm the fact against live GBP/business knowledge using the evidence hierarchy in `growth/evidence/`.
2. Set `status` to `verified`.
3. Set `verifiedAt` (ISO date).
4. Set `source` / `sourceReference` to the approval source.
5. Add notes if there are scope limits.
6. Re-run `npm run growth:validate-post -- <draft.json>` against production `growth/`.

Latest operating-catalog evidence pass: `growth/evidence/operating-catalog-2026-08-11.md`.

## Evidence binding (fail closed)

Sensitive language must cite **explicit evidence IDs** on the draft. The validator does **not** accept a claim just because some other verified fact in the same broad category exists.

### Service / area refs (required commercial topic contract)

`serviceRefs[]` / `areaRefs[]` are the **authoritative declarations** of intended commercial topics for a draft. Automation must declare what it intends to market; the validator then checks those declarations against the verified catalog and known catalog mentions in the summary.

| Field | Rule |
| --- | --- |
| `contentIntent` | `service` (default) \| `reputation` \| `general` |
| `serviceRefs[]` | Required for `contentIntent: "service"` (>=1). Each ID must exist and be `verified`. |
| `areaRefs[]` | Required whenever the summary claims a **known catalog** locality. Each ID must exist and be `verified`. |

What this gate fail-closes today:

- Candidate / rejected / unknown **ref IDs** fail
- Recognized catalog service/area mentions omitted from the matching refs array fail
- Declared refs that never appear in the summary fail
- Duplicate refs are deduplicated with a warning
- `contentIntent: "reputation"` / `"general"` forbid catalog service/area marketing and service-marketing language
- Passing validation still **never publishes**

What this gate does **not** claim:

- Deterministic validation does **not** semantically recognize arbitrary out-of-catalog free-text services or locations (example: an undeclared "roof replacement" phrase may not be detected if it is not in `services.json`)
- A PASS means the draft cleared catalog-ref / known-mention / evidence gates for **human-reviewed shadow mode**
- A PASS does **not** imply unattended auto-publish eligibility
- Future P3 auto-publish requires controlled rendering from verified structured facts, or another explicitly reviewed semantic-coverage gate

Every validation result therefore includes:

- `requiresHumanReview: true`
- `autoPublishEligible: false`
- `semanticCoverage: "catalog_refs_and_known_mentions"`

Examples:

```json
{
  "contentIntent": "service",
  "summary": "Power Washing around Shawnigan Lake...",
  "serviceRefs": ["svc.power-washing"],
  "areaRefs": ["area.shawnigan-lake"]
}
```

```json
{
  "contentIntent": "reputation",
  "summary": "Thank you to homeowners who leave thoughtful Google reviews..."
}
```

Cordova Bay may be declared via `area.cordova-bay`; municipality-wide `area.saanich` remains candidate and fails.

### Evidence ref fields

| Field | When required |
| --- | --- |
| `offerRef` | Price, discount, coupon, or offer language |
| `availabilityRef` + `claimedAvailability.key` | Openings / available-now language |
| `claimRefs[]` | Insured, licensed, certified, guarantees, experience years, superlatives |
| `testimonialRef` | Testimonial/review quote language |
| `projectRef` | Project/job-specific phrasing |

Binding rules:

- Evidence id must exist, `status=verified`, kind must match the claim family
- Expired `validUntil` / future `validFrom` fails
- Dollar amounts and discount percents must match the referenced offer record
- Availability / project scope must cover declared `serviceRefs` / `areaRefs` when scoped
- Unrelated verified `kind=claim` does **not** authorize insured/certified/best/#1/years
- Testimonials require approved quote text to appear in the draft (no invented paraphrase)
- Projects require that mentioned and declared services/areas appear on that project record

Audit fields on every result include: `contentIntent`, `requestedServiceIds`, `matchedServiceIds`, `rejectedServiceRefs`, `requestedAreaIds`, `matchedAreaIds`, `rejectedAreaRefs`, `requestedEvidenceIds`, `matchedEvidenceIds`, `rejectedEvidence`, `unsupportedClaims`, `evidenceBindings`, `requiresHumanReview`, `autoPublishEligible`, `semanticCoverage`, plus `publishes: false` and `contactsGoogle: false`.

## Project evidence

Add one JSON file per approved project under `projects/` with fields:

- `id`, `title`, `status` (`verified` only for automation)
- `serviceIds[]`, `areaIds[]`
- `summary` (non-identifying)
- `source`, `sourceReference`, `verifiedAt`, `permissionGranted`
- photos/path references only when permission exists

Do not invent job outcomes. Empty catalog = project-specific claims fail.

## CTA / UTM convention

Validation is **action-type aware** via `validateGbpCta({ actionType, url }, rules)`.

### `CALL`

- Website URL is **not** required (GBP CALL uses the profile phone).
- Website UTM requirements do **not** apply when there is no URL.
- `normalizedCta` is `null` on a valid CALL CTA.
- Supplying a website `url` with `CALL` **fails** as inconsistent (deterministic; do not silently ignore).

### URL-based CTAs (`LEARN_MORE`, `BOOK`, `ORDER`, `SHOP`, `SIGN_UP`)

These **require** an approved website URL and must:

- use HTTPS
- host on `maestrosservices.com` (or `www.`)
- hit an approved path
- include `utm_source=google_business_profile`
- include `utm_medium=organic`
- use an allowed `utm_campaign` (`gbp_posts`, `gbp_profile`, or `gbp_growth_ops`)
- may keep `#quote` / other anchors

Malformed, HTTP, external, or missing URLs fail validation. The validator reports failures; it does not silently rewrite and proceed as publishable.

## Duplicate detection

- Normalize lowercase / whitespace / punctuation
- Exact normalized match fails
- Near-duplicate: Jaccard similarity on word bigrams
- Default threshold: **0.82** (`content-rules.json` → `duplicate.nearDuplicateThreshold`)
- Default behavior: fail closed (no silent override)

Regression fixture: near-duplicate power-washing captions representing the May 26 / May 29 historical duplicate situation.

## Dry-run

```sh
npm run growth:validate-post -- growth/fixtures/posts/valid-power-washing.json
npm run test:growth
```

Exit `0` only when gates pass. Exit non-zero on validation failure. Never publishes. Human review remains mandatory; auto-publish eligible is always no.
