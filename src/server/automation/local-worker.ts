import type { AutomationWorkerConfigRecord, EvidenceLoopOptions, WorldModelServices } from "@/server/services/types";

type AutomationServices = Pick<WorldModelServices["automation"], "listWorkerConfigs" | "recordHeartbeat" | "runEvidenceLoop">;
type TimerHandle = unknown;

export type EvidenceLoopWorkerStartInput = {
  workerId?: string;
  intervalMs: number;
  failureBackoffMultiplier?: number;
  maxIntervalMs?: number;
  loopOptions: EvidenceLoopOptions;
};

export type LocalWorkerRuntime = {
  workerId: string;
  running: boolean;
  nextRunAt?: Date;
  consecutiveFailureCount: number;
};

type WorkerState = {
  workerId: string;
  intervalMs: number;
  failureBackoffMultiplier: number;
  maxIntervalMs: number;
  loopOptions: EvidenceLoopOptions;
  consecutiveFailureCount: number;
  stopped: boolean;
  running: boolean;
  nextRunAt?: Date;
  timer?: TimerHandle;
};

type WorkerControllerDependencies = {
  now?: () => Date;
  setTimer?: (callback: () => void, ms: number) => TimerHandle;
  clearTimer?: (timer: TimerHandle) => void;
};

const DEFAULT_WORKER_ID = "default";
const DEFAULT_FAILURE_BACKOFF_MULTIPLIER = 2;
const DEFAULT_MAX_INTERVAL_MS = 60 * 60 * 1000;
const MIN_INTERVAL_MS = 1000;

function normalizeIntervalMs(intervalMs: number) {
  if (!Number.isFinite(intervalMs)) return 15 * 60 * 1000;
  return Math.max(MIN_INTERVAL_MS, Math.floor(intervalMs));
}

function normalizeBackoffMultiplier(multiplier: number | undefined) {
  if (multiplier === undefined || !Number.isFinite(multiplier)) return DEFAULT_FAILURE_BACKOFF_MULTIPLIER;
  return Math.max(1, multiplier);
}

function normalizeMaxIntervalMs(intervalMs: number, maxIntervalMs: number | undefined) {
  if (maxIntervalMs === undefined || !Number.isFinite(maxIntervalMs)) return DEFAULT_MAX_INTERVAL_MS;
  return Math.max(intervalMs, Math.floor(maxIntervalMs));
}

