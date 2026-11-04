-- Persisted provider payload for functions/api/quote.ts (PR #31 fix
-- round 2). The handler stores the exact Resend request body on the
-- attempt before its first provider call and replays it byte-for-byte on
-- reconciling retries: the attempt id is the provider idempotency key,
-- and the provider rejects a reused key whose payload differs, while
-- risk flags (which shape the email) are time-dependent.
ALTER TABLE quote_attempts ADD COLUMN provider_payload TEXT;
