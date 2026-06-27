import { createSourceAdapter, type RawObservation, type SourceAdapter } from "@/server/sources/adapters";
import type {
  BeliefRecord,
  EvidenceLoopOptions,
  EvidenceLoopQuery,
  ObservationRunRecord,
  ObservationSourceKind,
  ObservationSourceRecord,
  RawObservationInput,
  WorldModelServices
} from "@/server/services/types";

export type EvidenceLoopDryRunOptions = Pick<
  EvidenceLoopOptions,
  "beliefIds" | "sourceIds" | "maxQueries" | "maxSources" | "maxObservations" | "bootstrapDefaultSources"
> & {
  timeoutMs?: number;
};

export type ConfiguredSourceDryRunDependencies = {
  createAdapter?: (kind: ObservationSourceKind) => SourceAdapter;
};

export type DryRunSourceServices = Pick<WorldModelServices["sources"], "runDryRun"> & {
  listBeliefs?: WorldModelServices["beliefs"]["listBeliefs"];
};

const DRY_RUN_QUERY_SOURCE_KINDS = new Set<ObservationSourceKind>(["GITHUB", "HUGGING_FACE", "GDELT", "PREDICTION_MARKET"]);

function dryRunObservationInput(observation: RawObservation): RawObservationInput {
  return {
    title: observation.title,
    content: observation.content || observation.title,
    url: observation.url,
    author: observation.author,
    publishedAt: observation.publishedAt
  };
}

function dryRunSourceSupportsGeneratedQueries(source: Pick<ObservationSourceRecord, "kind" | "url">) {
  return Boolean(source.url?.includes("{query}") || DRY_RUN_QUERY_SOURCE_KINDS.has(source.kind));
}

function dryRunQueryPartKey(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function compactDryRunSearchQuery(parts: string[]) {
  const selected: Array<{ value: string; key: string }> = [];
  for (const part of parts) {
    const value = part.trim().replace(/\s+/g, " ");
    const key = dryRunQueryPartKey(value);
    if (!key) continue;
    if (selected.some((item) => item.key === key || item.key.includes(key))) continue;
    for (let index = selected.length - 1; index >= 0; index -= 1) {
      if (key.includes(selected[index].key)) selected.splice(index, 1);
    }
    selected.push({ value, key });
  }
  return selected.map((item) => item.value).join(" ");
}

function dryRunEvidenceSearchQueryFromNotes(notes: string) {
  for (const line of notes.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:证据检索|evidenceSearchQuery|evidence search)\s*[:：]\s*(.+?)\s*$/i);
    const query = match?.[1]?.trim();
    if (query) return query;
  }
  return "";
}

function dryRunHypothesisSearchQuery(belief: BeliefRecord, hypothesis: BeliefRecord["hypotheses"][number]) {
  const structuredQuery = hypothesis.evidenceSearchQuery?.trim() ?? "";
  if (structuredQuery) return compactDryRunSearchQuery([structuredQuery]);
  const notesQuery = dryRunEvidenceSearchQueryFromNotes(hypothesis.notes);
  return notesQuery ? compactDryRunSearchQuery([notesQuery]) : compactDryRunSearchQuery([belief.title, hypothesis.proposition, hypothesis.notes]);
}

function dryRunHypothesisSettlementSearchQuery(belief: BeliefRecord, hypothesis: BeliefRecord["hypotheses"][number]) {
  return compactDryRunSearchQuery([
    hypothesis.evidenceSearchQuery?.trim() ?? "",
    belief.title,
    hypothesis.proposition,
    hypothesis.expiryCondition ?? "",
    "final outcome result settlement"
  ]);
}

function dryRunHypothesisIsEffective(hypothesis: BeliefRecord["hypotheses"][number], referenceTime = new Date()) {
  if (hypothesis.status !== "ACTIVE") return false;
  const referenceMs = referenceTime.getTime();
  if (hypothesis.startsAt && hypothesis.startsAt.getTime() > referenceMs) return false;
  if (hypothesis.expiresAt && hypothesis.expiresAt.getTime() <= referenceMs) return false;
  return true;
}

function dryRunHypothesisNeedsSettlementReview(hypothesis: BeliefRecord["hypotheses"][number], referenceTime = new Date()) {
  if (hypothesis.status !== "ACTIVE" || !hypothesis.expiresAt) return false;
  return hypothesis.expiresAt.getTime() <= referenceTime.getTime();
}

