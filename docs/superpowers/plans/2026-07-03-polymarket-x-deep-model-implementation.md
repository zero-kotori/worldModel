# Polymarket X Deep Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved Polymarket public market-data collector, X/Twitter Bearer Token recent-search collector, and external deep-model HTTP estimator.

**Architecture:** Keep the main behavior in the existing source-adapter and estimator layers, with new platform-specific helpers extracted only when a file would otherwise grow harder to reason about. Preserve the public `WorldModelServices` shape and the review-first automation defaults. Use credential references that resolve to environment variables and never store secrets in the database.

**Tech Stack:** TypeScript, Vitest, Next.js runtime fetch, existing `WorldModelStore` services, OpenAI-compatible chat-completions protocol, Polymarket public Gamma/CLOB APIs, X API v2 recent search.

---

## File Structure

- Modify `src/server/models/estimators.ts`: implement external deep-model HTTP calls, shared OpenAI-compatible parsing, and an optional composite estimator helper.
- Modify `src/server/services/configured.ts`: wire external deep-model only when `EXTERNAL_MODEL_*` config is present, while keeping LLM as the default main scorer.
- Modify `src/lib/world-model-llm-config.ts`: normalize external model config from environment variables.
- Modify `tests/server/model-estimators.test.ts`: add TDD coverage for external deep-model success, abstention, failure sanitization, and configured composite wiring.
- Modify `src/server/sources/adapters.ts`: route Polymarket and X adapter modes, or delegate to small local helper functions in the same file if the code stays readable.
- Modify `tests/server/source-adapters.test.ts`: add TDD coverage for richer Polymarket parsing and X recent-search credential behavior.
- Modify `src/lib/world-model-source-presets.ts`: add or refine presets for Polymarket markets/events and X recent search without credentials.
- Modify `tests/lib/world-model-source-presets.test.ts`: assert new presets are listed and credential-free defaults remain safe.
- Modify `.env.example`: add non-secret `EXTERNAL_MODEL_*` and example X credential variable names with empty values.
- Modify `docs/ai/world-model-rollout.md`: add operational notes for Polymarket public access, X Bearer Token setup, and external model configuration.

No Prisma schema changes are planned.

## Task 1: External Deep-Model Estimator

**Files:**
- Modify: `tests/server/model-estimators.test.ts`
- Modify: `src/server/models/estimators.ts`
- Modify: `src/lib/world-model-llm-config.ts`

- [x] **Step 1: Write the failing external estimator success test**

Add this test near the existing LLM estimator tests in `tests/server/model-estimators.test.ts`:

```ts
it("calls an external OpenAI-compatible deep model endpoint and parses likelihood output", async () => {
  const requests: Array<{ url: string; authorization: string | null; body: Record<string, unknown> }> = [];
  const fakeFetch: typeof fetch = async (url, init) => {
    requests.push({
      url: String(url),
      authorization: new Headers(init?.headers).get("authorization"),
      body: JSON.parse(String(init?.body))
    });
    return new Response(
      JSON.stringify({
        model: "deep-eval-v1",
        choices: [
          {
            message: {
              content: JSON.stringify({
                direction: "SUPPORTS",
                relevance: 0.84,
                likelihoodRatio: 2.6,
                confidence: 0.73,
                reviewRequired: false,
                rationale: "The external model finds direct market evidence."
              })
            }
          }
        ]
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };
  const estimator = createExternalModelEstimator({
    endpoint: "https://models.example/v1",
    apiKey: "external-test-key",
    model: "deep-eval-v1",
    version: "2026-07-03",
    fetch: fakeFetch
  });

  const output = await estimator.estimate({
    evidenceText: "Polymarket odds moved after a verified event.",
    hypothesis: "The event is more likely after the market move",
    category: "AI_TREND",
    sourceCredibility: 0.8
  });

  expect(requests).toHaveLength(1);
  expect(requests[0].url).toBe("https://models.example/v1/chat/completions");
  expect(requests[0].authorization).toBe("Bearer external-test-key");
  expect(requests[0].body).toMatchObject({
    model: "deep-eval-v1",
    response_format: { type: "json_object" }
  });
  expect(output).toMatchObject({
    estimator: "external-deep-model",
    direction: "SUPPORTS",
    relevance: 0.84,
    likelihoodRatio: 2.6,
    confidence: 0.73,
    weight: 2,
    modelVersion: "external-deep-model:2026-07-03",
    abstain: false
  });
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run tests/server/model-estimators.test.ts -t "external OpenAI-compatible"
```

