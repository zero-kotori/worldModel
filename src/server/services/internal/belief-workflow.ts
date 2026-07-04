import { normalizeMutuallyExclusive } from "@/domain/bayes";
import { createRecordId } from "@/server/services/in-memory-store";
import {
  createHypothesisSchema,
  parseBeliefInput,
  updateBeliefSchema,
  updateHypothesisSchema
} from "@/server/services/internal/schemas";
import type { WorldModelServiceContext } from "@/server/services/internal/service-context";
import { now } from "@/server/services/internal/shared";
import { createHypothesisRecommendations } from "@/server/services/internal/recommendations";
import type { UpdateWorkflow } from "@/server/services/internal/update-workflow";
import type {
  BeliefRecord,
  ConfirmEvidenceInput,
  CreateBeliefInput,
  CreateHypothesisInput,
  HypothesisRecord,
  HypothesisRecommendation,
  HypothesisRecommendationOptions,
  UpdateBeliefInput,
  UpdateHypothesisInput
} from "@/server/services/types";

export type BeliefWorkflowDependencies = {
  updateWorkflow: UpdateWorkflow;
  requeueUnmatchedObservationsForHypothesis(hypothesis: HypothesisRecord): Promise<void>;
  requeueSourceObservationForRecommendedHypotheses(
    sourceObservationId: string | undefined,
    hypotheses: HypothesisRecord[],
    directionForHypothesis?: (hypothesis: HypothesisRecord) => ConfirmEvidenceInput["links"][number]["direction"]
  ): Promise<void>;
  requeueSourceObservationForRecommendedHypothesis(
    sourceObservationId: string | undefined,
    hypothesis: HypothesisRecord
  ): Promise<void>;
};

export type BeliefWorkflow = {
  createBelief(input: CreateBeliefInput): Promise<BeliefRecord>;
  updateBeliefRecord(beliefId: string, input: UpdateBeliefInput): Promise<BeliefRecord>;
  createHypothesis(beliefId: string, input: CreateHypothesisInput): Promise<HypothesisRecord>;
  updateHypothesisRecord(hypothesisId: string, input: UpdateHypothesisInput): Promise<HypothesisRecord>;
  recommendHypotheses(beliefId: string, options?: HypothesisRecommendationOptions): Promise<HypothesisRecommendation[]>;
};

function createHypotheses(input: CreateBeliefInput, beliefId: string): HypothesisRecord[] {
  const priorProbabilities =
    input.probabilityMode === "MUTUALLY_EXCLUSIVE"
      ? normalizeMutuallyExclusive(input.hypotheses.map((hypothesis) => hypothesis.priorProbability))
      : input.hypotheses.map((hypothesis) => hypothesis.priorProbability);
  const currentProbabilityInputs = input.hypotheses.map((hypothesis) => hypothesis.currentProbability ?? hypothesis.priorProbability);
  const currentProbabilities =
    input.probabilityMode === "MUTUALLY_EXCLUSIVE" ? normalizeMutuallyExclusive(currentProbabilityInputs) : currentProbabilityInputs;
  const createdAt = now();

  return input.hypotheses.map((hypothesis, index) => ({
    id: createRecordId("hypothesis"),
    beliefId,
    proposition: hypothesis.proposition.trim(),
    notes: hypothesis.notes ?? "",
    evidenceSearchQuery: hypothesis.evidenceSearchQuery?.trim() ?? "",
    stance: hypothesis.stance ?? "SUPPORTS",
    priorProbability: priorProbabilities[index],
    currentProbability: currentProbabilities[index],
    strength: currentProbabilities[index],
    status: "ACTIVE",
    startsAt: hypothesis.startsAt,
    expiresAt: hypothesis.expiresAt,
    expiryCondition: hypothesis.expiryCondition,
    createdAt,
    updatedAt: createdAt
  }));
}

