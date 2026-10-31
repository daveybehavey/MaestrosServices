-- Quote intake store (S55-6A A7) for functions/api/quote.ts.
--
-- Provisioning (deploy-time, NOT done by this migration):
--   1. Create the database:        wrangler d1 create maestros-quote-intake
--   2. Apply this migration:       wrangler d1 migrations apply maestros-quote-intake
--      (or execute this file in the Cloudflare dashboard SQL console)
--   3. Bind it to the Pages project `maestrosservices` as QUOTE_DB
--      (Pages project Settings -> Functions -> D1 database bindings).
--   4. Also set PUBLIC_TURNSTILE_SITE_KEY as a Pages runtime environment
--      variable so server-rendered result pages can re-render the
--      challenge widget on resubmission forms (the Astro build inlines
--      the same value at build time; the Function reads it at runtime).
--
-- Until QUOTE_DB is bound, the endpoint fails closed (503, visible
-- "temporarily unavailable") rather than accepting submissions it cannot
-- durably record.
--
-- Retention (S55-6A A7 proposal, enforced by operational purge jobs):
--   audit metadata 90 days; failed/unconfirmed payload recovery 7 days;
--   exact-content duplicate claims expire 24 hours after confirmed handoff
--   (claim_active is cleared by the endpoint's expiry sweep; the attempt
--   rows themselves are the audit record).

CREATE TABLE IF NOT EXISTS quote_attempts (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  status TEXT NOT NULL, -- sending | delivered | rejected | unconfirmed
  reason_code TEXT,
  field_errors TEXT, -- JSON array of {field, message}
  risk_score INTEGER NOT NULL DEFAULT 0,
  risk_flags TEXT, -- JSON array of flag names
  content_hash TEXT,
  content TEXT, -- exact serialized enquiry content (restricted storage)
  payload TEXT, -- JSON business fields (restricted storage; recovery window)
  provider_message_id TEXT,
  provider_status INTEGER,
  recipient TEXT,
  separate_of TEXT, -- reference of the original attempt for repeats/overrides
  retry_after_seconds INTEGER,
  return_to TEXT,
  claim_active INTEGER NOT NULL DEFAULT 0,
  delivered_at INTEGER
);

-- One live claim per exact enquiry content. Keyed by (content_hash,
-- content): a hash collision with different content does not block a
-- different enquiry, and matches are always confirmed against the full
-- serialized content, never the hash alone.
CREATE UNIQUE INDEX IF NOT EXISTS quote_attempts_live_content
  ON quote_attempts (content_hash, content)
  WHERE claim_active = 1;

CREATE INDEX IF NOT EXISTS quote_attempts_by_submission
  ON quote_attempts (submission_id);

CREATE TABLE IF NOT EXISTS quote_rate_limits (
  ip_digest TEXT NOT NULL, -- keyed digest; raw addresses are never stored
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_digest, window_start)
);
