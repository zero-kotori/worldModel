import {
  summarizeLlmEvaluationQualityDiagnostics,
  summarizeLlmAutoApplyReadiness,
  summarizeLlmHypothesisRecommendationConfig,
  summarizeLlmScorerConfig
} from "@/lib/world-model-models-ui";

describe("world model models UI", () => {
  it("reports configured LLM scorer status without exposing the API key", () => {
    const summary = summarizeLlmScorerConfig({
      LLM_PROVIDER: "deepseek",
      LLM_BASE_URL: "https://api.deepseek.com",
      LLM_API_KEY: "sk-test-secret-value",
      LLM_MODEL: "deepseek-chat"
    });

    expect(summary).toEqual({
      label: "可用",
      tone: "healthy",
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      hasApiKey: true,
      detail: "deepseek:deepseek-chat 已配置为 LLM 主评分器。"
    });
    expect(JSON.stringify(summary)).not.toContain("sk-test-secret-value");
  });

  it("uses DeepSeek defaults for v1 LLM scorer status when only the API key is configured", () => {
    const summary = summarizeLlmScorerConfig({
      LLM_API_KEY: "sk-test-secret-value"
    });

    expect(summary).toEqual({
      label: "可用",
      tone: "healthy",
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      hasApiKey: true,
      detail: "deepseek:deepseek-chat 已配置为 LLM 主评分器。"
    });
    expect(JSON.stringify(summary)).not.toContain("sk-test-secret-value");
  });

  it("identifies missing LLM scorer configuration fields", () => {
    const summary = summarizeLlmScorerConfig({
      LLM_PROVIDER: "deepseek",
      LLM_BASE_URL: "https://api.deepseek.com",
      LLM_API_KEY: "",
      LLM_MODEL: ""
    });

    expect(summary).toEqual({
      label: "未配置",
      tone: "warning",
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      hasApiKey: false,
      detail: "缺少 LLM_API_KEY，LLM 主评分器会弃权。"
    });
  });

  it("reports configured LLM hypothesis recommendations by default without exposing the API key", () => {
    const summary = summarizeLlmHypothesisRecommendationConfig({
      LLM_API_KEY: "sk-test-secret-value"
    });

    expect(summary).toEqual({
      label: "LLM 推荐",
      tone: "healthy",
      llmPathEnabled: true,
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      hasApiKey: true,
      detail: "deepseek:deepseek-chat 已配置为 LLM 假设推荐生成器。"
    });
    expect(JSON.stringify(summary)).not.toContain("sk-test-secret-value");
  });

  it("reports disabled LLM hypothesis recommendations as rule fallback", () => {
    const summary = summarizeLlmHypothesisRecommendationConfig({
      LLM_PROVIDER: "deepseek",
      LLM_API_KEY: "sk-test-secret-value",
      LLM_HYPOTHESIS_RECOMMENDATIONS: "false"
    });

    expect(summary).toEqual({
      label: "规则兜底",
      tone: "warning",
      llmPathEnabled: false,
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      hasApiKey: true,
      detail: "LLM_HYPOTHESIS_RECOMMENDATIONS 已关闭，假设推荐使用规则兜底。"
    });
    expect(JSON.stringify(summary)).not.toContain("sk-test-secret-value");
  });

  it("warns when LLM hypothesis recommendations are enabled without credentials", () => {
    const summary = summarizeLlmHypothesisRecommendationConfig({
      LLM_API_KEY: ""
    });

    expect(summary).toEqual({
      label: "配置不完整",
      tone: "warning",
      llmPathEnabled: true,
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      hasApiKey: false,
      detail: "缺少 LLM_API_KEY，LLM 假设推荐会退回规则兜底。"
    });
  });

  it("marks auto-apply as downgraded until the LLM scorer has been evaluated", () => {
    expect(summarizeLlmAutoApplyReadiness(null)).toEqual({
      label: "自动应用降级",
      tone: "warning",
      detail: "LLM 主评分器未评估：LLM API 已配置为 v1 主评分器，但没有最近评估结果；运行真实样本评估后再依赖自动应用。"
    });
  });

  it("marks auto-apply as available when the latest LLM evaluation passes guard thresholds", () => {
    expect(
      summarizeLlmAutoApplyReadiness(
        {
          generatedAt: new Date("2026-06-18T01:00:00.000Z"),
          samplesPath: "model-artifacts/training-samples.jsonl",
          summary: {
            modelName: "deepseek:deepseek-v4-flash",
            sampleCount: 30,
            scoredCount: 30,
            sourceCounts: { fever: 28, local_confirmed: 2 },
            directionAccuracy: {
              SUPPORTS: { total: 10, scored: 10, correct: 9, accuracy: 0.9 },
              OPPOSES: { total: 10, scored: 10, correct: 8, accuracy: 0.8 },
              NEUTRAL: { total: 10, scored: 10, correct: 7, accuracy: 0.7 }
            },
            likelihoodRatio: { min: 0.2, max: 12, mean: 2.6 },
            lowConfidenceCount: 1,
            lowConfidenceRate: 1 / 30,
            reviewRequiredCount: 3,
            reviewRequiredRate: 0.1,
            fallbackComparedCount: 30,
            fallbackDivergenceCount: 4,
            fallbackDivergenceRate: 4 / 30
          }
        },
        { referenceTime: new Date("2026-06-20T01:00:00.000Z") }
      )
    ).toEqual({
      label: "可自动应用",
      tone: "healthy",
      detail: "最近一次 LLM 评估满足当前自动应用保护条件。"
    });
  });

  it("marks auto-apply as downgraded when the latest LLM evaluation is stale", () => {
    expect(
      summarizeLlmAutoApplyReadiness(
        {
          generatedAt: new Date("2026-05-30T01:00:00.000Z"),
          samplesPath: "model-artifacts/training-samples.jsonl",
          summary: {
            modelName: "deepseek:deepseek-v4-flash",
            sampleCount: 30,
            scoredCount: 30,
            sourceCounts: { fever: 28, local_confirmed: 2 },
            directionAccuracy: {
              SUPPORTS: { total: 10, scored: 10, correct: 9, accuracy: 0.9 },
              OPPOSES: { total: 10, scored: 10, correct: 8, accuracy: 0.8 },
              NEUTRAL: { total: 10, scored: 10, correct: 7, accuracy: 0.7 }
            },
            likelihoodRatio: { min: 0.2, max: 12, mean: 2.6 },
            lowConfidenceCount: 1,
            lowConfidenceRate: 1 / 30,
            reviewRequiredCount: 3,
            reviewRequiredRate: 0.1,
            fallbackComparedCount: 30,
            fallbackDivergenceCount: 4,
            fallbackDivergenceRate: 4 / 30
          }
        },
        { referenceTime: new Date("2026-06-20T01:00:00.000Z") }
      )
    ).toEqual({
      label: "自动应用降级",
      tone: "warning",
      detail: "LLM 评估结果陈旧：最近一次 LLM 评估已超过 14 天，自动应用前应重新运行真实样本评估。"
    });
  });

  it("marks auto-apply as downgraded when the latest LLM evaluation has no generated time", () => {
    expect(
      summarizeLlmAutoApplyReadiness({
        samplesPath: "model-artifacts/training-samples.jsonl",
        summary: {
          modelName: "deepseek:deepseek-v4-flash",
          sampleCount: 30,
          scoredCount: 30,
          sourceCounts: { fever: 28, local_confirmed: 2 },
          directionAccuracy: {
            SUPPORTS: { total: 10, scored: 10, correct: 9, accuracy: 0.9 },
            OPPOSES: { total: 10, scored: 10, correct: 8, accuracy: 0.8 },
            NEUTRAL: { total: 10, scored: 10, correct: 7, accuracy: 0.7 }
          },
          likelihoodRatio: { min: 0.2, max: 12, mean: 2.6 },
          lowConfidenceCount: 1,
          lowConfidenceRate: 1 / 30,
          reviewRequiredCount: 3,
          reviewRequiredRate: 0.1,
          fallbackComparedCount: 30,
          fallbackDivergenceCount: 4,
          fallbackDivergenceRate: 4 / 30
        }
      })
    ).toEqual({
      label: "自动应用降级",
      tone: "warning",
      detail: "LLM 评估时间缺失：最近一次 LLM 评估缺少生成时间，自动应用前应重新运行真实样本评估。"
    });
  });

  it("marks auto-apply as downgraded when LLM evaluation quality diagnostics are risky", () => {
    const evaluation = {
      generatedAt: new Date("2026-06-18T01:00:00.000Z"),
      samplesPath: "model-artifacts/training-samples.jsonl",
      summary: {
        modelName: "deepseek:deepseek-v4-flash",
        sampleCount: 30,
        scoredCount: 30,
        sourceCounts: { fever: 28, github: 1, local_confirmed: 1 },
        directionAccuracy: {
          SUPPORTS: { total: 10, scored: 10, correct: 9, accuracy: 0.9 },
          OPPOSES: { total: 10, scored: 10, correct: 7, accuracy: 0.7 },
          NEUTRAL: { total: 10, scored: 10, correct: 6, accuracy: 0.6 }
        },
        likelihoodRatio: { min: 0.05, max: 20, mean: 7.08 },
        lowConfidenceCount: 0,
        lowConfidenceRate: 0,
        reviewRequiredCount: 8,
        reviewRequiredRate: 0.267,
        fallbackComparedCount: 30,
        fallbackDivergenceCount: 14,
        fallbackDivergenceRate: 0.467
      }
    };

    const referenceTime = new Date("2026-06-20T01:00:00.000Z");

    expect(summarizeLlmEvaluationQualityDiagnostics(evaluation, { referenceTime })).toEqual([
      {
        level: "warning",
        title: "LLM 评估方向准确率偏低",
        detail: "最近一次 LLM 评估方向准确率偏低：中性 60.0%；建议抽样复核提示词、样本标签和自动应用阈值。"
      },
      {
        level: "warning",
        title: "LLM 与 fallback 分歧偏高",
        detail: "最近一次 LLM 评估中 46.7% 样本与 fallback 方向分歧，自动应用前应抽样复核评分理由。"
      }
    ]);
    expect(summarizeLlmAutoApplyReadiness(evaluation, { referenceTime })).toEqual({
      label: "自动应用降级",
      tone: "warning",
      detail:
        "LLM 评估方向准确率偏低：最近一次 LLM 评估方向准确率偏低：中性 60.0%；建议抽样复核提示词、样本标签和自动应用阈值。"
    });
  });
});
