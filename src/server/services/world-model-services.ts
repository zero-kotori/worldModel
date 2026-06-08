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
import type { EstimatorOutput } from "@/domain/likelihood";
import type { LikelihoodEstimator } from "@/server/models/estimators";
import { createRecordId } from "@/server/services/in-memory-store";
import { createSourceAdapter, type AdapterDependencies } from "@/server/sources/adapters";
import type {
  BayesianUpdateEventRecord,
  ConfirmAndApplyEvidenceResult,
  ConfirmEvidenceInput,
  CreateBeliefInput,
  CreateHypothesisInput,
  CreateObservationInput,
  CreateSourceInput,
  EvidenceHypothesisLinkRecord,
  EvidenceLoopOptions,
  EvidenceLoopQuery,
  EvidenceRecord,
  HypothesisRecord,
  ImportArtifactInput,
  RawObservationInput,
  RunSourceOptions,
  RunLikelihoodInput,
  ConnectEvidenceHypothesisInput,
  UpdateBeliefInput,
  UpdateEvidenceInput,
  UpdateHypothesisInput,
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
        stance: z.enum(["SUPPORTS", "OPPOSES"]).optional(),
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
    z.array(
      z.object({
        proposition: z.string(),
        priorProbability: probabilitySchema,
        stance: z.enum(["SUPPORTS", "OPPOSES"]).optional(),
        notes: z.string().optional()
      })
    )
  )
});

const createHypothesisSchema = z.object({
  proposition: z.string().trim().min(1, "Hypothesis proposition is required"),
  priorProbability: probabilitySchema,
  stance: z.enum(["SUPPORTS", "OPPOSES"]).default("SUPPORTS"),
  notes: z.string().optional(),
  startsAt: z.date().optional(),
  expiresAt: z.date().optional(),
  expiryCondition: z.string().optional()
});

const updateBeliefSchema = z.object({
  title: z.string().trim().min(1).optional(),
  category: z.enum(["AI_TREND", "INVESTMENT", "TECH_TREND", "CAREER", "SOURCE_RELIABILITY"]).optional(),
  description: z.string().optional(),
  probabilityMode: z.enum(["MUTUALLY_EXCLUSIVE", "INDEPENDENT"]).optional(),
  status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]).optional()
});