Expected: FAIL because `createExternalModelEstimator` does not accept `apiKey`, `model`, or `fetch`, and still abstains when endpoint is present.

- [x] **Step 3: Implement the minimal external estimator**

In `src/server/models/estimators.ts`, expand the config type and make the endpoint call. Reuse `chatCompletionsUrl()`, `likelihoodPrompt()`, and `parseLlmLikelihoodJson()`:

```ts
export function createExternalModelEstimator(config: {
  endpoint?: string;
  apiKey?: string;
  model?: string;
  version?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): LikelihoodEstimator {
  return {
    name: "external-deep-model",
    async estimate(input) {
      const endpoint = config.endpoint?.trim();
      const model = config.model?.trim();
      if (!endpoint || !model) {
        return externalModelAbstain("External model endpoint or model is not configured.", config);
      }
      const fetcher = config.fetch ?? fetch;
      const controller = config.timeoutMs ? new AbortController() : undefined;
      const timeout = controller ? setTimeout(() => controller.abort(), config.timeoutMs) : undefined;
      try {
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (config.apiKey?.trim()) headers.authorization = `Bearer ${config.apiKey.trim()}`;
        const response = await fetcher(chatCompletionsUrl(endpoint), {
          method: "POST",
          headers,
          body: JSON.stringify({
            model,
            temperature: 0,
            max_tokens: 500,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content:
                  "You score how an evidence item changes one hypothesis. Use only the supplied evidence and context, not outside knowledge. Return only JSON with direction, relevance, likelihoodRatio, confidence, reviewRequired, and rationale."
              },
              { role: "user", content: likelihoodPrompt(input) }
            ]
          }),
          signal: controller?.signal
        });
        if (!response.ok) return externalModelAbstain(`External model request failed with status ${response.status}.`, config);
        const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }>; model?: string };
        const parsed = parseLlmLikelihoodJson(body.choices?.[0]?.message?.content ?? "");
        if (!parsed) return externalModelAbstain("External model response was not valid likelihood JSON.", config);
        return {
          estimator: "external-deep-model",
          direction: parsed.direction,
          relevance: parsed.relevance,
          likelihoodRatio: parsed.likelihoodRatio,
          confidence: parsed.confidence,
          weight: 2,
          rationale: parsed.rationale,
          reviewRequired: parsed.reviewRequired,
          modelVersion: `external-deep-model:${config.version ?? body.model ?? model}`,
          abstain: false
        };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return externalModelAbstain(`External model request failed: ${reason}`, config);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }
  };
}
```

Add the helper in the same file:

```ts
function externalModelAbstain(reason: string, config: { version?: string; model?: string }): EstimatorOutput {
  return {
    estimator: "external-deep-model",
    weight: 2,
    abstain: true,
    rationale: reason,
    modelVersion: `external-deep-model:${config.version ?? config.model ?? "unconfigured"}`
  };
}
```

- [x] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npx vitest run tests/server/model-estimators.test.ts -t "external OpenAI-compatible"
```

Expected: PASS.

- [x] **Step 5: Add failure and config tests**

Add tests in `tests/server/model-estimators.test.ts` for:

```ts
it("abstains external deep-model scoring without endpoint or model", async () => {
  const estimator = createExternalModelEstimator({ endpoint: "https://models.example/v1" });
  await expect(
    estimator.estimate({
      evidenceText: "Evidence",
      hypothesis: "Hypothesis",
      category: "TECH_TREND",
      sourceCredibility: 0.5
    })
  ).resolves.toMatchObject({
    estimator: "external-deep-model",
    weight: 2,
    abstain: true,
    rationale: "External model endpoint or model is not configured."
  });
});

