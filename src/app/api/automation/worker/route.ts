import { getEvidenceLoopWorkerController } from "@/server/automation/local-worker";
import { getWorldModelServices } from "@/server/services";
import { jsonError, jsonOk, readJson, verifyApiRequest } from "@/app/api/_utils";
import { guardAutoApply } from "@/server/automation/auto-apply-policy";
import type { AutomationWorkerConfigRecord, EvidenceLoopOptions } from "@/server/services/types";

type PersistedWorkerConfig = Omit<AutomationWorkerConfigRecord, "createdAt" | "updatedAt">;
type WorkerStartInput = Partial<PersistedWorkerConfig> & {
  runImmediately?: boolean;
};

const DEFAULT_WORKER_ID = "default";

function defaultWorkerConfig(id = DEFAULT_WORKER_ID): PersistedWorkerConfig {
  return {
    id,
    enabled: false,
    intervalMs: 900_000,
    failureBackoffMultiplier: 2,
    maxIntervalMs: 3_600_000,
    reviewOnly: false,
    maxQueries: 3,
    maxSources: 3,
    beliefIds: undefined,
    sourceIds: undefined,
    maxObservations: 20,
    candidateThreshold: 0.25,
    autoConfirmThreshold: 0.85,
    bootstrapDefaultSources: true,
    forceAutoApply: true,
    duplicateObservationCleanup: "REJECT",
    unmatchedObservationCleanup: "KEEP",
    lowImpactObservationCleanup: "KEEP"
  };
}

function persistableConfig(config: AutomationWorkerConfigRecord): PersistedWorkerConfig {
  return {
    id: config.id,
    enabled: config.enabled,
    intervalMs: config.intervalMs,
    failureBackoffMultiplier: config.failureBackoffMultiplier,
    maxIntervalMs: config.maxIntervalMs,
    reviewOnly: config.reviewOnly,
    maxQueries: config.maxQueries,
    maxSources: config.maxSources,
    beliefIds: config.beliefIds,
    sourceIds: config.sourceIds,
    maxObservations: config.maxObservations,
    candidateThreshold: config.candidateThreshold,
    autoConfirmThreshold: config.autoConfirmThreshold,
    bootstrapDefaultSources: config.bootstrapDefaultSources,
    forceAutoApply: config.forceAutoApply,
    duplicateObservationCleanup: config.duplicateObservationCleanup,
    unmatchedObservationCleanup: config.unmatchedObservationCleanup,
    lowImpactObservationCleanup: config.lowImpactObservationCleanup
  };
}

function workerId(value: unknown) {
  const id = typeof value === "string" ? value.trim() : "";
  return id || DEFAULT_WORKER_ID;
}

function startConfig(input: WorkerStartInput): PersistedWorkerConfig {
  const base = defaultWorkerConfig(workerId(input.id));
  return {
    ...base,
    ...input,
    id: base.id,
    enabled: true
  };
}

function loopOptionsFromConfig(config: PersistedWorkerConfig): EvidenceLoopOptions {
  return {
    reviewOnly: config.reviewOnly,
    maxQueries: config.maxQueries,
    maxSources: config.maxSources,
    beliefIds: config.beliefIds,
    sourceIds: config.sourceIds,
    maxObservations: config.maxObservations,
    candidateThreshold: config.candidateThreshold,
    autoConfirmThreshold: config.autoConfirmThreshold,
    bootstrapDefaultSources: config.bootstrapDefaultSources,
    forceAutoApply: config.forceAutoApply,
    duplicateObservationCleanup: config.duplicateObservationCleanup,
    unmatchedObservationCleanup: config.unmatchedObservationCleanup,
    lowImpactObservationCleanup: config.lowImpactObservationCleanup
  };
}

function formatWorkerRestoreError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return `自动化守护进程恢复失败：${message}`;
}

export async function GET(request: Request) {
  try {
    verifyApiRequest(request);
    const services = getWorldModelServices();
    const controller = getEvidenceLoopWorkerController();
    let restoreError: string | undefined;
    try {
      await controller.restoreEnabled(services);
    } catch (error) {
      restoreError = formatWorkerRestoreError(error);
    }
    const [configs, heartbeats] = await Promise.all([services.automation.listWorkerConfigs(), services.automation.listHeartbeats()]);
    return jsonOk({
      runtime: controller.listRuntime(),
      configs,
      heartbeats,
      ...(restoreError ? { restoreError } : {})
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJson<WorkerStartInput>(request);
    const { runImmediately, ...fields } = body;
    const services = getWorldModelServices();
    const controller = getEvidenceLoopWorkerController();
    const guarded = await guardAutoApply(services, startConfig(fields));
    const config = await services.automation.saveWorkerConfig(guarded.options);
    const runtime = await controller.start(
      {
        workerId: config.id,
        intervalMs: config.intervalMs,
        failureBackoffMultiplier: config.failureBackoffMultiplier,
        maxIntervalMs: config.maxIntervalMs,
        runImmediately: runImmediately ?? true,
        loopOptions: loopOptionsFromConfig(config)
      },
      services
    );
    return jsonOk(guarded.notice ? { config, runtime, notice: guarded.notice } : { config, runtime }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await readJson<{ workerId?: string }>(request);
    const id = workerId(body.workerId);
    const services = getWorldModelServices();
    const controller = getEvidenceLoopWorkerController();
    const existing = (await services.automation.listWorkerConfigs()).find((config) => config.id === id);
    const config = existing ? await services.automation.saveWorkerConfig({ ...persistableConfig(existing), enabled: false }) : null;
    await controller.stop(id, services);
    return jsonOk({ workerId: id, config });
  } catch (error) {
    return jsonError(error);
  }
}
