import { deduplicateObservation } from "@/domain/dedupe";
import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import { pathToFileURL } from "node:url";
import { guardAutoApply, guardAutoApplyWithLlmEvaluation } from "@/server/automation/auto-apply-policy";
import {
  createDryRunSourceServices,
  runConfiguredSourceDryRuns as runConfiguredSourceDryRunsCore,
  runObserveLoopDryRun as runObserveLoopDryRunCore,
  type ConfiguredSourceDryRunDependencies,
  type DryRunSourceServices,
  type EvidenceLoopDryRunOptions
} from "@/server/automation/evidence-loop-dry-run";
import {
  evidenceLoopResultAttentionMessage,
  evidenceLoopResultNeedsAttention,
  evidenceLoopResultNeedsBackoff
} from "@/server/automation/evidence-loop-result";
import { createReadableCodes, readableCode } from "@/lib/world-model-display";
import { createConfiguredWorldModelServices } from "@/server/services/configured";
import { createPrismaWorldModelStore } from "@/server/services/prisma-store";
import { createSourceAdapter, supportedSourceKinds, type RawObservation } from "@/server/sources/adapters";
import type {
  EvidenceLoopOptions,
  ObservationSourceKind,
  ObservationSourceRecord,
  RunSourceOptions,
  AutomationWorkerConfigRecord,
  WorldModelServices
} from "@/server/services/types";

config({ path: ".env.local" });
config();

const DEFAULT_REPEAT_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_FAILURE_BACKOFF_MULTIPLIER = 2;
const DEFAULT_MAX_REPEAT_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_ONESHOT_TIMEOUT_MS = 120 * 1000;
const DEFAULT_WORKER_ID = "default";

