import type { BeliefRecord, HypothesisRecord, ObservationSourceKind } from "@/server/services/types";

export type PlannedEvidenceQuery = {
  query: string;
  strategy: "LLM" | "MANUAL" | "RULE_BASE" | "RULE_COMPARISON" | "SETTLEMENT";
  purpose: "GENERAL" | "PREDICTION_MARKET";
  sourceKinds: ObservationSourceKind[];
};

export type EvidenceQueryPlannerInput = {
  belief: BeliefRecord;
  hypothesis: HypothesisRecord;
  baseQuery: string;
  settlementDue: boolean;
};

export type EvidenceQueryPlanner = (
  input: EvidenceQueryPlannerInput
) => PlannedEvidenceQuery[] | Promise<PlannedEvidenceQuery[]>;

const GENERAL_QUERY_SOURCE_KINDS: ObservationSourceKind[] = ["RSS", "WEB_PAGE", "SEARCH", "GITHUB", "HUGGING_FACE", "GDELT", "SOCIAL"];
const PREDICTION_MARKET_SOURCE_KINDS: ObservationSourceKind[] = ["PREDICTION_MARKET"];
const ALL_QUERY_SOURCE_KINDS: ObservationSourceKind[] = [...GENERAL_QUERY_SOURCE_KINDS, ...PREDICTION_MARKET_SOURCE_KINDS];

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeKnownEntities(value: string) {
  return compactWhitespace(value)
    .replace(/\bgpt\s*[- ]?\s*(\d+(?:\.\d+)?)\b/gi, "GPT-$1")
    .replace(/\bgpt\b/gi, "GPT")
    .replace(/\bclaude\b/gi, "Claude")
    .replace(/\bmythos\b/gi, "Mythos")
    .replace(/\bopenai\b/gi, "OpenAI")
    .replace(/\banthropic\b/gi, "Anthropic");
}

function cleanSearchPhrase(value: string) {
  return normalizeKnownEntities(
    value
      .replace(/[“”"']/g, " ")
      .replace(/[（）()[\]{}]/g, " ")
      .replace(/\s*[<>]\s*/g, " ")
      .replace(/(?:暴打|强于|优于|超过|胜过)/gi, " ")
  );
}

function titleCaseLoose(value: string) {
  return normalizeKnownEntities(
    value
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => {
        if (/^(GPT|OpenAI|Anthropic)$/i.test(part)) return normalizeKnownEntities(part);
        if (/^GPT-\d+(?:\.\d+)?$/i.test(part)) return normalizeKnownEntities(part);
        return part.length > 1 ? `${part[0].toUpperCase()}${part.slice(1)}` : part.toUpperCase();
      })
      .join(" ")
  );
}

function comparisonFromText(value: string) {
  const normalized = compactWhitespace(value);
  const symbolMatch = normalized.match(/^(.+?)\s*([<>])\s*(.+)$/);
  if (symbolMatch) {
    const left = titleCaseLoose(symbolMatch[1]);
    const right = titleCaseLoose(symbolMatch[3]);
    if (left && right) {
      return symbolMatch[2] === ">" ? { winner: left, loser: right } : { winner: right, loser: left };
    }
  }

  const wordMatch = normalized.match(/^(.+?)\s+(?:outperform|outperforms|beat|beats|better than|强于|优于|超过|胜过|暴打)\s+(.+)$/i);
  if (!wordMatch) return undefined;
  const winner = titleCaseLoose(wordMatch[1]);
  const loser = titleCaseLoose(wordMatch[2]);
  return winner && loser ? { winner, loser } : undefined;
}

function uniquePlannedQueries(queries: PlannedEvidenceQuery[]) {
  const seen = new Set<string>();
  return queries.filter((query) => {
    const key = `${query.purpose}:${query.query.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function planEvidenceLoopQueries(input: {
  belief: BeliefRecord;
  hypothesis: HypothesisRecord;
  baseQuery: string;
  settlementDue: boolean;
}) {
  const baseQuery = compactWhitespace(input.baseQuery);
  if (!baseQuery) return [];

  if (input.settlementDue) {
    return [
      {
        query: baseQuery,
        strategy: "SETTLEMENT" as const,
        purpose: "GENERAL" as const,
        sourceKinds: ALL_QUERY_SOURCE_KINDS
      }
    ];
  }

  if (input.hypothesis.evidenceSearchQuery?.trim()) {
    return [
      {
        query: baseQuery,
        strategy: "MANUAL" as const,
        purpose: "GENERAL" as const,
        sourceKinds: ALL_QUERY_SOURCE_KINDS
      }
    ];
  }

  const comparison = comparisonFromText(input.hypothesis.proposition) ?? comparisonFromText(input.hypothesis.evidenceSearchQuery ?? "");
  if (comparison) {
    return uniquePlannedQueries([
      {
        query: `${comparison.winner} vs ${comparison.loser} benchmark`,
        strategy: "RULE_COMPARISON",
        purpose: "GENERAL",
        sourceKinds: GENERAL_QUERY_SOURCE_KINDS
      },
      {
        query: `${comparison.winner} ${comparison.loser} comparison`,
        strategy: "RULE_COMPARISON",
        purpose: "GENERAL",
        sourceKinds: GENERAL_QUERY_SOURCE_KINDS
      },
      {
        query: `Will ${comparison.winner} outperform ${comparison.loser}?`,
        strategy: "RULE_COMPARISON",
        purpose: "PREDICTION_MARKET",
        sourceKinds: PREDICTION_MARKET_SOURCE_KINDS
      },
      {
        query: cleanSearchPhrase(baseQuery),
        strategy: "RULE_BASE",
        purpose: "GENERAL",
        sourceKinds: GENERAL_QUERY_SOURCE_KINDS
      }
    ]).filter((query) => query.query);
  }

  return [
    {
      query: cleanSearchPhrase(baseQuery),
      strategy: "RULE_BASE" as const,
      purpose: "GENERAL" as const,
      sourceKinds: ALL_QUERY_SOURCE_KINDS
    }
  ];
}

export async function planEvidenceLoopQueriesWithFallback(
  input: EvidenceQueryPlannerInput,
  planner: EvidenceQueryPlanner | undefined
) {
  if (planner) {
    try {
      const planned = uniquePlannedQueries((await planner(input)).filter((query) => query.query.trim()));
      if (planned.length > 0) return planned;
    } catch {
      // Query planning is an optional recall improvement; collection falls back to deterministic rules.
    }
  }
  return planEvidenceLoopQueries(input);
}
