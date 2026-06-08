import { deduplicateObservation } from "@/domain/dedupe";
import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import { createPrismaWorldModelStore } from "@/server/services/prisma-store";
import { createWorldModelServices } from "@/server/services/world-model-services";
import { createSourceAdapter, supportedSourceKinds, type RawObservation } from "@/server/sources/adapters";
import type { ObservationSourceKind } from "@/server/services/types";

config({ path: ".env.local" });
config();

function arg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function numberArg(name: string) {
  const value = arg(name);
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

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const loop = process.argv.includes("--loop");
  const reviewOnly = process.argv.includes("--review-only");
  const sourceId = arg("--source");
  const runAllSources = process.argv.includes("--all");

  if (loop || sourceId || runAllSources) {
    const prisma = new PrismaClient();
    try {
      const services = createWorldModelServices(createPrismaWorldModelStore(prisma));
      if (loop) {
        const result = await services.automation.runEvidenceLoop({
          reviewOnly,
          sourceIds: sourceId ? [sourceId] : undefined,
          maxObservations: numberArg("--max-observations"),
          autoConfirmThreshold: numberArg("--threshold")
        });
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      const configuredSources = await services.sources.listSources();
      const sources = sourceId ? configuredSources.filter((source) => source.id === sourceId) : configuredSources;
      if (sourceId && sources.length === 0) {
        throw new Error(`Source not found: ${sourceId}`);
      }
      if (reviewOnly) {
        const runs = [];
        for (const source of sources.filter((item) => item.enabled)) {
          const run = await services.sources.runSource(source.id, { reviewOnly: true });
          runs.push({ ...run, source: source.name });
        }
        console.log(JSON.stringify({ mode: "review-only", runs }, null, 2));
        return;
      }
      const runs = [];
      for (const source of sources) {
        runs.push(await services.sources.runSource(source.id));
      }
      console.log(JSON.stringify({ mode: loop ? "loop" : "write", runs }, null, 2));
    } finally {
      await prisma.$disconnect();
    }
    return;
  }

  const kind = kindFromArg(arg("--adapter") ?? arg("--kind"));
  const url = arg("--url");
  const adapter = createSourceAdapter(kind);
  const observations = await adapter.fetch({
    name: arg("--name") ?? `${kind} dry run`,
    adapter: kind.toLowerCase(),
    url,
    credentialRef: arg("--credential-ref")
  });

  console.log(
    JSON.stringify(
      {
        mode: dryRun ? "dry-run" : "write-disabled",
        adapter: kind,
        supportedAdapters: supportedSourceKinds,
        fetched: observations.length,
        deduplicated: countDuplicates(observations),
        observations,
        message: dryRun
          ? "Observation dry-run completed without writing evidence."
          : "Use --source <source-id> or --all to persist observations from configured sources."
      },
      null,
      2
    )
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
