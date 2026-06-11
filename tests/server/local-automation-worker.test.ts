import { createEvidenceLoopWorkerController } from "@/server/automation/local-worker";
import type { WorldModelServices } from "@/server/services/types";

type Automation = WorldModelServices["automation"];

function createAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    runEvidenceLoop: async () => ({
      mode: "auto-apply",
      queryCount: 1,
      sourceRunCount: 1,
      itemCount: 1,
      deduplicatedCount: 0,
      candidateCount: 1,
      autoAppliedCount: 1,
      reviewCount: 0,
      failureCount: 0,
      queries: [],
      runs: []
    }),
    recordHeartbeat: async (input) => ({
      ...input,
      createdAt: input.heartbeatAt,
      updatedAt: input.heartbeatAt
    }),
    listHeartbeats: async () => [],
    ...overrides
  };
}

describe("local evidence loop worker", () => {
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
});