it("does not leak external deep-model API keys in HTTP failure rationales", async () => {
  const estimator = createExternalModelEstimator({
    endpoint: "https://models.example/v1",
    apiKey: "secret-external-key",
    model: "deep-eval-v1",
    fetch: async () => new Response("forbidden secret-external-key", { status: 403 })
  });
  const output = await estimator.estimate({
    evidenceText: "Evidence",
    hypothesis: "Hypothesis",
    category: "TECH_TREND",
    sourceCredibility: 0.5
  });
  expect(output.abstain).toBe(true);
  expect(output.rationale).toBe("External model request failed with status 403.");
  expect(output.rationale).not.toContain("secret-external-key");
});
```

- [x] **Step 6: Run all model estimator tests**

Run:

```bash
npx vitest run tests/server/model-estimators.test.ts
```

Expected: PASS.

- [x] **Step 7: Commit Task 1**

```bash
git add src/server/models/estimators.ts tests/server/model-estimators.test.ts
git commit -m "feat: call external deep model estimator"
```

## Task 2: Configure External Deep Model Without Replacing the Main LLM

**Files:**
- Modify: `src/lib/world-model-llm-config.ts`
- Modify: `src/server/models/estimators.ts`
- Modify: `src/server/services/configured.ts`
- Modify: `tests/server/configured-services.test.ts`

- [x] **Step 1: Write a failing configured-services test**

Add this test to `tests/server/configured-services.test.ts`:

```ts
it("includes configured external deep-model outputs while keeping the main LLM scorer", async () => {
  const calls: string[] = [];
  const services = createConfiguredWorldModelServices(createInMemoryWorldModelStore(), {
    env: {
      LLM_PROVIDER: "deepseek",
      LLM_BASE_URL: "https://llm.example",
      LLM_API_KEY: "llm-key",
      LLM_MODEL: "llm-model",
      EXTERNAL_MODEL_ENDPOINT: "https://external.example/v1",
      EXTERNAL_MODEL_API_KEY: "external-key",
      EXTERNAL_MODEL_MODEL: "external-model",
      EXTERNAL_MODEL_VERSION: "external-v1"
    },
    async llmFetch(input) {
      calls.push(String(input));
      return new Response(
        JSON.stringify({
          model: String(input).includes("external.example") ? "external-model" : "llm-model",
          choices: [
            {
              message: {
                content: JSON.stringify({
                  direction: "SUPPORTS",
                  relevance: String(input).includes("external.example") ? 0.82 : 0.9,
                  likelihoodRatio: String(input).includes("external.example") ? 2.1 : 2.4,
                  confidence: String(input).includes("external.example") ? 0.7 : 0.8,
                  rationale: String(input).includes("external.example") ? "External model signal" : "LLM signal"
                })
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    },
    sourceAdapterDependencies: {
      async fetchText() {
        return "<html><head><title>AI agents accelerate engineering teams</title></head><body>AI agents accelerate engineering teams.</body></html>";
      }
    },
    autoApplyPolicy: async (input) => input
  });
  const belief = await services.beliefs.createBelief({
    title: "AI agents",
    category: "AI_TREND",
    description: "",
    probabilityMode: "INDEPENDENT",
    hypotheses: balancedAgentHypotheses()
  });
  const source = await services.sources.createSource({
    name: "Configured source",
    kind: "WEB_PAGE",
    url: "https://example.test/agent-signal",
    adapter: "web_page",
    credibility: 0.8,
    enabled: true,
    autoConfirm: true,
    autoConfirmThreshold: 0.2
  });

  await services.automation.runEvidenceLoop({ beliefIds: [belief.id], sourceIds: [source.id], autoConfirmThreshold: 0.2 });
  const [run] = await services.likelihood.listRuns();

  expect(calls.some((url) => url.includes("https://llm.example"))).toBe(true);
  expect(calls.some((url) => url.includes("https://external.example"))).toBe(true);
  expect(run.estimatorOutputs.map((output) => output.estimator)).toEqual(["llm", "external-deep-model"]);
});
```

- [x] **Step 2: Run the configured-services focused test and verify RED**

Run:

```bash
npx vitest run tests/server/configured-services.test.ts -t "external deep-model outputs"
```

Expected: FAIL because configured services only pass the LLM estimator.

- [x] **Step 3: Normalize external model config**

In `src/lib/world-model-llm-config.ts`, add:

```ts
export type ExternalModelConfigEnv = Record<string, string | undefined> & {
  EXTERNAL_MODEL_ENDPOINT?: string;
  EXTERNAL_MODEL_API_KEY?: string;
  EXTERNAL_MODEL_MODEL?: string;
  EXTERNAL_MODEL_VERSION?: string;
  EXTERNAL_MODEL_TIMEOUT_MS?: string;
};

export type NormalizedExternalModelConfig = {
  endpoint: string;
  apiKey: string;
  model: string;
  version?: string;
  timeoutMs?: number;
};

export function normalizeExternalModelConfig(env: ExternalModelConfigEnv = process.env): NormalizedExternalModelConfig {
  const timeout = Number(env.EXTERNAL_MODEL_TIMEOUT_MS);
  return {
    endpoint: env.EXTERNAL_MODEL_ENDPOINT?.trim() ?? "",
    apiKey: env.EXTERNAL_MODEL_API_KEY?.trim() ?? "",
    model: env.EXTERNAL_MODEL_MODEL?.trim() ?? "",
    version: env.EXTERNAL_MODEL_VERSION?.trim() || undefined,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? Math.floor(timeout) : undefined
  };
}

export function isExternalModelConfigured(env: ExternalModelConfigEnv = process.env) {
  const config = normalizeExternalModelConfig(env);
  return Boolean(config.endpoint && config.model);
}
```

- [x] **Step 4: Add a composite estimator helper**

In `src/server/models/estimators.ts`, add:

```ts
export function createCompositeLikelihoodEstimator(estimators: LikelihoodEstimator[]): LikelihoodEstimator {
  return {
    name: estimators.map((estimator) => estimator.name).join("+"),
    async estimate(input) {
      const outputs = [];
      for (const estimator of estimators) {
        const output = await estimator.estimate(input);
        outputs.push(output);
      }
      return outputs;
    }
  };
}
```

Change the interface to:

```ts
export type LikelihoodEstimator = {
  name: string;
  estimate(input: EstimatorInput): Promise<EstimatorOutput | EstimatorOutput[]>;
};
```

Update `src/server/services/world-model-services.ts` at the estimator call site to normalize output arrays:

```ts
const outputs = [await options.likelihoodEstimator.estimate({ ... })].flat();
for (const output of outputs) {
  // existing candidateEvaluation and usable-output handling
}
```

When building a recommended link, use the first usable output for direction/relevance/likelihood/confidence and set `estimatorOutputs: outputs`.

- [x] **Step 5: Wire configured services**

In `src/server/services/configured.ts`, import `createCompositeLikelihoodEstimator`, `createExternalModelEstimator`, and `normalizeExternalModelConfig`. Build:

```ts
const llmEstimator = createConfiguredLlmEstimator(options.env, options.llmFetch);
const externalConfig = normalizeExternalModelConfig(options.env);
const likelihoodEstimator =
  externalConfig.endpoint && externalConfig.model
    ? createCompositeLikelihoodEstimator([
        llmEstimator,
        createExternalModelEstimator({
          endpoint: externalConfig.endpoint,
          apiKey: externalConfig.apiKey,
          model: externalConfig.model,
          version: externalConfig.version,
          fetch: options.llmFetch,
          timeoutMs: externalConfig.timeoutMs ?? 30_000
        })
      ])
    : llmEstimator;
```

Pass `likelihoodEstimator` into `createWorldModelServices`.

- [x] **Step 6: Run configured-services tests**

Run:

```bash
npx vitest run tests/server/configured-services.test.ts
```

Expected: PASS.

- [x] **Step 7: Commit Task 2**

```bash
git add src/lib/world-model-llm-config.ts src/server/models/estimators.ts src/server/services/configured.ts src/server/services/world-model-services.ts tests/server/configured-services.test.ts
git commit -m "feat: wire optional external model scoring"
```

## Task 3: Polymarket Public Market Data

**Files:**
- Modify: `tests/server/source-adapters.test.ts`
- Modify: `src/server/sources/adapters.ts`

- [x] **Step 1: Write failing richer Polymarket market parsing test**

Add this test below the existing prediction-market test:

```ts
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

  await expect(adapter.fetch({ name: "Polymarket", adapter: "polymarket_markets", queries: ["AI agents adoption"] })).resolves.toEqual([
    expect.objectContaining({
      title: "Polymarket: Will AI agents exceed 20% enterprise adoption in 2026?",
      content: expect.stringContaining("Yes 0.62"),
      url: "https://polymarket.com/event/ai-agents-enterprise-adoption-2026",
      publishedAt: new Date("2026-12-31T00:00:00Z"),
      sourceMetadata: expect.objectContaining({
        adapter: "PREDICTION_MARKET",
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
```

- [x] **Step 2: Verify RED**

Run:

```bash
npx vitest run tests/server/source-adapters.test.ts -t "rich Polymarket"
```

Expected: FAIL because current parser emits only minimal prediction-market metadata.

- [x] **Step 3: Implement richer Polymarket parsing**

In `src/server/sources/adapters.ts`, add helpers:

```ts
function arrayStringField(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
}

function numericArrayField(record: Record<string, unknown>, key: string): number[] {
  return arrayStringField(record, key).map(Number).filter((item) => Number.isFinite(item));
}

function flexibleNumberField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) ? numeric : undefined;
}
```

Replace `parsePredictionMarketObservations()` with Polymarket-aware parsing that preserves old behavior for object shapes with `markets`.

- [x] **Step 4: Verify GREEN**

Run:

```bash
npx vitest run tests/server/source-adapters.test.ts -t "rich Polymarket"
```

Expected: PASS.

- [x] **Step 5: Add Polymarket events test**

Add:

```ts
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
        source: "polymarket_events",
        eventId: "event-1",
        marketCount: 1
      })
    })
  ]);
});
```

- [x] **Step 6: Run source adapter tests**

Run:

```bash
npx vitest run tests/server/source-adapters.test.ts
```

Expected: PASS.

- [x] **Step 7: Commit Task 3**

```bash
git add src/server/sources/adapters.ts tests/server/source-adapters.test.ts
git commit -m "feat: enrich polymarket market observations"
```

## Task 4: X/Twitter Recent Search Adapter

**Files:**
- Modify: `tests/server/source-adapters.test.ts`
- Modify: `src/server/sources/adapters.ts`

- [x] **Step 1: Write failing X recent search credential test**

Add:

```ts
it("collects X recent-search observations with a bearer token credential ref", async () => {
  const requested: Array<{ url: string; authorization: string | null }> = [];
  const adapter = createSourceAdapter("SOCIAL", {
    fetchImpl: async (url, init) => {
      requested.push({
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization")
      });
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "1800000000000000001",
              text: "AI agents are changing enterprise workflows.",
              author_id: "42",
              created_at: "2026-07-03T01:02:03.000Z",
              lang: "en",
              public_metrics: { retweet_count: 2, reply_count: 3, like_count: 10, quote_count: 1 },
              possibly_sensitive: false
            }
          ],
          includes: { users: [{ id: "42", username: "builder", name: "Builder" }] }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    },
    env: {
      X_MAIN_BEARER_TOKEN: "x-test-token"
    }
  });

  await expect(
    adapter.fetch({
      name: "X recent search",
      adapter: "x_recent_search",
      credentialRef: "X_MAIN",
      queries: ["AI agents enterprise"]
    })
  ).resolves.toEqual([
    {
      title: "X: AI agents are changing enterprise workflows.",
      content: "AI agents are changing enterprise workflows. @builder Likes: 10 Reposts: 2 Replies: 3 Quotes: 1",
      url: "https://x.com/builder/status/1800000000000000001",
      author: "builder",
      publishedAt: new Date("2026-07-03T01:02:03.000Z"),
      sourceMetadata: {
        adapter: "SOCIAL",
        query: "AI agents enterprise",
        source: "x_recent_search",
        tweetId: "1800000000000000001",
        authorId: "42",
        username: "builder",
        lang: "en",
        possiblySensitive: false,
        publicMetrics: { retweet_count: 2, reply_count: 3, like_count: 10, quote_count: 1 }
      }
    }
  ]);
  expect(requested[0].authorization).toBe("Bearer x-test-token");
  expect(requested[0].url).toContain("https://api.x.com/2/tweets/search/recent");
  expect(requested[0].url).toContain("query=AI%20agents%20enterprise");
});
```

- [x] **Step 2: Verify RED**

Run:

```bash
npx vitest run tests/server/source-adapters.test.ts -t "X recent-search"
```

Expected: FAIL because `AdapterDependencies` has no `env` and `SOCIAL` without URL returns `[]`.

- [x] **Step 3: Implement X credential resolution and fetch path**

In `src/server/sources/adapters.ts`:

```ts
export type AdapterDependencies = {
  fetchText?: (url: string) => Promise<string>;
  fetchImpl?: typeof fetch;
  fallbackFetchText?: (url: string) => Promise<string>;
  env?: Record<string, string | undefined>;
};
```

Add:

```ts
function credentialEnvName(ref: string | undefined, suffix: string) {
  const normalized = ref?.trim().replace(/[^a-zA-Z0-9_]/g, "_").toUpperCase();
  return normalized ? `${normalized}_${suffix}` : "";
}