function delayForFailures(input: {
  consecutiveFailures: number;
  intervalMs: number;
  failureBackoffMultiplier: number;
  maxIntervalMs: number;
}) {
  if (input.consecutiveFailures <= 0) return input.intervalMs;
  const delay = input.intervalMs * Math.pow(input.failureBackoffMultiplier, input.consecutiveFailures);
  return Math.min(input.maxIntervalMs, Math.floor(delay));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function loopOptionsFromConfig(config: AutomationWorkerConfigRecord): EvidenceLoopOptions {
  return {
    reviewOnly: config.reviewOnly,
    candidateThreshold: config.candidateThreshold,
    autoConfirmThreshold: config.autoConfirmThreshold,
    maxObservations: config.maxObservations,
    bootstrapDefaultSources: config.bootstrapDefaultSources,
    forceAutoApply: config.forceAutoApply
  };
}

export function createEvidenceLoopWorkerController(dependencies: WorkerControllerDependencies = {}) {
  const now = dependencies.now ?? (() => new Date());
  const setTimer = dependencies.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
  const clearTimer = dependencies.clearTimer ?? ((timer: TimerHandle) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const workers = new Map<string, WorkerState>();

  async function recordHeartbeat(automation: AutomationServices, state: WorkerState, input: { status: "RUNNING" | "IDLE" | "ERROR"; nextRunAt?: Date; lastError?: string }) {
    await automation.recordHeartbeat({
      id: state.workerId,
      status: input.status,
      heartbeatAt: now(),
      nextRunAt: input.nextRunAt,
      intervalMs: state.intervalMs,
      consecutiveFailureCount: state.consecutiveFailureCount,
      lastError: input.lastError ?? ""
    });
  }

  async function runOnce(state: WorkerState, automation: AutomationServices) {
    if (state.stopped) return;
    state.running = true;
    let status: "RUNNING" | "ERROR" = "RUNNING";
    let lastError = "";

    try {
      const result = await automation.runEvidenceLoop(state.loopOptions);
      if (result.failureCount > 0) {
        state.consecutiveFailureCount += 1;
        status = "ERROR";
        lastError = "One or more source runs failed.";
      } else {
        state.consecutiveFailureCount = 0;
      }
    } catch (error) {
      state.consecutiveFailureCount += 1;
      status = "ERROR";
      lastError = errorMessage(error);
    } finally {
      state.running = false;
    }

    if (state.stopped) return;
    const delayMs = delayForFailures({
      consecutiveFailures: state.consecutiveFailureCount,
      intervalMs: state.intervalMs,
      failureBackoffMultiplier: state.failureBackoffMultiplier,
      maxIntervalMs: state.maxIntervalMs
    });
    state.nextRunAt = new Date(now().getTime() + delayMs);
    await recordHeartbeat(automation, state, { status, nextRunAt: state.nextRunAt, lastError });
    state.timer = setTimer(() => {
      void runOnce(state, automation);
    }, delayMs);
  }

  return {
    async start(input: EvidenceLoopWorkerStartInput, automation: AutomationServices) {
      const workerId = input.workerId?.trim() || DEFAULT_WORKER_ID;
      await this.stop(workerId, automation, { recordIdle: false });
      const intervalMs = normalizeIntervalMs(input.intervalMs);
      const state: WorkerState = {
        workerId,
        intervalMs,
        failureBackoffMultiplier: normalizeBackoffMultiplier(input.failureBackoffMultiplier),
        maxIntervalMs: normalizeMaxIntervalMs(intervalMs, input.maxIntervalMs),
        loopOptions: input.loopOptions,
        consecutiveFailureCount: 0,
        stopped: false,
        running: false
      };
      workers.set(workerId, state);
      await recordHeartbeat(automation, state, { status: "RUNNING" });
      await runOnce(state, automation);
      return this.listRuntime().find((worker) => worker.workerId === workerId);
    },
    async restoreEnabled(automation: AutomationServices) {
      const configs = await automation.listWorkerConfigs();
      for (const config of configs) {
        if (!config.enabled || workers.has(config.id)) continue;
        await this.start(
          {
            workerId: config.id,
            intervalMs: config.intervalMs,
            failureBackoffMultiplier: config.failureBackoffMultiplier,
            maxIntervalMs: config.maxIntervalMs,
            loopOptions: loopOptionsFromConfig(config)
          },
          automation
        );
      }
      return this.listRuntime();
    },
    async stop(workerId = DEFAULT_WORKER_ID, automation: AutomationServices, options: { recordIdle?: boolean } = {}) {
      const normalizedWorkerId = workerId.trim() || DEFAULT_WORKER_ID;
      const existing = workers.get(normalizedWorkerId);
      if (existing?.timer) {
        clearTimer(existing.timer);
      }
      if (existing) {
        existing.stopped = true;
        workers.delete(normalizedWorkerId);
      }
      if (options.recordIdle === false) return;
      const state: WorkerState =
        existing ??
        ({
          workerId: normalizedWorkerId,
          intervalMs: 15 * 60 * 1000,
          failureBackoffMultiplier: DEFAULT_FAILURE_BACKOFF_MULTIPLIER,
          maxIntervalMs: DEFAULT_MAX_INTERVAL_MS,
          loopOptions: {},
          consecutiveFailureCount: 0,
          stopped: true,
          running: false
        } satisfies WorkerState);
      state.consecutiveFailureCount = 0;
      await recordHeartbeat(automation, state, { status: "IDLE" });
    },
    listRuntime(): LocalWorkerRuntime[] {
      return [...workers.values()].map((worker) => ({
        workerId: worker.workerId,
        running: !worker.stopped,
        nextRunAt: worker.nextRunAt,
        consecutiveFailureCount: worker.consecutiveFailureCount
      }));
    }
  };
}

type GlobalWithEvidenceWorker = typeof globalThis & {
  __worldModelEvidenceLoopWorker?: ReturnType<typeof createEvidenceLoopWorkerController>;
};

export function getEvidenceLoopWorkerController() {
  const globalForWorker = globalThis as GlobalWithEvidenceWorker;
  globalForWorker.__worldModelEvidenceLoopWorker ??= createEvidenceLoopWorkerController();
  return globalForWorker.__worldModelEvidenceLoopWorker;
}
