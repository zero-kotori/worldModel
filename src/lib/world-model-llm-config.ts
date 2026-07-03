export type LlmProvider = "deepseek" | "openai" | "local";

export type LlmConfigEnv = Record<string, string | undefined> & {
  LLM_PROVIDER?: string;
  LLM_BASE_URL?: string;
  LLM_API_KEY?: string;
  LLM_MODEL?: string;
  LLM_HYPOTHESIS_RECOMMENDATIONS?: string;
};

export type ExternalModelConfigEnv = Record<string, string | undefined> & {
  EXTERNAL_MODEL_ENDPOINT?: string;
  EXTERNAL_MODEL_API_KEY?: string;
  EXTERNAL_MODEL_MODEL?: string;
  EXTERNAL_MODEL_VERSION?: string;
  EXTERNAL_MODEL_TIMEOUT_MS?: string;
};

export type NormalizedLlmConfig = {
  provider: LlmProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type NormalizedExternalModelConfig = {
  endpoint: string;
  apiKey: string;
  model: string;
  version?: string;
  timeoutMs?: number;
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

export function normalizeExternalModelConfig(env: ExternalModelConfigEnv = process.env): NormalizedExternalModelConfig {
  const timeout = Number(env.EXTERNAL_MODEL_TIMEOUT_MS);
  return {
    endpoint: env.EXTERNAL_MODEL_ENDPOINT?.trim() ?? "",
    apiKey: env.EXTERNAL_MODEL_API_KEY?.trim() ?? "",
    model: env.EXTERNAL_MODEL_MODEL?.trim() ?? "",
    version: env.EXTERNAL_MODEL_VERSION?.trim() || undefined,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? Math.floor(timeout) : undefined
  };
}

export function isExternalModelConfigured(env: ExternalModelConfigEnv = process.env) {
  const config = normalizeExternalModelConfig(env);
  return Boolean(config.endpoint && config.model);
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