function arg(name: string, argv = process.argv) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function numberArg(name: string, argv = process.argv) {
  const value = arg(name, argv);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function positiveIntegerArg(name: string, argv = process.argv) {
  const value = numberArg(name, argv);
  if (value === undefined || value < 1) return undefined;
  return Math.floor(value);
}

function intervalMsArg(argv = process.argv) {
  const seconds = numberArg("--interval-seconds", argv);
  if (seconds === undefined || seconds < 0) return DEFAULT_REPEAT_INTERVAL_MS;
  return Math.floor(seconds * 1000);
}

function failureBackoffMultiplierArg(argv = process.argv) {
  const multiplier = numberArg("--failure-backoff-multiplier", argv);
  if (multiplier === undefined || multiplier < 1) return DEFAULT_FAILURE_BACKOFF_MULTIPLIER;
  return multiplier;
}

function maxIntervalMsArg(intervalMs: number, argv = process.argv) {
  const seconds = numberArg("--max-interval-seconds", argv);
  const maxIntervalMs =
    seconds === undefined || seconds < 0 ? DEFAULT_MAX_REPEAT_INTERVAL_MS : Math.floor(seconds * 1000);
  return Math.max(intervalMs, maxIntervalMs);
}

function timeoutMsArg(argv = process.argv) {
  const seconds = numberArg("--timeout-seconds", argv);
  if (seconds === undefined) return DEFAULT_ONESHOT_TIMEOUT_MS;
  if (seconds <= 0) return undefined;
  return Math.floor(seconds * 1000);
}

function kindFromArg(value: string | undefined): ObservationSourceKind {
  const normalized = (value ?? "RSS").toUpperCase().replaceAll("-", "_");
  if (supportedSourceKinds.includes(normalized as ObservationSourceKind)) {
    return normalized as ObservationSourceKind;
  }
  throw new Error(`Unsupported adapter kind: ${value}`);
}

function countDuplicates(observations: RawObservation[]) {
  const seen: Array<RawObservation & { id: string; observedAt: Date }> = [];
  let duplicateCount = 0;
  for (const observation of observations) {
    const decision = deduplicateObservation({ ...observation, observedAt: new Date() }, seen);
    if (decision.duplicate) duplicateCount += 1;
    seen.push({ ...observation, id: `dry-${seen.length}`, observedAt: new Date() });
  }
  return duplicateCount;
}

export type ObserveCliOptions = {
  dryRun: boolean;
  loop: boolean;
  reviewOnly: boolean;
  bootstrapDefaultSources: boolean;
  forceAutoApply: boolean;
  repeat: boolean;
  intervalMs: number;
  failureBackoffMultiplier: number;
  maxIntervalMs: number;
  timeoutMs?: number;
  workerId: string;
  useWorkerConfig: boolean;
  iterations?: number;
  beliefId?: string;
  sourceId?: string;
  runAllSources: boolean;
  kind: ObservationSourceKind;
  url?: string;
  name?: string;
  credentialRef?: string;
  loopOptions: EvidenceLoopOptions;
};

export function parseObserveArgs(argv = process.argv): ObserveCliOptions {
  const dryRun = argv.includes("--dry-run");
  const loop = argv.includes("--loop");
  const reviewOnly = dryRun || argv.includes("--review-only");
  const beliefId = arg("--belief", argv) ?? arg("--belief-id", argv);
  const sourceId = arg("--source", argv);
  const runAllSources = argv.includes("--all");
  const bootstrapDefaultSources =
    argv.includes("--bootstrap-default-sources") || (loop && !sourceId && !argv.includes("--no-bootstrap-default-sources"));
  const forceAutoApply = !dryRun && argv.includes("--force-auto-apply");
  const repeat = argv.includes("--repeat") || argv.includes("--watch");
  const intervalMs = intervalMsArg(argv);
  const useWorkerConfig = argv.includes("--use-worker-config");
  const defaultReviewOnlySmokeBounds = loop && reviewOnly && !repeat && !beliefId && !sourceId && !runAllSources;
  const maxSources = positiveIntegerArg("--max-sources", argv) ?? (defaultReviewOnlySmokeBounds ? 1 : undefined);
  const maxQueries = positiveIntegerArg("--max-queries", argv) ?? (defaultReviewOnlySmokeBounds ? 1 : undefined);
  const maxObservations = positiveIntegerArg("--max-observations", argv) ?? (defaultReviewOnlySmokeBounds ? 1 : undefined);

  return {
    dryRun,
    loop,
    reviewOnly,
    bootstrapDefaultSources,
    forceAutoApply,
    repeat,
    intervalMs,
    workerId: arg("--worker-id", argv) ?? DEFAULT_WORKER_ID,
    useWorkerConfig,
    failureBackoffMultiplier: failureBackoffMultiplierArg(argv),
    maxIntervalMs: maxIntervalMsArg(intervalMs, argv),
    timeoutMs: timeoutMsArg(argv),
    iterations: positiveIntegerArg("--iterations", argv),
    beliefId,
    sourceId,
    runAllSources,
    kind: kindFromArg(arg("--adapter", argv) ?? arg("--kind", argv)),
    url: arg("--url", argv),
    name: arg("--name", argv),
    credentialRef: arg("--credential-ref", argv),
    loopOptions: {
      reviewOnly,
      beliefIds: beliefId ? [beliefId] : undefined,
      sourceIds: sourceId ? [sourceId] : undefined,
      maxObservations,
      maxSources,
      maxQueries,
      candidateThreshold: numberArg("--candidate-threshold", argv),
      autoConfirmThreshold: numberArg("--threshold", argv),
      bootstrapDefaultSources,
      forceAutoApply
    }
  };
}

type ObserveSelectorServices = Pick<WorldModelServices, "beliefs" | "sources">;

function selectorLooksLikeReadableCode(value: string, prefix: string) {
  return new RegExp(`^${prefix}-\\d+$`, "i").test(value.trim());
}

function resolveReadableSelector<T extends { id: string }>(
  records: T[],
  value: string,
  input: {
    prefix: string;
    label: string;
    dateOf: (record: T) => unknown;
  }
) {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (records.some((record) => record.id === trimmed)) return trimmed;

  const codes = createReadableCodes(records, input.prefix, input.dateOf);
  const normalizedCode = trimmed.toUpperCase();
  const match = records.find((record) => readableCode(codes, record.id, input.prefix) === normalizedCode);
  if (match) return match.id;

  if (selectorLooksLikeReadableCode(trimmed, input.prefix)) {
    throw new Error(`${input.label} not found: ${trimmed}`);
  }
  return trimmed;
}

export async function resolveObserveReadableSelectors(
  services: ObserveSelectorServices,
  options: ObserveCliOptions
): Promise<ObserveCliOptions> {
  const resolvedOptions: ObserveCliOptions = {
    ...options,
    loopOptions: { ...options.loopOptions }
  };

  if (options.beliefId || options.loopOptions.beliefIds?.length) {
    const beliefs = await services.beliefs.listBeliefs();
    const resolveBelief = (value: string) =>
      resolveReadableSelector(beliefs, value, {
        prefix: "B",
        label: "Belief",
        dateOf: (belief) => belief.createdAt
      });
    resolvedOptions.beliefId = options.beliefId ? resolveBelief(options.beliefId) : undefined;
    resolvedOptions.loopOptions.beliefIds = options.loopOptions.beliefIds?.map(resolveBelief);
  }

  if (options.sourceId || options.loopOptions.sourceIds?.length) {
    const sources = await services.sources.listSources();
    const resolveSource = (value: string) =>
      resolveReadableSelector(sources, value, {
        prefix: "S",
        label: "Source",
        dateOf: (source) => source.createdAt
      });
    resolvedOptions.sourceId = options.sourceId ? resolveSource(options.sourceId) : undefined;
    resolvedOptions.loopOptions.sourceIds = options.loopOptions.sourceIds?.map(resolveSource);
  }

  return resolvedOptions;
}

function loopOptionsFromWorkerConfig(config: AutomationWorkerConfigRecord): EvidenceLoopOptions {
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
    forceAutoApply: config.forceAutoApply
  };
}

