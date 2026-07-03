import { deduplicateObservation, type ObservationForDedupe } from "@/domain/dedupe";
import { listSourcePresets } from "@/lib/world-model-source-presets";
import { createRecordId } from "@/server/services/in-memory-store";
import type { ObservationWorkflow } from "@/server/services/internal/observation-workflow";
import { sourceSchema, updateSourceSchema } from "@/server/services/internal/schemas";
import type { WorldModelServiceContext } from "@/server/services/internal/service-context";
import { now } from "@/server/services/internal/shared";
import type { SourceWorkflow } from "@/server/services/internal/source-workflow";
import type { CreateSourceInput, RawObservationInput, RunDryRunOptions, UpdateSourceInput, WorldModelServices } from "@/server/services/types";

export function createSourceService(
  context: WorldModelServiceContext,
  sourceWorkflow: SourceWorkflow,
  observationWorkflow: ObservationWorkflow
): WorldModelServices["sources"] {
  const { store } = context;

  return {
    listSources() {
      return store.listSources();
    },
    listRuns() {
      return store.listObservationRuns();
    },
    async listPresets() {
      return listSourcePresets(await store.listSources());
    },
    async createPreset(id: string) {
      return sourceWorkflow.createSourcePresetRecord(id);
    },
    async createMissingPresets() {
      return sourceWorkflow.createMissingSourcePresetRecords();
    },
    async createSource(input: CreateSourceInput) {
      const parsed = sourceSchema.parse(input);
      const createdAt = now();
      return store.createSource({
        id: createRecordId("source"),
        ...parsed,
        createdAt,
        updatedAt: createdAt
      });
    },
    async updateSource(id: string, input: UpdateSourceInput) {
      const parsed = updateSourceSchema.parse(input);
      return store.updateSource(id, { ...parsed, updatedAt: now() });
    },
    async runDryRun(sourceId: string, observations: RawObservationInput[], runOptions: RunDryRunOptions = {}) {
      const source = await store.getSource(sourceId);
      if (!source) throw new Error(`Source not found: ${sourceId}`);
      const querySummary = runOptions.queries ?? [];
      const seen: ObservationForDedupe[] = [];
      let deduplicatedCount = 0;
      for (const observation of observations) {
        const decision = deduplicateObservation(observationWorkflow.toDedupeObservation(observation), seen);
        if (decision.duplicate) deduplicatedCount += 1;
        seen.push({ id: createRecordId("dry_observation"), ...observationWorkflow.toDedupeObservation(observation) });
      }
      const startedAt = now();
      return store.createObservationRun({
        id: createRecordId("observation_run"),
        sourceId,
        status: "DRY_RUN",
        startedAt,
        finishedAt: now(),
        itemCount: observations.length,
        reprocessedObservationCount: 0,
        deduplicatedCount,
        candidateCount: 0,
        autoAppliedCount: 0,
        reviewCount: 0,
        lowImpactCount: 0,
        unmatchedCount: 0,
        queryCount: querySummary.length,
        querySummary
      });
    },
    async runSource(sourceId: string, runOptions = {}) {
      return sourceWorkflow.runSource(sourceId, runOptions);
    }
  };
}
