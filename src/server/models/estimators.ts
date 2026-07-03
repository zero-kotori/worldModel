import type { BeliefCategory } from "@/server/services/types";
import type { EstimatorOutput } from "@/domain/likelihood";
import { normalizeLlmConfig } from "@/lib/world-model-llm-config";

export type EstimatorInput = {
  evidenceText: string;
  hypothesis: string;
  category: BeliefCategory;
  sourceCredibility: number;
  evidencePublishedAt?: Date | string;
  evidenceObservedAt?: Date | string;
  context?: string;
};

export type LikelihoodEstimator = {
  name: string;
  estimate(input: EstimatorInput): Promise<EstimatorOutput>;
};

export type LightweightArtifact = {
  version: string;
  supportTerms: string[];
  opposeTerms: string[];
};

function countTerms(text: string, terms: string[]) {
  const normalized = text.toLowerCase();
  return terms.filter((term) => normalized.includes(term.toLowerCase())).length;
}

export function createLightweightEstimator(artifact: LightweightArtifact | null): LikelihoodEstimator {
  return {
    name: "lightweight",
    async estimate(input) {
      if (!artifact) {
        return {
          estimator: "lightweight",
          weight: 1,
          abstain: true,
          rationale: "No lightweight artifact is registered."
        };
      }

      const supportCount = countTerms(input.evidenceText, artifact.supportTerms);
      const opposeCount = countTerms(input.evidenceText, artifact.opposeTerms);
      const score = supportCount - opposeCount;
      const likelihoodRatio = Math.max(0.2, Math.min(5, 1 + score * 0.45 * input.sourceCredibility));

      return {
        estimator: "lightweight",
        likelihoodRatio,
        confidence: Math.min(1, 0.35 + Math.abs(score) * 0.18 + input.sourceCredibility * 0.25),
        weight: 1,
        rationale: `Matched ${supportCount} support terms and ${opposeCount} oppose terms for ${input.category}.`,
        modelVersion: artifact.version,
        abstain: false
      };
    }
  };
}

export function createLlmEstimator(config: {
  provider: "deepseek" | "openai" | "local";
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): LikelihoodEstimator {
  return {
    name: "llm",
    async estimate(input) {
      const baseUrl = config.baseUrl?.trim();
      if (!config.apiKey || !config.model || !baseUrl) {
        return {
          estimator: "llm",
          weight: 3,
          abstain: true,
          rationale: "LLM base URL, model, or API key is not configured."
        };
      }

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
            temperature: 0,
            max_tokens: 500,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content:
                  "You score how an evidence item changes one hypothesis. Use only the supplied evidence and context, not outside knowledge. Evaluate every material constraint in the hypothesis. Return only JSON with direction, relevance, likelihoodRatio, confidence, reviewRequired, and rationale."
              },
              {
                role: "user",
                content: likelihoodPrompt(input)
              }
            ]
          }),
          signal: controller?.signal
        });

        if (!response.ok) {
          return llmAbstain(`LLM API request failed with status ${response.status}.`, config);
        }

        const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }>; model?: string };
        const content = body.choices?.[0]?.message?.content;
        if (!content) return llmAbstain("LLM API response did not include message content.", config);

        const parsed = parseLlmLikelihoodJson(content);
        if (!parsed) return llmAbstain("LLM API response was not valid likelihood JSON.", config);

        return {
          estimator: "llm",
          direction: parsed.direction,
          relevance: parsed.relevance,
          likelihoodRatio: parsed.likelihoodRatio,
          confidence: parsed.confidence,
          weight: 3,
          rationale: parsed.rationale,
          reviewRequired: parsed.reviewRequired,
          modelVersion: `${config.provider}:${body.model ?? config.model}`,
          abstain: false
        };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return llmAbstain(`LLM API request failed: ${reason}`, config);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }
  };
}

export function createConfiguredLlmEstimator(
  env: Record<string, string | undefined> = process.env,
  fetcher?: typeof fetch
) {
  const config = normalizeLlmConfig(env);
  return createLlmEstimator({
    provider: config.provider,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
    fetch: fetcher,
    timeoutMs: 30_000
  });
}

