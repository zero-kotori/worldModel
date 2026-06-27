import { normalizeLlmConfig } from "@/lib/world-model-llm-config";
import type { HypothesisRecommendation, HypothesisRecommendationGenerator } from "@/server/services/types";

type LlmHypothesisRecommendationConfig = {
  provider: "deepseek" | "openai" | "local";
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

type RawRecommendation = Record<string, unknown>;

export function createConfiguredLlmHypothesisRecommendationGenerator(
  env: Record<string, string | undefined> = process.env,
  fetcher?: typeof fetch
): HypothesisRecommendationGenerator {
  const config = normalizeLlmConfig(env);
  return createLlmHypothesisRecommendationGenerator({
    provider: config.provider,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
    fetch: fetcher,
    timeoutMs: 30_000
  });
}

export function createLlmHypothesisRecommendationGenerator(
  config: LlmHypothesisRecommendationConfig
): HypothesisRecommendationGenerator {
  return async (input) => {
    const baseUrl = config.baseUrl?.trim();
    if (!config.apiKey || !config.model || !baseUrl) return [];

    const fetcher = config.fetch ?? fetch;
    const controller = config.timeoutMs ? new AbortController() : undefined;
    const timeout = controller ? setTimeout(() => controller.abort(), config.timeoutMs) : undefined;

    try {
      const response = await fetcher(chatCompletionsUrl(baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
          model: config.model,
          temperature: 0.2,
          max_tokens: 700,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "You generate measurable hypotheses that repair calibration misses in a belief model. Return only JSON with a recommendations array."
            },
            {
              role: "user",
              content: recommendationPrompt(input)
            }
          ]
        }),
        signal: controller?.signal
      });

      if (!response.ok) return [];
      const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = body.choices?.[0]?.message?.content;
      if (!content) return [];
      return parseLlmRecommendationJson(content).slice(0, Math.max(0, Math.floor(input.limit)));
    } catch {
      return [];
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };
}

function chatCompletionsUrl(baseUrl: string) {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/chat/completions") ? trimmed : `${trimmed}/chat/completions`;
}

function recommendationPrompt(input: Parameters<HypothesisRecommendationGenerator>[0]) {
  const task = input.sourceObservation
    ? "Recommend new hypotheses that explain or test an unmatched source observation for this belief."
    : "Recommend new hypotheses that would make future evidence collection less biased after a settled calibration miss.";
  return JSON.stringify({
    task,
    schema: {
      recommendations: [
        {
          proposition: "specific measurable hypothesis, not a vague question",
          stance: "SUPPORTS | OPPOSES",
          priorProbability: "number between 0.05 and 0.95",
          notes: "observable signals to collect",
          evidenceSearchQuery: "query for automated evidence collection",
          rationale: "short reason tied to the settlement miss"
        }
      ]
    },
    belief: {
      title: input.belief.title,
      category: input.belief.category,
      description: input.belief.description,
      activeHypotheses: input.belief.hypotheses
        .filter((hypothesis) => hypothesis.status === "ACTIVE")
        .map((hypothesis) => ({
          proposition: hypothesis.proposition,
          stance: hypothesis.stance,
          currentProbability: hypothesis.currentProbability,
          notes: hypothesis.notes,
          evidenceSearchQuery: hypothesis.evidenceSearchQuery ?? ""
        }))
    },
    calibrationMiss: input.calibration
      ? {
          hypothesis: input.calibration.hypothesis.proposition,
          hypothesisNotes: input.calibration.hypothesis.notes,
          settledOutcome: input.calibration.outcome === 1 ? "RESOLVED_TRUE" : "RESOLVED_FALSE",
          predictedProbability: input.calibration.predictedProbability,
          error: input.calibration.error,
          resolvedOutcome: input.calibration.resolvedOutcome ?? ""
        }
      : undefined,
    sourceObservation: input.sourceObservation
      ? {
          title: input.sourceObservation.title,
          content: input.sourceObservation.content,
          url: input.sourceObservation.url ?? "",
          author: input.sourceObservation.author ?? "",
          credibility: input.sourceObservation.credibility,
          observedAt: input.sourceObservation.observedAt.toISOString(),
          publishedAt: input.sourceObservation.publishedAt?.toISOString() ?? "",
          metadata: input.sourceObservation.metadata
        }
      : undefined,
    limit: input.limit
  });
}

function parseLlmRecommendationJson(content: string): HypothesisRecommendation[] {
  const jsonText = extractJsonObject(content);
  if (!jsonText) return [];

  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const rawItems = Array.isArray(parsed.recommendations)
      ? parsed.recommendations
      : Array.isArray(parsed.hypotheses)
        ? parsed.hypotheses
        : [];
    return rawItems.flatMap((item) => parseRecommendation(item));
  } catch {
    return [];
  }
}

function parseRecommendation(item: unknown): HypothesisRecommendation[] {
  if (!item || typeof item !== "object" || Array.isArray(item)) return [];
  const raw = item as RawRecommendation;
  const proposition = stringField(raw, ["proposition", "hypothesis", "claim"]);
  const stance = stanceField(raw.stance ?? raw.direction);
  const priorProbability = probabilityField(raw.priorProbability ?? raw.prior_probability ?? raw.probability);
  const notes = stringField(raw, ["notes", "observableSignals", "observable_signals"]);
  const evidenceSearchQuery = stringField(raw, ["evidenceSearchQuery", "evidence_search_query", "query"]);
  const rationale = stringField(raw, ["rationale", "reason", "explanation"]);

  if (!proposition || !stance || priorProbability === null || !notes || !evidenceSearchQuery || !rationale) return [];
  return [{ proposition, stance, priorProbability, notes, evidenceSearchQuery, rationale }];
}

function extractJsonObject(content: string) {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  if (candidate.startsWith("{") && candidate.endsWith("}")) return candidate;

  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  return first >= 0 && last > first ? candidate.slice(first, last + 1) : null;
}

function stringField(record: RawRecommendation, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function stanceField(value: unknown): HypothesisRecommendation["stance"] | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === "SUPPORTS" || normalized === "SUPPORT") return "SUPPORTS";
  if (normalized === "OPPOSES" || normalized === "OPPOSE" || normalized === "OPPOSED") return "OPPOSES";
  return null;
}

function probabilityField(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.min(0.95, Math.max(0.05, numeric));
}
