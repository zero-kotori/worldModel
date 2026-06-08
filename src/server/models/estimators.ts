import type { BeliefCategory } from "@/server/services/types";
import type { EstimatorOutput } from "@/domain/likelihood";

export type EstimatorInput = {
  evidenceText: string;
  hypothesis: string;
  category: BeliefCategory;
  sourceCredibility: number;
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
                  "You score how an evidence item changes one hypothesis. Return only JSON with direction, relevance, likelihoodRatio, confidence, and rationale."
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
  env: NodeJS.ProcessEnv = process.env,
  fetcher?: typeof fetch
) {
  const provider = env.LLM_PROVIDER === "openai" || env.LLM_PROVIDER === "local" ? env.LLM_PROVIDER : "deepseek";
  return createLlmEstimator({
    provider,
    baseUrl: env.LLM_BASE_URL,
    apiKey: env.LLM_API_KEY,
    model: env.LLM_MODEL,
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
      rationale: "short reason in the same language as the evidence or hypothesis"
    },
    category: input.category,
    hypothesis: input.hypothesis,
    evidence: input.evidenceText,
    sourceCredibility: input.sourceCredibility,
    context: input.context ?? ""
  });
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
    const direction = parseDirection(parsed.direction);
    const relevance = clampProbability(parsed.relevance);
    const confidence = clampProbability(parsed.confidence);
    const likelihoodRatio = normalizeLikelihoodRatio(Number(parsed.likelihoodRatio), direction ?? undefined);
    const rationale = typeof parsed.rationale === "string" ? parsed.rationale.trim() : "";

    if (!direction || relevance === null || confidence === null || !Number.isFinite(likelihoodRatio) || likelihoodRatio <= 0 || !rationale) {
      return null;
    }

    return { direction, relevance, likelihoodRatio, confidence, rationale };
  } catch {
    return null;
  }
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
  return value === "SUPPORTS" || value === "OPPOSES" || value === "MIXED" || value === "NEUTRAL" ? value : null;
}

function clampProbability(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(1, numeric));
}

function normalizeLikelihoodRatio(value: number, direction: EstimatorOutput["direction"]) {
  if (!Number.isFinite(value) || value <= 0) return Number.NaN;
  const bounded = Math.max(0.05, Math.min(20, value));
  if (direction === "OPPOSES" && bounded > 1) return 1 / bounded;
  if (direction === "SUPPORTS" && bounded < 1) return 1 / bounded;
  if (direction === "NEUTRAL") return Math.max(0.9, Math.min(1.1, bounded));
  return bounded;
}

export function createExternalModelEstimator(config: { endpoint?: string; version?: string }): LikelihoodEstimator {
  return {
    name: "external-deep-model",
    async estimate() {
      if (!config.endpoint) {
        return {
          estimator: "external-deep-model",
          weight: 1,
          abstain: true,
          rationale: "External model endpoint is not configured."
        };
      }

      return {
        estimator: "external-deep-model",
        weight: 1,
        abstain: true,
        rationale: "External model endpoint is registered but not called during local dry run.",
        modelVersion: config.version ?? "external:unversioned"
      };
    }
  };
}
