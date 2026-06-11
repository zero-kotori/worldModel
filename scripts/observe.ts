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

  return {
    dryRun,
    loop,
    reviewOnly,
    bootstrapDefaultSources,
    forceAutoApply,
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

async function main() {
  const options = parseObserveArgs();

  if (options.loop || options.sourceId || options.runAllSources) {
    const prisma = new PrismaClient();
    try {
      const services = createConfiguredWorldModelServices(createPrismaWorldModelStore(prisma));
      if (options.loop) {
        const result = await services.automation.runEvidenceLoop(options.loopOptions);
        console.log(JSON.stringify(result, null, 2));
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
