import { summarizeLlmScorerConfig } from "@/lib/world-model-models-ui";

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
      model: "",
      hasApiKey: false,
      detail: "缺少 LLM_API_KEY、LLM_MODEL，LLM 主评分器会弃权。"
    });
  });
});
