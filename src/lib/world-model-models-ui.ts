type LlmScorerEnv = Record<string, string | undefined> & {
  LLM_PROVIDER?: string;
  LLM_BASE_URL?: string;
  LLM_API_KEY?: string;
  LLM_MODEL?: string;
};

export type LlmScorerConfigSummary = {
  label: "可用" | "未配置";
  tone: "healthy" | "warning";
  provider: string;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  detail: string;
};

function normalizedProvider(value: string | undefined) {
  const provider = value?.trim();
  return provider || "deepseek";
}

export function summarizeLlmScorerConfig(env: LlmScorerEnv): LlmScorerConfigSummary {
  const provider = normalizedProvider(env.LLM_PROVIDER);
  const baseUrl = env.LLM_BASE_URL?.trim() ?? "";
  const model = env.LLM_MODEL?.trim() ?? "";
  const hasApiKey = Boolean(env.LLM_API_KEY?.trim());
  const missing = [
    !baseUrl ? "LLM_BASE_URL" : "",
    !hasApiKey ? "LLM_API_KEY" : "",
    !model ? "LLM_MODEL" : ""
  ].filter(Boolean);

  if (missing.length === 0) {
    return {
      label: "可用",
      tone: "healthy",
      provider,
      baseUrl,
      model,
      hasApiKey,
      detail: `${provider}:${model} 已配置为 LLM 主评分器。`
    };
  }

  return {
    label: "未配置",
    tone: "warning",
    provider,
    baseUrl,
    model,
    hasApiKey,
    detail: `缺少 ${missing.join("、")}，LLM 主评分器会弃权。`
  };
}
