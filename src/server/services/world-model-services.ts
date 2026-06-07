import { z } from "zod";
import { deduplicateObservation, type ObservationForDedupe } from "@/domain/dedupe";
import { combineEstimatorOutputs } from "@/domain/likelihood";
import {
  applyUpdate,
  createUpdatePreview,
  rollbackUpdate,
  type BeliefForUpdate,
  type EvidenceLinkForUpdate,
  type UpdatePreview
} from "@/domain/updates";
import { normalizeMutuallyExclusive } from "@/domain/bayes";
import { createRecordId } from "@/server/services/in-memory-store";
import type {
  ConfirmEvidenceInput,
  CreateBeliefInput,
  CreateObservationInput,
  CreateSourceInput,
  EvidenceHypothesisLinkRecord,
  EvidenceRecord,
  HypothesisRecord,
  ImportArtifactInput,
  RawObservationInput,
  RunLikelihoodInput,
  WorldModelServices,
  WorldModelStore
} from "@/server/services/types";

const probabilitySchema = z.number().finite().min(0).max(1);

const createBeliefSchema = z.object({
  title: z.string().trim().min(1, "Belief title is required"),
  category: z.enum(["AI_TREND", "INVESTMENT", "TECH_TREND", "CAREER", "SOURCE_RELIABILITY"]),
  description: z.string(),
  probabilityMode: z.enum(["MUTUALLY_EXCLUSIVE", "INDEPENDENT"]),
  hypotheses: z
    .array(
      z.object({
        proposition: z.string().trim().min(1, "Hypothesis proposition is required"),
        priorProbability: z.number().finite().nonnegative(),
        notes: z.string().optional(),
        startsAt: z.date().optional(),
        expiresAt: z.date().optional(),
        expiryCondition: z.string().optional()
      })
    )
    .min(1, "At least one hypothesis is required")
});

const independentBeliefSchema = createBeliefSchema.extend({
  probabilityMode: z.literal("INDEPENDENT"),
  hypotheses: createBeliefSchema.shape.hypotheses.pipe(
    z.array(z.object({ proposition: z.string(), priorProbability: probabilitySchema, notes: z.string().optional() }))
  )
});