export function applyWorkerConfigToObserveOptions(options: ObserveCliOptions, config: AutomationWorkerConfigRecord): ObserveCliOptions {
  if (!config.enabled) {
    throw new Error(`Worker config is disabled: ${config.id}`);
  }

  return {
    ...options,
    workerId: config.id,
    reviewOnly: config.reviewOnly,
    forceAutoApply: config.forceAutoApply,
    intervalMs: config.intervalMs,
    failureBackoffMultiplier: config.failureBackoffMultiplier,
    maxIntervalMs: Math.max(config.intervalMs, config.maxIntervalMs),
    loopOptions: loopOptionsFromWorkerConfig(config)
  };
}

export function guardObserveLoopOptions(loopOptions: EvidenceLoopOptions, services?: Pick<WorldModelServices, "beliefs">) {
  if (services) return guardAutoApply(services as WorldModelServices, loopOptions);
  return guardAutoApplyWithLlmEvaluation(loopOptions);
}

export async function guardObserveSourceOptions(
  runOptions: RunSourceOptions,
  services?: Pick<WorldModelServices, "beliefs">,
  sourceAutoConfirm = false
) {
  const directGuard = services
    ? await guardAutoApply(services as WorldModelServices, runOptions)
    : await guardAutoApplyWithLlmEvaluation(runOptions);
  if (!services || !sourceAutoConfirm || directGuard.options.reviewOnly || directGuard.options.forceAutoApply) {
    return directGuard;
  }

  const sourceDefaultGuard = await guardAutoApply(services as WorldModelServices, {
    ...directGuard.options,
    forceAutoApply: true
  });
  if (!sourceDefaultGuard.options.reviewOnly) {
    return directGuard;
  }

  return {
    options: {
      ...directGuard.options,
      reviewOnly: true,
      forceAutoApply: false
    },
    notice: sourceDefaultGuard.notice
  };
}

export function observeReviewSourceRunOptions(options: ObserveCliOptions): RunSourceOptions {
  return {
    reviewOnly: true,
    beliefIds: options.loopOptions.beliefIds,
    candidateThreshold: options.loopOptions.candidateThreshold,
    autoConfirmThreshold: options.loopOptions.autoConfirmThreshold,
    maxQueries: options.loopOptions.maxQueries,
    maxObservations: options.loopOptions.maxObservations
  };
}

export function observeWriteSourceRunOptions(options: ObserveCliOptions): RunSourceOptions {
  return {
    beliefIds: options.loopOptions.beliefIds,
    candidateThreshold: options.loopOptions.candidateThreshold,
    autoConfirmThreshold: options.loopOptions.autoConfirmThreshold,
    forceAutoApply: options.forceAutoApply,
    maxQueries: options.loopOptions.maxQueries,
    maxObservations: options.loopOptions.maxObservations
  };
}

