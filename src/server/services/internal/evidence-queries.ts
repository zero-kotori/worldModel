import {
  CALIBRATION_QUERY_ERROR_THRESHOLD,
  CALIBRATION_QUERY_PRIORITY_WEIGHT,
  COUNTER_EVIDENCE_QUERY_PRIORITY_BOOST,
  COUNTER_EVIDENCE_QUERY_PROBABILITY_THRESHOLD,
  DAY_MS,
  FRAGILE_CERTAINTY_QUERY_PRIORITY_BOOST,
  FRAGILE_CERTAINTY_QUERY_PROBABILITY_THRESHOLD,
  FRAGILE_CERTAINTY_QUERY_QUALITY_THRESHOLD,
  STALE_EVIDENCE_QUERY_DAYS,
  STALE_EVIDENCE_QUERY_PRIORITY_BOOST,
  now
} from "@/server/services/internal/shared";
import { resolvedOutcomeValue } from "@/server/services/internal/recommendations";
import type { BeliefRecord, EvidenceRecord, HypothesisRecord } from "@/server/services/types";

// Pure query-construction and prioritisation helpers for the evidence loop:
// search-query compaction, evidence-coverage aggregation, calibration pressure
// and per-hypothesis query priority. No store access (AGENTS.md §3).

function normalizeQueryPart(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function queryTokens(value: string) {
  return normalizeQueryPart(value).split(" ").filter(Boolean);
}

function sharedPrefixLength(left: string[], right: string[]) {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

function compactSearchQuery(parts: string[]) {
  const selected: Array<{ value: string; normalized: string; tokens: string[] }> = [];
  for (const part of parts.map((value) => value.trim()).filter(Boolean)) {
    const normalized = normalizeQueryPart(part);
    const tokens = queryTokens(part);
    if (!normalized) continue;
    if (selected.some((item) => item.normalized === normalized || item.normalized.includes(normalized))) {
      continue;
    }
    for (let index = selected.length - 1; index >= 0; index -= 1) {
      if (normalized.includes(selected[index].normalized)) {
        selected.splice(index, 1);
      }
    }
    const prefixMatch = selected.find((item) => {
      const prefixLength = sharedPrefixLength(item.tokens, tokens);
      return prefixLength >= 3 && prefixLength < tokens.length && prefixLength < item.tokens.length;
    });
    if (prefixMatch) {
      const suffix = part.split(/\s+/).slice(sharedPrefixLength(prefixMatch.tokens, tokens)).join(" ");
      if (suffix) {
        prefixMatch.value = `${prefixMatch.value} ${suffix}`;
        prefixMatch.normalized = normalizeQueryPart(prefixMatch.value);
        prefixMatch.tokens = queryTokens(prefixMatch.value);
      }
      continue;
    }
    selected.push({ value: part, normalized, tokens });
  }
  return selected.map((item) => item.value).join(" ");
}

function evidenceSearchQueryFromNotes(notes: string) {
  for (const line of notes.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:证据检索|evidenceSearchQuery|evidence search)\s*[:：]\s*(.+?)\s*$/i);
    const query = match?.[1]?.trim();
    if (query) return query;
  }
  return "";
}

export function hypothesisEvidenceSearchQuery(belief: BeliefRecord, hypothesis: HypothesisRecord) {
  const structuredQuery = hypothesis.evidenceSearchQuery?.trim() ?? "";
  if (structuredQuery) return compactSearchQuery([structuredQuery]);
  const explicitQuery = evidenceSearchQueryFromNotes(hypothesis.notes);
  return explicitQuery ? compactSearchQuery([explicitQuery]) : compactSearchQuery([belief.title, hypothesis.proposition, hypothesis.notes]);
}

export function hypothesisSettlementSearchQuery(belief: BeliefRecord, hypothesis: HypothesisRecord) {
  return compactSearchQuery([
    hypothesis.evidenceSearchQuery ?? "",
    belief.title,
    hypothesis.proposition,
    hypothesis.expiryCondition ?? "",
    "final outcome result settlement"
  ]);
}

export function queryHintScore(queryHint: string, belief: BeliefRecord, hypothesis: HypothesisRecord) {
  if (!queryHint) return 0;
  const candidateQuery = hypothesisEvidenceSearchQuery(belief, hypothesis);
  return normalizeQueryPart(queryHint) === normalizeQueryPart(candidateQuery) ? 1 : 0;
}

