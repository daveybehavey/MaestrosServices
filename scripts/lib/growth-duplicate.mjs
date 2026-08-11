/**
 * Deterministic exact / near-duplicate detection for GBP post text.
 */

export const normalizePostText = (text) =>
  String(text ?? "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const wordTokens = (normalizedText) =>
  normalizedText.split(" ").filter(Boolean);

export const wordBigrams = (tokens) => {
  if (tokens.length < 2) return new Set(tokens);
  const grams = new Set();
  for (let i = 0; i < tokens.length - 1; i += 1) {
    grams.add(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return grams;
};

export const jaccardSimilarity = (setA, setB) => {
  if (!(setA instanceof Set) || !(setB instanceof Set)) {
    throw new Error("jaccardSimilarity expects Set operands");
  }
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const value of setA) {
    if (setB.has(value)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
};

export const scorePostSimilarity = (leftText, rightText) => {
  const leftNorm = normalizePostText(leftText);
  const rightNorm = normalizePostText(rightText);
  const exact = leftNorm.length > 0 && leftNorm === rightNorm;
  const leftGrams = wordBigrams(wordTokens(leftNorm));
  const rightGrams = wordBigrams(wordTokens(rightNorm));
  const score = Number(jaccardSimilarity(leftGrams, rightGrams).toFixed(4));
  return {
    exact,
    score,
    leftNormalized: leftNorm,
    rightNormalized: rightNorm,
  };
};

export const findDuplicateMatch = (
  candidateText,
  recentPosts = [],
  { nearDuplicateThreshold = 0.82 } = {}
) => {
  if (!Array.isArray(recentPosts)) {
    throw new Error("recentPosts must be an array");
  }
  if (
    typeof nearDuplicateThreshold !== "number" ||
    nearDuplicateThreshold < 0 ||
    nearDuplicateThreshold > 1
  ) {
    throw new Error("nearDuplicateThreshold must be a number between 0 and 1");
  }

  let best = null;
  for (const post of recentPosts) {
    const summary = typeof post === "string" ? post : post?.summary;
    if (!summary) continue;
    const similarity = scorePostSimilarity(candidateText, summary);
    const match = {
      type: similarity.exact ? "exact" : "near",
      score: similarity.score,
      exact: similarity.exact,
      matchedSummary: summary,
      matchedPostId: post?.name ?? post?.id ?? null,
      threshold: nearDuplicateThreshold,
    };
    if (similarity.exact) {
      return { ...match, isDuplicate: true };
    }
    if (similarity.score >= nearDuplicateThreshold) {
      if (!best || match.score > best.score) best = { ...match, isDuplicate: true };
    } else if (!best || match.score > best.score) {
      best = { ...match, isDuplicate: false };
    }
  }

  return (
    best ?? {
      type: null,
      score: 0,
      exact: false,
      isDuplicate: false,
      matchedSummary: null,
      matchedPostId: null,
      threshold: nearDuplicateThreshold,
    }
  );
};
