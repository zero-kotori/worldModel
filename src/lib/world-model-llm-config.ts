export type LlmProvider = "deepseek" | "openai" | "local";

export type LlmConfigEnv = Record<string, string | undefined> & {
  LLM_PROVIDER?: string;
  LLM_BASE_URL?: string;
  LLM_API_KEY?: string;
  LLM_MODEL?: string;
  LLM_HYPOTHESIS_RECOMMENDATIONS?: string;
};

export type NormalizedLlmConfig = {
  provider: LlmProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
};

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEEPSEEK_MODEL = "deepseek-chat";

export function normalizeLlmConfig(env: LlmConfigEnv = process.env): NormalizedLlmConfig {
  const provider = normalizeProvider(env.LLM_PROVIDER);
  return {
    provider,
    baseUrl: normalizeBaseUrl(provider, env.LLM_BASE_URL),
    apiKey: env.LLM_API_KEY?.trim() ?? "",
    model: normalizeModel(provider, env.LLM_MODEL)
  };
}

export function isLlmHypothesisRecommendationsDisabled(env: LlmConfigEnv = process.env) {
  return /^(0|false|disabled|off)$/i.test(env.LLM_HYPOTHESIS_RECOMMENDATIONS?.trim() ?? "");
}

function normalizeProvider(value: string | undefined): LlmProvider {
  const normalized = value?.trim();
  if (normalized === "openai" || normalized === "local") return normalized;
  return "deepseek";
}

function normalizeBaseUrl(provider: LlmProvider, value: string | undefined) {
  const configured = value?.trim();
  if (configured) return configured;
  if (provider === "deepseek") return DEEPSEEK_BASE_URL;
  return "";
}

function normalizeModel(provider: LlmProvider, value: string | undefined) {
  const configured = value?.trim();
  if (configured) return configured;
  if (provider === "deepseek") return DEEPSEEK_MODEL;
  return "";
}