function hypothesisUncertainty(hypothesis: HypothesisRecord) {
  return Math.max(0, Math.min(1, 1 - Math.abs(hypothesis.currentProbability - 0.5) * 2));
}

export function staleEvidenceDays(latestEvidenceAt: string | undefined, referenceTime: Date) {
  if (!latestEvidenceAt) return undefined;
  const latest = new Date(latestEvidenceAt);
  if (Number.isNaN(latest.getTime())) return undefined;
  const days = Math.max(0, Math.floor((referenceTime.getTime() - latest.getTime()) / DAY_MS));
  return days >= STALE_EVIDENCE_QUERY_DAYS ? days : undefined;
}

export function calibrationPressureByBelief(beliefs: BeliefRecord[]) {
  const pressure = new Map<string, { error: number; hypothesisId: string }>();

  for (const belief of beliefs) {
    for (const hypothesis of belief.hypotheses) {
      const outcome = resolvedOutcomeValue(hypothesis.status);
      if (outcome === null) continue;

      const predictedProbability = Math.min(1, Math.max(0, hypothesis.currentProbability));
      const error = Math.abs(predictedProbability - outcome);
      if (error < CALIBRATION_QUERY_ERROR_THRESHOLD) continue;

      const existing = pressure.get(belief.id);
      if (!existing || error > existing.error || (error === existing.error && hypothesis.id < existing.hypothesisId)) {
        pressure.set(belief.id, { error, hypothesisId: hypothesis.id });
      }
    }
  }

  return pressure;
}

export function activeEvidenceCoverageByHypothesis(evidenceItems: EvidenceRecord[]) {
  const coverage = new Map<
    string,
    {
      evidenceCount: number;
      supportEvidenceCount: number;
      opposingEvidenceCount: number;
      relevanceSum: number;
      confidenceSum: number;
      linkCount: number;
      latestEvidenceAt?: string;
    }
  >();
  for (const evidence of evidenceItems) {
    if (evidence.status !== "ACTIVE") continue;
    for (const link of evidence.links) {
      const existing = coverage.get(link.hypothesisId) ?? {
        evidenceCount: 0,
        supportEvidenceCount: 0,
        opposingEvidenceCount: 0,
        relevanceSum: 0,
        confidenceSum: 0,
        linkCount: 0
      };
      const confirmedAt = evidence.confirmedAt.toISOString();
      coverage.set(link.hypothesisId, {
        evidenceCount: existing.evidenceCount + 1,
        supportEvidenceCount: existing.supportEvidenceCount + (link.direction === "SUPPORTS" ? 1 : 0),
        opposingEvidenceCount: existing.opposingEvidenceCount + (link.direction === "OPPOSES" ? 1 : 0),
        relevanceSum: existing.relevanceSum + link.relevance,
        confidenceSum: existing.confidenceSum + link.confidence,
        linkCount: existing.linkCount + 1,
        latestEvidenceAt:
          !existing.latestEvidenceAt || confirmedAt > existing.latestEvidenceAt ? confirmedAt : existing.latestEvidenceAt
      });
    }
  }
  return coverage;
}

