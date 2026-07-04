import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { vi } from "vitest";

const loadWorldModelData = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("@/app/admin/world-model/data", () => ({
  loadWorldModelData
}));

function emptyWorldModelData() {
  return {
    error: undefined,
    beliefs: [],
    observations: [],
    evidence: [],
    sources: [],
    runs: [],
    heartbeats: [],
    workerConfigs: [],
    workerRuntime: [],
    models: [],
    updates: [],
    likelihoodRuns: [],
    llmEvaluation: null
  };
}

describe("world model models page", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    loadWorldModelData.mockReset();
  });

  it("shows whether LLM hypothesis recommendations are enabled", async () => {
    const previousKey = process.env.LLM_API_KEY;
    process.env.LLM_API_KEY = "sk-test-secret-value";
    loadWorldModelData.mockResolvedValue(emptyWorldModelData());
    const { default: ModelsPage } = await import("@/app/admin/world-model/models/page");

    try {
      const html = renderToStaticMarkup(await ModelsPage({ searchParams: Promise.resolve({}) }));

      expect(html).toContain("LLM 假设推荐");
      expect(html).toContain("LLM 推荐");
      expect(html).toContain("deepseek:deepseek-chat 已配置为 LLM 假设推荐生成器。");
      expect(html).not.toContain("sk-test-secret-value");
    } finally {
      if (previousKey === undefined) {
        delete process.env.LLM_API_KEY;
      } else {
        process.env.LLM_API_KEY = previousKey;
      }
    }
  });

  it("shows likelihood scoring runs with evidence and hypothesis context", async () => {
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      beliefs: [
        {
          id: "belief_signal",
          title: "AI agent adoption",
          category: "AI_TREND",
          description: "",
          probabilityMode: "INDEPENDENT",
          origin: "INTERNAL",
          status: "ACTIVE",
          createdAt: new Date("2026-06-11T00:00:00.000Z"),
          updatedAt: new Date("2026-06-11T00:00:00.000Z"),
          hypotheses: [
            {
              id: "hypothesis_signal",
              beliefId: "belief_signal",
              proposition: "AI agents accelerate engineering teams",
              notes: "",
              stance: "SUPPORTS",
              priorProbability: 0.35,
              currentProbability: 0.58,
              strength: 0.58,
              status: "ACTIVE",
              createdAt: new Date("2026-06-11T00:01:00.000Z"),
              updatedAt: new Date("2026-06-11T00:01:00.000Z")
            }
          ]
        }
      ],
      observations: [
        {
          id: "observation_signal",
          title: "Agent adoption report",
          content: "Teams report accelerated delivery.",
          observedAt: new Date("2026-06-11T00:02:00.000Z"),
          status: "CONFIRMED",
          credibility: 0.8,
          metadata: {}
        }
      ],
      evidence: [
        {
          id: "evidence_signal",
          observationId: "observation_signal",
          title: "Agent adoption evidence",
          content: "Teams report accelerated delivery.",
          confirmedAt: new Date("2026-06-11T00:03:00.000Z"),
          confirmationMode: "AUTO",
          credibility: 0.8,
          status: "ACTIVE",
          metadata: {},
          links: []
        }
      ],
      likelihoodRuns: [
        {
          id: "likelihood_signal",
          evidenceId: "evidence_signal",
          hypothesisId: "hypothesis_signal",
          ensembleLikelihoodRatio: 2.4,
          ensembleConfidence: 0.78,
          estimatorOutputs: [
            {
              estimator: "llm",
              likelihoodRatio: 2.4,
              confidence: 0.78,
              weight: 3,
              rationale: "Semantic support from the evidence.",
              modelVersion: "deepseek:deepseek-chat"
            }
          ],
          modelVersion: "deepseek:deepseek-chat",
          createdAt: new Date("2026-06-12T03:00:00.000Z")
        }
      ]
    });
    const { default: ModelsPage } = await import("@/app/admin/world-model/models/page");

    const html = renderToStaticMarkup(await ModelsPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("似然评分审计");
    expect(html).toContain("Agent adoption evidence");
    expect(html).toContain("AI agents accelerate engineering teams");
    expect(html).toContain("2.40");
    expect(html).toContain("0.78");
    expect(html).toContain("deepseek:deepseek-chat");
    expect(html).toContain("llm: Semantic support from the evidence.");
  });

  it("shows the latest LLM evaluation quality summary", async () => {
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      llmEvaluation: {
        generatedAt: new Date("2026-06-18T01:02:03.000Z"),
        samplesPath: "model-artifacts/training-samples.jsonl",
        summary: {
          modelName: "deepseek:deepseek-v4-flash",
          sampleCount: 12,
          scoredCount: 10,
          directionAccuracy: {
            SUPPORTS: { total: 4, scored: 4, correct: 3, accuracy: 0.75 },
            OPPOSES: { total: 4, scored: 3, correct: 2, accuracy: 2 / 3 },
            NEUTRAL: { total: 4, scored: 3, correct: 1, accuracy: 1 / 3 }
          },
          likelihoodRatio: { min: 0.4, max: 10, mean: 2.8 },
          lowConfidenceCount: 2,
          lowConfidenceRate: 1 / 6,
          reviewRequiredCount: 3,
          reviewRequiredRate: 0.25,
          fallbackComparedCount: 8,
          fallbackDivergenceCount: 2,
          fallbackDivergenceRate: 0.25,
          sourceCounts: { fever: 6, climate_fever: 5, local_confirmed: 1 }
        }
      }
    });
    const { default: ModelsPage } = await import("@/app/admin/world-model/models/page");

    const html = renderToStaticMarkup(await ModelsPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("LLM 评估结果");
    expect(html).toContain("自动应用保护");
    expect(html).toContain("自动应用降级");
    expect(html).toContain("LLM 评估样本不足");
    expect(html).toContain("deepseek:deepseek-v4-flash");
    expect(html).toContain("样本 12");
    expect(html).toContain("已评分 10");
    expect(html).toContain("支持 75.0%");
    expect(html).toContain("反对 66.7%");
    expect(html).toContain("中性 33.3%");
    expect(html).toContain("低置信度 16.7%");
    expect(html).toContain("需复核 25.0%");
    expect(html).toContain("fallback 分歧 25.0%");
    expect(html).toContain("来源覆盖");
    expect(html).toContain("local_confirmed 1");
    expect(html).toContain("fever 6");
  });

  it("shows non-blocking LLM evaluation quality diagnostics on the models page", async () => {
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      llmEvaluation: {
        generatedAt: new Date("2026-06-18T01:02:03.000Z"),
        samplesPath: "model-artifacts/training-samples.jsonl",
        summary: {
          modelName: "deepseek:deepseek-v4-flash",
          sampleCount: 30,
          scoredCount: 30,
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
          fallbackDivergenceRate: 0.467,
          sourceCounts: { fever: 29, local_confirmed: 1 }
        }
      }
    });
    const { default: ModelsPage } = await import("@/app/admin/world-model/models/page");

    const html = renderToStaticMarkup(await ModelsPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("LLM 评估质量诊断");
    expect(html).toContain("LLM 评估方向准确率偏低");
    expect(html).toContain("中性 60.0%");
    expect(html).toContain("LLM 与 fallback 分歧偏高");
    expect(html).toContain("46.7% 样本与 fallback 方向分歧");
  });

  it("surfaces the auto-apply guard when no LLM evaluation exists", async () => {
    loadWorldModelData.mockResolvedValue(emptyWorldModelData());
    const { default: ModelsPage } = await import("@/app/admin/world-model/models/page");

    const html = renderToStaticMarkup(await ModelsPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("自动应用保护");
    expect(html).toContain("自动应用降级");
    expect(html).toContain("LLM 主评分器未评估");
    expect(html).toContain("暂无 LLM 评估结果");
  });

  it("includes a runnable LLM evaluation form", async () => {
    loadWorldModelData.mockResolvedValue(emptyWorldModelData());
    const { default: ModelsPage } = await import("@/app/admin/world-model/models/page");

    const html = renderToStaticMarkup(await ModelsPage({ searchParams: Promise.resolve({}) }));
    const evaluationSection = html.slice(html.indexOf("LLM 评估运行"), html.indexOf("真实训练数据抓取"));

    expect(evaluationSection).toContain("LLM 评估运行");
    expect(evaluationSection).toContain("输出目录");
    expect(evaluationSection).toContain('name="outputDir"');
    expect(evaluationSection).toContain("model-artifacts");
    expect(evaluationSection).not.toContain('name="samplesPath"');
    expect(evaluationSection).not.toContain('name="fallbackPath"');
    expect(evaluationSection).not.toContain('name="outputPath"');
    expect(evaluationSection).toContain('name="limit"');
    expect(evaluationSection).toMatch(/<input[^>]*name="limit"[^>]*value="30"/);
    expect(evaluationSection).toContain("运行 LLM 评估");
  });

  it("includes a local lightweight training pipeline entry", async () => {
    loadWorldModelData.mockResolvedValue(emptyWorldModelData());
    const { default: ModelsPage } = await import("@/app/admin/world-model/models/page");

    const html = renderToStaticMarkup(await ModelsPage({ searchParams: Promise.resolve({}) }));
    const trainingSection = html.slice(html.indexOf("轻量模型训练"), html.indexOf("模型产物导入"));

    expect(trainingSection).toContain("轻量模型训练");
    expect(trainingSection).toContain("输出目录");
    expect(trainingSection).toContain('name="outputDir"');
    expect(trainingSection).toContain("model-artifacts");
    expect(trainingSection).toContain("准备样本、训练并导入");
  });

  it("includes a real public training sample fetch entry", async () => {
    loadWorldModelData.mockResolvedValue(emptyWorldModelData());
    const { default: ModelsPage } = await import("@/app/admin/world-model/models/page");

    const html = renderToStaticMarkup(await ModelsPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("真实训练数据抓取");
    expect(html).toContain("每个数据集行数");
    expect(html).toContain('name="limit"');
    expect(html).toMatch(/<input[^>]*name="limit"[^>]*value="20"/);
    expect(html).toContain("输出目录");
    expect(html).toContain('name="outputDir"');
    expect(html).toContain("model-artifacts");
    expect(html).toContain("抓取公开训练样本");
  });

  it("includes a training sample count field when importing model artifacts", async () => {
    loadWorldModelData.mockResolvedValue(emptyWorldModelData());
    const { default: ModelsPage } = await import("@/app/admin/world-model/models/page");

    const html = renderToStaticMarkup(await ModelsPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain('name="sampleCount"');
    expect(html).toContain("训练样本数");
  });

  it("shows imported model artifact training metrics", async () => {
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      models: [
        {
          id: "model_lightweight",
          name: "lightweight-local",
          kind: "LIGHTWEIGHT",
          version: "0.1.0",
          path: "model-artifacts/lightweight-local.json",
          enabled: true,
          createdAt: new Date("2026-06-18T01:00:00.000Z"),
          metrics: {
            trained: true,
            sampleCount: 14,
            sourceCounts: { fever: 2, scifact: 2, climate_fever: 10 }
          }
        }
      ]
    });
    const { default: ModelsPage } = await import("@/app/admin/world-model/models/page");

    const html = renderToStaticMarkup(await ModelsPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("训练指标");
    expect(html).toContain("已训练");
    expect(html).toContain("样本 14");
    expect(html).toContain("fever 2");
    expect(html).toContain("climate_fever 10");
  });
});