function observeDryRunOptions(options: ObserveCliOptions): EvidenceLoopDryRunOptions {
  return {
    beliefIds: options.loopOptions.beliefIds,
    sourceIds: options.loopOptions.sourceIds,
    maxQueries: options.loopOptions.maxQueries,
    maxSources: options.loopOptions.maxSources,
    maxObservations: options.loopOptions.maxObservations,
    bootstrapDefaultSources: options.loopOptions.bootstrapDefaultSources,
    timeoutMs: options.timeoutMs
  };
}

export async function runConfiguredSourceDryRuns(
  sources: ObservationSourceRecord[],
  services: DryRunSourceServices,
  options: ObserveCliOptions,
  dependencies: ConfiguredSourceDryRunDependencies = {}
) {
  return runConfiguredSourceDryRunsCore(sources, services, observeDryRunOptions(options), dependencies);
}

export async function runObserveLoopDryRun(
  configuredSources: ObservationSourceRecord[],
  services: DryRunSourceServices,
  options: ObserveCliOptions,
  dependencies: ConfiguredSourceDryRunDependencies = {}
) {
  return runObserveLoopDryRunCore(configuredSources, services, observeDryRunOptions(options), dependencies);
}

type DryRunSourceCatalogServices = Pick<WorldModelServices["sources"], "createMissingPresets" | "listSources">;

export async function listConfiguredSourcesForLoopDryRun(
  services: DryRunSourceCatalogServices,
  options: ObserveCliOptions
) {
  if (options.loopOptions.bootstrapDefaultSources && !options.loopOptions.sourceIds?.length) {
    await services.createMissingPresets();
  }
  return services.listSources();
}