async function dryRunQueriesForSource(
  source: ObservationSourceRecord,
  services: DryRunSourceServices,
  options: EvidenceLoopDryRunOptions
) {
  if (!dryRunSourceSupportsGeneratedQueries(source) || !services.listBeliefs) return undefined;

  const scopedBeliefIds = new Set(options.beliefIds?.filter(Boolean));
  const maxQueries = options.maxQueries && options.maxQueries > 0 ? Math.floor(options.maxQueries) : undefined;
  const beliefs = await services.listBeliefs();
  const queries: EvidenceLoopQuery[] = [];
  const seen = new Set<string>();
  const referenceTime = new Date();

  for (const belief of beliefs) {
    if (belief.status !== "ACTIVE") continue;
    if (scopedBeliefIds.size > 0 && !scopedBeliefIds.has(belief.id)) continue;
    for (const hypothesis of belief.hypotheses) {
      const settlementDue = dryRunHypothesisNeedsSettlementReview(hypothesis, referenceTime);
      if (!dryRunHypothesisIsEffective(hypothesis, referenceTime) && !settlementDue) continue;
      const query = settlementDue ? dryRunHypothesisSettlementSearchQuery(belief, hypothesis) : dryRunHypothesisSearchQuery(belief, hypothesis);
      const key = dryRunQueryPartKey(query);
      if (!query || seen.has(key)) continue;
      seen.add(key);
      queries.push({
        beliefId: belief.id,
        hypothesisId: hypothesis.id,
        category: belief.category,
        query,
        ...(settlementDue
          ? {
              purpose: "SETTLEMENT_REVIEW" as const,
              priority: 1,
              priorityReason: "settlement review due",
              settlementDue: true,
              expiresAt: hypothesis.expiresAt?.toISOString(),
              ...(hypothesis.expiryCondition ? { expiryCondition: hypothesis.expiryCondition } : {})
            }
          : {})
      });
      if (maxQueries && queries.length >= maxQueries) return queries;
    }
  }

  return queries.length > 0 ? queries : undefined;
}

export function createDryRunSourceServices(services: WorldModelServices): DryRunSourceServices {
  return {
    runDryRun: services.sources.runDryRun,
    listBeliefs: () => services.beliefs.listBeliefs()
  };
}

async function runWithTimeout<T>(task: Promise<T>, timeoutMs: number | undefined, message: string): Promise<T> {
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

export async function runConfiguredSourceDryRuns(
  sources: ObservationSourceRecord[],
  services: DryRunSourceServices,
  options: EvidenceLoopDryRunOptions,
  dependencies: ConfiguredSourceDryRunDependencies = {}
): Promise<Array<ObservationRunRecord & { source: string }>> {
  const adapterFactory = dependencies.createAdapter ?? createSourceAdapter;
  const runs = [];

  for (const source of sources.filter((item) => item.enabled)) {
    const adapter = adapterFactory(source.kind);
    const queries = await dryRunQueriesForSource(source, services, options);
    const fetchedObservations = await adapter.fetch({
      name: source.name,
      adapter: source.adapter,
      url: source.url,
      credentialRef: source.credentialRef,
      ...(queries ? { queries: queries.map((query) => query.query) } : {})
    });
    const rawObservations = options.maxObservations ? fetchedObservations.slice(0, options.maxObservations) : fetchedObservations;
    const run = await runWithTimeout(
      queries
        ? services.runDryRun(source.id, rawObservations.map(dryRunObservationInput), { queries })
        : services.runDryRun(source.id, rawObservations.map(dryRunObservationInput)),
      options.timeoutMs,
      `Source dry-run timed out after ${Math.round((options.timeoutMs ?? 0) / 1000)} seconds. Use --timeout-seconds to adjust the limit.`
    );
    runs.push({ ...run, source: source.name });
  }

  return runs;
}

export async function runObserveLoopDryRun(
  configuredSources: ObservationSourceRecord[],
  services: DryRunSourceServices,
  options: EvidenceLoopDryRunOptions,
  dependencies: ConfiguredSourceDryRunDependencies = {}
) {
  const sourceIds = new Set(options.sourceIds?.filter(Boolean));
  let sources = configuredSources.filter((source) => {
    if (!source.enabled || source.kind === "MANUAL") return false;
    return sourceIds.size === 0 || sourceIds.has(source.id);
  });
  if (options.maxSources !== undefined && options.maxSources > 0) {
    sources = sources.slice(0, Math.floor(options.maxSources));
  }

  return {
    mode: "dry-run" as const,
    runs: await runConfiguredSourceDryRuns(sources, services, options, dependencies)
  };
}
