import { vi } from "vitest";
import { createInMemoryWorldModelStore } from "@/server/services/in-memory-store";
import { createWorldModelServices } from "@/server/services/world-model-services";
import {
  guardObserveSourceOptions,
  guardObserveLoopOptions,
  loopResultAttentionMessage,
  loopResultNeedsBackoff,
  loopResultNeedsAttention,
  observeReviewSourceRunOptions,
  observeWriteSourceRunOptions,
  observeLoopExitCode,
  observeLoopHeartbeatNotice,
  parseObserveArgs,
  listConfiguredSourcesForLoopDryRun,
  runConfiguredSourceDryRuns,
  runObserveLoopDryRun,
  runRepeatedTask,
  runWithTimeout,
  applyWorkerConfigToObserveOptions,
  resolveObserveReadableSelectors
} from "../../scripts/observe";

const mocks = vi.hoisted(() => ({
  loadLlmEvaluationArtifact: vi.fn()
}));

vi.mock("@/server/training/llm-evaluation-artifact", () => ({
  loadLlmEvaluationArtifact: mocks.loadLlmEvaluationArtifact
}));

function llmEvaluationArtifact(overrides: Partial<{
  reviewRequiredRate: number;
  fallbackDivergenceRate: number | null;
  sourceCounts: Record<string, number>;
}> = {}) {
  return {
    generatedAt: new Date(),
    samplesPath: "model-artifacts/training-samples.jsonl",
    summary: {
      modelName: "deepseek:deepseek-v4-flash",
      sampleCount: 50,
      scoredCount: 50,
      directionAccuracy: {
        SUPPORTS: { total: 20, scored: 20, correct: 18, accuracy: 0.9 },
        OPPOSES: { total: 15, scored: 15, correct: 13, accuracy: 0.87 },
        NEUTRAL: { total: 15, scored: 15, correct: 13, accuracy: 0.87 }
      },
      likelihoodRatio: { min: 0.4, max: 10, mean: 2.4 },
      lowConfidenceCount: 2,
      lowConfidenceRate: 0.04,
      reviewRequiredCount: 4,
      reviewRequiredRate: overrides.reviewRequiredRate ?? 0.08,
      sourceCounts: overrides.sourceCounts ?? { fever: 49, local_confirmed: 1 },
      fallbackComparedCount: 50,
      fallbackDivergenceCount: overrides.fallbackDivergenceRate === null ? 0 : 4,
      fallbackDivergenceRate: overrides.fallbackDivergenceRate === undefined ? 0.08 : overrides.fallbackDivergenceRate
    }
  };
}

