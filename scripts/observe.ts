import { deduplicateObservation } from "@/domain/dedupe";
import { createSourceAdapter, supportedSourceKinds, type RawObservation } from "@/server/sources/adapters";
import type { ObservationSourceKind } from "@/server/services/types";

function arg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
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
          : "Observation writes are intentionally disabled in this CLI; use the API/service layer to persist observations."
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
