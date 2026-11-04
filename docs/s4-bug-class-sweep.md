# S4 bug-class sweep — MaestrosServices

Status: **STOPPED — open-PR scope collision**. This is a partial findings and collision record, not a completed four-class audit.

Reviewed baseline: `314364992f60482e93fd08e8dfe43fefc76bc792` (`main`). Recorded 2026-11-03 (America/Vancouver).

## Scope and stopping rule

Requested classes: (a) silent degradation fallbacks; (b) stale-snapshot persists after long awaits; (c) feedback gated behind an unopened reveal; (d) config/test pins drifting from guarded code. The starMapAppV2 examples are motivating analogies, not evidence about this repository.

The task explicitly requires stopping if the scope collides with an open PR or another task's files. GitHub's open-PR list and changed-file lists establish a collision in quote intake and feedback. Investigation stopped at that boundary; no competing implementation or review of those branches was attempted.

## CONFIRMED

### C1 — Class (a): apparent successful quote submission without provider delivery

**Source-confirmed on the baseline; already owned by open PRs, not a new remediation assignment.**

- [functions/api/quote.ts:123–124](https://github.com/daveybehavey/MaestrosServices/blob/314364992f60482e93fd08e8dfe43fefc76bc792/functions/api/quote.ts#L123-L124) constructs the success destination with `submitted=1`.
- [functions/api/quote.ts:164–170](https://github.com/daveybehavey/MaestrosServices/blob/314364992f60482e93fd08e8dfe43fefc76bc792/functions/api/quote.ts#L164-L170) returns that success redirect for a finite completion timestamp below the minimum or beyond the duplicate window, before the later provider work. A legitimate fast or long-lived form therefore loses its requested enquiry delivery while receiving the success destination.
- Other early success exits are visible at [134–137](https://github.com/daveybehavey/MaestrosServices/blob/314364992f60482e93fd08e8dfe43fefc76bc792/functions/api/quote.ts#L134-L137) (source headers), [158–162](https://github.com/daveybehavey/MaestrosServices/blob/314364992f60482e93fd08e8dfe43fefc76bc792/functions/api/quote.ts#L158-L162) (honeypots), [236–243](https://github.com/daveybehavey/MaestrosServices/blob/314364992f60482e93fd08e8dfe43fefc76bc792/functions/api/quote.ts#L236-L243) (link detection / duplicate signature). Their real-user frequency was not measured.
- [src/components/QuoteForm.astro:374–380](https://github.com/daveybehavey/MaestrosServices/blob/314364992f60482e93fd08e8dfe43fefc76bc792/src/components/QuoteForm.astro#L374-L380) reveals the success panel solely from that query parameter.

Evidence is direct control-flow inspection of source bytes, not a live submission, provider test, or production observation. No email was sent. This confirms the baseline mechanism, not the correctness or deployment of any proposed fix.

### C2 — Open-PR ownership collision

| Open PR | Relevant changed files | Collision |
| --- | --- | --- |
| [#19 — quote retries](https://github.com/daveybehavey/MaestrosServices/pull/19) | `functions/api/quote.ts`, `package.json`, `scripts/lib/quote-contract.test.mjs` | Quote delivery/retry behavior and test wiring |
| [#31 — no-silent-discard intake](https://github.com/daveybehavey/MaestrosServices/pull/31) | `functions/api/quote.ts`, `src/components/QuoteForm.astro`, `scripts/lib/quote-handler.test.mjs`, `scripts/lib/gravel-chemainus-copy.test.mjs`, `scripts/smoke-routes.mjs`, migrations | Same silent-discard and feedback surface |
| [#32 — reliability residuals, stacked on #31](https://github.com/daveybehavey/MaestrosServices/pull/32) | `functions/api/quote.ts`, `src/components/QuoteForm.astro`, `scripts/lib/quote-handler.test.mjs` | Same handler, feedback and guarded state transitions |

Ownership is confirmed from GitHub changed-file lists. PR descriptions provide context only; they do not validate fixes. #31 was open and non-draft; #19 and #32 were open drafts. This task did not alter their state.

## SUSPECTED

No suspected defect is asserted. Unexamined code is not evidence of either a defect or correctness.

## Coverage limits and disposition

| Class | Disposition |
| --- | --- |
| (a) Silent degradation | C1 source-confirmed, overlapping existing work; stopped |
| (b) Stale-snapshot persists | Not assessed beyond collision discovery |
| (c) Feedback gated behind a reveal | Not assessed; the query-driven success panel above is supporting evidence for C1, not proof of this separate class |
| (d) Config/test-pin drift | Not assessed beyond ownership discovery |

Resume only after the overlapping work is resolved or the owner explicitly assigns a non-overlapping scope. Re-pin the then-current main and recheck open PR ownership first. No claim of an exhaustive sweep or a clean bill of health is made.

## Change and validation boundary

Only this Markdown document is added. No application, test, rendering, production configuration, flag, checkout, Stripe/payment, HD download (DL-1), print-order, price, SKU or promo files are modified. No design/render inputs are changed; no render-equivalence test was run. No code tests/builds or external sends were run because analysis stopped at the ownership fence. Delivery claims and marketing copy are unchanged.

Validation: checked exact baseline SHA against GitHub main, read repository AGENTS.md, inspected the cited source lines, and retrieved changed-file lists for all three open PRs.
