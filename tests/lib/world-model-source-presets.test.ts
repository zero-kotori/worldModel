import { sourcePresetDefinitions } from "@/lib/world-model-source-presets";

describe("world model source presets", () => {
  it("includes a query-driven news RSS preset for automated cross-category evidence search", () => {
    const preset = sourcePresetDefinitions.find((item) => item.id === "google-news-query");

    expect(preset).toMatchObject({
      name: "Google News Query RSS",
      kind: "RSS",
      adapter: "rss_query",
      enabled: true,
      autoConfirm: false
    });
    expect(preset?.url).toContain("{query}");
    expect(preset?.description).toMatch(/category|belief|hypothesis/i);
  });

  it("includes public platform query presets for automated evidence collection", () => {
    expect(sourcePresetDefinitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "github-repository-query",
          kind: "GITHUB",
          adapter: "github_repositories",
          enabled: true,
          autoConfirm: false
        }),
        expect.objectContaining({
          id: "huggingface-model-query",
          kind: "HUGGING_FACE",
          adapter: "huggingface_models",
          enabled: true,
          autoConfirm: false
        }),
        expect.objectContaining({
          id: "gdelt-doc-query",
          kind: "GDELT",
          adapter: "gdelt_doc_articles",
          enabled: true,
          autoConfirm: false
        }),
        expect.objectContaining({
          id: "polymarket-query",
          kind: "PREDICTION_MARKET",
          adapter: "polymarket_markets",
          enabled: true,
          autoConfirm: false
        })
      ])
    );
    for (const preset of sourcePresetDefinitions.filter((item) =>
      ["github-repository-query", "huggingface-model-query", "gdelt-doc-query", "polymarket-query"].includes(item.id)
    )) {
      expect(preset.url).toContain("{query}");
    }
  });

  it("includes a public social query preset that stays review-only by default", () => {
    const preset = sourcePresetDefinitions.find((item) => item.id === "reddit-public-query");

    expect(preset).toMatchObject({
      name: "Reddit Public Query",
      kind: "SOCIAL",
      adapter: "public_social_search",
      enabled: true,
      autoConfirm: false
    });
    expect(preset?.url).toContain("{query}");
    expect(preset?.credibility).toBeLessThan(0.6);
  });
});