function chatCompletionsUrl(baseUrl: string) {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/chat/completions") ? trimmed : `${trimmed}/chat/completions`;
}

function likelihoodPrompt(input: EstimatorInput) {
  return JSON.stringify({
    task: "Estimate how the evidence affects the hypothesis.",
    schema: {
      direction: "SUPPORTS | OPPOSES | MIXED | NEUTRAL",
      relevance: "number between 0 and 1",
      likelihoodRatio: "positive number; >1 supports, <1 opposes, around 1 neutral or unclear",
      confidence: "number between 0 and 1",
      reviewRequired: "boolean; true when source ambiguity, weak attribution, or safety concerns require human review",
      rationale: "short reason in the same language as the evidence or hypothesis"
    },
    scoringGuidance: [
      "Score the full hypothesis, not just overlapping words or a subset of the claim.",
      "Do not use outside knowledge to fill missing dates, locations, entities, quantities, qualifiers, or causal links.",
      "If the evidence omits a material date, location, entity, quantity, qualifier, or causal condition required by the hypothesis, choose NEUTRAL with likelihoodRatio around 1 unless the missing constraint is clearly irrelevant.",
      "Do not treat related predicates as equivalent: born is not named, released is not peaked, announced is not shipped, and associated with is not caused by.",
      "Do not infer that a broad class includes a named item unless the evidence explicitly names that item.",
      "When any material constraint is missing or only implied, set reviewRequired to true and explain which constraint is missing.",
      "Use SUPPORTS only when the evidence makes the whole hypothesis materially more likely; use OPPOSES only when it directly contradicts a material part of the hypothesis.",
      "Set reviewRequired to true when the evidence is partial, ambiguous, weakly attributed, stale relative to the hypothesis time window, or mixes supporting and opposing signals."
    ],
    category: input.category,
    hypothesis: input.hypothesis,
    evidence: input.evidenceText,
    sourceCredibility: input.sourceCredibility,
    ...(input.evidencePublishedAt ? { evidencePublishedAt: serializeTemporalValue(input.evidencePublishedAt) } : {}),
    ...(input.evidenceObservedAt ? { evidenceObservedAt: serializeTemporalValue(input.evidenceObservedAt) } : {}),
    context: input.context ?? ""
  });
}

function serializeTemporalValue(value: Date | string) {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function llmAbstain(reason: string, config: { provider: string; model?: string }): EstimatorOutput {
  return {
    estimator: "llm",
    weight: 3,
    abstain: true,
    rationale: reason,
    modelVersion: config.model ? `${config.provider}:${config.model}` : `${config.provider}:unconfigured`
  };
}

function parseLlmLikelihoodJson(content: string) {
  const jsonText = extractJsonObject(content);
  if (!jsonText) return null;

  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const direction = parseDirection(firstDefined(parsed, ["direction", "label", "stance"]));
    const relevance = clampProbability(firstDefined(parsed, ["relevance", "relevancy"]));
    const confidence = clampProbability(firstDefined(parsed, ["confidence", "confidence_score"]));
    const rawLikelihoodRatio = Number(firstDefined(parsed, ["likelihoodRatio", "likelihood_ratio", "likelihood ratio", "lr"]));
    const likelihoodRatio = normalizeLikelihoodRatio(rawLikelihoodRatio, direction ?? undefined);
    const reviewRequired = parseBoolean(firstDefined(parsed, ["reviewRequired", "review_required", "needsReview", "needs_review"]));
    const rationaleValue = firstDefined(parsed, ["rationale", "reason", "explanation"]);
    const rationale = typeof rationaleValue === "string" ? rationaleValue.trim() : "";

    if (!direction || relevance === null || confidence === null || !Number.isFinite(likelihoodRatio) || likelihoodRatio <= 0 || !rationale) {
      return null;
    }

    return {
      direction,
      relevance,
      likelihoodRatio,
      confidence,
      reviewRequired: reviewRequired || directionLikelihoodRatioConflict(direction, rawLikelihoodRatio),
      rationale
    };
  } catch {
    return null;
  }
}