const updateHypothesisSchema = z.object({
  beliefId: z.string().min(1).optional(),
  proposition: z.string().trim().min(1).optional(),
  notes: z.string().optional(),
  stance: z.enum(["SUPPORTS", "OPPOSES"]).optional(),
  priorProbability: probabilitySchema.optional(),
  currentProbability: probabilitySchema.optional(),
  status: z.enum(["ACTIVE", "PAUSED", "RESOLVED_TRUE", "RESOLVED_FALSE", "ARCHIVED"]).optional(),
  startsAt: z.date().optional(),
  expiresAt: z.date().optional(),
  expiryCondition: z.string().optional()
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

const updateEvidenceSchema = z.object({
  title: z.string().trim().min(1).optional(),
  content: z.string().trim().min(1).optional(),
  url: z.string().url().optional(),
  credibility: probabilitySchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
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
    .optional()
});

const connectEvidenceHypothesisSchema = z.object({
  hypothesisId: z.string().min(1),
  direction: z.enum(["SUPPORTS", "OPPOSES", "MIXED", "NEUTRAL"]),
  relevance: probabilitySchema,
  likelihoodRatio: z.number().finite().positive(),
  confidence: probabilitySchema,
  rationale: z.string().trim().min(1)
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
      stance: hypothesis.stance ?? "SUPPORTS",
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

export type WorldModelServiceOptions = {
  sourceAdapterDependencies?: AdapterDependencies;
  likelihoodEstimator?: LikelihoodEstimator;
};

function textTokens(value: string) {
  const normalized = value
    .toLowerCase()
    .replaceAll(/[^a-z0-9\u4e00-\u9fa5]+/g, " ")
    .trim();
  if (!normalized) return new Set<string>();
  return new Set(normalized.split(/\s+/).filter((token) => token.length >= 2));
}

function overlapScore(source: string, target: string) {
  const sourceTokens = textTokens(source);
  const targetTokens = textTokens(target);
  if (sourceTokens.size === 0 || targetTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of targetTokens) {
    if (sourceTokens.has(token)) overlap += 1;
  }
  return overlap / targetTokens.size;
}

function isUsableEstimatorOutput(output: EstimatorOutput) {
  return (
    !output.abstain &&
    Number.isFinite(output.likelihoodRatio) &&
    Number.isFinite(output.confidence) &&
    output.likelihoodRatio !== undefined &&
    output.likelihoodRatio > 0 &&
    output.confidence !== undefined &&
    output.confidence > 0 &&
    output.confidence <= 1
  );
}

function estimatorDirection(output: EstimatorOutput): "SUPPORTS" | "OPPOSES" | "MIXED" | "NEUTRAL" {
  if (output.direction === "SUPPORTS" || output.direction === "OPPOSES" || output.direction === "MIXED" || output.direction === "NEUTRAL") {
    return output.direction;
  }
  const likelihoodRatio = output.likelihoodRatio ?? 1;
  if (likelihoodRatio > 1.05) return "SUPPORTS";
  if (likelihoodRatio < 0.95) return "OPPOSES";
  return "NEUTRAL";
}

export function createWorldModelServices(
  store: WorldModelStore,
  options: WorldModelServiceOptions = {}
): WorldModelServices {
  async function createObservation(input: CreateObservationInput) {
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
  }

  async function rejectObservation(observationId: string) {
    const observation = await store.getObservation(observationId);
    if (!observation) throw new Error(`Observation not found: ${observationId}`);
    if (observation.status === "CONFIRMED") {
      throw new Error("Confirmed observations must be rejected from the evidence record.");
    }
    return store.updateObservation(observation.id, { status: "REJECTED" });
  }

  async function confirmObservation(input: ConfirmEvidenceInput) {
    const parsed = confirmEvidenceSchema.parse(input);
    const observation = await store.getObservation(parsed.observationId);
    if (!observation) throw new Error(`Observation not found: ${parsed.observationId}`);
    const existingEvidence = (await store.listEvidence()).find((item) => item.observationId === observation.id);
    if (existingEvidence) throw new Error(`Observation is already confirmed as evidence: ${observation.title}`);

    const hypotheses = await Promise.all(parsed.links.map((link) => store.getHypothesis(link.hypothesisId)));
    const missingIndex = hypotheses.findIndex((hypothesis) => !hypothesis);
    if (missingIndex >= 0) {
      throw new Error(`Hypothesis not found: ${parsed.links[missingIndex].hypothesisId}`);
    }

    const beliefIds = new Set(hypotheses.map((hypothesis) => hypothesis?.beliefId));
    if (beliefIds.size > 1) {
      throw new Error("Evidence links must target hypotheses under one belief.");
    }

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
  }

  async function createPreview(evidenceId: string) {
    const evidence = await store.getEvidence(evidenceId);
    if (!evidence) throw new Error(`Evidence not found: ${evidenceId}`);
    if (evidence.status === "REJECTED") throw new Error(`Evidence is rejected and cannot be applied: ${evidence.title}`);
    const belief = await createBeliefForPreview(store, evidence);
    const links = evidence.links.map((link) => evidenceLinkToPreviewLink(link, evidence.credibility));
    return { ...createUpdatePreview(belief, links), evidenceId };
  }

  async function applyPreview(preview: UpdatePreview, likelihoodRunId?: string): Promise<BayesianUpdateEventRecord> {
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
  }

  async function confirmAndApplyObservation(input: ConfirmEvidenceInput): Promise<ConfirmAndApplyEvidenceResult> {
    const evidence = await confirmObservation(input);
    const preview = await createPreview(evidence.id);
    const event = await applyPreview(preview);
    return { evidence, event };
  }

  async function rollbackEvent(eventId: string) {
    const event = await store.getUpdateEvent(eventId);
    if (!event) throw new Error(`Update event not found: ${eventId}`);
    if (event.status === "ROLLED_BACK") throw new Error(`Update event is already rolled back: ${eventId}`);
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

  async function rollbackAppliedEvidenceEvents(evidenceId: string) {
    const events = (await store.listUpdateEvents())
      .filter((event) => event.evidenceId === evidenceId && event.status === "APPLIED")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    for (const event of events) {
      await rollbackEvent(event.id);
    }
  }

  async function renormalizeMutuallyExclusiveBelief(beliefId: string) {
    const belief = await store.getBelief(beliefId);
    if (!belief || belief.probabilityMode !== "MUTUALLY_EXCLUSIVE" || belief.hypotheses.length === 0) return;
    const probabilities = normalizeMutuallyExclusive(belief.hypotheses.map((hypothesis) => hypothesis.currentProbability));
    await store.updateHypothesisProbabilities(
      Object.fromEntries(belief.hypotheses.map((hypothesis, index) => [hypothesis.id, probabilities[index]]))
    );
  }

  async function updateBeliefRecord(beliefId: string, input: UpdateBeliefInput) {
    const existing = await store.getBelief(beliefId);
    if (!existing) throw new Error(`Belief not found: ${beliefId}`);
    const parsed = updateBeliefSchema.parse(input);
    const updated = await store.updateBelief(beliefId, { ...parsed, updatedAt: now() });
    if (parsed.probabilityMode === "MUTUALLY_EXCLUSIVE") {
      await renormalizeMutuallyExclusiveBelief(beliefId);
      return (await store.getBelief(beliefId)) ?? updated;
    }
    return updated;
  }

  async function updateHypothesisRecord(hypothesisId: string, input: UpdateHypothesisInput) {
    const existing = await store.getHypothesis(hypothesisId);
    if (!existing) throw new Error(`Hypothesis not found: ${hypothesisId}`);
    const parsed = updateHypothesisSchema.parse(input);
    if (parsed.beliefId) {
      const targetBelief = await store.getBelief(parsed.beliefId);
      if (!targetBelief) throw new Error(`Belief not found: ${parsed.beliefId}`);
    }

    const updated = await store.updateHypothesis(hypothesisId, {
      ...parsed,
      currentProbability: parsed.currentProbability ?? (parsed.priorProbability !== undefined ? parsed.priorProbability : undefined),
      updatedAt: now()
    });
    await renormalizeMutuallyExclusiveBelief(existing.beliefId);
    if (updated.beliefId !== existing.beliefId) {
      await renormalizeMutuallyExclusiveBelief(updated.beliefId);
    }
    return (await store.getHypothesis(hypothesisId)) ?? updated;
  }

  async function updateAndReapplyEvidence(evidenceId: string, input: UpdateEvidenceInput): Promise<ConfirmAndApplyEvidenceResult> {
    const existing = await store.getEvidence(evidenceId);
    if (!existing) throw new Error(`Evidence not found: ${evidenceId}`);
    if (existing.status === "REJECTED") throw new Error(`Evidence is rejected and cannot be edited: ${existing.title}`);

    const parsed = updateEvidenceSchema.parse(input);
    await rollbackAppliedEvidenceEvents(evidenceId);
    const updatedAt = now();
    const links = parsed.links?.map((link) => ({
      id: createRecordId("evidence_link"),
      evidenceId,
      hypothesisId: link.hypothesisId,
      direction: link.direction,
      relevance: link.relevance,
      likelihoodRatio: link.likelihoodRatio,
      confidence: link.confidence,
      rationale: link.rationale,
      createdAt: updatedAt
    }));
    const evidence = await store.updateEvidence(evidenceId, {
      title: parsed.title?.trim(),
      content: parsed.content?.trim(),
      url: parsed.url,
      credibility: parsed.credibility,
      metadata: parsed.metadata,
      status: "ACTIVE",
      links
    });
    const preview = await createPreview(evidence.id);
    const event = await applyPreview(preview);
    return { evidence, event };
  }

  async function connectEvidenceHypothesis(
    evidenceId: string,
    input: ConnectEvidenceHypothesisInput
  ): Promise<ConfirmAndApplyEvidenceResult> {
    const evidence = await store.getEvidence(evidenceId);
    if (!evidence) throw new Error(`Evidence not found: ${evidenceId}`);
    const hypothesis = await store.getHypothesis(input.hypothesisId);
    if (!hypothesis) throw new Error(`Hypothesis not found: ${input.hypothesisId}`);
    const parsed = connectEvidenceHypothesisSchema.parse(input);
    const links = new Map(evidence.links.map((link) => [link.hypothesisId, link]));
    links.set(parsed.hypothesisId, {
      id: createRecordId("evidence_link"),
      evidenceId,
      hypothesisId: parsed.hypothesisId,
      direction: parsed.direction,
      relevance: parsed.relevance,
      likelihoodRatio: parsed.likelihoodRatio,
      confidence: parsed.confidence,
      rationale: parsed.rationale,
      createdAt: now()
    });

    return updateAndReapplyEvidence(evidenceId, {
      title: evidence.title,
      content: evidence.content,
      url: evidence.url,
      credibility: evidence.credibility,
      metadata: evidence.metadata,
      links: [...links.values()].map((link) => ({
        hypothesisId: link.hypothesisId,
        direction: link.direction,
        relevance: link.relevance,
        likelihoodRatio: link.likelihoodRatio,
        confidence: link.confidence,
        rationale: link.rationale
      }))
    });
  }

  async function rejectEvidence(evidenceId: string) {
    const existing = await store.getEvidence(evidenceId);
    if (!existing) throw new Error(`Evidence not found: ${evidenceId}`);
    await rollbackAppliedEvidenceEvents(evidenceId);
    await store.updateObservation(existing.observationId, { status: "REJECTED" });
    return store.updateEvidence(evidenceId, { status: "REJECTED" });
  }

  async function recommendedEvidenceLinks(
    observation: Awaited<ReturnType<typeof createObservation>>,
    threshold: number
  ): Promise<ConfirmEvidenceInput["links"]> {
    const signal = `${observation.title}\n${observation.content}`;
    const beliefs = await store.listBeliefs();
    const ranked = beliefs
      .flatMap((belief) =>
        belief.hypotheses
          .filter((hypothesis) => hypothesis.status === "ACTIVE")
          .map((hypothesis) => {
            const score = overlapScore(signal, `${belief.title} ${hypothesis.proposition} ${hypothesis.notes}`);
            return { belief, hypothesis, score };
          })
      )
      .filter((candidate) => candidate.score >= threshold)
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];
    if (!best) return [];

    if (options.likelihoodEstimator) {
      const output = await options.likelihoodEstimator.estimate({
        evidenceText: `${observation.title}\n${observation.content}`,
        hypothesis: best.hypothesis.proposition,
        category: best.belief.category,
        sourceCredibility: observation.credibility,
        context: `${best.belief.title}\n${best.belief.description}\n${best.hypothesis.notes}`
      });

      if (isUsableEstimatorOutput(output)) {
        return [
          {
            hypothesisId: best.hypothesis.id,
            direction: estimatorDirection(output),
            relevance: output.relevance ?? Math.min(1, Math.max(0.1, best.score)),
            likelihoodRatio: output.likelihoodRatio ?? 1,
            confidence: output.confidence ?? 0.1,
            rationale: output.rationale ?? `LLM 自动关联到「${best.belief.title}」下的假设：${best.hypothesis.proposition}`
          }
        ];
      }
    }

    return [
      {
        hypothesisId: best.hypothesis.id,
        direction: "SUPPORTS",
        relevance: Math.min(1, Math.max(0.1, best.score)),
        likelihoodRatio: 1 + Math.min(2, best.score * 2),
        confidence: Math.min(0.95, Math.max(0.1, best.score)),
        rationale: `自动关联到「${best.belief.title}」下的假设：${best.hypothesis.proposition}`
      }
    ];
  }

  async function generateEvidenceLoopQueries(loopOptions: EvidenceLoopOptions = {}): Promise<EvidenceLoopQuery[]> {
    const beliefIds = new Set(loopOptions.beliefIds?.filter(Boolean));
    const beliefs = (await store.listBeliefs()).filter((belief) => {
      if (belief.status !== "ACTIVE") return false;
      return beliefIds.size === 0 || beliefIds.has(belief.id);
    });
    const seen = new Set<string>();
    const queries: EvidenceLoopQuery[] = [];

    for (const belief of beliefs) {
      for (const hypothesis of belief.hypotheses) {
        if (hypothesis.status !== "ACTIVE") continue;
        const query = [belief.title, hypothesis.proposition, hypothesis.notes]
          .map((value) => value.trim())
          .filter(Boolean)
          .join(" ");
        const key = `${hypothesis.id}:${query}`;
        if (!query || seen.has(key)) continue;
        seen.add(key);
        queries.push({
          beliefId: belief.id,
          hypothesisId: hypothesis.id,
          category: belief.category,
          query
        });
      }
    }

    return queries;
  }

  async function runSource(sourceId: string, runOptions: RunSourceOptions = {}) {
    const source = await store.getSource(sourceId);
    if (!source) throw new Error(`Source not found: ${sourceId}`);
    if (!source.enabled) throw new Error(`Source is disabled: ${source.name}`);

    const querySummary = runOptions.queries ?? [];
    const startedAt = now();
    try {
      const adapter = createSourceAdapter(source.kind, options.sourceAdapterDependencies);
      const fetchedObservations = await adapter.fetch({
        name: source.name,
        adapter: source.adapter,
        url: source.url,
        credentialRef: source.credentialRef,
        queries: querySummary.map((query) => query.query)
      });
      const rawObservations = runOptions.maxObservations ? fetchedObservations.slice(0, runOptions.maxObservations) : fetchedObservations;
      let deduplicatedCount = 0;
      let candidateCount = 0;
      let autoAppliedCount = 0;
      let reviewCount = 0;
      const threshold = runOptions.autoConfirmThreshold ?? source.autoConfirmThreshold;

      for (const rawObservation of rawObservations) {
        const observation = await createObservation({
          sourceId: source.id,
          title: rawObservation.title,
          content: rawObservation.content || rawObservation.title,
          url: rawObservation.url,
          author: rawObservation.author,
          publishedAt: rawObservation.publishedAt,
          credibility: source.credibility,
          metadata: rawObservation.sourceMetadata
        });

        if (observation.status === "DUPLICATE") {
          deduplicatedCount += 1;
          continue;
        }

        const links = await recommendedEvidenceLinks(observation, threshold);
        if (links.length === 0) {
          await store.updateObservation(observation.id, { status: "UNKNOWN" });
          reviewCount += 1;
          continue;
        }

        candidateCount += 1;
        if (runOptions.reviewOnly || !source.autoConfirm) {
          reviewCount += 1;
          continue;
        }

        await confirmAndApplyObservation({
          observationId: observation.id,
          confirmationMode: "AUTO",
          links
        });
        autoAppliedCount += 1;
      }

      return store.createObservationRun({
        id: createRecordId("observation_run"),
        sourceId,
        status: runOptions.reviewOnly ? "REVIEW_ONLY" : "SUCCESS",
        startedAt,
        finishedAt: now(),
        itemCount: rawObservations.length,
        deduplicatedCount,
        candidateCount,
        autoAppliedCount,
        reviewCount,
        queryCount: querySummary.length,
        querySummary
      });
    } catch (error) {
      return store.createObservationRun({
        id: createRecordId("observation_run"),
        sourceId,
        status: "FAILED",
        startedAt,
        finishedAt: now(),
        itemCount: 0,
        deduplicatedCount: 0,
        candidateCount: 0,
        autoAppliedCount: 0,
        reviewCount: 0,
        queryCount: querySummary.length,
        querySummary,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async function runEvidenceLoop(loopOptions: EvidenceLoopOptions = {}) {
    const queries = await generateEvidenceLoopQueries(loopOptions);
    const sourceIds = new Set(loopOptions.sourceIds?.filter(Boolean));
    const sources = (await store.listSources()).filter((source) => {
      if (!source.enabled || source.kind === "MANUAL") return false;
      return sourceIds.size === 0 || sourceIds.has(source.id);
    });
    const runs = [];

    for (const source of sources) {
      runs.push(
        await runSource(source.id, {
          reviewOnly: loopOptions.reviewOnly,
          autoConfirmThreshold: loopOptions.autoConfirmThreshold,
          maxObservations: loopOptions.maxObservations,
          queries
        })
      );
    }

    return {
      mode: loopOptions.reviewOnly ? "review-only" as const : "auto-apply" as const,
      queryCount: queries.length,
      sourceRunCount: runs.length,
      itemCount: runs.reduce((sum, run) => sum + run.itemCount, 0),
      deduplicatedCount: runs.reduce((sum, run) => sum + run.deduplicatedCount, 0),
      candidateCount: runs.reduce((sum, run) => sum + run.candidateCount, 0),
      autoAppliedCount: runs.reduce((sum, run) => sum + run.autoAppliedCount, 0),
      reviewCount: runs.reduce((sum, run) => sum + run.reviewCount, 0),
      failureCount: runs.filter((run) => run.status === "FAILED").length,
      queries,
      runs
    };
  }

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
      updateBelief: updateBeliefRecord,
      async createHypothesis(beliefId: string, input: CreateHypothesisInput) {
        const belief = await store.getBelief(beliefId);
        if (!belief) throw new Error(`Belief not found: ${beliefId}`);
        const parsed = createHypothesisSchema.parse(input);
        const createdAt = now();
        const hypothesis = await store.createHypothesis({
          id: createRecordId("hypothesis"),
          beliefId,
          proposition: parsed.proposition.trim(),
          notes: parsed.notes ?? "",
          stance: parsed.stance,
          priorProbability: parsed.priorProbability,
          currentProbability: parsed.priorProbability,
          strength: parsed.priorProbability,
          status: "ACTIVE",
          startsAt: parsed.startsAt,
          expiresAt: parsed.expiresAt,
          expiryCondition: parsed.expiryCondition,
          createdAt,
          updatedAt: createdAt
        });

        if (belief.probabilityMode === "MUTUALLY_EXCLUSIVE") {
          const updatedBelief = await store.getBelief(beliefId);
          if (updatedBelief) {
            const probabilities = normalizeMutuallyExclusive(
              updatedBelief.hypotheses.map((item) => item.currentProbability)
            );
            await store.updateHypothesisProbabilities(
              Object.fromEntries(updatedBelief.hypotheses.map((item, index) => [item.id, probabilities[index]]))
            );
          }
          return (await store.getHypothesis(hypothesis.id)) ?? hypothesis;
        }

        return hypothesis;
      },
      updateHypothesis: updateHypothesisRecord,
      listBeliefs() {
        return store.listBeliefs();
      },
      getBelief(id) {
        return store.getBelief(id);
      }
    },
    observations: {
      createObservation,
      rejectObservation,
      listObservations() {
        return store.listObservations();
      }
    },
    evidence: {
      confirmObservation,
      confirmAndApplyObservation,
      updateAndReapply: updateAndReapplyEvidence,
      connectHypothesis: connectEvidenceHypothesis,
      reject: rejectEvidence,
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
      createPreview,
      applyPreview,
      async rollback(eventId: string) {
        return rollbackEvent(eventId);
      }
    },
    sources: {
      listSources() {
        return store.listSources();
      },
      listRuns() {
        return store.listObservationRuns();
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
          deduplicatedCount,
          candidateCount: 0,
          autoAppliedCount: 0,
          reviewCount: 0,
          queryCount: 0,
          querySummary: []
        });
      },
      async runSource(sourceId: string, runOptions: RunSourceOptions = {}) {
        return runSource(sourceId, runOptions);
      }
    },
    automation: {
      runEvidenceLoop
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
