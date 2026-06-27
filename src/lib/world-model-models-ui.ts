import { llmEvaluationAutoApplyRisk, llmEvaluationDiagnostics } from "@/lib/world-model-sources-ui";
import {
  isLlmHypothesisRecommendationsDisabled,
  normalizeLlmConfig,
  type LlmConfigEnv
} from "@/lib/world-model-llm-config";
import type { LlmEvaluationArtifact } from "@/server/training/llm-evaluation-artifact";

type LlmScorerEnv = LlmConfigEnv;

export type LlmScorerConfigSummary = {
  label: "可用" | "未配置";
  tone: "healthy" | "warning";
  provider: string;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  detail: string;
};

export type LlmAutoApplyReadinessSummary = {
  label: "可自动应用" | "自动应用降级";
  tone: "healthy" | "warning";
  detail: string;
};

export type LlmEvaluationQualityDiagnostic = {
  level: "info" | "warning" | "error";
  title: string;
  detail: string;
};

export type LlmHypothesisRecommendationConfigSummary = {
  label: "LLM 推荐" | "规则兜底" | "配置不完整";
  tone: "healthy" | "warning";
  llmPathEnabled: boolean;
  provider: string;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  detail: string;
};

type LlmEvaluationSummaryOptions = {
  referenceTime?: Date;
};

export function summarizeLlmScorerConfig(env: LlmScorerEnv): LlmScorerConfigSummary {
  const config = normalizeLlmConfig(env);
  const provider = config.provider;
  const baseUrl = config.baseUrl;
  const model = config.model;
  const hasApiKey = Boolean(config.apiKey);
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

export function summarizeLlmHypothesisRecommendationConfig(env: LlmScorerEnv): LlmHypothesisRecommendationConfigSummary {
  const config = normalizeLlmConfig(env);
  const provider = config.provider;
  const baseUrl = config.baseUrl;
  const model = config.model;
  const hasApiKey = Boolean(config.apiKey);
  const disabled = isLlmHypothesisRecommendationsDisabled(env);
  const missing = [
    !baseUrl ? "LLM_BASE_URL" : "",
    !hasApiKey ? "LLM_API_KEY" : "",
    !model ? "LLM_MODEL" : ""
  ].filter(Boolean);

  if (disabled) {
    return {
      label: "规则兜底",
      tone: "warning",
      llmPathEnabled: false,
      provider,
      baseUrl,
      model,
      hasApiKey,
      detail: "LLM_HYPOTHESIS_RECOMMENDATIONS 已关闭，假设推荐使用规则兜底。"
    };
  }

  if (missing.length === 0) {
    return {
      label: "LLM 推荐",
      tone: "healthy",
      llmPathEnabled: true,
      provider,
      baseUrl,
      model,
      hasApiKey,
      detail: `${provider}:${model} 已配置为 LLM 假设推荐生成器。`
    };
  }

  return {
    label: "配置不完整",
    tone: "warning",
    llmPathEnabled: true,
    provider,
    baseUrl,
    model,
    hasApiKey,
    detail: `缺少 ${missing.join("、")}，LLM 假设推荐会退回规则兜底。`
  };
}

export function summarizeLlmAutoApplyReadiness(
  evaluation: LlmEvaluationArtifact | null | undefined,
  options: LlmEvaluationSummaryOptions = {}
): LlmAutoApplyReadinessSummary {
  const risk = llmEvaluationAutoApplyRisk(evaluation, options);
  if (risk) {
    return {
      label: "自动应用降级",
      tone: "warning",
      detail: `${risk.title}：${risk.detail}`
    };
  }

  return {
    label: "可自动应用",
    tone: "healthy",
    detail: "最近一次 LLM 评估满足当前自动应用保护条件。"
  };
}

export function summarizeLlmEvaluationQualityDiagnostics(
  evaluation: LlmEvaluationArtifact | null | undefined,
  options: LlmEvaluationSummaryOptions = {}
): LlmEvaluationQualityDiagnostic[] {
  return llmEvaluationDiagnostics(evaluation, options);
}