function firstDefined(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
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

function parseDirection(value: unknown): EstimatorOutput["direction"] | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return normalized === "SUPPORTS" || normalized === "OPPOSES" || normalized === "MIXED" || normalized === "NEUTRAL" ? normalized : null;
}

function clampProbability(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(1, numeric));
}

function parseBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "yes") return true;
    if (normalized === "false" || normalized === "no") return false;
  }
  return false;
}

function normalizeLikelihoodRatio(value: number, direction: EstimatorOutput["direction"]) {
  if (!Number.isFinite(value) || value <= 0) return Number.NaN;
  const bounded = Math.max(0.05, Math.min(20, value));
  if (direction === "OPPOSES" && bounded > 1) return 1 / bounded;
  if (direction === "SUPPORTS" && bounded < 1) return 1 / bounded;
  if (direction === "NEUTRAL") return Math.max(0.9, Math.min(1.1, bounded));
  return bounded;
}

function directionLikelihoodRatioConflict(direction: EstimatorOutput["direction"], value: number) {
  if (!Number.isFinite(value) || value <= 0) return false;
  if (direction === "SUPPORTS") return value <= 1;
  if (direction === "OPPOSES") return value >= 1;
  if (direction === "NEUTRAL") return value < 0.9 || value > 1.1;
  return false;
}

export function createExternalModelEstimator(config: {
  endpoint?: string;
  apiKey?: string;
  model?: string;
  version?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): LikelihoodEstimator {
  return {
    name: "external-deep-model",
    async estimate(input) {
      const endpoint = config.endpoint?.trim();
      const model = config.model?.trim();
      if (!endpoint || !model) {
        return externalModelAbstain("External model endpoint or model is not configured.", config);
      }

      const fetcher = config.fetch ?? fetch;
      const controller = config.timeoutMs ? new AbortController() : undefined;
      const timeout = controller ? setTimeout(() => controller.abort(), config.timeoutMs) : undefined;

      try {
        const headers: Record<string, string> = {
          "content-type": "application/json"
        };
        const apiKey = config.apiKey?.trim();
        if (apiKey) headers.authorization = `Bearer ${apiKey}`;

        const response = await fetcher(chatCompletionsUrl(endpoint), {
          method: "POST",
          headers,
          body: JSON.stringify({
            model,
            temperature: 0,
            max_tokens: 500,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content:
                  "You score how an evidence item changes one hypothesis. Use only the supplied evidence and context, not outside knowledge. Evaluate every material constraint in the hypothesis. Return only JSON with direction, relevance, likelihoodRatio, confidence, reviewRequired, and rationale."
              },
              {
                role: "user",
                content: likelihoodPrompt(input)
              }
            ]
          }),
          signal: controller?.signal
        });

        if (!response.ok) {
          return externalModelAbstain(`External model request failed with status ${response.status}.`, config);
        }

        const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }>; model?: string };
        const content = body.choices?.[0]?.message?.content;
        if (!content) return externalModelAbstain("External model response did not include message content.", config);

        const parsed = parseLlmLikelihoodJson(content);
        if (!parsed) return externalModelAbstain("External model response was not valid likelihood JSON.", config);

        return {
          estimator: "external-deep-model",
          direction: parsed.direction,
          relevance: parsed.relevance,
          likelihoodRatio: parsed.likelihoodRatio,
          confidence: parsed.confidence,
          weight: 2,
          rationale: parsed.rationale,
          reviewRequired: parsed.reviewRequired,
          modelVersion: `external-deep-model:${config.version ?? body.model ?? model}`,
          abstain: false
        };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return externalModelAbstain(`External model request failed: ${redactExternalModelSecret(reason, config)}.`, config);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }
  };
}

function externalModelAbstain(reason: string, config: { version?: string; model?: string }): EstimatorOutput {
  return {
    estimator: "external-deep-model",
    weight: 2,
    abstain: true,
    rationale: reason,
    modelVersion: `external-deep-model:${config.version ?? config.model ?? "unconfigured"}`
  };
}

function redactExternalModelSecret(reason: string, config: { apiKey?: string }) {
  const secret = config.apiKey?.trim();
  return secret ? reason.replaceAll(secret, "[redacted]") : reason;
}
