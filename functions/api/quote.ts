// Quote-form Pages Function — S55-6A no-silent-discard redesign.
//
// Invariant: every submitted enquiry reaches exactly one terminal state.
//   DELIVERED      — handed to Resend with a provider message ID captured in
//                    a durable attempt record before success is reported.
//   VISIBLY REJECTED — the submitter gets an explicit rejection/failure
//                    result (server-rendered result page keyed by an
//                    unguessable reference) and a durable rejection record.
// No spam, timing, duplicate, validation, configuration, or provider-failure
// branch returns apparent success without delivery evidence, and feedback is
// never selected from query parameters alone: `?submitted=1` means nothing
// anywhere in this flow. Outcomes live in the intake store (D1 binding
// QUOTE_DB; see migrations/0001_quote_intake.sql) and are rendered from the
// stored record.
//
// Spam handling is deterministic scoring, never silent disposal:
// honeypot +2, timing anomaly (fast / stale / untrusted) +1, link pattern +1.
// Score >= 1 requires a passed challenge, then the enquiry is DELIVERED with
// flags and marked "Review requested" in the business email.

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const TURNSTILE_VERIFY_ENDPOINT = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const RATE_WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 4;
const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;
const SENDING_STALE_MS = 15 * 60 * 1000;
const MIN_COMPLETION_MS = 3500;
const PROVIDER_TIMEOUT_MS = 10000;
const MAX_NAME_LENGTH = 80;
const MAX_PHONE_LENGTH = 30;
const MAX_EMAIL_LENGTH = 254;
const MAX_DETAILS_LENGTH = 2000;
const MAX_AREA_LENGTH = 180;
const MAX_SERVICE_LENGTH = 180;
const MAX_TRACKING_VALUE_LENGTH = 400;
const MAX_SHORT_VALUE_LENGTH = 180;

const BUSINESS_PHONE_DISPLAY = "250-858-1781";
const BUSINESS_PHONE_TEL = "+12508581781";

// The exact option values rendered by src/components/QuoteForm.astro.
// Area is a free-text input in the form, so it has no enum.
export const QUOTE_SERVICE_VALUES = [
  "not-sure",
  "mowing",
  "trim",
  "cleanup",
  "mulch",
  "powerwash",
  "rock",
  "fence",
  "gutter",
  "pruning",
  "moss",
  "driveway",
  "gravel",
  "ongoing",
  "other",
] as const;

export const QUOTE_SERVICE_LABELS: Record<string, string> = {
  "not-sure": "Not sure yet (we can recommend)",
  mowing: "Mowing and edging",
  trim: "Trimming and pruning",
  cleanup: "Seasonal cleanup",
  mulch: "Mulching and garden beds",
  powerwash: "Pressure washing (driveway, sidewalk, deck, siding)",
  rock: "Rock work / rock walls",
  fence: "Fence work / minor repairs",
  gutter: "Gutter cleaning (ground-accessible)",
  pruning: "Light pruning and shape-up",
  moss: "Moss/algae treatment",
  driveway: "Driveway grading or repair",
  gravel: "Gravel driveway install/refresh",
  ongoing: "Ongoing maintenance",
  other: "Other (describe below)",
};

export const QUOTE_TIMELINE_VALUES = ["", "as-soon-as-possible", "this-week", "next-1-2-weeks", "flexible"] as const;
export const QUOTE_TIMELINE_LABELS: Record<string, string> = {
  "": "Not sure yet",
  "as-soon-as-possible": "As soon as possible",
  "this-week": "This week",
  "next-1-2-weeks": "Next 1-2 weeks",
  flexible: "Flexible timing",
};

export const QUOTE_CONTACT_VALUES = ["text", "call", "email", "any"] as const;
export const QUOTE_CONTACT_LABELS: Record<string, string> = {
  text: "Text first",
  call: "Call first",
  email: "Email if provided",
  any: "Any method is fine",
};

type AttemptStatus = "sending" | "delivered" | "rejected" | "unconfirmed";

type FieldError = { field: string; message: string };

type QuotePayload = {
  name: string;
  phone: string;
  email: string;
  area: string;
  service: string;
  timeline: string;
  preferredContact: string;
  details: string;
  tracking: Record<string, string>;
};

type AttemptRecord = {
  id: string;
  submissionId: string;
  reference: string;
  createdAt: number;
  updatedAt: number;
  status: AttemptStatus;
  reasonCode: string | null;
  fieldErrors: FieldError[];
  riskScore: number;
  riskFlags: string[];
  contentHash: string | null;
  content: string | null;
  payload: QuotePayload | null;
  // The exact provider request body of this attempt's send, persisted
  // before the first provider call. A reconciling retry replays it
  // byte-for-byte under the same idempotency key (the attempt id): risk
  // flags are time-dependent, so rebuilding the email on a retry could
  // change it, and the provider rejects a reused key whose payload
  // differs (HTTP 409) — a rejection that says nothing about whether the
  // original send was accepted.
  providerPayload: string | null;
  providerMessageId: string | null;
  providerStatus: number | null;
  recipient: string | null;
  separateOf: string | null;
  retryAfterSeconds: number | null;
  returnTo: string | null;
  claimActive: boolean;
  deliveredAt: number | null;
};

type ClaimOutcome =
  | { kind: "claimed" }
  | { kind: "held"; holder: AttemptRecord };

interface QuoteStore {
  getAttemptById(id: string): Promise<AttemptRecord | null>;
  getAttemptByReference(reference: string): Promise<AttemptRecord | null>;
  getLatestAttemptBySubmissionId(submissionId: string): Promise<AttemptRecord | null>;
  // Creates the attempt. When record.claimActive is set, creation atomically
  // claims the (contentHash, content) pair; on conflict it throws an error
  // with `code === "QUOTE_CLAIM_CONFLICT"` and the current holder attached.
  createAttempt(record: AttemptRecord): Promise<void>;
  updateAttempt(id: string, patch: Partial<AttemptRecord>): Promise<void>;
  findClaimHolder(contentHash: string, content: string): Promise<AttemptRecord | null>;
  releaseClaim(id: string): Promise<void>;
  expireDeliveredClaims(cutoff: number): Promise<void>;
  incrementRate(ipDigest: string, windowStart: number): Promise<number>;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta?: { changes?: number } }>;
}

interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatement;
}

