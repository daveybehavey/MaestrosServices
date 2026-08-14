/**
 * Treat empty / whitespace-only env values as unset (GitHub Actions optional-secret shape).
 */

export const nonEmptyEnvValue = (env, name) => {
  const raw = env?.[name];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * Prefer a non-empty primary env key, else a non-empty fallback key.
 * Source metadata always matches the value actually selected.
 */
export const preferEnvValue = (env, primaryName, fallbackName) => {
  const primary = nonEmptyEnvValue(env, primaryName);
  if (primary != null) {
    return { value: primary, source: primaryName };
  }
  const fallback = nonEmptyEnvValue(env, fallbackName);
  if (fallback != null) {
    return { value: fallback, source: fallbackName };
  }
  return { value: null, source: null };
};
