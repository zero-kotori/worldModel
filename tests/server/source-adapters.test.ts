import { createPowershellFetchInvocation, createSourceAdapter, fetchTextWithFallback, parseRssObservations } from "@/server/sources/adapters";

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

  it("times out default network fetches with URL context", async () => {
    vi.useFakeTimers();
    const originalFetch = global.fetch;
    try {
      const fetchSpy = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
        if (!init?.signal) {
          return Promise.reject(new Error("missing abort signal"));
        }
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        });
      });
      vi.stubGlobal("fetch", fetchSpy);
      const adapter = createSourceAdapter("WEB_PAGE");
      const result = adapter.fetch({ name: "Slow page", adapter: "web", url: "https://slow.example/page" });
      const assertion = expect(result).rejects.toThrow("Source fetch timed out after 30 seconds for https://slow.example/page");

      await vi.advanceTimersByTimeAsync(30_000);

      await assertion;
      expect(fetchSpy).toHaveBeenCalledWith("https://slow.example/page", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    } finally {
      vi.stubGlobal("fetch", originalFetch);
      vi.useRealTimers();
    }
  });

  it("falls back to the system fetch path when Node fetch cannot connect", async () => {
    const primaryFetch = vi.fn(async () => {
      throw new TypeError("fetch failed", {
        cause: new Error("Connect Timeout Error")
      });
    });
    const fallbackFetchText = vi.fn(async () => "system response");

    await expect(
      fetchTextWithFallback("https://news.example/rss", {
        fetchImpl: primaryFetch as unknown as typeof fetch,
        fallbackFetchText
      })
    ).resolves.toBe("system response");
    expect(fallbackFetchText).toHaveBeenCalledWith("https://news.example/rss");
  });

  it("does not hide explicit HTTP failures behind the system fallback", async () => {
    const primaryFetch = vi.fn(async () => new Response("Server error", { status: 503 }));
    const fallbackFetchText = vi.fn(async () => "fallback response");

    await expect(
      fetchTextWithFallback("https://news.example/rss", {
        fetchImpl: primaryFetch as unknown as typeof fetch,
        fallbackFetchText
      })
    ).rejects.toThrow("Fetch failed 503 for https://news.example/rss");
    expect(fallbackFetchText).not.toHaveBeenCalled();
  });

  it("passes PowerShell fallback URLs through environment variables", () => {
    const url = "https://gamma-api.polymarket.com/markets?search=AI%20agents&limit=10&active=true&closed=false";
    const invocation = createPowershellFetchInvocation(url);

    expect(invocation.args.join(" ")).not.toContain(url);
    expect(invocation.args.join(" ")).toContain("$env:WORLDMODEL_FETCH_URL");
    expect(invocation.env.WORLDMODEL_FETCH_URL).toBe(url);
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

  it("expands query templates for RSS sources and keeps successful query feeds", async () => {
    const requestedUrls: string[] = [];
    const adapter = createSourceAdapter("RSS", {
      fetchText: async (url) => {
        requestedUrls.push(url);
        if (url !== "https://news.example/rss?q=career%20signal") {
          throw new Error(`Unexpected RSS URL: ${url}`);
        }
        return `<?xml version="1.0"?>
          <rss><channel>
            <item>
              <title>Career signal</title>
              <link>https://example.com/career-signal</link>
              <description>Evidence from a query-specific news feed.</description>
            </item>
          </channel></rss>`;
      }
    });

    await expect(
      adapter.fetch({
        name: "News Search",
        adapter: "rss",
        url: "https://news.example/rss?q={query}",
        queries: ["bad-query", "career signal"]
      })
    ).resolves.toEqual([
      {
        title: "Career signal",
        content: "Evidence from a query-specific news feed.",
        url: "https://example.com/career-signal",
        author: undefined,
        publishedAt: undefined,
        sourceMetadata: { adapter: "RSS", query: "career signal" }
      }
    ]);
    expect(requestedUrls).toEqual(["https://news.example/rss?q=bad-query", "https://news.example/rss?q=career%20signal"]);
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

  it("collects public social source URLs as generic observations", async () => {
    const adapter = createSourceAdapter("SOCIAL", {
      fetchText: async (url) => {
        expect(url).toBe("https://social.example/search?q=AI%20agents");
        return "<html><head><title>Social discussion signal</title></head><body>Builders discuss AI agents replacing routine coding work.</body></html>";
      }
    });

    await expect(
      adapter.fetch({
        name: "Public social search",
        adapter: "social_public",
        url: "https://social.example/search?q={query}",
        queries: ["AI agents"]
      })
    ).resolves.toEqual([
      {
        title: "Social discussion signal",
        content: "Builders discuss AI agents replacing routine coding work.",
        url: "https://social.example/search?q=AI%20agents",
        sourceMetadata: { adapter: "SOCIAL", query: "AI agents" }
      }
    ]);
  });

  it("fetches GitHub repository search results from generated evidence queries", async () => {
    const requestedUrls: string[] = [];
    const adapter = createSourceAdapter("GITHUB", {
      fetchText: async (url) => {
        requestedUrls.push(url);
        return JSON.stringify({
          items: [
            {
              full_name: "openai/codex",
              description: "Agentic coding workflow evidence",
              html_url: "https://github.com/openai/codex",
              updated_at: "2026-06-10T12:00:00Z",
              stargazers_count: 42000,
              owner: { login: "openai" }
            }
          ]
        });
      }
    });

    await expect(adapter.fetch({ name: "GitHub", adapter: "github", queries: ["AI agents workflow"] })).resolves.toEqual([
      {
        title: "GitHub: openai/codex",
        content: "Agentic coding workflow evidence Stars: 42000",
        url: "https://github.com/openai/codex",
        author: "openai",
        publishedAt: new Date("2026-06-10T12:00:00Z"),
        sourceMetadata: { adapter: "GITHUB", query: "AI agents workflow", source: "github_repositories", stars: 42000 }
      }
    ]);
    expect(requestedUrls).toEqual([
      "https://api.github.com/search/repositories?q=AI%20agents%20workflow&sort=updated&order=desc&per_page=10"
    ]);
  });

  it("fetches platform observations for every generated query", async () => {
    const requestedUrls: string[] = [];
    const adapter = createSourceAdapter("GITHUB", {
      fetchText: async (url) => {
        requestedUrls.push(url);
        const isSecondQuery = url.includes("second%20query");
        return JSON.stringify({
          items: [
            {
              full_name: isSecondQuery ? "example/second-signal" : "openai/codex",
              description: isSecondQuery ? "Second query evidence" : "Agentic coding workflow evidence",
              html_url: isSecondQuery ? "https://github.com/example/second-signal" : "https://github.com/openai/codex",
              updated_at: isSecondQuery ? "2026-06-11T12:00:00Z" : "2026-06-10T12:00:00Z",
              stargazers_count: isSecondQuery ? 120 : 42000,
              owner: { login: isSecondQuery ? "example" : "openai" }
            }
          ]
        });
      }
    });

    await expect(adapter.fetch({ name: "GitHub", adapter: "github", queries: ["AI agents workflow", "second query"] })).resolves.toEqual([
      expect.objectContaining({
        title: "GitHub: openai/codex",
        sourceMetadata: expect.objectContaining({ query: "AI agents workflow" })
      }),
      expect.objectContaining({
        title: "GitHub: example/second-signal",
        sourceMetadata: expect.objectContaining({ query: "second query" })
      })
    ]);
    expect(requestedUrls).toEqual([
      "https://api.github.com/search/repositories?q=AI%20agents%20workflow&sort=updated&order=desc&per_page=10",
      "https://api.github.com/search/repositories?q=second%20query&sort=updated&order=desc&per_page=10"
    ]);
  });

  it("fetches Hugging Face model search results from generated evidence queries", async () => {
    const requestedUrls: string[] = [];
    const adapter = createSourceAdapter("HUGGING_FACE", {
      fetchText: async (url) => {
        requestedUrls.push(url);
        return JSON.stringify([
          {
            id: "Qwen/Qwen3-Embedding",
            modelId: "Qwen/Qwen3-Embedding",
            pipeline_tag: "feature-extraction",
            tags: ["sentence-transformers", "mteb"],
            downloads: 120000,
            likes: 640,
            lastModified: "2026-06-11T08:30:00Z"
          }
        ]);
      }
    });

    await expect(adapter.fetch({ name: "Hugging Face", adapter: "hf", queries: ["embedding benchmark"] })).resolves.toEqual([
      {
        title: "Hugging Face: Qwen/Qwen3-Embedding",
        content: "Pipeline: feature-extraction Tags: sentence-transformers, mteb Downloads: 120000 Likes: 640",
        url: "https://huggingface.co/Qwen/Qwen3-Embedding",
        publishedAt: new Date("2026-06-11T08:30:00Z"),
        sourceMetadata: {
          adapter: "HUGGING_FACE",
          query: "embedding benchmark",
          source: "huggingface_models",
          downloads: 120000,
          likes: 640
        }
      }
    ]);
    expect(requestedUrls).toEqual([
      "https://huggingface.co/api/models?search=embedding%20benchmark&limit=10&sort=lastModified&direction=-1"
    ]);
  });

  it("fetches GDELT article results from generated evidence queries", async () => {
    const adapter = createSourceAdapter("GDELT", {
      fetchText: async () =>
        JSON.stringify({
          articles: [
            {
              title: "AI regulation bill advances",
              url: "https://news.example/ai-regulation",
              domain: "news.example",
              sourceCountry: "US",
              seendate: "20260612T113000Z"
            }
          ]
        })
    });

    await expect(adapter.fetch({ name: "GDELT", adapter: "gdelt", queries: ["AI regulation"] })).resolves.toEqual([
      {
        title: "AI regulation bill advances",
        content: "AI regulation bill advances Source: news.example Country: US",
        url: "https://news.example/ai-regulation",
        publishedAt: new Date("2026-06-12T11:30:00Z"),
        sourceMetadata: { adapter: "GDELT", query: "AI regulation", source: "gdelt_doc_articles", domain: "news.example" }
      }
    ]);
  });

  it("fetches prediction market results from generated evidence queries", async () => {
    const adapter = createSourceAdapter("PREDICTION_MARKET", {
      fetchText: async () =>
        JSON.stringify({
          markets: [
            {
              question: "Will AI agents exceed 20% enterprise adoption in 2026?",
              description: "Market tracks public adoption milestones.",
              slug: "ai-agents-enterprise-adoption-2026",
              endDate: "2026-12-31T00:00:00Z",
              volume: 250000,
              liquidity: 18000
            }
          ]
        })
    });

    await expect(adapter.fetch({ name: "Prediction Markets", adapter: "prediction", queries: ["AI agents adoption"] })).resolves.toEqual([
      {
        title: "Prediction market: Will AI agents exceed 20% enterprise adoption in 2026?",
        content: "Market tracks public adoption milestones. Volume: 250000 Liquidity: 18000",
        url: "https://polymarket.com/event/ai-agents-enterprise-adoption-2026",
        publishedAt: new Date("2026-12-31T00:00:00Z"),
        sourceMetadata: {
          adapter: "PREDICTION_MARKET",
          query: "AI agents adoption",
          source: "prediction_markets",
          volume: 250000,
          liquidity: 18000
        }
      }
    ]);
  });

  it("parses rich Polymarket market fields from Gamma market search", async () => {
    const adapter = createSourceAdapter("PREDICTION_MARKET", {
      fetchText: async () =>
        JSON.stringify([
          {
            id: "market-1",
            question: "Will AI agents exceed 20% enterprise adoption in 2026?",
            description: "Market tracks public adoption milestones.",
            slug: "ai-agents-enterprise-adoption-2026",
            conditionId: "0xabc",
            questionID: "question-1",
            endDate: "2026-12-31T00:00:00Z",
            active: true,
            closed: false,
            archived: false,
            volume: "250000.5",
            liquidity: "18000.25",
            outcomes: "[\"Yes\",\"No\"]",
            outcomePrices: "[\"0.62\",\"0.38\"]"
          }
        ])
    });

    await expect(
      adapter.fetch({ name: "Polymarket", adapter: "polymarket_markets", queries: ["AI agents adoption"] })
    ).resolves.toEqual([
      expect.objectContaining({
        title: "Polymarket: Will AI agents exceed 20% enterprise adoption in 2026?",
        content: expect.stringContaining("Yes 0.62"),
        url: "https://polymarket.com/event/ai-agents-enterprise-adoption-2026",
        publishedAt: new Date("2026-12-31T00:00:00Z"),
        sourceMetadata: expect.objectContaining({
          adapter: "PREDICTION_MARKET",
          query: "AI agents adoption",
          source: "polymarket_markets",
          marketId: "market-1",
          conditionId: "0xabc",
          questionId: "question-1",
          outcomes: ["Yes", "No"],
          outcomePrices: [0.62, 0.38],
          volume: 250000.5,
          liquidity: 18000.25,
          active: true,
          closed: false,
          archived: false
        })
      })
    ]);
  });

  it("parses Polymarket event search results", async () => {
    const adapter = createSourceAdapter("PREDICTION_MARKET", {
      fetchText: async () =>
        JSON.stringify({
          events: [
            {
              id: "event-1",
              title: "AI adoption milestones in 2026",
              slug: "ai-adoption-milestones-2026",
              volume: 500000,
              liquidity: 45000,
              markets: [
                {
                  id: "market-1",
                  question: "Will adoption exceed 20%?",
                  outcomes: ["Yes", "No"],
                  outcomePrices: ["0.55", "0.45"]
                }
              ]
            }
          ]
        })
    });

    await expect(
      adapter.fetch({
        name: "Polymarket events",
        adapter: "polymarket_events",
        url: "https://gamma-api.polymarket.com/events?search={query}&limit=10",
        queries: ["AI adoption"]
      })
    ).resolves.toEqual([
      expect.objectContaining({
        title: "Polymarket: AI adoption milestones in 2026",
        url: "https://polymarket.com/event/ai-adoption-milestones-2026",
        sourceMetadata: expect.objectContaining({
          adapter: "PREDICTION_MARKET",
          query: "AI adoption",
          source: "polymarket_events",
          eventId: "event-1",
          marketCount: 1
        })
      })
    ]);
  });
});