export function evidenceLoopQueryPriority(
  hypothesis: HypothesisRecord,
  coverage: {
    evidenceCount: number;
    supportEvidenceCount?: number;
    opposingEvidenceCount?: number;
    relevanceSum?: number;
    confidenceSum?: number;
    linkCount?: number;
    latestEvidenceAt?: string;
  },
  calibrationPressure?: { error: number; hypothesisId: string; hypothesisCode?: string },
  referenceTime = now()
) {
  const uncertainty = hypothesisUncertainty(hypothesis);
  const evidenceGap = coverage.evidenceCount === 0 ? 1 : Math.max(0, 1 - Math.min(coverage.evidenceCount, 3) / 3);
  const basePriority = uncertainty * 0.7 + evidenceGap * 0.3;
  const calibrationBoost = calibrationPressure ? calibrationPressure.error * CALIBRATION_QUERY_PRIORITY_WEIGHT : 0;
  const supportEvidenceCount = coverage.supportEvidenceCount ?? 0;
  const opposingEvidenceCount = coverage.opposingEvidenceCount ?? 0;
  const counterEvidenceGap =
    hypothesis.currentProbability >= COUNTER_EVIDENCE_QUERY_PROBABILITY_THRESHOLD &&
    supportEvidenceCount > 0 &&
    opposingEvidenceCount === 0;
  const counterEvidenceBoost = counterEvidenceGap ? COUNTER_EVIDENCE_QUERY_PRIORITY_BOOST : 0;
  const staleDays = staleEvidenceDays(coverage.latestEvidenceAt, referenceTime);
  const staleEvidenceBoost = staleDays === undefined ? 0 : STALE_EVIDENCE_QUERY_PRIORITY_BOOST;
  const linkCount = coverage.linkCount ?? 0;
  const averageEvidenceRelevance = linkCount > 0 && coverage.relevanceSum !== undefined ? coverage.relevanceSum / linkCount : undefined;
  const averageEvidenceConfidence = linkCount > 0 && coverage.confidenceSum !== undefined ? coverage.confidenceSum / linkCount : undefined;
  const fragileCertainty =
    coverage.evidenceCount > 0 &&
    (hypothesis.currentProbability >= FRAGILE_CERTAINTY_QUERY_PROBABILITY_THRESHOLD ||
      hypothesis.currentProbability <= 1 - FRAGILE_CERTAINTY_QUERY_PROBABILITY_THRESHOLD) &&
    averageEvidenceRelevance !== undefined &&
    averageEvidenceConfidence !== undefined &&
    (averageEvidenceRelevance < FRAGILE_CERTAINTY_QUERY_QUALITY_THRESHOLD ||
      averageEvidenceConfidence < FRAGILE_CERTAINTY_QUERY_QUALITY_THRESHOLD);
  const fragileCertaintyBoost = fragileCertainty ? FRAGILE_CERTAINTY_QUERY_PRIORITY_BOOST : 0;
  const priority = Number(
    Math.min(1, basePriority + calibrationBoost + counterEvidenceBoost + staleEvidenceBoost + fragileCertaintyBoost).toFixed(3)
  );
  const uncertaintyReason = uncertainty >= 0.66 ? "high uncertainty" : uncertainty >= 0.33 ? "moderate uncertainty" : "low uncertainty";
  const evidenceReason = coverage.evidenceCount === 0 ? "no active evidence" : `${coverage.evidenceCount} active evidence`;
  const priorityReasons = [uncertaintyReason, evidenceReason];
  if (calibrationPressure) {
    priorityReasons.push(`calibration error ${(calibrationPressure.error * 100).toFixed(1)}pp`);
  }
  if (counterEvidenceGap) {
    priorityReasons.push("needs counter-evidence");
  }
  if (staleDays !== undefined) {
    priorityReasons.push(`evidence stale ${staleDays}d`);
  }
  if (fragileCertainty) {
    priorityReasons.push("weak evidence quality");
  }

  return {
    priority,
    priorityReason: priorityReasons.join("; "),
    uncertainty: Number(uncertainty.toFixed(3)),
    evidenceCount: coverage.evidenceCount,
    supportEvidenceCount,
    opposingEvidenceCount,
    ...(counterEvidenceGap ? { counterEvidenceGap } : {}),
    ...(staleDays !== undefined ? { staleEvidenceDays: staleDays } : {}),
    ...(averageEvidenceRelevance !== undefined ? { averageEvidenceRelevance: Number(averageEvidenceRelevance.toFixed(3)) } : {}),
    ...(averageEvidenceConfidence !== undefined ? { averageEvidenceConfidence: Number(averageEvidenceConfidence.toFixed(3)) } : {}),
    ...(fragileCertainty ? { fragileCertainty } : {}),
    ...(coverage.latestEvidenceAt ? { latestEvidenceAt: coverage.latestEvidenceAt } : {}),
    ...(calibrationPressure
      ? {
          calibrationError: Number(calibrationPressure.error.toFixed(3)),
          calibrationHypothesisId: calibrationPressure.hypothesisId,
          ...(calibrationPressure.hypothesisCode ? { calibrationHypothesisCode: calibrationPressure.hypothesisCode } : {})
        }
      : {})
  };
}
