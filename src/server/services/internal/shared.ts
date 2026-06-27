import type { HypothesisRecord } from "@/server/services/types";

// Cross-cutting constants and primitive helpers shared by the world-model
// service modules. This module has no dependencies on the services themselves,
// so it is safe to import from any service module (AGENTS.md §3).

export const DEFAULT_CANDIDATE_THRESHOLD = 0.25;
export const DEFAULT_MIN_CANDIDATE_PROBABILITY_DELTA = 0.01;
export const OBSERVATION_RECOMMENDATION_THRESHOLD = 0.2;
export const LLM_FALLBACK_CANDIDATE_LIMIT = 5;
export const SOURCE_FAILURE_SUPPRESSION_THRESHOLD = 3;
export const SOURCE_FAILURE_RETRY_COOLDOWN_MS = 6 * 60 * 60 * 1000;
export const SOURCE_DUPLICATE_STALENESS_THRESHOLD = 3;
export const SOURCE_DUPLICATE_RETRY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_QUERY_TEMPLATE_SOURCE_KINDS = new Set(["GITHUB", "HUGGING_FACE", "GDELT", "PREDICTION_MARKET"]);
export const CALIBRATION_QUERY_ERROR_THRESHOLD = 0.35;
export const CALIBRATION_QUERY_PRIORITY_WEIGHT = 0.2;
export const COUNTER_EVIDENCE_QUERY_PROBABILITY_THRESHOLD = 0.8;
export const COUNTER_EVIDENCE_QUERY_PRIORITY_BOOST = 0.75;
export const STALE_EVIDENCE_QUERY_DAYS = 30;
export const STALE_EVIDENCE_QUERY_PRIORITY_BOOST = 0.6;
export const FRAGILE_CERTAINTY_QUERY_PROBABILITY_THRESHOLD = 0.85;
export const FRAGILE_CERTAINTY_QUERY_QUALITY_THRESHOLD = 0.55;
export const FRAGILE_CERTAINTY_QUERY_PRIORITY_BOOST = 0.7;
export const DAY_MS = 24 * 60 * 60 * 1000;

export function now() {
  return new Date();
}

export function isCurrentlyEffectiveHypothesis(hypothesis: HypothesisRecord, referenceTime = now()) {
  if (hypothesis.status !== "ACTIVE") return false;
  const referenceMs = referenceTime.getTime();
  if (hypothesis.startsAt && hypothesis.startsAt.getTime() > referenceMs) return false;
  if (hypothesis.expiresAt && hypothesis.expiresAt.getTime() <= referenceMs) return false;
  return true;
}

export function isSettlementReviewDueHypothesis(hypothesis: HypothesisRecord, referenceTime = now()) {
  if (hypothesis.status !== "ACTIVE" || !hypothesis.expiresAt) return false;
  return hypothesis.expiresAt.getTime() <= referenceTime.getTime();
}

export function textTokens(value: string) {
  const normalized = value
    .toLowerCase()
    .replaceAll(/[^a-z0-9一-龥]+/g, " ")
    .trim();
  if (!normalized) return new Set<string>();
  return new Set(normalized.split(/\s+/).filter((token) => token.length >= 2));
}

export function overlapScore(source: string, target: string) {
  const sourceTokens = textTokens(source);
  const targetTokens = textTokens(target);
  if (sourceTokens.size === 0 || targetTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of targetTokens) {
    if (sourceTokens.has(token)) overlap += 1;
  }
  return overlap / targetTokens.size;
}

export function normalizedThreshold(value: number | undefined, fallback: number) {
  const threshold = value ?? fallback;
  if (!Number.isFinite(threshold)) return fallback;
  return Math.min(1, Math.max(0, threshold));
}
