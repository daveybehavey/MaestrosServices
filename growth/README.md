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

1. Confirm the fact against live GBP/business knowledge.
2. Set `status` to `verified`.
3. Set `verifiedAt` (ISO date).
4. Set `source` / `sourceReference` to the approval source.
5. Add notes if there are scope limits.
6. Re-run `npm run growth:validate-post -- <draft.json>`.

## Evidence binding (fail closed)

Sensitive language must cite **explicit evidence IDs** on the draft. The validator does **not** accept a claim just because some other verified fact in the same broad category exists.

Draft fields:

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
- Availability service/area scope must cover mentions in the draft
- Unrelated verified `kind=claim` does **not** authorize insured/certified/best/#1/years
- Testimonials require approved quote text to appear in the draft (no invented paraphrase)
- Projects require that mentioned services/areas appear on that project record

Audit fields on every result: `requestedEvidenceIds`, `matchedEvidenceIds`, `rejectedEvidence`, `unsupportedClaims`, `evidenceBindings`.

## Project evidence

Add one JSON file per approved project under `projects/` with fields:

- `id`, `title`, `status` (`verified` only for automation)
- `serviceIds[]`, `areaIds[]`
- `summary` (non-identifying)
- `source`, `sourceReference`, `verifiedAt`, `permissionGranted`
- photos/path references only when permission exists

Do not invent job outcomes. Empty catalog = project-specific claims fail.

## CTA / UTM convention

GBP website CTAs must:

- use HTTPS
- host on `maestrosservices.com` (or `www.`)
- hit an approved path
- include `utm_source=google_business_profile`
- include `utm_medium=organic`
- use an allowed `utm_campaign` (`gbp_posts`, `gbp_profile`, or `gbp_growth_ops`)
- may keep `#quote` / other anchors

Malformed, HTTP, or external URLs fail validation. The validator reports failures; it does not silently rewrite and proceed as publishable.

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

Exit `0` only when gates pass. Exit non-zero on validation failure. Never publishes.