export async function runWithTimeout<T>(task: Promise<T>, timeoutMs: number | undefined, message: string): Promise<T> {
  if (timeoutMs === undefined) return task;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutTask = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
  });
  try {
    return await Promise.race([task, timeoutTask]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export type RepeatedTaskOptions<T = unknown> = {
  repeat?: boolean;
  iterations?: number;
  intervalMs?: number;
  failureBackoffMultiplier?: number;
  maxIntervalMs?: number;
  collectResults?: boolean;
  continueOnError?: boolean;
  isFailure?: (result: T) => boolean;
  onError?: (error: unknown, iteration: number) => void | Promise<void>;
  onIterationComplete?: (state: {
    iteration: number;
    result?: T;
    error?: unknown;
    failed: boolean;
    consecutiveFailures: number;
    nextDelayMs?: number;
  }) => void | Promise<void>;
  wait?: (ms: number) => Promise<void>;
};

function waitMs(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function delayForFailures(input: {
  consecutiveFailures: number;
  intervalMs: number;
  failureBackoffMultiplier: number;
  maxIntervalMs: number;
}) {
  if (input.consecutiveFailures <= 0) return input.intervalMs;
  const multiplier = Math.max(1, input.failureBackoffMultiplier);
  const delay = input.intervalMs * Math.pow(multiplier, input.consecutiveFailures);
  return Math.min(input.maxIntervalMs, Math.floor(delay));
}

export async function runRepeatedTask<T>(
  task: (iteration: number) => Promise<T>,
  options: RepeatedTaskOptions<T> = {}
): Promise<T[]> {
  const repeat = options.repeat ?? false;
  const intervalMs = Math.max(0, options.intervalMs ?? DEFAULT_REPEAT_INTERVAL_MS);
  const failureBackoffMultiplier = options.failureBackoffMultiplier ?? DEFAULT_FAILURE_BACKOFF_MULTIPLIER;
  const maxIntervalMs = Math.max(intervalMs, options.maxIntervalMs ?? DEFAULT_MAX_REPEAT_INTERVAL_MS);
  const collectResults = options.collectResults ?? true;
  const wait = options.wait ?? waitMs;
  const results: T[] = [];
  let iteration = 1;
  let consecutiveFailures = 0;

  while (options.iterations === undefined || iteration <= options.iterations) {
    let result: T | undefined;
    let errorForState: unknown;
    let failed = false;
    try {
      result = await task(iteration);
      failed = options.isFailure?.(result) ?? false;
      consecutiveFailures = failed ? consecutiveFailures + 1 : 0;
      if (collectResults) results.push(result);
    } catch (error) {
      if (!options.continueOnError) throw error;
      errorForState = error;
      failed = true;
      consecutiveFailures += 1;
      await options.onError?.(error, iteration);
    }
    const isLastIteration = !repeat || (options.iterations !== undefined && iteration >= options.iterations);
    const nextDelayMs = isLastIteration
      ? undefined
      : delayForFailures({
          consecutiveFailures,
          intervalMs,
          failureBackoffMultiplier,
          maxIntervalMs
        });
    await options.onIterationComplete?.({
      iteration,
      result,
      error: errorForState,
      failed,
      consecutiveFailures,
      nextDelayMs
    });
    if (isLastIteration) break;
    await wait(nextDelayMs ?? intervalMs);
    iteration += 1;
  }

  return results;
}

export const loopResultNeedsAttention = evidenceLoopResultNeedsAttention;
export const loopResultAttentionMessage = evidenceLoopResultAttentionMessage;
export const loopResultNeedsBackoff = evidenceLoopResultNeedsBackoff;

export function observeLoopHeartbeatNotice(
  policyNotice: string | undefined,
  result: Parameters<typeof loopResultAttentionMessage>[0] | undefined
) {
  return [policyNotice?.trim(), result ? loopResultAttentionMessage(result).trim() : ""].filter(Boolean).join(" ");
}

export function observeLoopExitCode(result: Parameters<typeof loopResultNeedsAttention>[0]) {
  return loopResultNeedsBackoff(result) ? 1 : 0;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function recordLoopHeartbeat(
  automation: WorldModelServices["automation"],
  input: Parameters<WorldModelServices["automation"]["recordHeartbeat"]>[0]
) {
  try {
    await automation.recordHeartbeat(input);
  } catch (error) {
    console.error(JSON.stringify({ workerId: input.id, heartbeatError: errorMessage(error) }, null, 2));
  }
}

async function main() {
  let options = parseObserveArgs();

  if (options.loop || options.sourceId || options.runAllSources) {
    const prisma = new PrismaClient();
    try {
      const services = createConfiguredWorldModelServices(createPrismaWorldModelStore(prisma));
      if (options.useWorkerConfig) {
        const config = (await services.automation.listWorkerConfigs()).find((item) => item.id === options.workerId);
        if (!config) throw new Error(`Worker config not found: ${options.workerId}`);
        options = applyWorkerConfigToObserveOptions(options, config);
      }
      options = await resolveObserveReadableSelectors(services, options);
      if (options.loop) {
        if (options.dryRun) {
          const configuredSources = await listConfiguredSourcesForLoopDryRun(services.sources, options);
          const result = await runObserveLoopDryRun(configuredSources, createDryRunSourceServices(services), options);
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        if (!options.repeat) {
          const guarded = await guardObserveLoopOptions(options.loopOptions, services);
          if (guarded.notice) console.error(guarded.notice);
          const result = await runWithTimeout(
            services.automation.runEvidenceLoop(guarded.options),
            options.timeoutMs,
            `Evidence loop timed out after ${Math.round((options.timeoutMs ?? 0) / 1000)} seconds. Use --timeout-seconds to adjust the limit.`
          );
          console.log(JSON.stringify(result, null, 2));
          const attentionMessage = loopResultAttentionMessage(result);
          if (attentionMessage) {
            console.error(attentionMessage);
          }
          const exitCode = observeLoopExitCode(result);
          if (exitCode !== 0) {
            process.exitCode = exitCode;
          }
          return;
        }
        await recordLoopHeartbeat(services.automation, {
          id: options.workerId,
          status: "RUNNING",
          heartbeatAt: new Date(),
          nextRunAt: undefined,
          intervalMs: options.intervalMs,
          consecutiveFailureCount: 0,
          lastNotice: "",
          lastError: ""
        });
        await runRepeatedTask(
          async (iteration) => {
            const guarded = await guardObserveLoopOptions(options.loopOptions, services);
            if (guarded.notice) console.error(JSON.stringify({ iteration, policyNotice: guarded.notice }, null, 2));
            const result = await services.automation.runEvidenceLoop(guarded.options);
            console.log(JSON.stringify({ iteration, result }, null, 2));
            return { policyNotice: guarded.notice, result };
          },
          {
            repeat: true,
            intervalMs: options.intervalMs,
            failureBackoffMultiplier: options.failureBackoffMultiplier,
            maxIntervalMs: options.maxIntervalMs,
            iterations: options.iterations,
            collectResults: false,
            continueOnError: true,
            isFailure: (result) => loopResultNeedsBackoff(result.result),
            onError: async (error, iteration) => {
              console.error(JSON.stringify({ iteration, error: errorMessage(error) }, null, 2));
            },
            onIterationComplete: async (state) => {
              const attentionMessage = state.result ? observeLoopHeartbeatNotice(state.result.policyNotice, state.result.result) : "";
              await recordLoopHeartbeat(services.automation, {
                id: options.workerId,
                status: state.error || state.failed ? "ERROR" : "RUNNING",
                heartbeatAt: new Date(),
                nextRunAt: state.nextDelayMs === undefined ? undefined : new Date(Date.now() + state.nextDelayMs),
                intervalMs: options.intervalMs,
                consecutiveFailureCount: state.consecutiveFailures,
                lastNotice: state.error || state.failed ? "" : attentionMessage,
                lastError: state.error
                  ? errorMessage(state.error)
                  : state.failed
                    ? attentionMessage || "Evidence loop needs attention."
                    : ""
              });
            }
          }
        );
        if (options.iterations !== undefined) {
          await recordLoopHeartbeat(services.automation, {
            id: options.workerId,
            status: "IDLE",
            heartbeatAt: new Date(),
            nextRunAt: undefined,
            intervalMs: options.intervalMs,
            consecutiveFailureCount: 0,
            lastNotice: "",
            lastError: ""
          });
        }
        return;
      }
      const configuredSources = await services.sources.listSources();
      const sources = options.sourceId ? configuredSources.filter((source) => source.id === options.sourceId) : configuredSources;
      if (options.sourceId && sources.length === 0) {
        throw new Error(`Source not found: ${options.sourceId}`);
      }
      if (options.dryRun) {
        const runs = await runConfiguredSourceDryRuns(sources, createDryRunSourceServices(services), options);
        console.log(JSON.stringify({ mode: "dry-run", runs }, null, 2));
        return;
      }
      if (options.reviewOnly) {
        const runs = [];
        const reviewSourceOptions = observeReviewSourceRunOptions(options);
        for (const source of sources.filter((item) => item.enabled)) {
          const run = await runWithTimeout(
            services.sources.runSource(source.id, reviewSourceOptions),
            options.timeoutMs,
            `Source review run timed out after ${Math.round((options.timeoutMs ?? 0) / 1000)} seconds. Use --timeout-seconds to adjust the limit.`
          );
          runs.push({ ...run, source: source.name });
        }
        console.log(JSON.stringify({ mode: "review-only", runs }, null, 2));
        return;
      }
      const runs = [];
      const writeSourceOptions = observeWriteSourceRunOptions(options);
      let ranReviewOnly = false;
      for (const source of sources) {
        const guarded = await guardObserveSourceOptions(writeSourceOptions, services, source.autoConfirm);
        if (guarded.notice) console.error(guarded.notice);
        ranReviewOnly ||= Boolean(guarded.options.reviewOnly);
        runs.push(
          await runWithTimeout(
            services.sources.runSource(source.id, guarded.options),
            options.timeoutMs,
            `Source run timed out after ${Math.round((options.timeoutMs ?? 0) / 1000)} seconds. Use --timeout-seconds to adjust the limit.`
          )
        );
      }
      console.log(JSON.stringify({ mode: ranReviewOnly ? "review-only" : options.loop ? "loop" : "write", runs }, null, 2));
    } finally {
      await prisma.$disconnect();
    }
    return;
  }

  const adapter = createSourceAdapter(options.kind);
  const observations = await adapter.fetch({
    name: options.name ?? `${options.kind} dry run`,
    adapter: options.kind.toLowerCase(),
    url: options.url,
    credentialRef: options.credentialRef
  });

  console.log(
    JSON.stringify(
      {
        mode: options.dryRun ? "dry-run" : "write-disabled",
        adapter: options.kind,
        supportedAdapters: supportedSourceKinds,
        fetched: observations.length,
        deduplicated: countDuplicates(observations),
        observations,
        message: options.dryRun
          ? "Observation dry-run completed without writing evidence."
          : "Use --source <source-id> or --all to persist observations from configured sources."
      },
      null,
      2
    )
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