function xBearerToken(source: AdapterSourceConfig, env: Record<string, string | undefined>) {
  const name = credentialEnvName(source.credentialRef, "BEARER_TOKEN");
  return name ? env[name]?.trim() ?? "" : "";
}
```

In `createSourceAdapter("SOCIAL")`, branch first:

```ts
if (source.adapter === "x_recent_search") {
  return fetchXRecentSearchObservations(source, dependencies);
}
```

Implement `fetchXRecentSearchObservations()` using `dependencies.fetchImpl ?? fetch`, Bearer header, and the parsing shape from the test.

- [x] **Step 4: Verify GREEN**

Run:

```bash
npx vitest run tests/server/source-adapters.test.ts -t "X recent-search"
```

Expected: PASS.

- [x] **Step 5: Add X missing-token and failure redaction tests**

Add:

```ts
it("keeps X recent-search credential refs inert when the bearer token is missing", async () => {
  const adapter = createSourceAdapter("SOCIAL", {
    fetchImpl: async () => {
      throw new Error("fetch should not be called without a token");
    },
    env: {}
  });

  await expect(
    adapter.fetch({ name: "X recent search", adapter: "x_recent_search", credentialRef: "X_MAIN", queries: ["AI agents"] })
  ).resolves.toEqual([]);
});

