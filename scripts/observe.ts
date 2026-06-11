import { deduplicateObservation } from "@/domain/dedupe";
import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import { pathToFileURL } from "node:url";
import { createConfiguredWorldModelServices } from "@/server/services/configured";
import { createPrismaWorldModelStore } from "@/server/services/prisma-store";
import { createSourceAdapter, supportedSourceKinds, type RawObservation } from "@/server/sources/adapters";
import type { EvidenceLoopOptions, ObservationSourceKind } from "@/server/services/types";

config({ path: ".env.local" });
config();

const DEFAULT_REPEAT_INTERVAL_MS = 15 * 60 * 1000;

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
  iterations?: number;
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
  const reviewOnly = argv.includes("--review-only");
  const sourceId = arg("--source", argv);
  const runAllSources = argv.includes("--all");
  const bootstrapDefaultSources =
    argv.includes("--bootstrap-default-sources") || (loop && !sourceId && !argv.includes("--no-bootstrap-default-sources"));
  const forceAutoApply = argv.includes("--force-auto-apply");
  const repeat = argv.includes("--repeat") || argv.includes("--watch");

  return {
    dryRun,
    loop,
    reviewOnly,
    bootstrapDefaultSources,
    forceAutoApply,
    repeat,
    intervalMs: intervalMsArg(argv),
    iterations: positiveIntegerArg("--iterations", argv),
    sourceId,
    runAllSources,
    kind: kindFromArg(arg("--adapter", argv) ?? arg("--kind", argv)),
    url: arg("--url", argv),
    name: arg("--name", argv),
    credentialRef: arg("--credential-ref", argv),
    loopOptions: {
      reviewOnly,
      sourceIds: sourceId ? [sourceId] : undefined,
      maxObservations: numberArg("--max-observations", argv),
      candidateThreshold: numberArg("--candidate-threshold", argv),
      autoConfirmThreshold: numberArg("--threshold", argv),
      bootstrapDefaultSources,
      forceAutoApply
    }
  };
}

export type RepeatedTaskOptions = {
  repeat?: boolean;
  iterations?: number;
  intervalMs?: number;
  collectResults?: boolean;
  wait?: (ms: number) => Promise<void>;
};

function waitMs(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function runRepeatedTask<T>(
  task: (iteration: number) => Promise<T>,
  options: RepeatedTaskOptions = {}
): Promise<T[]> {
  const repeat = options.repeat ?? false;
  const intervalMs = Math.max(0, options.intervalMs ?? DEFAULT_REPEAT_INTERVAL_MS);
  const collectResults = options.collectResults ?? true;
  const wait = options.wait ?? waitMs;
  const results: T[] = [];
  let iteration = 1;

  while (options.iterations === undefined || iteration <= options.iterations) {
    const result = await task(iteration);
    if (collectResults) results.push(result);
    if (!repeat || (options.iterations !== undefined && iteration >= options.iterations)) break;
    await wait(intervalMs);
    iteration += 1;
  }

  return results;
}

async function main() {
  const options = parseObserveArgs();

  if (options.loop || options.sourceId || options.runAllSources) {
    const prisma = new PrismaClient();
    try {
      const services = createConfiguredWorldModelServices(createPrismaWorldModelStore(prisma));
      if (options.loop) {
        if (!options.repeat) {
          const result = await services.automation.runEvidenceLoop(options.loopOptions);
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        await runRepeatedTask(
          async (iteration) => {
            const result = await services.automation.runEvidenceLoop(options.loopOptions);
            console.log(JSON.stringify({ iteration, result }, null, 2));
            return result;
          },
          {
            repeat: true,
            intervalMs: options.intervalMs,
            iterations: options.iterations,
            collectResults: false
          }
        );
        return;
      }
      const configuredSources = await services.sources.listSources();
      const sources = options.sourceId ? configuredSources.filter((source) => source.id === options.sourceId) : configuredSources;
      if (options.sourceId && sources.length === 0) {
        throw new Error(`Source not found: ${options.sourceId}`);
      }
      if (options.reviewOnly) {
        const runs = [];
        for (const source of sources.filter((item) => item.enabled)) {
          const run = await services.sources.runSource(source.id, {
            reviewOnly: true,
            candidateThreshold: options.loopOptions.candidateThreshold,
            autoConfirmThreshold: options.loopOptions.autoConfirmThreshold,
            maxObservations: options.loopOptions.maxObservations
          });
          runs.push({ ...run, source: source.name });
        }
        console.log(JSON.stringify({ mode: "review-only", runs }, null, 2));
        return;
      }
      const runs = [];
      for (const source of sources) {
        runs.push(
          await services.sources.runSource(source.id, {
            candidateThreshold: options.loopOptions.candidateThreshold,
            autoConfirmThreshold: options.loopOptions.autoConfirmThreshold,
            forceAutoApply: options.forceAutoApply,
            maxObservations: options.loopOptions.maxObservations
          })
        );
      }
      console.log(JSON.stringify({ mode: options.loop ? "loop" : "write", runs }, null, 2));
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
