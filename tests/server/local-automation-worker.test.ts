import { createEvidenceLoopWorkerController } from "@/server/automation/local-worker";
import type { WorldModelServices } from "@/server/services/types";
import { vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadLlmEvaluationArtifact: vi.fn()
}));

vi.mock("@/server/training/llm-evaluation-artifact", () => ({
  loadLlmEvaluationArtifact: mocks.loadLlmEvaluationArtifact
}));

type Automation = WorldModelServices["automation"];

function createAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    runEvidenceLoop: async () => ({
      mode: "auto-apply",
      queryCount: 1,
      sourceRunCount: 1,
      itemCount: 1,
      reprocessedObservationCount: 0,
      deduplicatedCount: 0,
      candidateCount: 1,
      autoAppliedCount: 1,
      reviewCount: 0,
      lowImpactCount: 0,
      unmatchedCount: 0,
      failureCount: 0,
      skippedSourceCount: 0,
      skippedSources: [],
      queries: [],
      runs: []
    }),
    recordHeartbeat: async (input) => ({
      ...input,
      createdAt: input.heartbeatAt,
      updatedAt: input.heartbeatAt
    }),
    listHeartbeats: async () => [],
    saveWorkerConfig: async (input) => ({
      ...input,
      createdAt: new Date("2026-06-11T00:00:00.000Z"),
      updatedAt: new Date("2026-06-11T00:00:00.000Z")
    }),
    listWorkerConfigs: async () => [],
    ...overrides
  };
}

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

