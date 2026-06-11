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
});
