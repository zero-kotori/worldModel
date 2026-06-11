import { createSourceAdapter, parseRssObservations } from "@/server/sources/adapters";

describe("observation source adapters", () => {
  it("parses RSS items into raw observations", () => {
    const observations = parseRssObservations(`<?xml version="1.0"?>
      <rss><channel>
        <item>
          <title>AI model release</title>
          <link>https://example.com/model</link>
          <description>Release details</description>
          <author>Example Author</author>
          <pubDate>Sun, 07 Jun 2026 10:00:00 GMT</pubDate>
        </item>
      </channel></rss>`);

    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      title: "AI model release",
      content: "Release details",
      url: "https://example.com/model",
      author: "Example Author"
    });
    expect(observations[0].publishedAt?.toISOString()).toBe("2026-06-07T10:00:00.000Z");
  });

  it("extracts a generic web page title and content", async () => {
    const adapter = createSourceAdapter("WEB_PAGE", {
      fetchText: async () => "<html><head><title>World model note</title></head><body>Main content</body></html>"
    });

    await expect(adapter.fetch({ name: "Page", adapter: "web", url: "https://example.com" })).resolves.toEqual([
      {
        title: "World model note",
        content: "Main content",
        url: "https://example.com",
        sourceMetadata: { adapter: "WEB_PAGE" }
      }
    ]);
  });

  it("keeps successful query observations when one query URL fails", async () => {
    const adapter = createSourceAdapter("SEARCH", {
      fetchText: async (url) => {
        if (url.includes("bad-query")) {
          throw new Error("Search backend timeout");
        }
        return "<html><head><title>Good query result</title></head><body>AI agents adoption evidence</body></html>";
      }
    });

    await expect(
      adapter.fetch({
        name: "Search",
        adapter: "search",
        url: "https://example.com/search?q={query}",
        queries: ["bad-query", "good-query"]
      })
    ).resolves.toEqual([
      {
        title: "Good query result",
        content: "AI agents adoption evidence",
        url: "https://example.com/search?q=good-query",
        sourceMetadata: { adapter: "SEARCH", query: "good-query" }
      }
    ]);
  });

  it("fails a query source only when every query URL fails", async () => {
    const adapter = createSourceAdapter("SEARCH", {
      fetchText: async () => {
        throw new Error("Search backend timeout");
      }
    });

    await expect(
      adapter.fetch({
        name: "Search",
        adapter: "search",
        url: "https://example.com/search?q={query}",
        queries: ["first", "second"]
      })
    ).rejects.toThrow("All 2 query fetches failed");
  });

  it("keeps unsupported or credential-bound social adapters as auditable dry-run stubs", async () => {
    const adapter = createSourceAdapter("SOCIAL");

    await expect(adapter.fetch({ name: "Social", adapter: "social", credentialRef: "X_COOKIE_PROFILE_1" })).resolves.toEqual([]);
  });
});