type QuoteEnv = {
  TURNSTILE_SECRET?: string;
  TURNSTILE_REQUIRED?: string;
  RESEND_API_KEY?: string;
  TO_EMAIL?: string;
  FROM_EMAIL?: string;
  PUBLIC_TURNSTILE_SITE_KEY?: string;
  // The same public analytics configuration the site build uses
  // (src/components/SEOHead.astro), read here as Pages runtime variables so
  // result-page resubmission forms can run the confirmed-delivery
  // conversion path (see resubmissionForm).
  PUBLIC_GA_ID?: string;
  PUBLIC_GOOGLE_ADS_ID?: string;
  PUBLIC_GOOGLE_ADS_QUOTE_LABEL?: string;
  QUOTE_DB?: D1DatabaseLike;
  QUOTE_ALLOW_MEMORY_STORE?: string;
  __quoteStore?: QuoteStore;
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

const getValue = (formData: FormData, key: string) =>
  (formData.get(key) ?? "").toString().trim();

const getIpAddress = (request: Request) => {
  const cfIp = request.headers.get("CF-Connecting-IP")?.trim();
  if (cfIp) return cfIp;
  const forwarded = request.headers.get("X-Forwarded-For") ?? "";
  return forwarded.split(",")[0]?.trim() || "";
};

const isTruthyFlag = (value: string | undefined) =>
  /^(1|true|yes|on)$/i.test((value ?? "").trim());

const randomToken = (length: number) => {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
};

const newReference = () => `MS-${randomToken(10)}`;
const newAttemptId = () => `att_${randomToken(20).toLowerCase()}`;

const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

// Enquiry identity (S55-6A A4): an exact, versioned serialization of all
// customer-provided business content. Only documented transport
// normalization is applied (consistent line endings; values arrive already
// outer-trimmed by getValue). No lowercasing, no truncation, no phone-digit
// reduction — no differing submitted business content can compare equal.
export const serializeEnquiryContent = (payload: QuotePayload) => {
  const normalize = (value: string) => value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return `v1:${JSON.stringify([
    normalize(payload.name),
    normalize(payload.phone),
    normalize(payload.email),
    normalize(payload.area),
    normalize(payload.service),
    normalize(payload.timeline),
    normalize(payload.preferredContact),
    normalize(payload.details),
  ])}`;
};

const isSameHostHeader = (candidateUrl: string | null, requestUrl: string) => {
  // Missing headers alone are not evidence of abuse (S55-6A A2).
  if (!candidateUrl) return true;
  try {
    const candidate = new URL(candidateUrl);
    const current = new URL(requestUrl);
    return candidate.host === current.host;
  } catch {
    return false;
  }
};

// The return destination keeps its same-host restriction; an invalid value
// falls back to the form anchor and never rejects an otherwise valid enquiry.
const validateReturnTo = (requestUrl: string, returnTo: string) => {
  const fallback = "/#quote";
  if (!returnTo) return fallback;
  try {
    const candidate = new URL(returnTo, requestUrl);
    const current = new URL(requestUrl);
    if (candidate.host === current.host && /^https?:$/.test(candidate.protocol)) {
      return `${candidate.pathname}${candidate.search}${candidate.hash || "#quote"}`;
    }
  } catch {
    return fallback;
  }
  return fallback;
};

const alertOperational = (event: string, detail: Record<string, unknown>) => {
  // Operational alert + independent ingress record substitute: structured
  // log line captured by the platform log stream. Raw payloads, challenge
  // tokens, and full IP addresses are never logged (digests only).
  console.error(JSON.stringify({ source: "quote-intake", event, ...detail }));
};

// ---------------------------------------------------------------------------
// Intake store: in-memory implementation (tests / explicit local dev) and
// the D1 implementation used in production. Both implement the same claim
// semantics: a (contentHash, content) pair is held by at most one attempt
// whose claimActive flag is set, and a holder is always confirmed against
// the complete serialized content, never the hash alone.
// ---------------------------------------------------------------------------

export const createMemoryQuoteStore = (): QuoteStore => {
  const attempts = new Map<string, AttemptRecord>();
  const rates = new Map<string, number>();

  const clone = (record: AttemptRecord): AttemptRecord => ({
    ...record,
    fieldErrors: record.fieldErrors.map((entry) => ({ ...entry })),
    riskFlags: [...record.riskFlags],
    payload: record.payload ? { ...record.payload, tracking: { ...record.payload.tracking } } : null,
  });

  const findHolderSync = (contentHash: string, content: string) => {
    for (const record of attempts.values()) {
      if (record.claimActive && record.contentHash === contentHash && record.content === content) {
        return record;
      }
    }
    return null;
  };

  return {
    async getAttemptById(id) {
      const record = attempts.get(id);
      return record ? clone(record) : null;
    },
    async getAttemptByReference(reference) {
      for (const record of attempts.values()) {
        if (record.reference === reference) return clone(record);
      }
      return null;
    },
    async getLatestAttemptBySubmissionId(submissionId) {
      let latest: AttemptRecord | null = null;
      for (const record of attempts.values()) {
        if (record.submissionId === submissionId && (!latest || record.createdAt >= latest.createdAt)) {
          latest = record;
        }
      }
      return latest ? clone(latest) : null;
    },
    async createAttempt(record) {
      // Synchronous critical section: the duplicate claim check and the
      // insert cannot interleave with another attempt in this isolate.
      if (attempts.has(record.id)) {
        const error = new Error("attempt id already exists") as Error & { code?: string };
        error.code = "QUOTE_ATTEMPT_EXISTS";
        throw error;
      }
      if (record.claimActive && record.contentHash && record.content) {
        const holder = findHolderSync(record.contentHash, record.content);
        if (holder) {
          const error = new Error("content claim already held") as Error & {
            code?: string;
            holder?: AttemptRecord;
          };
          error.code = "QUOTE_CLAIM_CONFLICT";
          error.holder = clone(holder);
          throw error;
        }
      }
      attempts.set(record.id, clone(record));
    },
    async updateAttempt(id, patch) {
      const record = attempts.get(id);
      if (!record) return;
      attempts.set(id, clone({ ...record, ...patch, id: record.id }));
    },
    async findClaimHolder(contentHash, content) {
      const holder = findHolderSync(contentHash, content);
      return holder ? clone(holder) : null;
    },
    async releaseClaim(id) {
      const record = attempts.get(id);
      if (record) attempts.set(id, { ...record, claimActive: false });
    },
    async expireDeliveredClaims(cutoff) {
      for (const record of attempts.values()) {
        if (record.claimActive && record.status === "delivered" && record.deliveredAt !== null && record.deliveredAt <= cutoff) {
          attempts.set(record.id, { ...record, claimActive: false });
        }
      }
    },
    async incrementRate(ipDigest, windowStart) {
      const key = `${ipDigest}|${windowStart}`;
      const next = (rates.get(key) ?? 0) + 1;
      rates.set(key, next);
      return next;
    },
  };
};

type AttemptRow = {
  id: string;
  submission_id: string;
  reference: string;
  created_at: number;
  updated_at: number;
  status: AttemptStatus;
  reason_code: string | null;
  field_errors: string | null;
  risk_score: number;
  risk_flags: string | null;
  content_hash: string | null;
  content: string | null;
  payload: string | null;
  provider_payload: string | null;
  provider_message_id: string | null;
  provider_status: number | null;
  recipient: string | null;
  separate_of: string | null;
  retry_after_seconds: number | null;
  return_to: string | null;
  claim_active: number;
  delivered_at: number | null;
};

const rowToRecord = (row: AttemptRow): AttemptRecord => ({
  id: row.id,
  submissionId: row.submission_id,
  reference: row.reference,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  status: row.status,
  reasonCode: row.reason_code,
  fieldErrors: row.field_errors ? (JSON.parse(row.field_errors) as FieldError[]) : [],
  riskScore: row.risk_score,
  riskFlags: row.risk_flags ? (JSON.parse(row.risk_flags) as string[]) : [],
  contentHash: row.content_hash,
  content: row.content,
  payload: row.payload ? (JSON.parse(row.payload) as QuotePayload) : null,
  providerPayload: row.provider_payload ?? null,
  providerMessageId: row.provider_message_id,
  providerStatus: row.provider_status,
  recipient: row.recipient,
  separateOf: row.separate_of,
  retryAfterSeconds: row.retry_after_seconds,
  returnTo: row.return_to,
  claimActive: row.claim_active === 1,
  deliveredAt: row.delivered_at,
});

const createD1QuoteStore = (db: D1DatabaseLike): QuoteStore => ({
  async getAttemptById(id) {
    const row = await db.prepare("SELECT * FROM quote_attempts WHERE id = ?").bind(id).first<AttemptRow>();
    return row ? rowToRecord(row) : null;
  },
  async getAttemptByReference(reference) {
    const row = await db
      .prepare("SELECT * FROM quote_attempts WHERE reference = ?")
      .bind(reference)
      .first<AttemptRow>();
    return row ? rowToRecord(row) : null;
  },
  async getLatestAttemptBySubmissionId(submissionId) {
    const row = await db
      .prepare("SELECT * FROM quote_attempts WHERE submission_id = ? ORDER BY created_at DESC LIMIT 1")
      .bind(submissionId)
      .first<AttemptRow>();
    return row ? rowToRecord(row) : null;
  },
  async createAttempt(record) {
    try {
      await db
        .prepare(
          `INSERT INTO quote_attempts (
            id, submission_id, reference, created_at, updated_at, status, reason_code,
            field_errors, risk_score, risk_flags, content_hash, content, payload,
            provider_payload, provider_message_id, provider_status, recipient, separate_of,
            retry_after_seconds, return_to, claim_active, delivered_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          record.id,
          record.submissionId,
          record.reference,
          record.createdAt,
          record.updatedAt,
          record.status,
          record.reasonCode,
          JSON.stringify(record.fieldErrors),
          record.riskScore,
          JSON.stringify(record.riskFlags),
          record.contentHash,
          record.content,
          record.payload ? JSON.stringify(record.payload) : null,
          record.providerPayload,
          record.providerMessageId,
          record.providerStatus,
          record.recipient,
          record.separateOf,
          record.retryAfterSeconds,
          record.returnTo,
          record.claimActive ? 1 : 0,
          record.deliveredAt
        )
        .run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/UNIQUE constraint failed: quote_attempts\.(content_hash|id)/i.test(message) || /unique/i.test(message)) {
        const holder =
          record.contentHash && record.content
            ? await this.findClaimHolder(record.contentHash, record.content)
            : null;
        const wrapped = new Error(message) as Error & { code?: string; holder?: AttemptRecord | null };
        wrapped.code = holder ? "QUOTE_CLAIM_CONFLICT" : "QUOTE_ATTEMPT_EXISTS";
        wrapped.holder = holder ?? undefined;
        throw wrapped;
      }
      throw error;
    }
  },
  async updateAttempt(id, patch) {
    const current = await this.getAttemptById(id);
    if (!current) return;
    const next = { ...current, ...patch, id: current.id };
    await db
      .prepare(
        `UPDATE quote_attempts SET
          submission_id = ?, reference = ?, created_at = ?, updated_at = ?, status = ?,
          reason_code = ?, field_errors = ?, risk_score = ?, risk_flags = ?, content_hash = ?,
          content = ?, payload = ?, provider_payload = ?, provider_message_id = ?, provider_status = ?, recipient = ?,
          separate_of = ?, retry_after_seconds = ?, return_to = ?, claim_active = ?, delivered_at = ?
        WHERE id = ?`
      )
      .bind(
        next.submissionId,
        next.reference,
        next.createdAt,
        next.updatedAt,
        next.status,
        next.reasonCode,
        JSON.stringify(next.fieldErrors),
        next.riskScore,
        JSON.stringify(next.riskFlags),
        next.contentHash,
        next.content,
        next.payload ? JSON.stringify(next.payload) : null,
        next.providerPayload,
        next.providerMessageId,
        next.providerStatus,
        next.recipient,
        next.separateOf,
        next.retryAfterSeconds,
        next.returnTo,
        next.claimActive ? 1 : 0,
        next.deliveredAt,
        id
      )
      .run();
  },
  async findClaimHolder(contentHash, content) {
    const row = await db
      .prepare("SELECT * FROM quote_attempts WHERE content_hash = ? AND content = ? AND claim_active = 1 LIMIT 1")
      .bind(contentHash, content)
      .first<AttemptRow>();
    return row ? rowToRecord(row) : null;
  },
  async releaseClaim(id) {
    await db.prepare("UPDATE quote_attempts SET claim_active = 0 WHERE id = ?").bind(id).run();
  },
  async expireDeliveredClaims(cutoff) {
    await db
      .prepare(
        "UPDATE quote_attempts SET claim_active = 0 WHERE claim_active = 1 AND status = 'delivered' AND delivered_at <= ?"
      )
      .bind(cutoff)
      .run();
  },
  async incrementRate(ipDigest, windowStart) {
    const row = await db
      .prepare(
        `INSERT INTO quote_rate_limits (ip_digest, window_start, count) VALUES (?, ?, 1)
         ON CONFLICT (ip_digest, window_start) DO UPDATE SET count = count + 1
         RETURNING count`
      )
      .bind(ipDigest, windowStart)
      .first<{ count: number }>();
    return row?.count ?? 1;
  },
});

// A single process-wide memory store, used only when QUOTE_ALLOW_MEMORY_STORE
// is explicitly set (local development). Production must bind QUOTE_DB;
// without a durable store the endpoint fails closed rather than pretending
// to keep records it cannot keep.
let sharedMemoryStore: QuoteStore | null = null;

const resolveStore = (env: QuoteEnv): QuoteStore | null => {
  if (env.__quoteStore) return env.__quoteStore;
  if (env.QUOTE_DB) return createD1QuoteStore(env.QUOTE_DB);
  if (isTruthyFlag(env.QUOTE_ALLOW_MEMORY_STORE)) {
    if (!sharedMemoryStore) sharedMemoryStore = createMemoryQuoteStore();
    return sharedMemoryStore;
  }
  return null;
};

// ---------------------------------------------------------------------------
// Server-rendered result pages. Feedback is rendered from the durable
// attempt record, keyed by an unguessable reference — never from bare
// submitted/error query parameters, so a hand-typed URL cannot fabricate a
// success state or a lead conversion.
// ---------------------------------------------------------------------------

const pageShell = (title: string, body: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${escapeHtml(title)} — Maestros Services</title>
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background: #f7f4ec; color: #22301f; margin: 0; }
  main { max-width: 42rem; margin: 0 auto; padding: 2.5rem 1.25rem 3rem; }
  .card { background: #ffffff; border: 1px solid #ddd6c4; border-radius: 1rem; padding: 1.75rem; }
  h1 { font-size: 1.6rem; margin: 0 0 0.75rem; }
  p { line-height: 1.55; }
  .ref { font-weight: 600; }
  .fields { background: #f7f4ec; border-radius: 0.75rem; padding: 1rem 1.25rem; }
  .fields dt { font-weight: 600; margin-top: 0.5rem; }
  .fields dd { margin: 0.15rem 0 0; white-space: pre-wrap; }
  label { display: block; font-weight: 600; margin-top: 1rem; }
  input, select, textarea { width: 100%; box-sizing: border-box; margin-top: 0.35rem; padding: 0.65rem 0.8rem; border: 1px solid #b9b09a; border-radius: 0.6rem; font: inherit; background: #fff; }
  button { margin-top: 1.25rem; background: #22301f; color: #fff; border: 0; border-radius: 999px; padding: 0.8rem 1.6rem; font: inherit; font-weight: 600; cursor: pointer; }
  .errors { color: #8a1f1f; }
  a { color: #22301f; }
</style>
</head>
<body>
<main>
<div class="card">
${body}
</div>
</main>
</body>
</html>`;

const contactLine = (toEmail: string) =>
  `<p>Questions? Call or text <a href="tel:${BUSINESS_PHONE_TEL}">${BUSINESS_PHONE_DISPLAY}</a> or email <a href="mailto:${escapeHtml(toEmail)}">${escapeHtml(toEmail)}</a>.</p>`;

const payloadSummary = (payload: QuotePayload) => `
<dl class="fields">
  <dt>Name</dt><dd>${escapeHtml(payload.name)}</dd>
  <dt>Phone</dt><dd>${escapeHtml(payload.phone)}</dd>
  <dt>Email</dt><dd>${escapeHtml(payload.email || "Not provided")}</dd>
  <dt>Service area</dt><dd>${escapeHtml(payload.area)}</dd>
  <dt>Service</dt><dd>${escapeHtml(QUOTE_SERVICE_LABELS[payload.service] ?? payload.service)}</dd>
  <dt>Timeline</dt><dd>${escapeHtml(QUOTE_TIMELINE_LABELS[payload.timeline] ?? payload.timeline ?? "Not provided")}</dd>
  <dt>Preferred contact</dt><dd>${escapeHtml(QUOTE_CONTACT_LABELS[payload.preferredContact] ?? payload.preferredContact ?? "Not provided")}</dd>
  <dt>Details</dt><dd>${escapeHtml(payload.details || "Not provided")}</dd>
</dl>`;

const optionsHtml = (values: readonly string[], labels: Record<string, string>, selected: string) =>
  values
    .map(
      (value) =>
        `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(labels[value] ?? value)}</option>`
    )
    .join("");

// A fresh attempt of the same (or corrected) content: new submission
// identity, values preserved. `separate` marks the S55-6A A4 "Send as a
// separate enquiry" override, which bypasses content-repeat suppression.
const resubmissionForm = (
  record: AttemptRecord,
  env: QuoteEnv,
  { separate, submitLabel }: { separate: boolean; submitLabel: string }
) => {
  const payload = record.payload;
  if (!payload) return "";
  const siteKey = (env.PUBLIC_TURNSTILE_SITE_KEY ?? "").trim();
  // Confirmed-delivery conversion tracking for this form (below): the same
  // public analytics IDs the site build is configured with, embedded so the
  // standalone result page can run QuoteForm.astro's verify-then-fire path.
  const analyticsConfig = JSON.stringify({
    gaId: (env.PUBLIC_GA_ID ?? "").trim(),
    googleAdsId: (env.PUBLIC_GOOGLE_ADS_ID ?? "").trim(),
    quoteLabel: (env.PUBLIC_GOOGLE_ADS_QUOTE_LABEL ?? "").trim(),
  }).replace(/</g, "\\u003c");
  return `
<h2 style="margin-top:2rem;">Your entries</h2>
<form method="POST" action="/api/quote">
  <label>Name <input name="name" value="${escapeHtml(payload.name)}" maxlength="${MAX_NAME_LENGTH}" required /></label>
  <label>Phone <input name="phone" value="${escapeHtml(payload.phone)}" maxlength="${MAX_PHONE_LENGTH}" required /></label>
  <label>Email (optional) <input name="email" type="email" value="${escapeHtml(payload.email)}" maxlength="${MAX_EMAIL_LENGTH}" /></label>
  <label>Service area <input name="area" value="${escapeHtml(payload.area)}" maxlength="${MAX_AREA_LENGTH}" required /></label>
  <label>Primary service needed <select name="service" required>${optionsHtml(QUOTE_SERVICE_VALUES, QUOTE_SERVICE_LABELS, payload.service)}</select></label>
  <label>When would you like this done? <select name="timeline">${optionsHtml(QUOTE_TIMELINE_VALUES, QUOTE_TIMELINE_LABELS, payload.timeline)}</select></label>
  <label>Best way to reply <select name="preferred_contact">${optionsHtml(QUOTE_CONTACT_VALUES, QUOTE_CONTACT_LABELS, payload.preferredContact)}</select></label>
  <label>Details (optional) <textarea name="details" maxlength="${MAX_DETAILS_LENGTH}">${escapeHtml(payload.details)}</textarea></label>
  <input type="hidden" name="return_to" value="${escapeHtml(record.returnTo ?? "/#quote")}" />
  <input type="hidden" name="form_started_at" value="" />
  <div aria-hidden="true" style="display:none;"><label>Company <input name="company" tabindex="-1" autocomplete="off" /></label></div>
  <div aria-hidden="true" style="display:none;"><label>Website <input name="website" tabindex="-1" autocomplete="off" /></label></div>
  ${separate ? '<input type="hidden" name="separate_enquiry" value="1" />' : ""}
  ${siteKey ? `<div class="cf-turnstile" data-sitekey="${escapeHtml(siteKey)}" data-action="quote_form"></div><script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>` : ""}
  <button type="submit">${escapeHtml(submitLabel)}</button>
</form>
<script>window.__MS_QUOTE_RESULT_ANALYTICS__ = ${analyticsConfig};</script>
<script>
  (function () {
    var started = document.querySelector('input[name="form_started_at"]');
    if (started) started.value = String(Date.now());
    var form = started ? started.closest("form") : null;
    if (form && !form.querySelector('input[name="submission_id"]')) {
      var id = document.createElement("input");
      id.type = "hidden";
      id.name = "submission_id";
      id.value = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : "sub_" + Date.now() + "_" + Math.random().toString(36).slice(2);
      form.appendChild(id);
    }
    var idInput = form ? form.querySelector('input[name="submission_id"]') : null;
    var submissionId = idInput ? idInput.value : "";

    // Confirmed-delivery conversion tracking — the same path the main
    // quote form runs (src/components/QuoteForm.astro): a lead conversion
    // fires only after the handler's durable record confirms delivery for
    // the reference this submission produced, and the reference-keyed
    // session-storage flag deduplicates it, so repeat views or a second
    // submission flow can never double-count the lead. A native
    // (no-JavaScript) submission still works exactly as before; the
    // delivered result page itself stays inert — landing on it fires
    // nothing.
    var sendResultLeadSuccess = function (eventId) {
      var cfg = window.__MS_QUOTE_RESULT_ANALYTICS__ || {};
      if (!eventId || (!cfg.gaId && !cfg.googleAdsId)) return;
      var eventKey = "ms_quote_success:" + eventId;
      try {
        if (window.sessionStorage.getItem(eventKey)) return;
      } catch (e) {}
      window.dataLayer = window.dataLayer || [];
      if (!window.gtag) {
        window.gtag = function () {
          window.dataLayer.push(arguments);
        };
      }
      window.gtag("js", new Date());
      if (cfg.gaId) {
        window.gtag("config", cfg.gaId, { anonymize_ip: true, send_page_view: false });
      }
      if (cfg.googleAdsId) {
        window.gtag("config", cfg.googleAdsId);
      }
      var attribution = {};
      try {
        attribution = JSON.parse(window.localStorage.getItem("ms_attribution_v1") || "{}") || {};
      } catch (e) {}
      window.gtag("event", "generate_lead", {
        event_category: "form",
        event_label: "quote_form_success",
        lead_event_id: eventId,
        page_group: "site",
        page_type: "default",
        page_template: "default",
        utm_source: attribution.utm_source || "(not set)",
        utm_medium: attribution.utm_medium || "(not set)",
        utm_campaign: attribution.utm_campaign || "(not set)"
      });
      if (cfg.quoteLabel) {
        window.gtag("event", "conversion", { send_to: cfg.quoteLabel });
      }
      try {
        window.sessionStorage.setItem(eventKey, "1");
      } catch (e) {}
      var primaryId = cfg.gaId || cfg.googleAdsId;
      if (primaryId) {
        var script = document.createElement("script");
        script.async = true;
        script.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(primaryId);
        document.head.appendChild(script);
      }
    };

    if (form) {
      var submitted = false;
      form.addEventListener("submit", function (event) {
        // Defence in depth against double-clicks: the server atomically
        // deduplicates retries of this one submission, but a second
        // submit should never leave the browser either.
        if (submitted) {
          event.preventDefault();
          return;
        }
        submitted = true;
        var submitButton = form.querySelector('button[type="submit"]');
        if (submitButton) submitButton.disabled = true;
        if (!window.fetch || !window.FormData) return;
        event.preventDefault();
        var formData = new FormData(form);
        fetch(form.action, {
          method: "POST",
          body: formData,
          credentials: "same-origin",
          redirect: "follow"
        })
          .then(function (response) {
            var nextUrl = response.url || "";
            var ref = null;
            try {
              ref = new URL(nextUrl, window.location.origin).searchParams.get("ref");
            } catch (e) {
              ref = null;
            }
            if (ref) {
              // Verify the stored outcome before counting a conversion,
              // then show the result page — the same order the main quote
              // form uses.
              return fetch("/api/quote?ref=" + encodeURIComponent(ref) + "&format=json", {
                credentials: "same-origin"
              })
                .then(function (verifyResponse) {
                  return verifyResponse.json();
                })
                .then(function (result) {
                  if (result && result.conversionEligible) {
                    sendResultLeadSuccess(ref);
                  }
                })
                .catch(function () {})
                .then(function () {
                  window.location.assign(nextUrl);
                });
            }
            if (response.status >= 400) {
              // A server-rendered terminal page returned inline (for
              // example a rate limit): display it as-is.
              return response.text().then(function (html) {
                document.open();
                document.write(html);
                document.close();
              });
            }
            window.location.assign(nextUrl || form.action);
          })
          .catch(function () {
            // Never fall back to a native resubmission: the first attempt
            // may already have been accepted, and a blind resend could
            // double-send it. Land on this submission's status page
            // instead, which renders whatever the durable record holds.
            if (submissionId) {
              window.location.assign("/api/quote?submission=" + encodeURIComponent(submissionId));
            }
          });
      });
    }
  })();
</script>`;
};

const REJECTION_COPY: Record<string, { title: string; message: string }> = {
  source_rejected: {
    title: "Your request was not sent",
    message:
      "It did not pass our source check, so nothing was sent. Please submit from the Maestros Services website, or contact us directly.",
  },
  malformed_request: {
    title: "Your request was not sent",
    message: "It could not be read, so nothing was sent. Please try again.",
  },
  rate_limited: {
    title: "Too many requests",
    message:
      "Several quote requests have come from this connection in a short time, so this one was not sent. Please wait for the interval below and try again, or contact us directly.",
  },
  validation_failed: {
    title: "Your request was not sent",
    message: "Please correct the fields noted below and resubmit. Your entries are preserved.",
  },
  challenge_not_configured: {
    title: "Your request was not sent",
    message:
      "The spam-protection check is not available right now, so your request could not be verified or sent. Please contact us directly.",
  },
  challenge_unavailable: {
    title: "Your request was not sent",
    message:
      "The spam-protection check could not be completed, so your request was not sent. Please try again, or contact us directly.",
  },
  challenge_missing: {
    title: "Your request was not sent",
    message: "Please complete the spam-protection check and resubmit. Nothing was sent.",
  },
  challenge_failed: {
    title: "Your request was not sent",
    message: "The spam-protection check did not pass, so your request was not sent. Please try again, or contact us directly.",
  },
  provider_not_configured: {
    title: "Your request was not sent",
    message: "We could not hand your request to our email service, so it was not sent. Please contact us directly.",
  },
  provider_failed: {
    title: "Your request was not sent",
    message:
      "We could not hand your request to our email service, so it was not sent. Your entries are preserved below — please try again or contact us directly.",
  },
  submission_conflict: {
    title: "Your request was not sent",
    message:
      "This submission reference was already used with different details, so nothing was sent. Please return to the form and submit again.",
  },
};

const resultPageHtml = (record: AttemptRecord, env: QuoteEnv, toEmail: string): string => {
  const backLink = `<p><a href="${escapeHtml(record.returnTo ?? "/#quote")}">Return to the quote form</a></p>`;

  if (record.status === "delivered") {
    return pageShell(
      "Quote request accepted",
      `<h1 tabindex="-1">Quote request accepted</h1>
<p>Your quote request was accepted by our email service for delivery. Reference: <span class="ref">${escapeHtml(record.reference)}</span>.</p>
${record.payload ? payloadSummary(record.payload) : ""}
<p>If you need to add anything, call or text ${BUSINESS_PHONE_DISPLAY} and mention your reference.</p>
${backLink}`
    );
  }

  if (record.status === "sending") {
    return pageShell(
      "Quote request in progress",
      `<h1 tabindex="-1">Your request is being processed</h1>
<p>Reference: <span class="ref">${escapeHtml(record.reference)}</span>. Please wait a moment and <a href="/api/quote?ref=${escapeHtml(record.reference)}">check this page again</a>. Do not submit again yet — a second submission cannot be confirmed until this one finishes.</p>
${contactLine(toEmail)}`
    );
  }

  if (record.status === "unconfirmed") {
    return pageShell(
      "Delivery could not be confirmed",
      `<h1 tabindex="-1">We could not confirm delivery</h1>
<p>Your request (reference <span class="ref">${escapeHtml(record.reference)}</span>) may or may not have reached our email service — the confirmation did not come back, so it is <strong>not</strong> counted as sent. Please do not assume we have it.</p>
<p><a href="/api/quote?ref=${escapeHtml(record.reference)}">Check the status of this submission</a> before sending another, or contact us directly and mention your reference.</p>
${record.payload ? payloadSummary(record.payload) : ""}
${contactLine(toEmail)}`
    );
  }

  // rejected
  if (record.reasonCode === "duplicate") {
    return pageShell(
      "No new email was sent",
      `<h1 tabindex="-1">No new email was sent</h1>
<p>No new email was sent because this matches an earlier request accepted by our email service. Reference: <span class="ref">${escapeHtml(record.separateOf ?? "")}</span>. Change the details or choose &lsquo;Send as a separate enquiry&rsquo; if this is another job.</p>
${record.payload ? payloadSummary(record.payload) : ""}
${resubmissionForm(record, env, { separate: true, submitLabel: "Send as a separate enquiry" })}
${contactLine(toEmail)}
${backLink}`
    );
  }

  if (record.reasonCode === "delivery_unconfirmed_exists") {
    return pageShell(
      "A matching request is awaiting confirmation",
      `<h1 tabindex="-1">A matching request is awaiting confirmation</h1>
<p>An identical request (reference <span class="ref">${escapeHtml(record.separateOf ?? "")}</span>) is still awaiting a delivery confirmation, so no new email was sent. Please check that submission's status before sending another, or contact us directly.</p>
${record.payload ? payloadSummary(record.payload) : ""}
${contactLine(toEmail)}
${backLink}`
    );
  }

  const copy = REJECTION_COPY[record.reasonCode ?? ""] ?? {
    title: "Your request was not sent",
    message: "Something went wrong, so your request was not sent. Please try again or contact us directly.",
  };
  const fieldList =
    record.fieldErrors.length > 0
      ? `<ul class="errors">${record.fieldErrors.map((entry) => `<li>${escapeHtml(entry.message)}</li>`).join("")}</ul>`
      : "";
  const retryLine =
    record.reasonCode === "rate_limited" && record.retryAfterSeconds
      ? `<p>Please wait about ${Math.max(1, Math.ceil(record.retryAfterSeconds / 60))} minute(s) before trying again.</p>`
      : "";
  const showForm = Boolean(record.payload) && record.reasonCode !== "source_rejected";
  return pageShell(
    copy.title,
    `<h1 tabindex="-1">${escapeHtml(copy.title)}</h1>
<p>${escapeHtml(copy.message)}</p>
${fieldList}
${retryLine}
${record.payload ? payloadSummary(record.payload) : ""}
${showForm ? resubmissionForm(record, env, { separate: false, submitLabel: "Send again" }) : ""}
${contactLine(toEmail)}
${backLink}`
  );
};

const simplePageResponse = (title: string, body: string, status: number, extraHeaders: Record<string, string> = {}) =>
  new Response(pageShell(title, body), {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders },
  });

const storageUnavailableResponse = (toEmail: string) =>
  simplePageResponse(
    "Quote form temporarily unavailable",
    `<h1 tabindex="-1">The quote form is temporarily unavailable</h1>
<p>Your request was not sent — the form cannot record submissions right now, so it does not accept them. Please contact us directly.</p>
${contactLine(toEmail)}`,
    503
  );

// ---------------------------------------------------------------------------
// Core pipeline
// ---------------------------------------------------------------------------

type QuoteContext = { request: Request; env: QuoteEnv };

const baseAttempt = (partial: Partial<AttemptRecord>): AttemptRecord => ({
  id: newAttemptId(),
  submissionId: "",
  reference: newReference(),
  createdAt: Date.now(),
  updatedAt: Date.now(),
  status: "rejected",
  reasonCode: null,
  fieldErrors: [],
  riskScore: 0,
  riskFlags: [],
  contentHash: null,
  content: null,
  payload: null,
  providerPayload: null,
  providerMessageId: null,
  providerStatus: null,
  recipient: null,
  separateOf: null,
  retryAfterSeconds: null,
  returnTo: null,
  claimActive: false,
  deliveredAt: null,
  ...partial,
});

const redirectToResult = (request: Request, reference: string) =>
  new Response(null, {
    status: 303,
    headers: {
      Location: new URL(`/api/quote?ref=${reference}`, request.url).toString(),
      "Cache-Control": "no-store",
    },
  });

const validatePayload = (payload: QuotePayload): FieldError[] => {
  const errors: FieldError[] = [];
  const push = (field: string, message: string) => {
    if (!errors.some((entry) => entry.field === field)) errors.push({ field, message });
  };

  if (!payload.name) push("name", "Name is required.");
  if (!payload.phone) push("phone", "Phone is required.");
  if (!payload.area) push("area", "Service area is required.");
  if (!payload.service) push("service", "Please choose a service from the list.");

  if (payload.name.length > MAX_NAME_LENGTH) push("name", `Name must be ${MAX_NAME_LENGTH} characters or fewer.`);
  if (payload.phone.length > MAX_PHONE_LENGTH) push("phone", `Phone must be ${MAX_PHONE_LENGTH} characters or fewer.`);
  if (payload.email.length > MAX_EMAIL_LENGTH) push("email", `Email must be ${MAX_EMAIL_LENGTH} characters or fewer.`);
  if (payload.area.length > MAX_AREA_LENGTH) push("area", `Service area must be ${MAX_AREA_LENGTH} characters or fewer.`);
  if (payload.service.length > MAX_SERVICE_LENGTH) push("service", `Service must be ${MAX_SERVICE_LENGTH} characters or fewer.`);
  if (payload.timeline.length > MAX_SHORT_VALUE_LENGTH) push("timeline", `Timeline must be ${MAX_SHORT_VALUE_LENGTH} characters or fewer.`);
  if (payload.preferredContact.length > MAX_SHORT_VALUE_LENGTH)
    push("preferred_contact", `Preferred contact must be ${MAX_SHORT_VALUE_LENGTH} characters or fewer.`);
  if (payload.details.length > MAX_DETAILS_LENGTH) push("details", `Details must be ${MAX_DETAILS_LENGTH} characters or fewer.`);
  if ((payload.tracking.page_title ?? "").length > MAX_SHORT_VALUE_LENGTH)
    push("page_title", `page_title must be ${MAX_SHORT_VALUE_LENGTH} characters or fewer.`);
  for (const [key, value] of Object.entries(payload.tracking)) {
    if (key === "page_title") continue;
    if (value.length > MAX_TRACKING_VALUE_LENGTH) {
      push(key, `${key} must be ${MAX_TRACKING_VALUE_LENGTH} characters or fewer.`);
    }
  }

  if (payload.phone) {
    const digits = payload.phone.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) push("phone", "Phone must contain 7 to 15 digits.");
  }
  if (payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    push("email", "Email does not look valid.");
  }
  if (payload.service && !(QUOTE_SERVICE_VALUES as readonly string[]).includes(payload.service)) {
    push("service", "Please choose a service from the list.");
  }
  if (!(QUOTE_TIMELINE_VALUES as readonly string[]).includes(payload.timeline)) {
    push("timeline", "Please choose a timeline from the list.");
  }
  if (!(QUOTE_CONTACT_VALUES as readonly string[]).includes(payload.preferredContact)) {
    push("preferred_contact", "Please choose how we should reply.");
  }
  if (payload.preferredContact === "email" && !payload.email) {
    push("email", "Email is required when email is the preferred reply method.");
  }
  return errors;
};

const scoreRisk = (input: {
  honeypot: string;
  secondaryHoneypot: string;
  startedAtRaw: string;
  name: string;
  details: string;
  now: number;
}): { score: number; flags: string[] } => {
  let score = 0;
  const flags: string[] = [];
  if (input.honeypot || input.secondaryHoneypot) {
    score += 2;
    flags.push("honeypot_populated");
  }
  const startedAt = Number.parseInt(input.startedAtRaw, 10);
  if (!input.startedAtRaw || !Number.isFinite(startedAt)) {
    score += 1;
    flags.push("timing_untrusted");
  } else {
    const elapsed = input.now - startedAt;
    if (elapsed < 0) {
      score += 1;
      flags.push("timing_untrusted");
    } else if (elapsed < MIN_COMPLETION_MS) {
      score += 1;
      flags.push("fast_completion");
    } else if (elapsed > DUPLICATE_WINDOW_MS) {
      score += 1;
      flags.push("stale_form");
    }
  }
  const linkMatches = `${input.name}\n${input.details}`.match(/https?:\/\/|www\./gi);
  if ((linkMatches?.length ?? 0) >= 2) {
    score += 1;
    flags.push("link_pattern");
  }
  return { score, flags };
};

const buildEmail = (payload: QuotePayload, record: AttemptRecord, toEmail: string) => {
  const flagged = record.riskScore > 0;
  const trackingRows: Array<[string, string]> = [
    ["UTM source", payload.tracking.utm_source ?? ""],
    ["UTM medium", payload.tracking.utm_medium ?? ""],
    ["UTM campaign", payload.tracking.utm_campaign ?? ""],
    ["UTM content", payload.tracking.utm_content ?? ""],
    ["UTM term", payload.tracking.utm_term ?? ""],
    ["gclid", payload.tracking.gclid ?? ""],
    ["fbclid", payload.tracking.fbclid ?? ""],
    ["msclkid", payload.tracking.msclkid ?? ""],
    ["Landing page", payload.tracking.landing_page ?? ""],
    ["Referrer", payload.tracking.referrer ?? ""],
    ["Page title", payload.tracking.page_title ?? ""],
    ["Page path", payload.tracking.page_path ?? ""],
  ];
  const populatedTrackingRows = trackingRows.filter(([, value]) => Boolean(value));
  const hasTrackingData = populatedTrackingRows.length > 0;

  const flagLines = flagged
    ? [
        "REVIEW REQUESTED — this enquiry was delivered with risk flags:",
        `Flags: ${record.riskFlags.join(", ")} (score ${record.riskScore})`,
        "",
      ]
    : [];
  const separateLines = record.separateOf
    ? [`Submitted as a separate enquiry (repeat of reference ${record.separateOf}).`, ""]
    : [];

  const text = [
    "New quote request",
    `Reference: ${record.reference}`,
    ...separateLines,
    ...flagLines,
    `Name: ${payload.name}`,
    `Phone: ${payload.phone}`,
    `Email: ${payload.email || "Not provided"}`,
    `Service area: ${payload.area}`,
    `Service: ${payload.service}`,
    `Timeline: ${payload.timeline || "Not provided"}`,
    `Preferred contact: ${payload.preferredContact || "Not provided"}`,
    `Details: ${payload.details || "Not provided"}`,
    ...(hasTrackingData
      ? ["", "Attribution:", ...populatedTrackingRows.map(([label, value]) => `${label}: ${value}`)]
      : []),
  ].join("\n");

  const html = `
    <h2>New quote request</h2>
    <p><strong>Reference:</strong> ${escapeHtml(record.reference)}</p>
    ${record.separateOf ? `<p>Submitted as a separate enquiry (repeat of reference ${escapeHtml(record.separateOf)}).</p>` : ""}
    ${
      flagged
        ? `<p><strong>Review requested</strong> — delivered with risk flags: ${escapeHtml(record.riskFlags.join(", "))} (score ${record.riskScore}).</p>`
        : ""
    }
    <p><strong>Name:</strong> ${escapeHtml(payload.name)}</p>
    <p><strong>Phone:</strong> ${escapeHtml(payload.phone)}</p>
    <p><strong>Email:</strong> ${escapeHtml(payload.email || "Not provided")}</p>
    <p><strong>Service area:</strong> ${escapeHtml(payload.area)}</p>
    <p><strong>Service:</strong> ${escapeHtml(payload.service)}</p>
    <p><strong>Timeline:</strong> ${escapeHtml(payload.timeline || "Not provided")}</p>
    <p><strong>Preferred contact:</strong> ${escapeHtml(payload.preferredContact || "Not provided")}</p>
    <p><strong>Details:</strong><br />${escapeHtml(payload.details || "Not provided").replace(/\n/g, "<br />")}</p>
    ${
      hasTrackingData
        ? `<h3>Attribution</h3><ul>${populatedTrackingRows
            .map(([label, value]) => `<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</li>`)
            .join("")}</ul>`
        : ""
    }
  `;

  return {
    subject: `${flagged ? "[Review requested] " : ""}New quote request - ${payload.name}`,
    text,
    html,
    toEmail,
  };
};

const handleQuotePost = async ({ request, env }: QuoteContext): Promise<Response> => {
  const toEmail = (env.TO_EMAIL ?? "quotes@maestrosservices.com").trim() || "quotes@maestrosservices.com";
  const fromEmail = env.FROM_EMAIL ?? "Maestros Services <quotes@maestrosservices.com>";
  const now = Date.now();
  const requestHost = new URL(request.url).host;
  const turnstileSecret = (env.TURNSTILE_SECRET ?? "").trim();
  const turnstileRequiredByConfig = isTruthyFlag(env.TURNSTILE_REQUIRED) || Boolean(turnstileSecret);

  const store = resolveStore(env);
  if (!store) {
    alertOperational("storage_unavailable", { at: now });
    return storageUnavailableResponse(toEmail);
  }

  const rejectAndRedirect = async (record: AttemptRecord) => {
    await store.createAttempt(record);
    return redirectToResult(request, record.reference);
  };

  // Source verification: a supplied cross-host or malformed Origin/Referer
  // is visibly rejected (S55-6A A2). It is never quietly accepted.
  if (
    !isSameHostHeader(request.headers.get("Origin"), request.url) ||
    !isSameHostHeader(request.headers.get("Referer"), request.url)
  ) {
    const record = baseAttempt({ status: "rejected", reasonCode: "source_rejected", createdAt: now, updatedAt: now });
    alertOperational("source_rejected", { reference: record.reference, at: now });
    return rejectAndRedirect(record);
  }

  // Shared rate limit (durable store, fixed 10-minute buckets, keyed IP
  // digest — never the raw address).
  const ipAddress = getIpAddress(request);
  if (ipAddress) {
    const ipDigest = await sha256Hex(`maestros-quote-v1|${ipAddress}`);
    const windowStart = Math.floor(now / RATE_WINDOW_MS) * RATE_WINDOW_MS;
    const count = await store.incrementRate(ipDigest, windowStart);
    if (count > MAX_REQUESTS_PER_WINDOW) {
      const retryAfterSeconds = Math.max(1, Math.ceil((windowStart + RATE_WINDOW_MS - now) / 1000));
      const record = baseAttempt({
        status: "rejected",
        reasonCode: "rate_limited",
        retryAfterSeconds,
        createdAt: now,
        updatedAt: now,
      });
      await store.createAttempt(record);
      alertOperational("rate_limited", { reference: record.reference, at: now });
      return new Response(resultPageHtml(record, env, toEmail), {
        status: 429,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Retry-After": String(retryAfterSeconds),
        },
      });
    }
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    const record = baseAttempt({ status: "rejected", reasonCode: "malformed_request", createdAt: now, updatedAt: now });
    return rejectAndRedirect(record);
  }

  const returnTo = validateReturnTo(request.url, getValue(formData, "return_to"));
  const separateEnquiry = getValue(formData, "separate_enquiry") === "1";
  const submittedIdRaw = getValue(formData, "submission_id");
  const submissionId = /^[A-Za-z0-9_-]{8,80}$/.test(submittedIdRaw) ? submittedIdRaw : `srv_${randomToken(16).toLowerCase()}`;

  const payload: QuotePayload = {
    name: getValue(formData, "name"),
    phone: getValue(formData, "phone"),
    email: getValue(formData, "email"),
    area: getValue(formData, "area"),
    service: getValue(formData, "service"),
    timeline: getValue(formData, "timeline"),
    preferredContact: getValue(formData, "preferred_contact"),
    details: getValue(formData, "details"),
    tracking: {
      utm_source: getValue(formData, "utm_source"),
      utm_medium: getValue(formData, "utm_medium"),
      utm_campaign: getValue(formData, "utm_campaign"),
      utm_content: getValue(formData, "utm_content"),
      utm_term: getValue(formData, "utm_term"),
      gclid: getValue(formData, "gclid"),
      fbclid: getValue(formData, "fbclid"),
      msclkid: getValue(formData, "msclkid"),
      landing_page: getValue(formData, "landing_page"),
      referrer: getValue(formData, "referrer"),
      page_title: getValue(formData, "page_title"),
      page_path: getValue(formData, "page_path"),
    },
  };
  const serialized = serializeEnquiryContent(payload);
  const { score, flags } = scoreRisk({
    honeypot: getValue(formData, "company"),
    secondaryHoneypot: getValue(formData, "website"),
    startedAtRaw: getValue(formData, "form_started_at"),
    name: payload.name,
    details: payload.details,
    now,
  });

  // Attempt-identity reconciliation: a retry of the same submission id with
  // the same content resumes the existing attempt instead of double-sending.
  let attempt: AttemptRecord | null = null;
  // True when the attempt was resumed in an ambiguous state ("sending" gone
  // stale, or "unconfirmed"): an earlier invocation may already have handed
  // it to the provider without confirmation. Such an attempt's state and
  // content claim must survive any verification failure in a later request
  // (see finalizeRejection).
  let resumedAmbiguousAttempt = false;
  const existing = await store.getLatestAttemptBySubmissionId(submissionId);
  if (existing && existing.content !== null) {
    if (existing.content !== serialized) {
      if (existing.status !== "rejected") {
        const record = baseAttempt({
          submissionId,
          status: "rejected",
          reasonCode: "submission_conflict",
          payload,
          returnTo,
          createdAt: now,
          updatedAt: now,
        });
        return rejectAndRedirect(record);
      }
      // A terminally rejected attempt does not block a corrected resubmission.
    } else if (existing.status === "delivered") {
      const record = baseAttempt({
        submissionId,
        status: "rejected",
        reasonCode: "duplicate",
        separateOf: existing.reference,
        payload,
        returnTo,
        createdAt: now,
        updatedAt: now,
      });
      return rejectAndRedirect(record);
    } else if (existing.status === "sending" && now - existing.updatedAt <= SENDING_STALE_MS) {
      return redirectToResult(request, existing.reference);
    } else if (existing.status === "sending" || existing.status === "unconfirmed") {
      attempt = existing;
      resumedAmbiguousAttempt = true;
    }
  }

  if (!attempt) {
    // Fresh attempt: validation first, with field-specific corrections.
    const fieldErrors = validatePayload(payload);
    if (fieldErrors.length > 0) {
      const record = baseAttempt({
        submissionId,
        status: "rejected",
        reasonCode: "validation_failed",
        fieldErrors,
        payload,
        returnTo,
        createdAt: now,
        updatedAt: now,
      });
      return rejectAndRedirect(record);
    }

    const contentHash = await sha256Hex(serialized);
    const fresh = baseAttempt({
      submissionId,
      status: "sending",
      riskScore: score,
      riskFlags: flags,
      contentHash,
      content: serialized,
      payload,
      returnTo,
      claimActive: !separateEnquiry,
      createdAt: now,
      updatedAt: now,
    });

    if (separateEnquiry) {
      // The override bypasses content-repeat suppression and does not take
      // over the original's claim; the original stays the suppression
      // holder until its 24-hour claim expires. The original's reference is
      // kept on this attempt so the business email can link the two.
      //
      // Bypassing the content claim must not leave this submission itself
      // unguarded: two concurrent requests carrying the same submission id
      // (a double-click on the result-page form) both pass the lookup
      // above before either creates its attempt, and without a guard both
      // would insert and send. So the attempt claims a submission-scoped
      // key through the same atomic claim primitive — a key derived from
      // the submission id and the content hash, stored in the claim's hash
      // slot (the record's content itself stays the exact serialized
      // enquiry, so submission reconciliation above is unaffected, and the
      // original's real content claim is never matched by it). Creation is
      // atomic in both stores, so exactly one of the racing requests
      // inserts; the other reconciles onto the winner below.
      const holder = await store.findClaimHolder(contentHash, serialized);
      const separateClaimHash = await sha256Hex(`maestros-quote-separate-v1|${submissionId}|${contentHash}`);
      const withOrigin = {
        ...fresh,
        separateOf: holder && holder.content === serialized ? holder.reference : null,
        contentHash: separateClaimHash,
        claimActive: true,
      };
      try {
        await store.createAttempt(withOrigin);
        attempt = withOrigin;
      } catch (error) {
        const claimHolder = (error as { holder?: AttemptRecord }).holder ?? null;
        if (!claimHolder || claimHolder.submissionId !== submissionId) throw error;
        // A concurrent request for this very separate submission won the
        // claim; reconcile onto its attempt instead of sending again.
        if (claimHolder.status === "delivered") {
          return redirectToResult(request, claimHolder.reference);
        }
        if (claimHolder.status === "sending" && now - claimHolder.updatedAt <= SENDING_STALE_MS) {
          return redirectToResult(request, claimHolder.reference);
        }
        if (claimHolder.status === "sending" || claimHolder.status === "unconfirmed") {
          attempt = claimHolder;
          resumedAmbiguousAttempt = true;
        } else {
          // The holder is terminally rejected; its claim is released by
          // the rejection paths, so a live claim here is inconsistent —
          // proceed without one rather than suppress a legitimate retry.
          const unclaimed = { ...withOrigin, claimActive: false };
          await store.createAttempt(unclaimed);
          attempt = unclaimed;
        }
      }
    } else {
      await store.expireDeliveredClaims(now - DUPLICATE_WINDOW_MS);
      try {
        await store.createAttempt(fresh);
        attempt = fresh;
      } catch (error) {
        const holder =
          (error as { holder?: AttemptRecord }).holder ??
          (await store.findClaimHolder(contentHash, serialized));
        if (!holder) throw error;
        if (holder.submissionId === submissionId) {
          // A concurrent retry of this very submission won the claim;
          // reconcile onto its result instead of opening a second record.
          return redirectToResult(request, holder.reference);
        }
        if (holder.content !== serialized) {
          // Hash collision with different content: never suppress a
          // different enquiry on hash equality alone (S55-6A A4). Proceed
          // without the claim.
          alertOperational("content_hash_collision", { reference: fresh.reference, at: now });
          await store.createAttempt({ ...fresh, claimActive: false });
          attempt = { ...fresh, claimActive: false };
        } else if (holder.status === "delivered") {
          const record = baseAttempt({
            submissionId,
            status: "rejected",
            reasonCode: "duplicate",
            separateOf: holder.reference,
            payload,
            returnTo,
            createdAt: now,
            updatedAt: now,
          });
          return rejectAndRedirect(record);
        } else {
          if (holder.status === "sending" && now - holder.updatedAt > SENDING_STALE_MS) {
            await store.updateAttempt(holder.id, {
              status: "unconfirmed",
              reasonCode: "provider_unconfirmed",
              updatedAt: now,
            });
          }
          const record = baseAttempt({
            submissionId,
            status: "rejected",
            reasonCode: "delivery_unconfirmed_exists",
            separateOf: holder.reference,
            payload,
            returnTo,
            createdAt: now,
            updatedAt: now,
          });
          return rejectAndRedirect(record);
        }
      }
    }
  } else {
    // Reconcile: the resumed attempt keeps its stored risk assessment for
    // anything that shapes the provider payload — the payload is built
    // from (or replayed as) the original below. This request's fresh risk
    // telemetry is recorded on the record only after that payload is
    // secured (see the send path), so a retry can never change the email
    // under the attempt's unchanged idempotency key.
  }

  if (!attempt) {
    // Unreachable by construction (every path above assigns or returns);
    // fail closed rather than risk an unrecorded send.
    alertOperational("attempt_resolution_failed", { at: now });
    return storageUnavailableResponse(toEmail);
  }

  const finalizeRejection = async (reasonCode: string) => {
    if (resumedAmbiguousAttempt) {
      // A resumed attempt may already have been accepted by the provider —
      // its earlier send ended without confirmation, so its outcome is
      // unknown. A challenge or configuration failure in THIS request
      // (missing token, failed/unavailable verification, unconfigured
      // challenge or provider) establishes nothing about that send, so it
      // must not overwrite the ambiguous state or release the content
      // claim: either would let a later fresh submission re-send the same
      // enquiry under a new idempotency key and duplicate an accepted
      // email, while telling the customer nothing was sent. The attempt
      // stays unconfirmed (a stale "sending" record is normalized to the
      // same classification the claim path already gives it) until a retry
      // reconciles it with the provider under its original key.
      await store.updateAttempt(attempt.id, {
        status: "unconfirmed",
        reasonCode: "provider_unconfirmed",
        updatedAt: Date.now(),
      });
      return redirectToResult(request, attempt.reference);
    }
    await store.updateAttempt(attempt.id, {
      status: "rejected",
      reasonCode,
      claimActive: false,
      updatedAt: Date.now(),
    });
    return redirectToResult(request, attempt.reference);
  };

  // Challenge: required by configuration, or by any risk signal (S55-6A A3).
  const challengeRequired = turnstileRequiredByConfig || score >= 1;
  if (challengeRequired) {
    if (!turnstileSecret) {
      alertOperational("challenge_not_configured", { reference: attempt.reference, at: now });
      return finalizeRejection("challenge_not_configured");
    }
    const token = getValue(formData, "cf-turnstile-response");
    if (!token) {
      return finalizeRejection("challenge_missing");
    }
    let outcome: { success?: boolean; hostname?: string; action?: string };
    try {
      const verify = await fetch(TURNSTILE_VERIFY_ENDPOINT, {
        method: "POST",
        body: new URLSearchParams({ secret: turnstileSecret, response: token, remoteip: ipAddress }),
      });
      outcome = (await verify.json()) as { success?: boolean; hostname?: string; action?: string };
    } catch {
      return finalizeRejection("challenge_unavailable");
    }
    if (!outcome.success || outcome.hostname !== requestHost || outcome.action !== "quote_form") {
      return finalizeRejection("challenge_failed");
    }
  }

  const resendKey = (env.RESEND_API_KEY ?? "").trim();
  if (!resendKey) {
    alertOperational("provider_not_configured", { reference: attempt.reference, at: now });
    return finalizeRejection("provider_not_configured");
  }

  // The provider payload is persisted before the first provider call and
  // replayed byte-for-byte on every reconciling retry. The email is built
  // from the attempt's stored payload and stored risk assessment — never
  // from this request's fresh inputs — because risk flags are
  // time-dependent (a fast submission retried seconds later scores
  // differently) and the provider rejects a reused idempotency key whose
  // payload differs (HTTP 409), a response that establishes nothing about
  // the original send. Persisting before the call means even a send whose
  // acceptance response is lost leaves the exact body behind for its
  // retry.
  let providerBody = attempt.providerPayload;
  if (!providerBody) {
    const email = buildEmail(attempt.payload ?? payload, attempt, toEmail);
    providerBody = JSON.stringify({
      from: fromEmail,
      to: [email.toEmail],
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
    await store.updateAttempt(attempt.id, { providerPayload: providerBody, updatedAt: Date.now() });
    attempt.providerPayload = providerBody;
  }

  if (resumedAmbiguousAttempt) {
    // Record this request's risk telemetry only now that the provider
    // payload is frozen, so it can never shape the email a retry sends.
    await store.updateAttempt(attempt.id, { riskScore: score, riskFlags: flags, updatedAt: Date.now() });
    attempt.riskScore = score;
    attempt.riskFlags = flags;
  }

  let response: Response;
  try {
    response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
        // The attempt id is stable across reconciled retries, so the
        // provider dedupes a retry of an ambiguously accepted send.
        "Idempotency-Key": attempt.id,
      },
      body: providerBody,
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch {
    await store.updateAttempt(attempt.id, {
      status: "unconfirmed",
      reasonCode: "provider_unconfirmed",
      updatedAt: Date.now(),
    });
    return redirectToResult(request, attempt.reference);
  }

  if (!response.ok) {
    if (resumedAmbiguousAttempt) {
      // A non-OK response to a reconciling retry does not establish the
      // original send's outcome: the provider may already have accepted
      // that send, and an error here (a 409 for a reused key, a transient
      // 5xx) speaks only to this request. Resolving the attempt as
      // rejected would release its content claim and let a fresh
      // submission re-send the same enquiry under a new idempotency key,
      // duplicating a possibly accepted email. The attempt stays
      // unconfirmed with its claim held until a retry reconciles it.
      await store.updateAttempt(attempt.id, {
        status: "unconfirmed",
        reasonCode: "provider_unconfirmed",
        providerStatus: response.status,
        updatedAt: Date.now(),
      });
      return redirectToResult(request, attempt.reference);
    }
    await store.updateAttempt(attempt.id, {
      status: "rejected",
      reasonCode: "provider_failed",
      providerStatus: response.status,
      claimActive: false,
      updatedAt: Date.now(),
    });
    return redirectToResult(request, attempt.reference);
  }

  let providerMessageId: string | null = null;
  try {
    const body = (await response.json()) as { id?: unknown };
    if (typeof body.id === "string" && body.id) providerMessageId = body.id;
  } catch {
    providerMessageId = null;
  }
  if (!providerMessageId) {
    // HTTP OK without a usable acceptance body is not delivery evidence.
    await store.updateAttempt(attempt.id, {
      status: "unconfirmed",
      reasonCode: "provider_unconfirmed",
      providerStatus: response.status,
      updatedAt: Date.now(),
    });
    return redirectToResult(request, attempt.reference);
  }

  const deliveredAt = Date.now();
  await store.updateAttempt(attempt.id, {
    status: "delivered",
    providerMessageId,
    providerStatus: response.status,
    recipient: toEmail,
    deliveredAt,
    updatedAt: deliveredAt,
  });
  return redirectToResult(request, attempt.reference);
};

const handleQuoteGet = async ({ request, env }: QuoteContext): Promise<Response> => {
  const toEmail = (env.TO_EMAIL ?? "quotes@maestrosservices.com").trim() || "quotes@maestrosservices.com";
  const params = new URL(request.url).searchParams;
  const store = resolveStore(env);
  if (!store) {
    alertOperational("storage_unavailable", { at: Date.now() });
    return storageUnavailableResponse(toEmail);
  }
  const reference = params.get("ref") ?? "";
  const submission = params.get("submission") ?? "";
  const record = reference
    ? await store.getAttemptByReference(reference)
    : submission
      ? await store.getLatestAttemptBySubmissionId(submission)
      : null;
  if (!record) {
    if (params.get("format") === "json") {
      return new Response(JSON.stringify({ error: "not_found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }
    return simplePageResponse(
      "Submission not found",
      `<h1 tabindex="-1">We could not find that submission</h1>
<p>No quote request matches that reference, so nothing can be confirmed from this page. If you submitted the form, please contact us directly and we will sort it out.</p>
${contactLine(toEmail)}`,
      404
    );
  }
  if (params.get("format") === "json") {
    return new Response(
      JSON.stringify({
        reference: record.reference,
        status: record.status,
        reasonCode: record.reasonCode,
        conversionEligible: record.status === "delivered",
        fieldErrors: record.fieldErrors,
      }),
      { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
    );
  }
  return new Response(resultPageHtml(record, env, toEmail), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
};

const methodNotAllowed = async ({ request, env }: QuoteContext): Promise<Response> => {
  const toEmail = (env.TO_EMAIL ?? "quotes@maestrosservices.com").trim() || "quotes@maestrosservices.com";
  const store = resolveStore(env);
  if (store) {
    try {
      await store.createAttempt(
        baseAttempt({ status: "rejected", reasonCode: "method_not_allowed", createdAt: Date.now(), updatedAt: Date.now() })
      );
    } catch {
      // The 405 response stands even if the audit write fails.
    }
  }
  alertOperational("method_not_allowed", { method: request.method, at: Date.now() });
  return simplePageResponse(
    "Method not allowed",
    `<h1 tabindex="-1">That request method is not supported</h1>
<p>The quote form accepts POST submissions only. Please use the form, or contact us directly.</p>
${contactLine(toEmail)}`,
    405,
    { Allow: "POST, GET" }
  );
};

export const onRequest = async (context: QuoteContext): Promise<Response> => {
  if (context.request.method === "POST") return handleQuotePost(context);
  if (context.request.method === "GET") return handleQuoteGet(context);
  return methodNotAllowed(context);
};

export const onRequestPost = async (context: QuoteContext): Promise<Response> => {
  if (context.request.method !== "POST") return methodNotAllowed(context);
  return handleQuotePost(context);
};

export const onRequestGet = async (context: QuoteContext): Promise<Response> => handleQuoteGet(context);