describe("local evidence loop worker", () => {
  beforeEach(() => {
    mocks.loadLlmEvaluationArtifact.mockReset();
    mocks.loadLlmEvaluationArtifact.mockResolvedValue(llmEvaluationArtifact());
  });

  it("starts a worker, runs one loop immediately, records heartbeat, and schedules the next run", async () => {
    const heartbeats: Array<Parameters<Automation["recordHeartbeat"]>[0]> = [];
    const loopOptions = { reviewOnly: true, maxObservations: 2 };
    const scheduled: Array<{ callback: () => void; ms: number; id: number }> = [];
    const controller = createEvidenceLoopWorkerController({
      now: () => new Date("2026-06-11T05:00:00.000Z"),
      setTimer: (callback, ms) => {
        const id = scheduled.length + 1;
        scheduled.push({ callback, ms, id });
        return id;
      },
      clearTimer: () => {}
    });
    const automation = createAutomation({
      recordHeartbeat: async (input) => {
        heartbeats.push(input);
        return { ...input, createdAt: input.heartbeatAt, updatedAt: input.heartbeatAt };
      }
    });

    await controller.start(
      {
        workerId: "default",
        intervalMs: 900_000,
        failureBackoffMultiplier: 2,
        maxIntervalMs: 3_600_000,
        loopOptions
      },
      automation
    );

    expect(heartbeats).toEqual([
      expect.objectContaining({
        id: "default",
        status: "RUNNING",
        nextRunAt: undefined,
        intervalMs: 900_000,
        consecutiveFailureCount: 0
      }),
      expect.objectContaining({
        id: "default",
        status: "RUNNING",
        nextRunAt: new Date("2026-06-11T05:15:00.000Z"),
        intervalMs: 900_000,
        consecutiveFailureCount: 0
      })
    ]);
    expect(scheduled).toEqual([expect.objectContaining({ ms: 900_000 })]);
    expect(controller.listRuntime()).toEqual([
      expect.objectContaining({
        workerId: "default",
        running: true,
        nextRunAt: new Date("2026-06-11T05:15:00.000Z")
      })
    ]);
  });

  it("downgrades forced auto-apply loop options before worker execution when LLM evaluation quality is risky", async () => {
    mocks.loadLlmEvaluationArtifact.mockResolvedValue(llmEvaluationArtifact({ reviewRequiredRate: 0.46 }));
    const loopOptionsSeen: Array<Parameters<Automation["runEvidenceLoop"]>[0]> = [];
    const controller = createEvidenceLoopWorkerController({
      now: () => new Date("2026-06-11T05:00:00.000Z"),
      setTimer: () => 42,
      clearTimer: () => {}
    });
    const automation = createAutomation({
      runEvidenceLoop: async (options) => {
        loopOptionsSeen.push(options);
        return {
          mode: "review-only",
          queryCount: 1,
          sourceRunCount: 1,
          itemCount: 1,
          reprocessedObservationCount: 0,
          deduplicatedCount: 0,
          candidateCount: 1,
          autoAppliedCount: 0,
          reviewCount: 1,
          lowImpactCount: 0,
          unmatchedCount: 0,
          failureCount: 0,
          skippedSourceCount: 0,
          skippedSources: [],
          queries: [],
          runs: []
        };
      }
    });

    await controller.start(
      {
        workerId: "default",
        intervalMs: 900_000,
        loopOptions: { reviewOnly: false, forceAutoApply: true, maxObservations: 2 }
      },
      automation
    );

    expect(loopOptionsSeen).toEqual([{ reviewOnly: true, forceAutoApply: false, maxObservations: 2 }]);
  });

  it("records the auto-apply downgrade reason without backing off the worker", async () => {
    mocks.loadLlmEvaluationArtifact.mockResolvedValue(llmEvaluationArtifact({ reviewRequiredRate: 0.46 }));
    const heartbeats: Array<Parameters<Automation["recordHeartbeat"]>[0]> = [];
    const scheduled: Array<{ ms: number; id: number }> = [];
    const controller = createEvidenceLoopWorkerController({
      now: () => new Date("2026-06-11T05:00:00.000Z"),
      setTimer: (_callback, ms) => {
        const id = scheduled.length + 1;
        scheduled.push({ ms, id });
        return id;
      },
      clearTimer: () => {}
    });
    const automation = createAutomation({
      runEvidenceLoop: async () => ({
        mode: "review-only",
        queryCount: 1,
        sourceRunCount: 1,
        itemCount: 1,
        reprocessedObservationCount: 0,
        deduplicatedCount: 0,
        candidateCount: 1,
        autoAppliedCount: 0,
        reviewCount: 1,
        lowImpactCount: 0,
        unmatchedCount: 0,
        failureCount: 0,
        skippedSourceCount: 0,
        skippedSources: [],
        queries: [],
        runs: []
      }),
      recordHeartbeat: async (input) => {
        heartbeats.push(input);
        return { ...input, createdAt: input.heartbeatAt, updatedAt: input.heartbeatAt };
      }
    });

    await controller.start(
      {
        workerId: "default",
        intervalMs: 60_000,
        failureBackoffMultiplier: 2,
        maxIntervalMs: 600_000,
        loopOptions: { reviewOnly: false, forceAutoApply: true }
      },
      automation
    );

    expect(heartbeats.at(-1)).toMatchObject({
      id: "default",
      status: "RUNNING",
      nextRunAt: new Date("2026-06-11T05:01:00.000Z"),
      consecutiveFailureCount: 0,
      lastNotice: "LLM 评估风险：LLM 评估复核率偏高，已切换为待审模式。 1 条候选观察等待确认。",
      lastError: ""
    });
    expect(scheduled).toEqual([expect.objectContaining({ ms: 60_000 })]);
  });

  it("downgrades forced auto-apply loop options before worker execution when no hypothesis is currently effective", async () => {
    const loopOptionsSeen: Array<Parameters<Automation["runEvidenceLoop"]>[0]> = [];
    const controller = createEvidenceLoopWorkerController({
      now: () => new Date("2026-06-11T05:00:00.000Z"),
      setTimer: () => 42,
      clearTimer: () => {}
    });
    const automation = createAutomation({
      runEvidenceLoop: async (options) => {
        loopOptionsSeen.push(options);
        return {
          mode: "review-only",
          queryCount: 0,
          sourceRunCount: 0,
          itemCount: 0,
          reprocessedObservationCount: 0,
          deduplicatedCount: 0,
          candidateCount: 0,
          autoAppliedCount: 0,
          reviewCount: 0,
          lowImpactCount: 0,
          unmatchedCount: 0,
          failureCount: 0,
          skippedSourceCount: 0,
          skippedSources: [],
          queries: [],
          runs: []
        };
      }
    });
    const services = {
      automation,
      beliefs: {
        listBeliefs: async () => [
          {
            id: "belief_ai_agents",
            code: "B-001",
            title: "AI agents",
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
                beliefId: "belief_ai_agents",
                proposition: "AI agents adoption accelerates next month",
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
    } as unknown as WorldModelServices;

    await controller.start(
      {
        workerId: "default",
        intervalMs: 900_000,
        loopOptions: { reviewOnly: false, forceAutoApply: true, maxObservations: 2 }
      },
      services
    );

    expect(loopOptionsSeen).toEqual([{ reviewOnly: true, forceAutoApply: false, maxObservations: 2 }]);
  });

  it("downgrades forced auto-apply loop options before worker execution when hypothesis coverage is one-sided", async () => {
    const loopOptionsSeen: Array<Parameters<Automation["runEvidenceLoop"]>[0]> = [];
    const controller = createEvidenceLoopWorkerController({
      now: () => new Date("2026-06-11T05:00:00.000Z"),
      setTimer: () => 42,
      clearTimer: () => {}
    });
    const automation = createAutomation({
      runEvidenceLoop: async (options) => {
        loopOptionsSeen.push(options);
        return {
          mode: "review-only",
          queryCount: 1,
          sourceRunCount: 1,
          itemCount: 1,
          reprocessedObservationCount: 0,
          deduplicatedCount: 0,
          candidateCount: 1,
          autoAppliedCount: 0,
          reviewCount: 1,
          lowImpactCount: 0,
          unmatchedCount: 0,
          failureCount: 0,
          skippedSourceCount: 0,
          skippedSources: [],
          queries: [],
          runs: []
        };
      }
    });
    const services = {
      automation,
      beliefs: {
        listBeliefs: async () => [
          {
            id: "belief_ai_agents",
            code: "B-001",
            title: "AI agents",
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
                id: "hypothesis_signal",
                code: "H-001",
                beliefId: "belief_ai_agents",
                proposition: "AI agents adoption accelerates",
                stance: "SUPPORTS",
                priorProbability: 0.5,
                currentProbability: 0.5,
                status: "ACTIVE",
                startsAt: undefined,
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
    } as unknown as WorldModelServices;

    await controller.start(
      {
        workerId: "default",
        intervalMs: 900_000,
        loopOptions: { reviewOnly: false, forceAutoApply: true, maxObservations: 2 }
      },
      services
    );

    expect(loopOptionsSeen).toEqual([{ reviewOnly: true, forceAutoApply: false, maxObservations: 2 }]);
  });

  it("backs off and records an error heartbeat when a loop run fails", async () => {
    const heartbeats: Array<Parameters<Automation["recordHeartbeat"]>[0]> = [];
    const scheduled: Array<{ ms: number; id: number }> = [];
    const controller = createEvidenceLoopWorkerController({
      now: () => new Date("2026-06-11T05:00:00.000Z"),
      setTimer: (_callback, ms) => {
        const id = scheduled.length + 1;
        scheduled.push({ ms, id });
        return id;
      },
      clearTimer: () => {}
    });
    const automation = createAutomation({
      runEvidenceLoop: async () => {
        throw new Error("source unavailable");
      },
      recordHeartbeat: async (input) => {
        heartbeats.push(input);
        return { ...input, createdAt: input.heartbeatAt, updatedAt: input.heartbeatAt };
      }
    });

    await controller.start(
      {
        workerId: "default",
        intervalMs: 60_000,
        failureBackoffMultiplier: 3,
        maxIntervalMs: 600_000,
        loopOptions: {}
      },
      automation
    );

    expect(heartbeats.at(-1)).toMatchObject({
      id: "default",
      status: "ERROR",
      nextRunAt: new Date("2026-06-11T05:03:00.000Z"),
      consecutiveFailureCount: 1,
      lastError: "source unavailable"
    });
    expect(scheduled).toEqual([expect.objectContaining({ ms: 180_000 })]);
  });

  it("backs off when every eligible source is skipped after repeated failures", async () => {
    const heartbeats: Array<Parameters<Automation["recordHeartbeat"]>[0]> = [];
    const scheduled: Array<{ ms: number; id: number }> = [];
    const controller = createEvidenceLoopWorkerController({
      now: () => new Date("2026-06-11T05:00:00.000Z"),
      setTimer: (_callback, ms) => {
        const id = scheduled.length + 1;
        scheduled.push({ ms, id });
        return id;
      },
      clearTimer: () => {}
    });
    const automation = createAutomation({
      runEvidenceLoop: async () => ({
        mode: "auto-apply",
        queryCount: 1,
        sourceRunCount: 0,
        skippedSourceCount: 1,
        skippedSources: [
          {
            sourceId: "source_flaky",
            sourceName: "Flaky source",
            reason: "CONSECUTIVE_FAILURES",
            consecutiveFailureCount: 3,
            latestError: "fetch failed"
          }
        ],
        itemCount: 0,
        reprocessedObservationCount: 0,
        deduplicatedCount: 0,
        candidateCount: 0,
        autoAppliedCount: 0,
        reviewCount: 0,
        lowImpactCount: 0,
        unmatchedCount: 0,
        failureCount: 1,
        queries: [],
        runs: [
          {
            id: "observation_run_skipped",
            status: "FAILED",
            startedAt: new Date("2026-06-11T05:00:00.000Z"),
            finishedAt: new Date("2026-06-11T05:00:00.000Z"),
            itemCount: 0,
            reprocessedObservationCount: 0,
            deduplicatedCount: 0,
            candidateCount: 0,
            autoAppliedCount: 0,
            reviewCount: 0,
            lowImpactCount: 0,
            unmatchedCount: 0,
            queryCount: 1,
            querySummary: [],
            errorMessage: "S-001 · Flaky source: CONSECUTIVE_FAILURES"
          }
        ]
      }),
      recordHeartbeat: async (input) => {
        heartbeats.push(input);
        return { ...input, createdAt: input.heartbeatAt, updatedAt: input.heartbeatAt };
      }
    });

    await controller.start(
      {
        workerId: "default",
        intervalMs: 60_000,
        failureBackoffMultiplier: 2,
        maxIntervalMs: 600_000,
        loopOptions: {}
      },
      automation
    );

    expect(heartbeats.at(-1)).toMatchObject({
      id: "default",
      status: "ERROR",
      nextRunAt: new Date("2026-06-11T05:02:00.000Z"),
      consecutiveFailureCount: 1,
      lastError: "所有可用来源都因连续失败被跳过。"
    });
    expect(scheduled).toEqual([expect.objectContaining({ ms: 120_000 })]);
  });

  it("records a low-increment attention message when every eligible source is skipped as stale", async () => {
    const heartbeats: Array<Parameters<Automation["recordHeartbeat"]>[0]> = [];
    const scheduled: Array<{ ms: number; id: number }> = [];
    const controller = createEvidenceLoopWorkerController({
      now: () => new Date("2026-06-11T05:00:00.000Z"),
      setTimer: (_callback, ms) => {
        const id = scheduled.length + 1;
        scheduled.push({ ms, id });
        return id;
      },
      clearTimer: () => {}
    });
    const automation = createAutomation({
      runEvidenceLoop: async () => ({
        mode: "auto-apply",
        queryCount: 1,
        sourceRunCount: 0,
        skippedSourceCount: 1,
        skippedSources: [
          {
            sourceId: "source_stale",
            sourceName: "Stale source",
            reason: "LOW_INCREMENT",
            consecutiveDuplicateOnlyCount: 3
          }
        ],
        itemCount: 0,
        reprocessedObservationCount: 0,
        deduplicatedCount: 0,
        candidateCount: 0,
        autoAppliedCount: 0,
        reviewCount: 0,
        lowImpactCount: 0,
        unmatchedCount: 0,
        failureCount: 0,
        queries: [],
        runs: []
      }),
      recordHeartbeat: async (input) => {
        heartbeats.push(input);
        return { ...input, createdAt: input.heartbeatAt, updatedAt: input.heartbeatAt };
      }
    });

    await controller.start(
      {
        workerId: "default",
        intervalMs: 60_000,
        failureBackoffMultiplier: 2,
        maxIntervalMs: 600_000,
        loopOptions: {}
      },
      automation
    );

    expect(heartbeats.at(-1)).toMatchObject({
      id: "default",
      status: "ERROR",
      lastError: "所有可用来源都因缺少新观察被跳过。"
    });
    expect(scheduled).toEqual([expect.objectContaining({ ms: 120_000 })]);
  });

  it("keeps polling at the normal interval when a loop leaves candidates waiting for review", async () => {
    const heartbeats: Array<Parameters<Automation["recordHeartbeat"]>[0]> = [];
    const scheduled: Array<{ ms: number; id: number }> = [];
    const controller = createEvidenceLoopWorkerController({
      now: () => new Date("2026-06-11T05:00:00.000Z"),
      setTimer: (_callback, ms) => {
        const id = scheduled.length + 1;
        scheduled.push({ ms, id });
        return id;
      },
      clearTimer: () => {}
    });
    const automation = createAutomation({
      runEvidenceLoop: async () => ({
        mode: "review-only",
        queryCount: 1,
        sourceRunCount: 1,
        itemCount: 2,
        reprocessedObservationCount: 0,
        deduplicatedCount: 0,
        candidateCount: 2,
        autoAppliedCount: 0,
        reviewCount: 2,
        lowImpactCount: 0,
        unmatchedCount: 0,
        failureCount: 0,
        skippedSourceCount: 0,
        skippedSources: [],
        queries: [],
        runs: []
      }),
      recordHeartbeat: async (input) => {
        heartbeats.push(input);
        return { ...input, createdAt: input.heartbeatAt, updatedAt: input.heartbeatAt };
      }
    });

    await controller.start(
      {
        workerId: "default",
        intervalMs: 60_000,
        failureBackoffMultiplier: 2,
        maxIntervalMs: 600_000,
        loopOptions: { reviewOnly: true }
      },
      automation
    );

    expect(heartbeats.at(-1)).toMatchObject({
      id: "default",
      status: "RUNNING",
      consecutiveFailureCount: 0,
      lastNotice: "2 条候选观察等待确认。",
      lastError: ""
    });
    expect(scheduled).toEqual([expect.objectContaining({ ms: 60_000 })]);
  });

  it("keeps the worker healthy when skipped sources are offset by reprocessed observations", async () => {
    const heartbeats: Array<Parameters<Automation["recordHeartbeat"]>[0]> = [];
    const scheduled: Array<{ ms: number; id: number }> = [];
    const controller = createEvidenceLoopWorkerController({
      now: () => new Date("2026-06-11T05:00:00.000Z"),
      setTimer: (_callback, ms) => {
        const id = scheduled.length + 1;
        scheduled.push({ ms, id });
        return id;
      },
      clearTimer: () => {}
    });
    const automation = createAutomation({
      runEvidenceLoop: async () => ({
        mode: "auto-apply",
        queryCount: 1,
        sourceRunCount: 0,
        skippedSourceCount: 1,
        skippedSources: [
          {
            sourceId: "source_stale",
            sourceName: "Stale source",
            reason: "LOW_INCREMENT",
            consecutiveDuplicateOnlyCount: 3
          }
        ],
        itemCount: 0,
        reprocessedObservationCount: 1,
        deduplicatedCount: 0,
        candidateCount: 1,
        autoAppliedCount: 1,
        reviewCount: 0,
        lowImpactCount: 0,
        unmatchedCount: 0,
        failureCount: 0,
        queries: [],
        runs: []
      }),
      recordHeartbeat: async (input) => {
        heartbeats.push(input);
        return { ...input, createdAt: input.heartbeatAt, updatedAt: input.heartbeatAt };
      }
    });

    await controller.start(
      {
        workerId: "default",
        intervalMs: 60_000,
        failureBackoffMultiplier: 2,
        maxIntervalMs: 600_000,
        loopOptions: {}
      },
      automation
    );

    expect(heartbeats.at(-1)).toMatchObject({
      id: "default",
      status: "RUNNING",
      consecutiveFailureCount: 0,
      lastError: ""
    });
    expect(scheduled).toEqual([expect.objectContaining({ ms: 60_000 })]);
  });

  it("stops a worker by clearing its timer and recording idle heartbeat", async () => {
    const cleared: number[] = [];
    const heartbeats: Array<Parameters<Automation["recordHeartbeat"]>[0]> = [];
    const controller = createEvidenceLoopWorkerController({
      now: () => new Date("2026-06-11T05:00:00.000Z"),
      setTimer: () => 42,
      clearTimer: (timerId) => {
        cleared.push(timerId as number);
      }
    });
    const automation = createAutomation({
      recordHeartbeat: async (input) => {
        heartbeats.push(input);
        return { ...input, createdAt: input.heartbeatAt, updatedAt: input.heartbeatAt };
      }
    });

    await controller.start({ workerId: "default", intervalMs: 60_000, loopOptions: {} }, automation);
    await controller.stop("default", automation);

    expect(cleared).toEqual([42]);
    expect(heartbeats.at(-1)).toMatchObject({
      id: "default",
      status: "IDLE",
      nextRunAt: undefined,
      consecutiveFailureCount: 0,
      lastError: ""
    });
    expect(controller.listRuntime()).toEqual([]);
  });

  it("restores enabled worker configs by scheduling them without immediately running a loop", async () => {
    let runCount = 0;
    const loopOptionsSeen: Array<Parameters<Automation["runEvidenceLoop"]>[0]> = [];
    const scheduled: Array<{ callback: () => void; ms: number; id: number }> = [];
    const heartbeats: Array<Parameters<Automation["recordHeartbeat"]>[0]> = [];
    const controller = createEvidenceLoopWorkerController({
      now: () => new Date("2026-06-11T05:00:00.000Z"),
      setTimer: (callback, ms) => {
        const id = scheduled.length + 1;
        scheduled.push({ callback, ms, id });
        return id;
      },
      clearTimer: () => {}
    });
    const automation = createAutomation({
      recordHeartbeat: async (input) => {
        heartbeats.push(input);
        return { ...input, createdAt: input.heartbeatAt, updatedAt: input.heartbeatAt };
      },
      runEvidenceLoop: async (options) => {
        runCount += 1;
        loopOptionsSeen.push(options);
        return {
          mode: "auto-apply",
          queryCount: 1,
          sourceRunCount: 1,
          itemCount: 1,
          reprocessedObservationCount: 0,
          deduplicatedCount: 0,
          candidateCount: 1,
          autoAppliedCount: 1,
          reviewCount: 0,
          lowImpactCount: 0,
          unmatchedCount: 0,
          failureCount: 0,
          skippedSourceCount: 0,
          skippedSources: [],
          queries: [],
          runs: []
        };
      },
      listWorkerConfigs: async () => [
        {
          id: "default",
          enabled: true,
          intervalMs: 120_000,
          failureBackoffMultiplier: 2,
          maxIntervalMs: 600_000,
          reviewOnly: true,
          maxQueries: 3,
          maxSources: 2,
          beliefIds: ["belief_ai_agents"],
          sourceIds: ["source_github"],
          maxObservations: 5,
          candidateThreshold: 0.2,
          autoConfirmThreshold: 0.8,
          bootstrapDefaultSources: true,
          forceAutoApply: false,
          createdAt: new Date("2026-06-11T00:00:00.000Z"),
          updatedAt: new Date("2026-06-11T00:00:00.000Z")
        },
        {
          id: "disabled",
          enabled: false,
          intervalMs: 60_000,
          failureBackoffMultiplier: 2,
          maxIntervalMs: 600_000,
          reviewOnly: true,
          maxObservations: undefined,
          candidateThreshold: undefined,
          autoConfirmThreshold: undefined,
          bootstrapDefaultSources: true,
          forceAutoApply: false,
          createdAt: new Date("2026-06-11T00:00:00.000Z"),
          updatedAt: new Date("2026-06-11T00:00:00.000Z")
        }
      ]
    });

    await controller.restoreEnabled(automation);
    await controller.restoreEnabled(automation);

    expect(runCount).toBe(0);
    expect(heartbeats).toEqual([
      expect.objectContaining({
        id: "default",
        status: "RUNNING",
        nextRunAt: new Date("2026-06-11T05:02:00.000Z"),
        consecutiveFailureCount: 0
      })
    ]);
    expect(scheduled).toEqual([expect.objectContaining({ ms: 120_000 })]);
    expect(controller.listRuntime()).toEqual([
      expect.objectContaining({
        workerId: "default",
        running: true,
        nextRunAt: new Date("2026-06-11T05:02:00.000Z")
      })
    ]);

    scheduled[0].callback();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(loopOptionsSeen).toEqual([
      expect.objectContaining({
        reviewOnly: true,
        maxQueries: 3,
        maxSources: 2,
        beliefIds: ["belief_ai_agents"],
        sourceIds: ["source_github"],
        maxObservations: 5,
        candidateThreshold: 0.2,
        autoConfirmThreshold: 0.8,
        bootstrapDefaultSources: true,
        forceAutoApply: false
      })
    ]);
  });

  it("runs an enabled worker immediately on restore when its persisted next run is overdue", async () => {
    let runCount = 0;
    const scheduled: Array<{ callback: () => void; ms: number; id: number }> = [];
    const heartbeats: Array<Parameters<Automation["recordHeartbeat"]>[0]> = [];
    const controller = createEvidenceLoopWorkerController({
      now: () => new Date("2026-06-11T05:00:00.000Z"),
      setTimer: (callback, ms) => {
        const id = scheduled.length + 1;
        scheduled.push({ callback, ms, id });
        return id;
      },
      clearTimer: () => {}
    });
    const automation = createAutomation({
      recordHeartbeat: async (input) => {
        heartbeats.push(input);
        return { ...input, createdAt: input.heartbeatAt, updatedAt: input.heartbeatAt };
      },
      runEvidenceLoop: async () => {
        runCount += 1;
        return {
          mode: "auto-apply",
          queryCount: 1,
          sourceRunCount: 1,
          itemCount: 1,
          reprocessedObservationCount: 0,
          deduplicatedCount: 0,
          candidateCount: 1,
          autoAppliedCount: 1,
          reviewCount: 0,
          lowImpactCount: 0,
          unmatchedCount: 0,
          failureCount: 0,
          skippedSourceCount: 0,
          skippedSources: [],
          queries: [],
          runs: []
        };
      },
      listWorkerConfigs: async () => [
        {
          id: "default",
          enabled: true,
          intervalMs: 120_000,
          failureBackoffMultiplier: 2,
          maxIntervalMs: 600_000,
          reviewOnly: false,
          maxObservations: 5,
          candidateThreshold: 0.2,
          autoConfirmThreshold: 0.8,
          bootstrapDefaultSources: true,
          forceAutoApply: true,
          createdAt: new Date("2026-06-11T00:00:00.000Z"),
          updatedAt: new Date("2026-06-11T00:00:00.000Z")
        }
      ],
      listHeartbeats: async () => [
        {
          id: "default",
          status: "RUNNING",
          heartbeatAt: new Date("2026-06-11T04:57:00.000Z"),
          nextRunAt: new Date("2026-06-11T04:59:00.000Z"),
          intervalMs: 120_000,
          consecutiveFailureCount: 0,
          lastNotice: "",
          lastError: "",
          createdAt: new Date("2026-06-11T04:57:00.000Z"),
          updatedAt: new Date("2026-06-11T04:57:00.000Z")
        }
      ]
    });

    await controller.restoreEnabled(automation);

    expect(runCount).toBe(1);
    expect(heartbeats).toEqual([
      expect.objectContaining({
        id: "default",
        status: "RUNNING",
        nextRunAt: undefined
      }),
      expect.objectContaining({
        id: "default",
        status: "RUNNING",
        nextRunAt: new Date("2026-06-11T05:02:00.000Z"),
        consecutiveFailureCount: 0
      })
    ]);
    expect(scheduled).toEqual([expect.objectContaining({ ms: 120_000 })]);
  });

  it("restores an enabled worker with the remaining delay when its persisted next run is still pending", async () => {
    let runCount = 0;
    const scheduled: Array<{ callback: () => void; ms: number; id: number }> = [];
    const heartbeats: Array<Parameters<Automation["recordHeartbeat"]>[0]> = [];
    const controller = createEvidenceLoopWorkerController({
      now: () => new Date("2026-06-11T05:00:00.000Z"),
      setTimer: (callback, ms) => {
        const id = scheduled.length + 1;
        scheduled.push({ callback, ms, id });
        return id;
      },
      clearTimer: () => {}
    });
    const automation = createAutomation({
      recordHeartbeat: async (input) => {
        heartbeats.push(input);
        return { ...input, createdAt: input.heartbeatAt, updatedAt: input.heartbeatAt };
      },
      runEvidenceLoop: async () => {
        runCount += 1;
        return {
          mode: "auto-apply",
          queryCount: 1,
          sourceRunCount: 1,
          itemCount: 1,
          reprocessedObservationCount: 0,
          deduplicatedCount: 0,
          candidateCount: 1,
          autoAppliedCount: 1,
          reviewCount: 0,
          lowImpactCount: 0,
          unmatchedCount: 0,
          failureCount: 0,
          skippedSourceCount: 0,
          skippedSources: [],
          queries: [],
          runs: []
        };
      },
      listWorkerConfigs: async () => [
        {
          id: "default",
          enabled: true,
          intervalMs: 120_000,
          failureBackoffMultiplier: 2,
          maxIntervalMs: 600_000,
          reviewOnly: true,
          maxObservations: 5,
          candidateThreshold: 0.2,
          autoConfirmThreshold: 0.8,
          bootstrapDefaultSources: true,
          forceAutoApply: false,
          createdAt: new Date("2026-06-11T00:00:00.000Z"),
          updatedAt: new Date("2026-06-11T00:00:00.000Z")
        }
      ],
      listHeartbeats: async () => [
        {
          id: "default",
          status: "RUNNING",
          heartbeatAt: new Date("2026-06-11T04:59:00.000Z"),
          nextRunAt: new Date("2026-06-11T05:00:45.000Z"),
          intervalMs: 120_000,
          consecutiveFailureCount: 0,
          lastNotice: "",
          lastError: "",
          createdAt: new Date("2026-06-11T04:59:00.000Z"),
          updatedAt: new Date("2026-06-11T04:59:00.000Z")
        }
      ]
    });

    await controller.restoreEnabled(automation);

    expect(runCount).toBe(0);
    expect(heartbeats).toEqual([
      expect.objectContaining({
        id: "default",
        status: "RUNNING",
        nextRunAt: new Date("2026-06-11T05:00:45.000Z")
      })
    ]);
    expect(scheduled).toEqual([expect.objectContaining({ ms: 45_000 })]);
  });

  it("restores the latest consecutive failure count with a pending enabled worker", async () => {
    const scheduled: Array<{ callback: () => void; ms: number; id: number }> = [];
    const heartbeats: Array<Parameters<Automation["recordHeartbeat"]>[0]> = [];
    const controller = createEvidenceLoopWorkerController({
      now: () => new Date("2026-06-11T05:00:00.000Z"),
      setTimer: (callback, ms) => {
        const id = scheduled.length + 1;
        scheduled.push({ callback, ms, id });
        return id;
      },
      clearTimer: () => {}
    });
    const automation = createAutomation({
      recordHeartbeat: async (input) => {
        heartbeats.push(input);
        return { ...input, createdAt: input.heartbeatAt, updatedAt: input.heartbeatAt };
      },
      listWorkerConfigs: async () => [
        {
          id: "default",
          enabled: true,
          intervalMs: 120_000,
          failureBackoffMultiplier: 2,
          maxIntervalMs: 600_000,
          reviewOnly: true,
          maxObservations: 5,
          candidateThreshold: 0.2,
          autoConfirmThreshold: 0.8,
          bootstrapDefaultSources: true,
          forceAutoApply: false,
          createdAt: new Date("2026-06-11T00:00:00.000Z"),
          updatedAt: new Date("2026-06-11T00:00:00.000Z")
        }
      ],
      listHeartbeats: async () => [
        {
          id: "default",
          status: "ERROR",
          heartbeatAt: new Date("2026-06-11T04:59:00.000Z"),
          nextRunAt: new Date("2026-06-11T05:00:45.000Z"),
          intervalMs: 120_000,
          consecutiveFailureCount: 2,
          lastNotice: "",
          lastError: "source unavailable",
          createdAt: new Date("2026-06-11T04:59:00.000Z"),
          updatedAt: new Date("2026-06-11T04:59:00.000Z")
        }
      ]
    });

    await controller.restoreEnabled(automation);

    expect(heartbeats).toEqual([
      expect.objectContaining({
        id: "default",
        status: "RUNNING",
        nextRunAt: new Date("2026-06-11T05:00:45.000Z"),
        consecutiveFailureCount: 2
      })
    ]);
    expect(controller.listRuntime()).toEqual([
      expect.objectContaining({
        workerId: "default",
        running: true,
        nextRunAt: new Date("2026-06-11T05:00:45.000Z"),
        consecutiveFailureCount: 2
      })
    ]);
    expect(scheduled).toEqual([expect.objectContaining({ ms: 45_000 })]);
  });
});