const createObservationSchema = z.object({
  sourceId: z.string().optional(),
  title: z.string().trim().min(1, "Observation title is required"),
  content: z.string().trim().min(1, "Observation content is required"),
  url: z.string().url().optional(),
  author: z.string().optional(),
  publishedAt: z.date().optional(),
  credibility: probabilitySchema.optional(),
  normalizedHash: z.string().optional(),
  semanticKey: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

const confirmEvidenceSchema = z.object({
  observationId: z.string().min(1),
  confirmationMode: z.enum(["MANUAL", "AUTO"]),
  links: z
    .array(
      z.object({
        hypothesisId: z.string().min(1),
        direction: z.enum(["SUPPORTS", "OPPOSES", "MIXED", "NEUTRAL"]),
        relevance: probabilitySchema,
        likelihoodRatio: z.number().finite().positive(),
        confidence: probabilitySchema,
        rationale: z.string().trim().min(1)
      })
    )
    .min(1)
});

const sourceSchema = z.object({
  name: z.string().trim().min(1),
  kind: z.enum(["MANUAL", "RSS", "WEB_PAGE", "SEARCH", "GITHUB", "HUGGING_FACE", "GDELT", "PREDICTION_MARKET", "SOCIAL"]),
  url: z.string().url().optional(),
  adapter: z.string().trim().min(1),
  credentialRef: z.string().optional(),
  credibility: probabilitySchema,
  enabled: z.boolean(),
  autoConfirm: z.boolean(),
  autoConfirmThreshold: probabilitySchema
});

const artifactSchema = z.object({
  name: z.string().trim().min(1),
  kind: z.enum(["LIGHTWEIGHT", "LLM", "DEEP_ADAPTER"]),
  version: z.string().trim().min(1),
  path: z.string().trim().min(1),
  metrics: z.record(z.string(), z.unknown()),
  enabled: z.boolean()
});

function parseBeliefInput(input: CreateBeliefInput) {
  if (input.probabilityMode === "INDEPENDENT") {
    return independentBeliefSchema.parse(input);
  }
  return createBeliefSchema.parse(input);
}

function now() {
  return new Date();
}

function createHypotheses(input: CreateBeliefInput, beliefId: string): HypothesisRecord[] {
  const probabilities =
    input.probabilityMode === "MUTUALLY_EXCLUSIVE"
      ? normalizeMutuallyExclusive(input.hypotheses.map((hypothesis) => hypothesis.priorProbability))
      : input.hypotheses.map((hypothesis) => hypothesis.priorProbability);
  const createdAt = now();

  return input.hypotheses.map((hypothesis, index) => ({
    id: createRecordId("hypothesis"),
    beliefId,
    proposition: hypothesis.proposition.trim(),
    notes: hypothesis.notes ?? "",
    priorProbability: probabilities[index],
    currentProbability: probabilities[index],
    strength: probabilities[index],
    status: "ACTIVE",
    startsAt: hypothesis.startsAt,
    expiresAt: hypothesis.expiresAt,
    expiryCondition: hypothesis.expiryCondition,
    createdAt,
    updatedAt: createdAt
  }));
}

function evidenceLinkToPreviewLink(link: EvidenceHypothesisLinkRecord, credibility: number): EvidenceLinkForUpdate {
  return {
    hypothesisId: link.hypothesisId,
    likelihoodRatio: link.likelihoodRatio,
    credibility,
    confidence: link.confidence,
    rationale: link.rationale
  };
}

async function createBeliefForPreview(store: WorldModelStore, evidence: EvidenceRecord): Promise<BeliefForUpdate> {
  const hypotheses = await Promise.all(evidence.links.map((link) => store.getHypothesis(link.hypothesisId)));
  const presentHypotheses = hypotheses.filter((hypothesis): hypothesis is HypothesisRecord => Boolean(hypothesis));
  if (presentHypotheses.length !== evidence.links.length) {
    throw new Error("Evidence links reference missing hypotheses.");
  }

  const beliefIds = new Set(presentHypotheses.map((hypothesis) => hypothesis.beliefId));
  if (beliefIds.size !== 1) {
    throw new Error("A single update preview must target one belief.");
  }

  const belief = await store.getBelief(presentHypotheses[0].beliefId);
  if (!belief) throw new Error(`Belief not found: ${presentHypotheses[0].beliefId}`);

  return {
    id: belief.id,
    probabilityMode: belief.probabilityMode,
    hypotheses: belief.hypotheses.map((hypothesis) => ({
      id: hypothesis.id,
      proposition: hypothesis.proposition,
      currentProbability: hypothesis.currentProbability,
      strength: hypothesis.strength
    }))
  };
}

function toDedupeObservation(observation: RawObservationInput | CreateObservationInput): ObservationForDedupe {
  return {
    title: observation.title,
    content: observation.content,
    url: observation.url,
    observedAt: new Date(),
    publishedAt: observation.publishedAt
  };
}

export function createWorldModelServices(store: WorldModelStore): WorldModelServices {
  return {
    beliefs: {
      async createBelief(input) {
        const parsed = parseBeliefInput(input);
        const createdAt = now();
        const beliefId = createRecordId("belief");
        const hypotheses = createHypotheses(parsed, beliefId);
        return store.createBelief(
          {
            id: beliefId,
            title: parsed.title.trim(),
            category: parsed.category,
            description: parsed.description,
            probabilityMode: parsed.probabilityMode,
            status: "ACTIVE",
            createdAt,
            updatedAt: createdAt
          },
          hypotheses
        );
      },
      listBeliefs() {
        return store.listBeliefs();
      },
      getBelief(id) {
        return store.getBelief(id);
      }
    },
    observations: {
      async createObservation(input: CreateObservationInput) {
        const parsed = createObservationSchema.parse(input);
        const existing = await store.listObservations();
        const decision = deduplicateObservation(
          {
            ...toDedupeObservation(parsed),
            normalizedHash: parsed.normalizedHash,
            semanticKey: parsed.semanticKey
          },
          existing
        );
        const observedAt = now();
        return store.createObservation({
          id: createRecordId("observation"),
          sourceId: parsed.sourceId,
          title: parsed.title.trim(),
          content: parsed.content.trim(),
          url: parsed.url,
          author: parsed.author,
          publishedAt: parsed.publishedAt,
          observedAt,
          normalizedHash: parsed.normalizedHash,
          semanticKey: parsed.semanticKey,
          status: decision.duplicate ? "DUPLICATE" : "PENDING",
          duplicateOfId: decision.duplicateOfId,
          credibility: parsed.credibility ?? 0.5,
          metadata: parsed.metadata ?? {}
        });
      },
      listObservations() {
        return store.listObservations();
      }
    },
    evidence: {
      async confirmObservation(input: ConfirmEvidenceInput) {
        const parsed = confirmEvidenceSchema.parse(input);
        const observation = await store.getObservation(parsed.observationId);
        if (!observation) throw new Error(`Observation not found: ${parsed.observationId}`);
        const confirmedAt = now();
        const evidenceId = createRecordId("evidence");
        const links: EvidenceHypothesisLinkRecord[] = parsed.links.map((link) => ({
          id: createRecordId("evidence_link"),
          evidenceId,
          hypothesisId: link.hypothesisId,
          direction: link.direction,
          relevance: link.relevance,
          likelihoodRatio: link.likelihoodRatio,
          confidence: link.confidence,
          rationale: link.rationale,
          createdAt: confirmedAt
        }));
        const evidence = await store.createEvidence({
          id: evidenceId,
          observationId: observation.id,
          title: observation.title,
          content: observation.content,
          url: observation.url,
          confirmedAt,
          confirmationMode: parsed.confirmationMode,
          credibility: observation.credibility,
          status: "ACTIVE",
          metadata: observation.metadata,
          links
        });
        await store.updateObservation(observation.id, { status: "CONFIRMED" });
        return evidence;
      },
      listEvidence() {
        return store.listEvidence();
      }
    },
    likelihood: {
      async runLikelihood(input: RunLikelihoodInput) {
        const evidence = await store.getEvidence(input.evidenceId);
        if (!evidence) throw new Error(`Evidence not found: ${input.evidenceId}`);
        const hypothesis = await store.getHypothesis(input.hypothesisId);
        if (!hypothesis) throw new Error(`Hypothesis not found: ${input.hypothesisId}`);
        const ensemble = combineEstimatorOutputs(input.outputs);
        return store.createLikelihoodRun({
          id: createRecordId("likelihood"),
          evidenceId: input.evidenceId,
          hypothesisId: input.hypothesisId,
          ensembleLikelihoodRatio: ensemble.likelihoodRatio,
          ensembleConfidence: ensemble.confidence,
          estimatorOutputs: input.outputs,
          modelVersion: ensemble.modelVersion,
          createdAt: now()
        });
      }
    },
    updates: {
      listEvents() {
        return store.listUpdateEvents();
      },
      async createPreview(evidenceId: string) {
        const evidence = await store.getEvidence(evidenceId);
        if (!evidence) throw new Error(`Evidence not found: ${evidenceId}`);
        const belief = await createBeliefForPreview(store, evidence);
        const links = evidence.links.map((link) => evidenceLinkToPreviewLink(link, evidence.credibility));
        return { ...createUpdatePreview(belief, links), evidenceId };
      },
      async applyPreview(preview: UpdatePreview, likelihoodRunId?: string) {
        const event = applyUpdate(preview, { id: createRecordId("update"), createdAt: now() });
        await store.updateHypothesisProbabilities(event.posteriorSnapshot);
        return store.createUpdateEvent({
          id: event.id,
          beliefId: event.beliefId,
          evidenceId: preview.evidenceId ?? "unknown",
          likelihoodRunId,
          priorSnapshot: event.priorSnapshot,
          posteriorSnapshot: event.posteriorSnapshot,
          mode: "APPLIED",
          status: "APPLIED",
          confidence: event.confidence,
          explanations: event.explanations,
          createdAt: event.createdAt
        });
      },
      async rollback(eventId: string) {
        const event = await store.getUpdateEvent(eventId);
        if (!event) throw new Error(`Update event not found: ${eventId}`);
        const rolledBack = rollbackUpdate(
          {
            id: event.id,
            beliefId: event.beliefId,
            priorSnapshot: event.priorSnapshot,
            posteriorSnapshot: event.posteriorSnapshot,
            mode: "APPLIED",
            status: "APPLIED",
            confidence: event.confidence,
            explanations: event.explanations,
            createdAt: event.createdAt
          },
          now()
        );
        await store.updateHypothesisProbabilities(rolledBack.restoredProbabilities);
        const saved = await store.updateUpdateEvent(eventId, {
          status: "ROLLED_BACK",
          rolledBackAt: rolledBack.rolledBackAt
        });
        return { ...saved, restoredProbabilities: rolledBack.restoredProbabilities };
      }
    },
    sources: {
      listSources() {
        return store.listSources();
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
      async runDryRun(sourceId: string, observations: RawObservationInput[]) {
        const source = await store.getSource(sourceId);
        if (!source) throw new Error(`Source not found: ${sourceId}`);
        const seen: ObservationForDedupe[] = [];
        let deduplicatedCount = 0;
        for (const observation of observations) {
          const decision = deduplicateObservation(toDedupeObservation(observation), seen);
          if (decision.duplicate) deduplicatedCount += 1;
          seen.push({ id: createRecordId("dry_observation"), ...toDedupeObservation(observation) });
        }
        const startedAt = now();
        return store.createObservationRun({
          id: createRecordId("observation_run"),
          sourceId,
          status: "DRY_RUN",
          startedAt,
          finishedAt: now(),
          itemCount: observations.length,
          deduplicatedCount
        });
      }
    },
    models: {
      listArtifacts() {
        return store.listModelArtifacts();
      },
      async importArtifact(input: ImportArtifactInput) {
        const parsed = artifactSchema.parse(input);
        return store.createModelArtifact({
          id: createRecordId("model"),
          ...parsed,
          createdAt: now()
        });
      }
    }
  };
}