describe("observe CLI options", () => {
  beforeEach(() => {
    mocks.loadLlmEvaluationArtifact.mockReset();
    mocks.loadLlmEvaluationArtifact.mockResolvedValue(llmEvaluationArtifact());
  });

  it("bootstraps default sources for plain loop runs without an explicit source", () => {
    const options = parseObserveArgs(["node", "observe.ts", "--loop"]);

    expect(options.loop).toBe(true);
    expect(options.sourceId).toBeUndefined();
    expect(options.loopOptions.bootstrapDefaultSources).toBe(true);
  });

  it("does not bootstrap defaults when a loop targets an explicit source", () => {
    const options = parseObserveArgs(["node", "observe.ts", "--loop", "--source", "source_1"]);

    expect(options.sourceId).toBe("source_1");
    expect(options.loopOptions.bootstrapDefaultSources).toBe(false);
  });

  it("resolves human-readable belief and source codes before running scoped loops", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const belief = await services.beliefs.createBelief({
      title: "Readable scoped belief",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "Readable scoped hypothesis",
          priorProbability: 0.5,
          stance: "SUPPORTS",
          notes: ""
        }
      ]
    });
    const source = await services.sources.createSource({
      name: "Readable scoped source",
      kind: "RSS",
      adapter: "rss",
      url: "https://example.com/feed.xml",
      credibility: 0.8,
      enabled: true,
      autoConfirm: false,
      autoConfirmThreshold: 0.8
    });
    const options = parseObserveArgs(["node", "observe.ts", "--loop", "--belief", "B-001", "--source", "S-001"]);

    const resolved = await resolveObserveReadableSelectors(services, options);

    expect(resolved.beliefId).toBe(belief.id);
    expect(resolved.sourceId).toBe(source.id);
    expect(resolved.loopOptions.beliefIds).toEqual([belief.id]);
    expect(resolved.loopOptions.sourceIds).toEqual([source.id]);
  });

  it("allows default source bootstrapping to be disabled explicitly", () => {
    const options = parseObserveArgs(["node", "observe.ts", "--loop", "--no-bootstrap-default-sources"]);

    expect(options.loopOptions.bootstrapDefaultSources).toBe(false);
  });

  it("parses forced auto-apply loop options", () => {
    const options = parseObserveArgs([
      "node",
      "observe.ts",
      "--loop",
      "--review-only",
      "--force-auto-apply",
      "--max-observations",
      "3",
      "--candidate-threshold",
      "0.25",
      "--threshold",
      "0.75"
    ]);

    expect(options.loopOptions).toMatchObject({
      reviewOnly: true,
      forceAutoApply: true,
      maxObservations: 3,
      candidateThreshold: 0.25,
      autoConfirmThreshold: 0.75
    });
  });

  it("downgrades forced auto-apply loop options when LLM evaluation quality is risky", async () => {
    mocks.loadLlmEvaluationArtifact.mockResolvedValue(llmEvaluationArtifact({ reviewRequiredRate: 0.46 }));
    const options = parseObserveArgs([
      "node",
      "observe.ts",
      "--loop",
      "--force-auto-apply",
      "--max-observations",
      "3",
      "--threshold",
      "0.75"
    ]);

    await expect(guardObserveLoopOptions(options.loopOptions)).resolves.toEqual({
      options: {
        reviewOnly: true,
        sourceIds: undefined,
        maxObservations: 3,
        maxSources: undefined,
        maxQueries: undefined,
        candidateThreshold: undefined,
        autoConfirmThreshold: 0.75,
        bootstrapDefaultSources: true,
        forceAutoApply: false
      },
      notice: "LLM 评估风险：LLM 评估复核率偏高，已切换为待审模式。"
    });
  });

  it("downgrades forced auto-apply loop options when the scoped belief has no currently effective hypothesis", async () => {
    const options = parseObserveArgs([
      "node",
      "observe.ts",
      "--loop",
      "--belief",
      "belief_scoped",
      "--force-auto-apply",
      "--max-observations",
      "3",
      "--threshold",
      "0.75"
    ]);
    const services = {
      beliefs: {
        listBeliefs: async () => [
          {
            id: "belief_scoped",
            code: "B-001",
            title: "Scoped belief",
            category: "AI_TREND",
            description: "",
            probabilityMode: "INDEPENDENT",
            origin: "INTERNAL",
            status: "ACTIVE",
            priorProbability: 0.5,
            currentProbability: 0.5,
            createdAt: new Date("2026-06-18T01:00:00.000Z"),
            updatedAt: new Date("2026-06-18T01:00:00.000Z"),
            hypotheses: [
              {
                id: "hypothesis_future",
                code: "H-001",
                beliefId: "belief_scoped",
                proposition: "Scoped hypothesis starts later",
                stance: "SUPPORTS",
                priorProbability: 0.5,
                currentProbability: 0.5,
                status: "ACTIVE",
                startsAt: new Date("2099-01-01T00:00:00.000Z"),
                expiresAt: undefined,
                expiryCondition: "",
                notes: "",
                createdAt: new Date("2026-06-18T01:00:00.000Z"),
                updatedAt: new Date("2026-06-18T01:00:00.000Z")
              }
            ]
          }
        ]
      }
    };

    await expect(guardObserveLoopOptions(options.loopOptions, services as never)).resolves.toEqual({
      options: {
        reviewOnly: true,
        beliefIds: ["belief_scoped"],
        sourceIds: undefined,
        maxObservations: 3,
        maxSources: undefined,
        maxQueries: undefined,
        candidateThreshold: undefined,
        autoConfirmThreshold: 0.75,
        bootstrapDefaultSources: true,
        forceAutoApply: false
      },
      notice: "没有当前有效假设，已切换为待审模式。"
    });
  });

  it("downgrades forced auto-apply source options when LLM evaluation quality is risky", async () => {
    mocks.loadLlmEvaluationArtifact.mockResolvedValue(llmEvaluationArtifact({ reviewRequiredRate: 0.46 }));
    const options = parseObserveArgs([
      "node",
      "observe.ts",
      "--source",
      "source_1",
      "--force-auto-apply",
      "--candidate-threshold",
      "0.25",
      "--max-observations",
      "3"
    ]);

    await expect(
      guardObserveSourceOptions({
        candidateThreshold: options.loopOptions.candidateThreshold,
        autoConfirmThreshold: options.loopOptions.autoConfirmThreshold,
        forceAutoApply: options.forceAutoApply,
        maxObservations: options.loopOptions.maxObservations
      })
    ).resolves.toEqual({
      options: {
        reviewOnly: true,
        candidateThreshold: 0.25,
        autoConfirmThreshold: undefined,
        forceAutoApply: false,
        maxObservations: 3
      },
      notice: "LLM 评估风险：LLM 评估复核率偏高，已切换为待审模式。"
    });
  });

  it("downgrades forced auto-apply source options when the scoped belief has no currently effective hypothesis", async () => {
    const options = parseObserveArgs([
      "node",
      "observe.ts",
      "--source",
      "source_1",
      "--belief",
      "belief_scoped",
      "--force-auto-apply",
      "--candidate-threshold",
      "0.25",
      "--max-observations",
      "3"
    ]);
    const services = {
      beliefs: {
        listBeliefs: async () => [
          {
            id: "belief_scoped",
            code: "B-001",
            title: "Scoped belief",
            category: "AI_TREND",
            description: "",
            probabilityMode: "INDEPENDENT",
            origin: "INTERNAL",
            status: "ACTIVE",
            priorProbability: 0.5,
            currentProbability: 0.5,
            createdAt: new Date("2026-06-18T01:00:00.000Z"),
            updatedAt: new Date("2026-06-18T01:00:00.000Z"),
            hypotheses: [
              {
                id: "hypothesis_future",
                code: "H-001",
                beliefId: "belief_scoped",
                proposition: "Scoped hypothesis starts later",
                stance: "SUPPORTS",
                priorProbability: 0.5,
                currentProbability: 0.5,
                status: "ACTIVE",
                startsAt: new Date("2099-01-01T00:00:00.000Z"),
                expiresAt: undefined,
                expiryCondition: "",
                notes: "",
                createdAt: new Date("2026-06-18T01:00:00.000Z"),
                updatedAt: new Date("2026-06-18T01:00:00.000Z")
              }
            ]
          }
        ]
      }
    };

    await expect(guardObserveSourceOptions(observeWriteSourceRunOptions(options), services as never)).resolves.toEqual({
      options: {
        reviewOnly: true,
        beliefIds: ["belief_scoped"],
        candidateThreshold: 0.25,
        autoConfirmThreshold: undefined,
        forceAutoApply: false,
        maxQueries: undefined,
        maxObservations: 3
      },
      notice: "没有当前有效假设，已切换为待审模式。"
    });
  });

  it("downgrades auto-confirming source options when the scoped belief has no currently effective hypothesis", async () => {
    const options = parseObserveArgs([
      "node",
      "observe.ts",
      "--source",
      "source_github",
      "--belief",
      "belief_scoped",
      "--candidate-threshold",
      "0.2",
      "--threshold",
      "0.7",
      "--max-observations",
      "5"
    ]);
    const services = {
      beliefs: {
        listBeliefs: async () => [
          {
            id: "belief_scoped",
            code: "B-001",
            title: "Scoped belief",
            category: "AI_TREND",
            description: "",
            probabilityMode: "INDEPENDENT",
            origin: "INTERNAL",
            status: "ACTIVE",
            priorProbability: 0.5,
            currentProbability: 0.5,
            createdAt: new Date("2026-06-18T01:00:00.000Z"),
            updatedAt: new Date("2026-06-18T01:00:00.000Z"),
            hypotheses: [
              {
                id: "hypothesis_future",
                code: "H-001",
                beliefId: "belief_scoped",
                proposition: "Scoped hypothesis starts later",
                stance: "SUPPORTS",
                priorProbability: 0.5,
                currentProbability: 0.5,
                status: "ACTIVE",
                startsAt: new Date("2099-01-01T00:00:00.000Z"),
                expiresAt: undefined,
                expiryCondition: "",
                notes: "",
                createdAt: new Date("2026-06-18T01:00:00.000Z"),
                updatedAt: new Date("2026-06-18T01:00:00.000Z")
              }
            ]
          }
        ]
      }
    };

    await expect(guardObserveSourceOptions(observeWriteSourceRunOptions(options), services as never, true)).resolves.toEqual({
      options: {
        reviewOnly: true,
        beliefIds: ["belief_scoped"],
        candidateThreshold: 0.2,
        autoConfirmThreshold: 0.7,
        forceAutoApply: false,
        maxQueries: undefined,
        maxObservations: 5
      },
      notice: "没有当前有效假设，已切换为待审模式。"
    });
  });

  it("bounds one-shot review-only evidence loops by default", () => {
    const options = parseObserveArgs(["node", "observe.ts", "--loop", "--review-only"]);

    expect(options.loopOptions).toMatchObject({
      reviewOnly: true,
      maxSources: 1,
      maxQueries: 1,
      maxObservations: 1
    });
  });

  it("does not add smoke-test bounds when review-only loops explicitly target all sources", () => {
    const options = parseObserveArgs(["node", "observe.ts", "--loop", "--review-only", "--all"]);

    expect(options.loopOptions.maxSources).toBeUndefined();
    expect(options.loopOptions.maxQueries).toBeUndefined();
    expect(options.loopOptions.maxObservations).toBeUndefined();
  });

  it("parses a one-shot timeout for evidence loop runs", () => {
    const options = parseObserveArgs(["node", "observe.ts", "--loop", "--review-only", "--timeout-seconds", "45"]);

    expect(options.timeoutMs).toBe(45_000);
  });

  it("parses a maximum source count for bounded evidence loop runs", () => {
    const options = parseObserveArgs(["node", "observe.ts", "--loop", "--review-only", "--max-sources", "1"]);

    expect(options.loopOptions.maxSources).toBe(1);
  });

  it("scopes evidence loop runs by belief and source", () => {
    const options = parseObserveArgs(["node", "observe.ts", "--loop", "--belief", "belief_ai_agents", "--source", "source_github"]);

    expect(options.loopOptions.beliefIds).toEqual(["belief_ai_agents"]);
    expect(options.loopOptions.sourceIds).toEqual(["source_github"]);
  });

  it("passes belief scope to source review-only runs", () => {
    const options = parseObserveArgs([
      "node",
      "observe.ts",
      "--source",
      "source_github",
      "--review-only",
      "--belief",
      "belief_ai_agents",
      "--candidate-threshold",
      "0.2",
      "--threshold",
      "0.7",
      "--max-queries",
      "2",
      "--max-observations",
      "5"
    ]);

    expect(observeReviewSourceRunOptions(options)).toEqual({
      reviewOnly: true,
      beliefIds: ["belief_ai_agents"],
      candidateThreshold: 0.2,
      autoConfirmThreshold: 0.7,
      maxQueries: 2,
      maxObservations: 5
    });
  });

  it("passes belief scope to writable source runs before policy guarding", () => {
    const options = parseObserveArgs([
      "node",
      "observe.ts",
      "--source",
      "source_github",
      "--belief",
      "belief_ai_agents",
      "--force-auto-apply",
      "--candidate-threshold",
      "0.2",
      "--threshold",
      "0.7",
      "--max-queries",
      "2",
      "--max-observations",
      "5"
    ]);

    expect(observeWriteSourceRunOptions(options)).toEqual({
      beliefIds: ["belief_ai_agents"],
      candidateThreshold: 0.2,
      autoConfirmThreshold: 0.7,
      forceAutoApply: true,
      maxQueries: 2,
      maxObservations: 5
    });
  });

  it("treats configured source dry-runs as review-only and disables forced auto-apply", () => {
    const options = parseObserveArgs([
      "node",
      "observe.ts",
      "--source",
      "source_github",
      "--dry-run",
      "--force-auto-apply",
      "--candidate-threshold",
      "0.2",
      "--threshold",
      "0.7",
      "--max-observations",
      "5"
    ]);

    expect(options.dryRun).toBe(true);
    expect(options.reviewOnly).toBe(true);
    expect(options.forceAutoApply).toBe(false);
    expect(observeReviewSourceRunOptions(options)).toEqual({
      reviewOnly: true,
      beliefIds: undefined,
      candidateThreshold: 0.2,
      autoConfirmThreshold: 0.7,
      maxQueries: undefined,
      maxObservations: 5
    });
  });

  it("bounds one-shot dry-run evidence loops and prevents forced auto-apply", () => {
    const options = parseObserveArgs(["node", "observe.ts", "--loop", "--dry-run", "--force-auto-apply"]);

    expect(options.dryRun).toBe(true);
    expect(options.reviewOnly).toBe(true);
    expect(options.forceAutoApply).toBe(false);
    expect(options.loopOptions).toMatchObject({
      reviewOnly: true,
      forceAutoApply: false,
      maxSources: 1,
      maxQueries: 1,
      maxObservations: 1
    });
  });

  it("runs configured source dry-runs through runDryRun instead of the writable source path", async () => {
    const options = parseObserveArgs(["node", "observe.ts", "--source", "source_news", "--dry-run", "--max-observations", "1"]);
    const runDryRun = vi.fn().mockResolvedValue({ id: "run_dry", status: "DRY_RUN", itemCount: 1 });
    const fetch = vi.fn().mockResolvedValue([
      {
        title: "First source signal",
        content: "First source signal content",
        url: "https://example.com/first",
        author: "Reporter",
        publishedAt: new Date("2026-06-18T01:00:00.000Z"),
        sourceMetadata: { adapter: "RSS" }
      },
      {
        title: "Second source signal",
        content: "Second source signal content"
      }
    ]);

    await expect(
      runConfiguredSourceDryRuns(
        [
          {
            id: "source_news",
            name: "News",
            kind: "RSS",
            adapter: "rss",
            url: "https://news.example/rss",
            credibility: 0.7,
            enabled: true,
            autoConfirm: true,
            autoConfirmThreshold: 0.8,
            createdAt: new Date("2026-06-18T01:00:00.000Z"),
            updatedAt: new Date("2026-06-18T01:00:00.000Z")
          }
        ],
        { runDryRun },
        options,
        {
          createAdapter: () => ({
            kind: "RSS",
            fetch
          })
        }
      )
    ).resolves.toEqual([{ id: "run_dry", status: "DRY_RUN", itemCount: 1, source: "News" }]);

    expect(fetch).toHaveBeenCalledWith({
      name: "News",
      adapter: "rss",
      url: "https://news.example/rss",
      credentialRef: undefined
    });
    expect(runDryRun).toHaveBeenCalledWith("source_news", [
      {
        title: "First source signal",
        content: "First source signal content",
        url: "https://example.com/first",
        author: "Reporter",
        publishedAt: new Date("2026-06-18T01:00:00.000Z")
      }
    ]);
  });

  it("passes generated belief queries into query-backed configured source dry-runs", async () => {
    const options = parseObserveArgs([
      "node",
      "observe.ts",
      "--source",
      "source_github",
      "--dry-run",
      "--belief",
      "belief_ai_agents",
      "--max-queries",
      "1"
    ]);
    const runDryRun = vi.fn().mockResolvedValue({ id: "run_github_dry", status: "DRY_RUN", itemCount: 1 });
    const fetch = vi.fn().mockResolvedValue([
      {
        title: "Agent framework signal",
        content: "Agent framework signal content"
      }
    ]);
    const listBeliefs = vi.fn().mockResolvedValue([
      {
        id: "belief_ai_agents",
        title: "AI agents",
        category: "AI_TREND",
        description: "Agentic software development adoption",
        probabilityMode: "BAYESIAN",
        origin: "INTERNAL",
        status: "ACTIVE",
        createdAt: new Date("2026-06-18T01:00:00.000Z"),
        updatedAt: new Date("2026-06-18T01:00:00.000Z"),
        hypotheses: [
          {
            id: "hypothesis_agent_frameworks",
            beliefId: "belief_ai_agents",
            proposition: "open-source agent frameworks adoption",
            notes: "",
            stance: "SUPPORTS",
            priorProbability: 0.45,
            currentProbability: 0.5,
            strength: 0.5,
            status: "ACTIVE",
            createdAt: new Date("2026-06-18T01:01:00.000Z"),
            updatedAt: new Date("2026-06-18T01:01:00.000Z")
          }
        ]
      }
    ]);

    await expect(
      runConfiguredSourceDryRuns(
        [
          {
            id: "source_github",
            name: "GitHub",
            kind: "GITHUB",
            adapter: "github",
            credibility: 0.7,
            enabled: true,
            autoConfirm: false,
            autoConfirmThreshold: 0.8,
            createdAt: new Date("2026-06-18T01:00:00.000Z"),
            updatedAt: new Date("2026-06-18T01:00:00.000Z")
          }
        ],
        { runDryRun, listBeliefs } as unknown as Parameters<typeof runConfiguredSourceDryRuns>[1],
        options,
        {
          createAdapter: () => ({
            kind: "GITHUB",
            fetch
          })
        }
      )
    ).resolves.toEqual([{ id: "run_github_dry", status: "DRY_RUN", itemCount: 1, source: "GitHub" }]);

    expect(fetch).toHaveBeenCalledWith({
      name: "GitHub",
      adapter: "github",
      url: undefined,
      credentialRef: undefined,
      queries: ["AI agents open-source agent frameworks adoption"]
    });
    expect(runDryRun).toHaveBeenCalledWith(
      "source_github",
      [
        {
          title: "Agent framework signal",
          content: "Agent framework signal content",
          url: undefined,
          author: undefined,
          publishedAt: undefined
        }
      ],
      {
        queries: [
          {
            beliefId: "belief_ai_agents",
            hypothesisId: "hypothesis_agent_frameworks",
            category: "AI_TREND",
            query: "AI agents open-source agent frameworks adoption"
          }
        ]
      }
    );
  });

  it("passes settlement review queries into query-backed configured source dry-runs", async () => {
    const options = parseObserveArgs(["node", "observe.ts", "--source", "source_github", "--dry-run", "--belief", "belief_ai_agents"]);
    const runDryRun = vi.fn().mockResolvedValue({ id: "run_github_settlement_dry", status: "DRY_RUN", itemCount: 1 });
    const fetch = vi.fn().mockResolvedValue([
      {
        title: "Agent framework final outcome",
        content: "The final outcome is ready for settlement review."
      }
    ]);
    const listBeliefs = vi.fn().mockResolvedValue([
      {
        id: "belief_ai_agents",
        title: "AI agents",
        category: "AI_TREND",
        description: "Agentic software development adoption",
        probabilityMode: "BAYESIAN",
        origin: "INTERNAL",
        status: "ACTIVE",
        createdAt: new Date("2026-06-18T01:00:00.000Z"),
        updatedAt: new Date("2026-06-18T01:00:00.000Z"),
        hypotheses: [
          {
            id: "hypothesis_agent_frameworks",
            beliefId: "belief_ai_agents",
            proposition: "open-source agent frameworks adoption reaches production use",
            notes: "",
            stance: "SUPPORTS",
            priorProbability: 0.45,
            currentProbability: 0.5,
            strength: 0.5,
            status: "ACTIVE",
            expiresAt: new Date("2026-06-01T00:00:00.000Z"),
            expiryCondition: "The launch window closes.",
            createdAt: new Date("2026-06-18T01:01:00.000Z"),
            updatedAt: new Date("2026-06-18T01:01:00.000Z")
          }
        ]
      }
    ]);

    await runConfiguredSourceDryRuns(
      [
        {
          id: "source_github",
          name: "GitHub",
          kind: "GITHUB",
          adapter: "github",
          credibility: 0.7,
          enabled: true,
          autoConfirm: false,
          autoConfirmThreshold: 0.8,
          createdAt: new Date("2026-06-18T01:00:00.000Z"),
          updatedAt: new Date("2026-06-18T01:00:00.000Z")
        }
      ],
      { runDryRun, listBeliefs } as unknown as Parameters<typeof runConfiguredSourceDryRuns>[1],
      options,
      {
        createAdapter: () => ({
          kind: "GITHUB",
          fetch
        })
      }
    );

    expect(fetch).toHaveBeenCalledWith({
      name: "GitHub",
      adapter: "github",
      url: undefined,
      credentialRef: undefined,
      queries: ["AI agents open-source agent frameworks adoption reaches production use The launch window closes. final outcome result settlement"]
    });
    expect(runDryRun).toHaveBeenCalledWith(
      "source_github",
      [
        {
          title: "Agent framework final outcome",
          content: "The final outcome is ready for settlement review.",
          url: undefined,
          author: undefined,
          publishedAt: undefined
        }
      ],
      {
        queries: [
          {
            beliefId: "belief_ai_agents",
            hypothesisId: "hypothesis_agent_frameworks",
            category: "AI_TREND",
            purpose: "SETTLEMENT_REVIEW",
            query:
              "AI agents open-source agent frameworks adoption reaches production use The launch window closes. final outcome result settlement",
            priority: 1,
            priorityReason: "settlement review due",
            settlementDue: true,
            expiresAt: "2026-06-01T00:00:00.000Z",
            expiryCondition: "The launch window closes."
          }
        ]
      }
    );
  });

  it("runs loop dry-runs through configured source dry-runs without calling the writable loop", async () => {
    const options = parseObserveArgs(["node", "observe.ts", "--loop", "--dry-run", "--all", "--max-sources", "1", "--max-observations", "1"]);
    const runDryRun = vi.fn().mockResolvedValue({ id: "run_loop_dry", status: "DRY_RUN", itemCount: 1 });
    const fetch = vi.fn().mockResolvedValue([
      {
        title: "Loop dry-run signal",
        content: "Loop dry-run signal content"
      },
      {
        title: "Ignored by max observations",
        content: "Ignored content"
      }
    ]);
    const runEvidenceLoop = vi.fn();

    await expect(
      runObserveLoopDryRun(
        [
          {
            id: "source_manual",
            name: "Manual",
            kind: "MANUAL",
            adapter: "manual",
            credibility: 0.5,
            enabled: true,
            autoConfirm: false,
            autoConfirmThreshold: 0.8,
            createdAt: new Date("2026-06-18T01:00:00.000Z"),
            updatedAt: new Date("2026-06-18T01:00:00.000Z")
          },
          {
            id: "source_disabled",
            name: "Disabled",
            kind: "RSS",
            adapter: "rss",
            credibility: 0.7,
            enabled: false,
            autoConfirm: false,
            autoConfirmThreshold: 0.8,
            createdAt: new Date("2026-06-18T01:01:00.000Z"),
            updatedAt: new Date("2026-06-18T01:01:00.000Z")
          },
          {
            id: "source_first",
            name: "First",
            kind: "RSS",
            adapter: "rss",
            url: "https://news.example/rss",
            credibility: 0.7,
            enabled: true,
            autoConfirm: true,
            autoConfirmThreshold: 0.8,
            createdAt: new Date("2026-06-18T01:02:00.000Z"),
            updatedAt: new Date("2026-06-18T01:02:00.000Z")
          },
          {
            id: "source_second",
            name: "Second",
            kind: "WEB_PAGE",
            adapter: "web",
            url: "https://example.com",
            credibility: 0.7,
            enabled: true,
            autoConfirm: true,
            autoConfirmThreshold: 0.8,
            createdAt: new Date("2026-06-18T01:03:00.000Z"),
            updatedAt: new Date("2026-06-18T01:03:00.000Z")
          }
        ],
        {
          runDryRun
        },
        options,
        {
          createAdapter: () => ({
            kind: "RSS",
            fetch
          })
        }
      )
    ).resolves.toEqual({
      mode: "dry-run",
      runs: [{ id: "run_loop_dry", status: "DRY_RUN", itemCount: 1, source: "First" }]
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(runDryRun).toHaveBeenCalledWith("source_first", [
      {
        title: "Loop dry-run signal",
        content: "Loop dry-run signal content",
        url: undefined,
        author: undefined,
        publishedAt: undefined
      }
    ]);
    expect(runEvidenceLoop).not.toHaveBeenCalled();
  });

  it("bootstraps default sources before listing loop dry-run sources", async () => {
    const options = parseObserveArgs(["node", "observe.ts", "--loop", "--dry-run"]);
    const source = {
      id: "source_github",
      name: "GitHub",
      kind: "GITHUB" as const,
      adapter: "github",
      credibility: 0.7,
      enabled: true,
      autoConfirm: false,
      autoConfirmThreshold: 0.8,
      createdAt: new Date("2026-06-18T01:00:00.000Z"),
      updatedAt: new Date("2026-06-18T01:00:00.000Z")
    };
    const createMissingPresets = vi.fn().mockResolvedValue([]);
    const listSources = vi.fn().mockResolvedValue([source]);

    await expect(listConfiguredSourcesForLoopDryRun({ createMissingPresets, listSources }, options)).resolves.toEqual([source]);

    expect(createMissingPresets).toHaveBeenCalled();
    expect(createMissingPresets.mock.invocationCallOrder[0]).toBeLessThan(listSources.mock.invocationCallOrder[0]);
  });

  it("does not add smoke-test bounds when review-only loops explicitly target a belief", () => {
    const options = parseObserveArgs(["node", "observe.ts", "--loop", "--review-only", "--belief", "belief_ai_agents"]);

    expect(options.loopOptions.maxSources).toBeUndefined();
    expect(options.loopOptions.maxQueries).toBeUndefined();
    expect(options.loopOptions.maxObservations).toBeUndefined();
  });

  it("parses repeat automation options for unattended evidence loops", () => {
    const options = parseObserveArgs([
      "node",
      "observe.ts",
      "--loop",
      "--repeat",
      "--worker-id",
      "daily-loop",
      "--interval-seconds",
      "120",
      "--failure-backoff-multiplier",
      "3",
      "--max-interval-seconds",
      "600",
      "--iterations",
      "3"
    ]);

    expect(options.repeat).toBe(true);
    expect(options.workerId).toBe("daily-loop");
    expect(options.intervalMs).toBe(120_000);
    expect(options.failureBackoffMultiplier).toBe(3);
    expect(options.maxIntervalMs).toBe(600_000);
    expect(options.iterations).toBe(3);
  });

  it("parses the persisted worker configuration flag", () => {
    const options = parseObserveArgs(["node", "observe.ts", "--loop", "--repeat", "--use-worker-config", "--worker-id", "nightly"]);

    expect(options.useWorkerConfig).toBe(true);
    expect(options.workerId).toBe("nightly");
  });

  it("can run unattended loops from a persisted worker configuration", () => {
    const options = parseObserveArgs([
      "node",
      "observe.ts",
      "--loop",
      "--repeat",
      "--use-worker-config",
      "--worker-id",
      "nightly",
      "--iterations",
      "2"
    ]);

    const configured = applyWorkerConfigToObserveOptions(options, {
      id: "nightly",
      enabled: true,
      intervalMs: 300_000,
      failureBackoffMultiplier: 3,
      maxIntervalMs: 1_800_000,
      reviewOnly: false,
      maxQueries: 5,
      maxSources: 2,
      beliefIds: ["belief_career"],
      sourceIds: ["source_gdelt"],
      maxObservations: 12,
      candidateThreshold: 0.22,
      autoConfirmThreshold: 0.82,
      bootstrapDefaultSources: false,
      forceAutoApply: true,
      createdAt: new Date("2026-06-18T01:00:00.000Z"),
      updatedAt: new Date("2026-06-18T01:05:00.000Z")
    });

    expect(configured).toMatchObject({
      intervalMs: 300_000,
      failureBackoffMultiplier: 3,
      maxIntervalMs: 1_800_000,
      iterations: 2,
      loopOptions: {
        reviewOnly: false,
        maxQueries: 5,
        maxSources: 2,
        beliefIds: ["belief_career"],
        sourceIds: ["source_gdelt"],
        maxObservations: 12,
        candidateThreshold: 0.22,
        autoConfirmThreshold: 0.82,
        bootstrapDefaultSources: false,
        forceAutoApply: true
      }
    });
  });

  it("does not run from a disabled persisted worker configuration", () => {
    const options = parseObserveArgs(["node", "observe.ts", "--loop", "--repeat", "--use-worker-config", "--worker-id", "nightly"]);

    expect(() =>
      applyWorkerConfigToObserveOptions(options, {
        id: "nightly",
        enabled: false,
        intervalMs: 300_000,
        failureBackoffMultiplier: 3,
        maxIntervalMs: 1_800_000,
        reviewOnly: false,
        bootstrapDefaultSources: true,
        forceAutoApply: true,
        createdAt: new Date("2026-06-18T01:00:00.000Z"),
        updatedAt: new Date("2026-06-18T01:05:00.000Z")
      })
    ).toThrow("Worker config is disabled: nightly");
  });

  it("repeats a task with waits only between iterations", async () => {
    const calls: number[] = [];
    const waits: number[] = [];

    const results = await runRepeatedTask(
      async (iteration) => {
        calls.push(iteration);
        return { iteration };
      },
      {
        repeat: true,
        iterations: 3,
        intervalMs: 5000,
        wait: async (ms) => {
          waits.push(ms);
        }
      }
    );

    expect(calls).toEqual([1, 2, 3]);
    expect(waits).toEqual([5000, 5000]);
    expect(results).toEqual([{ iteration: 1 }, { iteration: 2 }, { iteration: 3 }]);
  });

  it("can repeat without accumulating task results for long-running workers", async () => {
    const calls: number[] = [];

    const results = await runRepeatedTask(
      async (iteration) => {
        calls.push(iteration);
        return { iteration };
      },
      {
        repeat: true,
        iterations: 2,
        intervalMs: 0,
        collectResults: false,
        wait: async () => {}
      }
    );

    expect(calls).toEqual([1, 2]);
    expect(results).toEqual([]);
  });

  it("backs off after failed task results and resets after success", async () => {
    const waits: number[] = [];
    const outcomes = [{ failureCount: 1 }, { failureCount: 0 }, { failureCount: 1 }];

    await runRepeatedTask(
      async (iteration) => outcomes[iteration - 1],
      {
        repeat: true,
        iterations: 3,
        intervalMs: 1000,
        failureBackoffMultiplier: 2,
        maxIntervalMs: 5000,
        isFailure: (result) => result.failureCount > 0,
        wait: async (ms) => {
          waits.push(ms);
        }
      }
    );

    expect(waits).toEqual([2000, 1000]);
  });

  it("treats a fully suppressed evidence loop as a failed repeat iteration", async () => {
    const waits: number[] = [];
    const outcomes = [
      {
        failureCount: 0,
        sourceRunCount: 0,
        skippedSourceCount: 1
      },
      {
        failureCount: 0,
        sourceRunCount: 1,
        skippedSourceCount: 0
      }
    ];

    await runRepeatedTask(
      async (iteration) => outcomes[iteration - 1],
      {
        repeat: true,
        iterations: 2,
        intervalMs: 1000,
        failureBackoffMultiplier: 2,
        isFailure: loopResultNeedsAttention,
        wait: async (ms) => {
          waits.push(ms);
        }
      }
    );

    expect(waits).toEqual([2000]);
  });

  it("does not back off repeated evidence loops only because observations need review", async () => {
    const waits: number[] = [];
    const outcomes = [
      {
        failureCount: 0,
        sourceRunCount: 1,
        skippedSourceCount: 0,
        reviewCount: 2
      },
      {
        failureCount: 0,
        sourceRunCount: 1,
        skippedSourceCount: 0,
        reviewCount: 0
      }
    ];

    expect(typeof loopResultNeedsBackoff).toBe("function");
    expect(loopResultNeedsBackoff(outcomes[0])).toBe(false);
    expect(loopResultNeedsBackoff({ failureCount: 1, sourceRunCount: 1, skippedSourceCount: 0 })).toBe(true);

    await runRepeatedTask(
      async (iteration) => outcomes[iteration - 1],
      {
        repeat: true,
        iterations: 2,
        intervalMs: 1000,
        failureBackoffMultiplier: 2,
        isFailure: loopResultNeedsBackoff,
        wait: async (ms) => {
          waits.push(ms);
        }
      }
    );

    expect(waits).toEqual([1000]);
  });

  it("reports the specific attention reason for low-increment skipped sources", () => {
    expect(
      loopResultAttentionMessage({
        failureCount: 0,
        sourceRunCount: 0,
        skippedSourceCount: 1,
        skippedSources: [
          {
            sourceId: "source_stale",
            sourceName: "Stale source",
            reason: "LOW_INCREMENT",
            consecutiveDuplicateOnlyCount: 3
          }
        ]
      })
    ).toBe("所有可用来源都因缺少新观察被跳过。");
  });

  it("reports attention when a loop leaves observations for manual closure", () => {
    expect(
      loopResultAttentionMessage({
        failureCount: 0,
        sourceRunCount: 1,
        skippedSourceCount: 0,
        reviewCount: 2
      })
    ).toBe("2 条候选观察等待确认。");

    expect(
      loopResultAttentionMessage({
        failureCount: 0,
        sourceRunCount: 1,
        skippedSourceCount: 0,
        lowImpactCount: 1
      })
    ).toBe("1 条低影响观察需要人工处理。");

    expect(
      loopResultAttentionMessage({
        failureCount: 0,
        sourceRunCount: 1,
        skippedSourceCount: 0,
        unmatchedCount: 3
      })
    ).toBe("3 条观察未匹配到现有假设，可能需要补充新假设。");
  });

  it("combines policy downgrade and loop attention in repeat heartbeat notices", () => {
    expect(
      observeLoopHeartbeatNotice("LLM 评估风险：LLM 评估复核率偏高，已切换为待审模式。", {
        failureCount: 0,
        sourceRunCount: 1,
        skippedSourceCount: 0,
        reviewCount: 1
      })
    ).toBe("LLM 评估风险：LLM 评估复核率偏高，已切换为待审模式。 1 条候选观察等待确认。");

    expect(
      observeLoopHeartbeatNotice("", {
        failureCount: 0,
        sourceRunCount: 1,
        skippedSourceCount: 0,
        unmatchedCount: 2
      })
    ).toBe("2 条观察未匹配到现有假设，可能需要补充新假设。");
  });

  it("reports the specific attention reason for loops without runnable sources", () => {
    expect(
      loopResultAttentionMessage({
        failureCount: 1,
        sourceRunCount: 0,
        skippedSourceCount: 0,
        runs: [
          {
            errorMessage: "没有可运行来源：当前没有配置非手动且启用的采集来源。"
          }
        ]
      })
    ).toBe("没有可运行来源：当前没有配置非手动且启用的采集来源。");
  });

  it("reports the specific attention reason for loops without runnable queries", () => {
    expect(
      loopResultAttentionMessage({
        failureCount: 1,
        sourceRunCount: 0,
        skippedSourceCount: 0,
        runs: [
          {
            errorMessage: "没有可运行查询：当前没有活跃信念或当前信念下没有活跃/待结算假设。"
          }
        ]
      })
    ).toBe("没有可运行查询：当前没有活跃信念或当前信念下没有活跃/待结算假设。");
  });

  it("returns a failing process code only for one-shot loops that need backoff", () => {
    expect(
      observeLoopExitCode({
        failureCount: 1,
        sourceRunCount: 1,
        skippedSourceCount: 0
      })
    ).toBe(1);

    expect(
      observeLoopExitCode({
        failureCount: 0,
        sourceRunCount: 1,
        skippedSourceCount: 0,
        reviewCount: 1
      })
    ).toBe(0);

    expect(
      observeLoopExitCode({
        failureCount: 0,
        sourceRunCount: 1,
        skippedSourceCount: 0
      })
    ).toBe(0);
  });

  it("continues after task errors when configured and backs off before retrying", async () => {
    const waits: number[] = [];
    const errors: string[] = [];
    const calls: number[] = [];

    const results = await runRepeatedTask(
      async (iteration) => {
        calls.push(iteration);
        if (iteration === 1) throw new Error("temporary failure");
        return { ok: true };
      },
      {
        repeat: true,
        iterations: 2,
        intervalMs: 1000,
        failureBackoffMultiplier: 2,
        continueOnError: true,
        onError: async (error) => {
          errors.push(error instanceof Error ? error.message : String(error));
        },
        wait: async (ms) => {
          waits.push(ms);
        }
      }
    );

    expect(calls).toEqual([1, 2]);
    expect(errors).toEqual(["temporary failure"]);
    expect(waits).toEqual([2000]);
    expect(results).toEqual([{ ok: true }]);
  });

  it("reports repeat state with the next delay before waiting", async () => {
    const waits: number[] = [];
    const states: Array<{
      iteration: number;
      failed: boolean;
      consecutiveFailures: number;
      nextDelayMs?: number;
    }> = [];

    await runRepeatedTask(
      async (iteration) => ({ failureCount: iteration === 1 ? 1 : 0 }),
      {
        repeat: true,
        iterations: 2,
        intervalMs: 1000,
        failureBackoffMultiplier: 2,
        isFailure: (result) => result.failureCount > 0,
        onIterationComplete: async (state) => {
          states.push({
            iteration: state.iteration,
            failed: state.failed,
            consecutiveFailures: state.consecutiveFailures,
            nextDelayMs: state.nextDelayMs
          });
        },
        wait: async (ms) => {
          waits.push(ms);
        }
      }
    );

    expect(states).toEqual([
      { iteration: 1, failed: true, consecutiveFailures: 1, nextDelayMs: 2000 },
      { iteration: 2, failed: false, consecutiveFailures: 0, nextDelayMs: undefined }
    ]);
    expect(waits).toEqual([2000]);
  });

  it("rejects one-shot tasks that exceed the configured timeout", async () => {
    vi.useFakeTimers();
    try {
      const result = runWithTimeout(new Promise(() => {}), 1000, "observe run timed out");
      const assertion = expect(result).rejects.toThrow("observe run timed out");

      await vi.advanceTimersByTimeAsync(1000);

      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
