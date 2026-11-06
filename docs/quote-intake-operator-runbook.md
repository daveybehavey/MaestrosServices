# Quote-intake operator runbook (X11)

## Version and operating boundary

This runbook describes the intended system **after PRs [#31](https://github.com/daveybehavey/MaestrosServices/pull/31) and [#32](https://github.com/daveybehavey/MaestrosServices/pull/32) land**, not verified production behavior. Source snapshots reviewed: #31 `2be15e38f23e1dfcc2411fb197ae485eb1c12481`; #32 `5a10156b8f4d9166361d8072db94033361529357`. #32 is stacked on an earlier #31 revision. The final merged handler must be checked before treating this as an operational contract: newer #31 contains `persistFirstSend` write-once persistence absent from the #32 snapshot. This document does not resolve that integration or certify concurrency guarantees.

All commands/queries below are inspection only. Do not submit test enquiries to production, replay provider calls, change bindings/secrets/flags, apply migrations, edit intake rows, or send customer messages as part of this runbook. Escalate repairs through a separate approved task. Capture reference, attempt ID, reason, time and deployment commit; keep customer details, tokens, secrets and result URLs out of public issues.

## Source map

The following are source permalinks, rather than statements inferred from PR descriptions:

- [#32 handler](https://github.com/daveybehavey/MaestrosServices/blob/5a10156b8f4d9166361d8072db94033361529357/functions/api/quote.ts): `handleQuotePost`, `handleQuoteGet`, `resolveStore`, `resultPageHtml`, `resubmissionForm`, `scoreRisk`, `validatePayload`, `buildEmail`, `createD1QuoteStore`.
- [#31 handler](https://github.com/daveybehavey/MaestrosServices/blob/2be15e38f23e1dfcc2411fb197ae485eb1c12481/functions/api/quote.ts): newer first-send persistence guard.
- [QuoteForm.astro](https://github.com/daveybehavey/MaestrosServices/blob/5a10156b8f4d9166361d8072db94033361529357/src/components/QuoteForm.astro): widget, hidden fields, submission identity, fetch recovery and conversion verification.
- [SEOHead.astro](https://github.com/daveybehavey/MaestrosServices/blob/5a10156b8f4d9166361d8072db94033361529357/src/components/SEOHead.astro): conditional Turnstile API script.
- [0001 schema and provisioning notes](https://github.com/daveybehavey/MaestrosServices/blob/5a10156b8f4d9166361d8072db94033361529357/migrations/0001_quote_intake.sql), [0002 provider payload](https://github.com/daveybehavey/MaestrosServices/blob/5a10156b8f4d9166361d8072db94033361529357/migrations/0002_provider_payload.sql), [0003 first-send timestamp](https://github.com/daveybehavey/MaestrosServices/blob/5a10156b8f4d9166361d8072db94033361529357/migrations/0003_provider_sent_at.sql).
- [Environment-name examples](../.env.example) and [repository operating/deployment rules](../AGENTS.md). Examples do not establish which production values or bindings exist.

## How an enquiry flows

1. The shared form POSTs to `/api/quote`. It includes business fields, attribution, `submission_id`, timing and two honeypots. Its JavaScript preserves the submission ID for unchanged retries and changes it when business fields change. Native POST also works; the server generates an ID when the supplied ID is not 8–80 ASCII letters, digits, underscores or hyphens.
2. The Function resolves D1 through `QUOTE_DB`. Without a store it returns a visible 503 and does not call Turnstile or Resend. Supplied malformed/cross-host Origin or Referer is rejected; missing headers alone are allowed. The shared limiter counts requests in fixed ten-minute IP-digest buckets; the fifth and subsequent requests get 429 with `Retry-After`. No IP means that limiter is skipped.
3. The handler parses, scores and validates the enquiry, reconciles submission identity, and claims exact content in D1 before provider contact. D1 stores both successful attempts and reason-coded rejections. Duplicate identity covers all eight business fields, outer-trimmed with consistent line endings; attribution is excluded. Hash matches are checked against full content. A corrected business payload is different content.
4. Turnstile is required when `TURNSTILE_REQUIRED` is truthy, a trimmed `TURNSTILE_SECRET` exists, or risk score is at least one. The server POSTs token, secret and remote IP to `https://challenges.cloudflare.com/turnstile/v0/siteverify`. Acceptance requires truthy `success`, hostname exactly equal to the request host, and action exactly `quote_form` (missing/mismatching values fail).
5. Honeypot population adds 2; fast completion below 3500 ms, stale completion above 24 hours, or untrusted timing adds 1; at least two URL-like matches in name/details adds 1. Flags require a challenge, not silent disposal. A passing flagged enquiry can be sent with “Review requested” in the notification.
6. The exact Resend JSON body and first-send timestamp are persisted before the provider call. POST to `https://api.resend.com/emails` uses attempt ID as `Idempotency-Key` and a ten-second timeout. The notification contains reference, business fields, available attribution, and risk/separate-enquiry annotations.
7. HTTP success plus a nonempty trimmed string message ID is stored as `delivered` with recipient and acceptance time before success feedback. This means provider handoff, **not inbox receipt or a reply promise**. A transport exception, timeout, unreadable success body or missing/blank ID leaves `unconfirmed`.
8. Normal outcome POSTs return 303 to `/api/quote?ref=...`; GET renders the stored outcome. JSON status adds `format=json`; only `status=delivered` yields `conversionEligible=true`. A bare `?submitted=1` confirms nothing. Result-page GET generally returns 200 even for a rejected record: inspect status/reason, not HTTP 200 alone.

## Where the widget, bindings and variables live

Inspect the actual deployed commit and the appropriate Pages environment; do not change settings during diagnosis.

| Name / location | Role and check |
| --- | --- |
| `src/components/QuoteForm.astro` | Uses build-time `import.meta.env.PUBLIC_TURNSTILE_SITE_KEY`; renders `.cf-turnstile` with `data-action="quote_form"` only when key is present. |
| `src/components/SEOHead.astro` | Includes Turnstile `v0/api.js` only when the build-time public key is present. If widget is missing, inspect built markup and script loading without submitting. |
| `functions/api/quote.ts: resubmissionForm` | Result-page widget and its script use runtime `env.PUBLIC_TURNSTILE_SITE_KEY`. A working initial widget does not prove recovery pages have this runtime variable. |
| `TURNSTILE_SECRET`, `TURNSTILE_REQUIRED` | Runtime verification secret and required flag. Truthy flag values: 1, true, yes, on (case-insensitive). Check presence/configuration without exposing the secret. |
| `QUOTE_DB` | D1 binding. Migration 0001 names database `maestros-quote-intake`, Pages project `maestrosservices`, and Settings → Functions → D1 database bindings. Verify the actual binding target and all three migrations. |
| `RESEND_API_KEY` | Runtime provider credential; missing/blank causes `provider_not_configured`. |
| `TO_EMAIL`, `FROM_EMAIL` | Recipient defaults to `quotes@maestrosservices.com` (also on blank after trim); sender defaults to `Maestros Services <quotes@maestrosservices.com>` when unset. Inspect the frozen provider payload privately if reconciling an older attempt whose settings may differ. |
| `PUBLIC_GA_ID`, `PUBLIC_GOOGLE_ADS_ID`, `PUBLIC_GOOGLE_ADS_QUOTE_LABEL` | Runtime inputs for result-page resubmission conversion tracking; separate from intake/delivery evidence. |
| `QUOTE_ALLOW_MEMORY_STORE`, `__quoteStore` | Explicit local-development memory fallback and injected test store. Neither is a production repair for missing D1. |

No Wrangler config is provided in the inspected root; use the binding target, not an assumed local CLI default. Provisioning notes are prerequisites, not evidence they have been executed.

## Check whether enquiries landed in D1

Use the Cloudflare D1 SQL console for the database actually bound as `QUOTE_DB` to the relevant Pages environment. These SELECT/PRAGMA examples require no schema or data mutations. Timestamps are Unix milliseconds. Replace the synthetic reference or submission placeholder privately; never paste customer rows into the PR.

Check schema first:

```sql
PRAGMA table_info(quote_attempts);
PRAGMA table_info(quote_rate_limits);
```

Expect 0001 columns plus `provider_payload` (0002) and `provider_sent_at` (0003). Then inspect recent intake metadata:

```sql
SELECT id, reference, submission_id, status, reason_code,
       datetime(created_at / 1000, 'unixepoch') AS created_utc,
       provider_status, provider_message_id, recipient, delivered_at,
       risk_score, risk_flags, separate_of, claim_active
FROM quote_attempts
ORDER BY created_at DESC LIMIT 50;
```

Locate one result or the latest records for a client submission:

```sql
SELECT id, reference, submission_id, status, reason_code, field_errors,
       created_at, updated_at, provider_sent_at, provider_status,
       provider_message_id, recipient, delivered_at, separate_of,
       risk_score, risk_flags, claim_active
FROM quote_attempts
WHERE reference = 'MS-REPLACE-WITH-REFERENCE'
ORDER BY created_at DESC;

SELECT id, reference, status, reason_code, created_at, separate_of
FROM quote_attempts
WHERE submission_id = 'REPLACE_WITH_SUBMISSION_ID'
ORDER BY created_at DESC;
```

A row proves the intake record landed, not that email was accepted. Check `status`, message ID and time; follow `separate_of` to the original when duplicate/awaiting-confirmation feedback points there. `payload`, `content` and `provider_payload` contain restricted customer data; retrieve only the minimum privately when necessary. No matching row is not proof nothing was sent: confirm environment, lookup identity, storage errors and provider evidence.

Exception inspection (SQL clock supplies current milliseconds, no unbound parameters):

```sql
SELECT id, reference, submission_id, status, updated_at
FROM quote_attempts
WHERE status = 'sending'
  AND updated_at < CAST(strftime('%s', 'now') AS INTEGER) * 1000 - 900000;

SELECT id, reference, submission_id, created_at, provider_sent_at,
       provider_status, claim_active
FROM quote_attempts
WHERE status = 'unconfirmed'
  AND COALESCE(provider_sent_at, created_at)
      < CAST(strftime('%s', 'now') AS INTEGER) * 1000 - 86400000;

SELECT reference, status, reason_code, risk_score, risk_flags
FROM quote_attempts
WHERE risk_score > 0
ORDER BY created_at DESC LIMIT 50;

SELECT status, reason_code, COUNT(*) AS attempts
FROM quote_attempts
GROUP BY status, reason_code;
```

A status GET is not strictly read-only: #32 normalizes a `sending` row older than 15 minutes to `unconfirmed/provider_unconfirmed`, guarded against downgrading delivery, then re-reads it. It never calls the provider. Use SQL for a read-only investigation. Unviewed stale rows can remain `sending`; there is no background normalization job here.

## Failure symptoms and triage

Unless stated otherwise, reasons below are stored rejections rendered on a result page after 303.

| Evidence / symptom | Operator action |
| --- | --- |
| 503 “temporarily unavailable”; `storage_unavailable` or `attempt_resolution_failed` alert | Inspect D1 binding and schema. Missing store fails closed. Do not enable memory fallback. D1 read/write exceptions elsewhere are not globally caught by this handler and may surface as platform errors; do not assume every storage failure has a durable row or the friendly 503. Correlate Function logs before any retry. |
| `source_rejected` | Inspect request Origin/Referer host and deployed form action. Both supplied headers must parse and match host; do not weaken the check. |
| `malformed_request` | Body could not be parsed as form data. Inspect request encoding/client integration; no preserved payload is available on this branch. |
| `rate_limited`, direct 429 + `Retry-After` | Wait for the stated interval. #32 keeps JS form entries and disables the button until timeout; native response includes a send-again form if parsing succeeded. Retained fields are clamped; malformed body may yield no payload. `rate_limit_record_failed` means 429 still rendered but its record write failed. Shared connections can share a bucket. |
| `validation_failed` + `field_errors` | Correct named fields using the result form. Required: name/phone/area/service; phone 7–15 digits; valid optional email, required for email preference; service/timeline/contact must match rendered enums. Limits: name 80, phone 30, email 254, details 2000, area/service/timeline/contact/page title 180, other attribution 400. |
| `challenge_not_configured` | Challenge needed but secret missing. Check runtime secret presence, required flag and risk flags. Escalate configuration repair. |
| `challenge_missing` | No token supplied. Check widget markup, public key at build/runtime as applicable, browser script/network errors and completion of challenge. |
| `challenge_failed` | Verification lacked success or exact hostname/action. Check request hostname, widget action and Turnstile hostname configuration; do not treat a visible widget as proof server verification passed. |
| `challenge_unavailable` | Fetch/JSON verification threw. Inspect Function/network evidence; do not bypass protection. |
| `provider_not_configured` | Missing trimmed Resend key. Inspect runtime binding presence without printing values; escalate repair. |
| `provider_failed` + `provider_status` | Initial provider request returned non-OK. Inspect provider status/dashboard and sender/recipient setup. Claim is released for a fresh rejected attempt. A non-OK reconciling retry instead stays unconfirmed because it says nothing conclusive about the original call. |
| `unconfirmed/provider_unconfirmed`; “We could not confirm delivery” | May already have been accepted. Check provider dashboard by reference in the email body, recipient, name in subject and original send time; retain ID/evidence privately. Within 24 hours of `provider_sent_at ?? created_at`, #32 offers a retry pinned to the original submission ID/body/key. Do not create a new-ID resend to diagnose it. After the window no retry form is offered; escalate manual reconciliation. |
| `sending`; “being processed” | Fresh attempt is in progress. Do not resubmit blindly. Older than 15 minutes is an exception; observation via GET normalizes it as above, but proves no provider outcome. |
| `duplicate`; “No new email was sent” | Follow `separate_of` to the accepted original. Changed business details form a different claim; deliberate “Send as a separate enquiry” is an explicit override, not a triage shortcut. Delivered claims expire after 24 hours via a POST-path sweep; rows are not deleted by that sweep. |
| `delivery_unconfirmed_exists` | Matching content is held by an unresolved attempt. Follow original reference and reconcile it; do not release the claim to force a resend. |
| `submission_conflict` | Same submission ID used with different details against a non-rejected record. Inspect client identity handling; use normal correction flow rather than rewriting records. |
| Browser “could not confirm” panel after fetch failure | Entries remain; no native fallback POST occurs. Check the linked submission status/D1 and provider evidence before sending again. Browser failure does not establish server failure. |
| 404 “Submission not found” / JSON `not_found` | Check ref/submission identity and environment. Bare/forged success parameters prove nothing. |
| 405 + `Allow: POST, GET` | Unsupported method; use the form/status routes. Audit write is best effort and may fail. |
| D1 delivered but notification absent from mailbox | Check provider message ID, frozen recipient and provider dashboard/inbox filtering. This implementation has no bounce/receipt processing to prove inbox arrival. Do not overwrite delivery evidence or resend automatically. |
| Operational `content_hash_collision` | Escalate with reference/time; source explicitly avoids suppressing differing full content solely because hashes match. |

## Logs and unresolved operations

`alertOperational` emits JSON on `console.error` with `source: "quote-intake"` and event-specific reference/time/method/age fields. Look in the Pages Function platform logs for the matching deployment. Events include `storage_unavailable`, `source_rejected`, `rate_limited`, `rate_limit_record_failed`, `method_not_allowed`, `attempt_resolution_failed`, `challenge_not_configured`, `provider_not_configured`, `provider_replay_window_expired`, `stranded_sending_normalized` and `content_hash_collision`. Not every rejection emits an alert; inspect D1 too. These structured calls do not log raw payload/token/full IP. Log retention/export is not established by the source.

For aged unconfirmed attempts, collect dashboard acceptance evidence and escalate a reviewed reconciliation plan. Do not hand-mark delivered without a provider message ID, release claims, or replay expired keys. #32's PR-body proposal for manual disposition is not an implemented admin workflow in these source snapshots; no operator UPDATE commands are supplied here.

Migration 0001 labels 90-day audit / 7-day failed-unconfirmed payload retention as a proposal enforced by operational purge jobs. These migrations and the handler do not implement a scheduled purge or reconciliation worker. No completion workflow for risk review or independent durable pre-write ingress is established here. Resolve ownership/retention/integration decisions separately; this runbook does not invent them.

No delivery-speed claim, marketing-copy remediation, provisioning, production setting change, live send, payment/download/print workflow, or design/rendering change is part of X11.