it("does not leak X bearer tokens when recent-search requests fail", async () => {
  const adapter = createSourceAdapter("SOCIAL", {
    fetchImpl: async () => new Response("token x-secret-token forbidden", { status: 401 }),
    env: { X_MAIN_BEARER_TOKEN: "x-secret-token" }
  });

  await expect(
    adapter.fetch({ name: "X recent search", adapter: "x_recent_search", credentialRef: "X_MAIN", queries: ["AI agents"] })
  ).rejects.toThrow("X recent search failed with status 401");
});
```

- [x] **Step 6: Run source adapter tests**

Run:

```bash
npx vitest run tests/server/source-adapters.test.ts
```

Expected: PASS.

- [x] **Step 7: Commit Task 4**

```bash
git add src/server/sources/adapters.ts tests/server/source-adapters.test.ts
git commit -m "feat: add x recent search adapter"
```

## Task 5: Presets, Environment Examples, and Rollout Notes

**Files:**
- Modify: `.env.example`
- Modify: `src/lib/world-model-source-presets.ts`
- Modify: `tests/lib/world-model-source-presets.test.ts`
- Modify: `docs/ai/world-model-rollout.md`

- [x] **Step 1: Write failing preset test**

Add to `tests/lib/world-model-source-presets.test.ts`:

```ts
it("includes Polymarket priority sources and an inert X recent-search preset", () => {
  const presets = listSourcePresets([]);
  expect(presets.map((preset) => preset.id)).toEqual(
    expect.arrayContaining(["polymarket-query", "polymarket-events-query", "x-recent-search"])
  );
  const xPreset = presets.find((preset) => preset.id === "x-recent-search");
  expect(xPreset).toMatchObject({
    kind: "SOCIAL",
    adapter: "x_recent_search",
    credentialRef: "X_MAIN",
    enabled: false,
    autoConfirm: false
  });
});
```

- [x] **Step 2: Verify RED**

Run:

```bash
npx vitest run tests/lib/world-model-source-presets.test.ts -t "Polymarket priority"
```

Expected: FAIL because `polymarket-events-query` and `x-recent-search` are not present.

- [x] **Step 3: Add presets**

In `src/lib/world-model-source-presets.ts`, add:

```ts
{
  id: "polymarket-events-query",
  name: "Polymarket Events Query",
  description: "Polymarket public event search for grouped market signals and settlement context.",
  kind: "PREDICTION_MARKET",
  url: "https://gamma-api.polymarket.com/events?search={query}&limit=10",
  adapter: "polymarket_events",
  credentialRef: undefined,
  credibility: 0.62,
  enabled: true,
  autoConfirm: false,
  autoConfirmThreshold: 0.9
},
{
  id: "x-recent-search",
  name: "X Recent Search",
  description: "X/Twitter recent-search API signals. Requires X_MAIN_BEARER_TOKEN and remains disabled by default.",
  kind: "SOCIAL",
  url: undefined,
  adapter: "x_recent_search",
  credentialRef: "X_MAIN",
  credibility: 0.42,
  enabled: false,
  autoConfirm: false,
  autoConfirmThreshold: 0.95
}
```

- [x] **Step 4: Add non-secret env examples**

In `.env.example`, add:

```env
EXTERNAL_MODEL_ENDPOINT=""
EXTERNAL_MODEL_API_KEY=""
EXTERNAL_MODEL_MODEL=""
EXTERNAL_MODEL_VERSION=""
EXTERNAL_MODEL_TIMEOUT_MS="30000"
X_MAIN_BEARER_TOKEN=""
```

- [x] **Step 5: Update rollout notes**

In `docs/ai/world-model-rollout.md`, add operational notes:

```md
- Polymarket public Gamma/Data/CLOB reads do not require a Polymarket API key for this phase.
- X recent search requires an X developer app Bearer Token. Store it as `X_MAIN_BEARER_TOKEN` when using the `X_MAIN` credential reference.
- External deep-model scoring is optional and uses `EXTERNAL_MODEL_*`; it does not reuse `LLM_*` automatically.
```

- [x] **Step 6: Run focused tests**

Run:

```bash
npx vitest run tests/lib/world-model-source-presets.test.ts
```

Expected: PASS.

- [x] **Step 7: Commit Task 5**

```bash
git add .env.example src/lib/world-model-source-presets.ts tests/lib/world-model-source-presets.test.ts docs/ai/world-model-rollout.md
git commit -m "docs: add automation source setup notes"
```

## Task 6: Final Verification

**Files:**
- No new files.
- Verify all changed behavior.

- [x] **Step 1: Run source adapter tests**

```bash
npx vitest run tests/server/source-adapters.test.ts
```

Expected: PASS.

- [x] **Step 2: Run model estimator tests**

```bash
npx vitest run tests/server/model-estimators.test.ts
```

Expected: PASS.

- [x] **Step 3: Run configured service tests**

```bash
npx vitest run tests/server/configured-services.test.ts
```

Expected: PASS.

- [x] **Step 4: Run required project checks**

```bash
npm run lint
npm run typecheck
npm run test
npm run observe -- --dry-run
```

Expected: all commands exit 0. If `observe -- --dry-run` cannot reach network sources in the local environment, record the exact failing source and whether the failure is unrelated to code changes.

- [x] **Step 5: Run build if prior checks pass**

```bash
npm run build
```

Expected: exit 0.

- [ ] **Step 6: Final commit if any verification-only docs changed**

```bash
git status --short
git log --oneline -5
```

Expected: no uncommitted changes. If there are documentation updates from verification, commit them with:

```bash
git add docs/ai/world-model-rollout.md
git commit -m "docs: record automation verification notes"
```

## Self-Review

Spec coverage:

- Polymarket public market-data parsing: Task 3.
- X/Twitter recent-search with Bearer Token and credential refs: Task 4.
- External deep-model HTTP estimator and separate config: Tasks 1 and 2.
- Review-first defaults, manual settlement, no periodic training refresh: preserved by not changing worker policy or settlement behavior.
- Linux production packaging: documented as deferred, not implemented in this phase.
- Minimal service extraction: not required unless Task 2 implementation makes `world-model-services.ts` harder to maintain; no all-service rewrite is planned.

Placeholder scan:

- No unresolved markers or incomplete file paths found.

Type consistency:

- `AdapterDependencies.env` is introduced in Task 4 and used only by source adapters.
- `createExternalModelEstimator()` accepts `endpoint`, `apiKey`, `model`, `version`, `fetch`, and `timeoutMs`.
- `LikelihoodEstimator.estimate()` may return one output or an array; service code must normalize that result before building links.
