import { guardAutoApplyWithLlmEvaluation } from "@/server/automation/auto-apply-policy";

const mocks = vi.hoisted(() => ({
  loadLlmEvaluationArtifact: vi.fn()
}));

vi.mock("@/server/training/llm-evaluation-artifact", () => ({
  loadLlmEvaluationArtifact: mocks.loadLlmEvaluationArtifact
}));

describe("auto-apply policy", () => {
  beforeEach(() => {
    mocks.loadLlmEvaluationArtifact.mockReset();
  });

  it("downgrades forced auto-apply when the LLM evaluation artifact cannot be loaded", async () => {
    mocks.loadLlmEvaluationArtifact.mockRejectedValue(new Error("artifact read failed"));

    await expect(
      guardAutoApplyWithLlmEvaluation({
        reviewOnly: false,
        forceAutoApply: true,
        maxQueries: 3
      })
    ).resolves.toEqual({
      options: {
        reviewOnly: true,
        forceAutoApply: false,
        maxQueries: 3
      },
      notice: "LLM 评估风险：LLM 评估加载失败，已切换为待审模式。"
    });
  });
});