export function createBeliefWorkflow(
  context: WorldModelServiceContext,
  dependencies: BeliefWorkflowDependencies
): BeliefWorkflow {
  const { store, options } = context;
  const { updateWorkflow } = dependencies;

  async function activeEvidenceLinkedToHypothesis(hypothesisId: string) {
    return (await store.listEvidence())
      .filter(
        (evidence) =>
          evidence.status === "ACTIVE" &&
          evidence.links.some((link) => link.hypothesisId === hypothesisId)
      )
      .sort((left, right) => left.confirmedAt.getTime() - right.confirmedAt.getTime());
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
    const probabilityModeChanged = parsed.probabilityMode !== undefined && parsed.probabilityMode !== existing.probabilityMode;
    const updated = await store.updateBelief(beliefId, { ...parsed, updatedAt: now() });
    const hasActiveUpdates = (await store.listUpdateEvents()).some((event) => event.beliefId === beliefId && event.status === "APPLIED");
    if (probabilityModeChanged && hasActiveUpdates) {
      await updateWorkflow.rebaseActiveUpdatesForBelief(beliefId);
      return (await store.getBelief(beliefId)) ?? updated;
    }
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
    const activeUpdatesBeforeEdit = await store.listUpdateEvents();

    const beliefMoved = parsed.beliefId !== undefined && parsed.beliefId !== existing.beliefId;
    const effectivenessMayChange =
      parsed.status !== undefined || parsed.startsAt !== undefined || parsed.expiresAt !== undefined;
    const settlingHypothesis = parsed.status === "RESOLVED_TRUE" || parsed.status === "RESOLVED_FALSE";
    const currentProbabilityIsDerived =
      parsed.currentProbability !== undefined &&
      parsed.priorProbability === undefined &&
      !settlingHypothesis &&
      activeUpdatesBeforeEdit.some((event) => event.status === "APPLIED" && event.beliefId === existing.beliefId);
    const affectedEvidence = beliefMoved || effectivenessMayChange ? await activeEvidenceLinkedToHypothesis(hypothesisId) : [];
    for (const evidence of affectedEvidence) {
      await updateWorkflow.rollbackAppliedEvidenceEvents(evidence.id);
    }

    const updated = await store.updateHypothesis(hypothesisId, {
      ...parsed,
      currentProbability: currentProbabilityIsDerived
        ? undefined
        : parsed.currentProbability ?? (parsed.priorProbability !== undefined ? parsed.priorProbability : undefined),
      updatedAt: now()
    });
    await renormalizeMutuallyExclusiveBelief(existing.beliefId);
    if (updated.beliefId !== existing.beliefId) {
      await renormalizeMutuallyExclusiveBelief(updated.beliefId);
    }
    if (parsed.priorProbability !== undefined && updated.beliefId === existing.beliefId) {
      await updateWorkflow.rebaseActiveUpdatesForBelief(updated.beliefId);
    }
    if (currentProbabilityIsDerived && updated.beliefId === existing.beliefId) {
      await updateWorkflow.rebaseActiveUpdatesForBelief(updated.beliefId);
    }
    for (const evidence of affectedEvidence) {
      const latest = await store.getEvidence(evidence.id);
      if (latest?.status === "ACTIVE") {
        await updateWorkflow.applyEvidenceUpdates(latest.id);
      }
    }
    return (await store.getHypothesis(hypothesisId)) ?? updated;
  }

  async function createBelief(input: CreateBeliefInput) {
    const parsed = parseBeliefInput(input);
    const createdAt = now();
    const beliefId = createRecordId("belief");
    const hypotheses = createHypotheses(parsed, beliefId);
    const belief = await store.createBelief(
      {
        id: beliefId,
        title: parsed.title.trim(),
        category: parsed.category,
        description: parsed.description,
        probabilityMode: parsed.probabilityMode,
        origin: parsed.origin ?? "INTERNAL",
        status: "ACTIVE",
        createdAt,
        updatedAt: createdAt
      },
      hypotheses
    );
    await dependencies.requeueSourceObservationForRecommendedHypotheses(parsed.sourceObservationId, belief.hypotheses, (hypothesis) =>
      hypothesis.stance === "OPPOSES" ? "OPPOSES" : "SUPPORTS"
    );
    return belief;
  }

  async function createHypothesis(beliefId: string, input: CreateHypothesisInput) {
    const belief = await store.getBelief(beliefId);
    if (!belief) throw new Error(`Belief not found: ${beliefId}`);
    const parsed = createHypothesisSchema.parse(input);
    const createdAt = now();
    const hypothesis = await store.createHypothesis({
      id: createRecordId("hypothesis"),
      beliefId,
      proposition: parsed.proposition.trim(),
      notes: parsed.notes ?? "",
      evidenceSearchQuery: parsed.evidenceSearchQuery?.trim() ?? "",
      stance: parsed.stance,
      priorProbability: parsed.priorProbability,
      currentProbability: parsed.currentProbability ?? parsed.priorProbability,
      strength: parsed.currentProbability ?? parsed.priorProbability,
      status: "ACTIVE",
      startsAt: parsed.startsAt,
      expiresAt: parsed.expiresAt,
      expiryCondition: parsed.expiryCondition,
      createdAt,
      updatedAt: createdAt
    });

    let finalHypothesis = hypothesis;
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
      finalHypothesis = (await store.getHypothesis(hypothesis.id)) ?? hypothesis;
    }

    await dependencies.requeueSourceObservationForRecommendedHypothesis(parsed.sourceObservationId, finalHypothesis);
    await dependencies.requeueUnmatchedObservationsForHypothesis(finalHypothesis);
    return finalHypothesis;
  }

  async function recommendHypotheses(beliefId: string, recommendationOptions: HypothesisRecommendationOptions = {}) {
    const belief = await store.getBelief(beliefId);
    if (!belief) throw new Error(`Belief not found: ${beliefId}`);
    const observations = await store.listObservations();
    const scopedObservations = recommendationOptions.sourceObservationId
      ? observations.filter((observation) => observation.id === recommendationOptions.sourceObservationId)
      : observations;
    return createHypothesisRecommendations(
      belief,
      recommendationOptions,
      scopedObservations,
      options.hypothesisRecommendationGenerator
    );
  }

  return {
    createBelief,
    updateBeliefRecord,
    createHypothesis,
    updateHypothesisRecord,
    recommendHypotheses
  };
}
