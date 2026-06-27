import type { AutomationWorkerConfigRecord, EvidenceLoopOptions, WorldModelServices } from "@/server/services/types";
import { guardAutoApply, guardAutoApplyWithLlmEvaluation } from "@/server/automation/auto-apply-policy";
import { evidenceLoopResultAttentionMessage, evidenceLoopResultBackoffMessage } from "@/server/automation/evidence-loop-result";

type AutomationServices = Pick<WorldModelServices["automation"], "listHeartbeats" | "listWorkerConfigs" | "recordHeartbeat" | "runEvidenceLoop">;
type WorkerServices = AutomationServices | Pick<WorldModelServices, "automation" | "beliefs">;
type TimerHandle = unknown;

export type EvidenceLoopWorkerStartInput = {
  workerId?: string;
  intervalMs: number;
  initialDelayMs?: number;
  initialConsecutiveFailureCount?: number;
  failureBackoffMultiplier?: number;
  maxIntervalMs?: number;
  loopOptions: EvidenceLoopOptions;
  runImmediately?: boolean;
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

function normalizeConsecutiveFailureCount(count: number | undefined) {
  if (count === undefined || !Number.isFinite(count)) return 0;
  return Math.max(0, Math.floor(count));
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

function latestHeartbeatById(heartbeats: Awaited<ReturnType<AutomationServices["listHeartbeats"]>>) {
  const latest = new Map<string, (typeof heartbeats)[number]>();
  for (const heartbeat of heartbeats) {
    const existing = latest.get(heartbeat.id);
    if (!existing || heartbeat.heartbeatAt.getTime() > existing.heartbeatAt.getTime()) {
      latest.set(heartbeat.id, heartbeat);
    }
  }
  return latest;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function loopOptionsFromConfig(config: AutomationWorkerConfigRecord): EvidenceLoopOptions {
  return {
    reviewOnly: config.reviewOnly,
    candidateThreshold: config.candidateThreshold,
    autoConfirmThreshold: config.autoConfirmThreshold,
    maxQueries: config.maxQueries,
    maxSources: config.maxSources,
    beliefIds: config.beliefIds,
    sourceIds: config.sourceIds,
    maxObservations: config.maxObservations,
    bootstrapDefaultSources: config.bootstrapDefaultSources,
    forceAutoApply: config.forceAutoApply
  };
}

function hasFullWorldModelServices(services: WorkerServices): services is Pick<WorldModelServices, "automation" | "beliefs"> {
  return "automation" in services && "beliefs" in services;
}

function automationServices(services: WorkerServices): AutomationServices {
  return hasFullWorldModelServices(services) ? services.automation : services;
}

async function guardWorkerLoopOptions(services: WorkerServices, options: EvidenceLoopOptions) {
  if (hasFullWorldModelServices(services)) {
    return guardAutoApply(services as WorldModelServices, options);
  }
  return guardAutoApplyWithLlmEvaluation(options);
}

export function createEvidenceLoopWorkerController(dependencies: WorkerControllerDependencies = {}) {
  const now = dependencies.now ?? (() => new Date());
  const setTimer = dependencies.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
  const clearTimer = dependencies.clearTimer ?? ((timer: TimerHandle) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const workers = new Map<string, WorkerState>();

  async function recordHeartbeat(
    services: WorkerServices,
    state: WorkerState,
    input: { status: "RUNNING" | "IDLE" | "ERROR"; nextRunAt?: Date; lastNotice?: string; lastError?: string }
  ) {
    const automation = automationServices(services);
    await automation.recordHeartbeat({
      id: state.workerId,
      status: input.status,
      heartbeatAt: now(),
      nextRunAt: input.nextRunAt,
      intervalMs: state.intervalMs,
      consecutiveFailureCount: state.consecutiveFailureCount,
      lastNotice: input.lastNotice ?? "",
      lastError: input.lastError ?? ""
    });
  }

  async function runOnce(state: WorkerState, services: WorkerServices) {
    const automation = automationServices(services);
    if (state.stopped) return;
    state.running = true;
    let status: "RUNNING" | "ERROR" = "RUNNING";
    let lastNotice = "";
    let lastError = "";

    try {
      const guarded = await guardWorkerLoopOptions(services, state.loopOptions);
      lastNotice = guarded.notice;
      const result = await automation.runEvidenceLoop(guarded.options);
      const backoffMessage = evidenceLoopResultBackoffMessage(result);
      if (backoffMessage) {
        state.consecutiveFailureCount += 1;
        status = "ERROR";
        lastNotice = "";
        lastError = backoffMessage;
      } else {
        const attentionMessage = evidenceLoopResultAttentionMessage(result);
        state.consecutiveFailureCount = 0;
        lastNotice = [lastNotice, attentionMessage].filter(Boolean).join(" ");
      }
    } catch (error) {
      state.consecutiveFailureCount += 1;
      status = "ERROR";
      lastNotice = "";
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
    await recordHeartbeat(services, state, { status, nextRunAt: state.nextRunAt, lastNotice, lastError });
    state.timer = setTimer(() => {
      void runOnce(state, services);
    }, delayMs);
  }

  async function scheduleNextRun(state: WorkerState, services: WorkerServices, delayMs: number) {
    state.nextRunAt = new Date(now().getTime() + delayMs);
    await recordHeartbeat(services, state, { status: "RUNNING", nextRunAt: state.nextRunAt });
    state.timer = setTimer(() => {
      void runOnce(state, services);
    }, delayMs);
  }

  return {
    async start(input: EvidenceLoopWorkerStartInput, services: WorkerServices) {
      const workerId = input.workerId?.trim() || DEFAULT_WORKER_ID;
      await this.stop(workerId, services, { recordIdle: false });
      const intervalMs = normalizeIntervalMs(input.intervalMs);
      const state: WorkerState = {
        workerId,
        intervalMs,
        failureBackoffMultiplier: normalizeBackoffMultiplier(input.failureBackoffMultiplier),
        maxIntervalMs: normalizeMaxIntervalMs(intervalMs, input.maxIntervalMs),
        loopOptions: input.loopOptions,
        consecutiveFailureCount: normalizeConsecutiveFailureCount(input.initialConsecutiveFailureCount),
        stopped: false,
        running: false
      };
      workers.set(workerId, state);
      if (input.runImmediately === false) {
        await scheduleNextRun(state, services, input.initialDelayMs ?? state.intervalMs);
      } else {
        await recordHeartbeat(services, state, { status: "RUNNING" });
        await runOnce(state, services);
      }
      return this.listRuntime().find((worker) => worker.workerId === workerId);
    },
    async restoreEnabled(services: WorkerServices) {
      const automation = automationServices(services);
      const configs = await automation.listWorkerConfigs();
      const heartbeats = latestHeartbeatById(await automation.listHeartbeats());
      const referenceTime = now();
      for (const config of configs) {
        if (!config.enabled || workers.has(config.id)) continue;
        const heartbeat = heartbeats.get(config.id);
        const persistedNextRunAt = heartbeat?.nextRunAt;
        const overdue = persistedNextRunAt !== undefined && persistedNextRunAt.getTime() <= referenceTime.getTime();
        const initialDelayMs = persistedNextRunAt
          ? Math.max(0, persistedNextRunAt.getTime() - referenceTime.getTime())
          : undefined;
        await this.start(
          {
            workerId: config.id,
            intervalMs: config.intervalMs,
            initialDelayMs,
            initialConsecutiveFailureCount: heartbeat?.consecutiveFailureCount,
            failureBackoffMultiplier: config.failureBackoffMultiplier,
            maxIntervalMs: config.maxIntervalMs,
            loopOptions: loopOptionsFromConfig(config),
            runImmediately: overdue ? true : false
          },
          services
        );
      }
      return this.listRuntime();
    },
    async stop(workerId = DEFAULT_WORKER_ID, services: WorkerServices, options: { recordIdle?: boolean } = {}) {
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
      await recordHeartbeat(services, state, { status: "IDLE" });
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
