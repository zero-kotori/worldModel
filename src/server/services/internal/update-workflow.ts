import { normalizeMutuallyExclusive } from "@/domain/bayes";
import {
  applyUpdate,
  createUpdatePreview,
  rollbackUpdate,
  type BeliefForUpdate,
  type EvidenceLinkForUpdate,
  type ProbabilitySnapshot,
  type UpdatePreview
} from "@/domain/updates";
import { createRecordId } from "@/server/services/in-memory-store";
import { isCurrentlyEffectiveHypothesis, now } from "@/server/services/internal/shared";
import type { WorldModelServiceContext } from "@/server/services/internal/service-context";
import type {
  BayesianUpdateEventRecord,
  BeliefRecord,
  ConfirmEvidenceInput,
  EvidenceHypothesisLinkRecord,
  EvidenceRecord,
  HypothesisRecord
} from "@/server/services/types";

export type UpdateWorkflow = {
  resolveHypothesesForLinks(links: Array<{ hypothesisId: string }>): Promise<HypothesisRecord[]>;
  createEvidencePreviews(evidence: EvidenceRecord): Promise<UpdatePreview[]>;
  createPreview(evidenceId: string): Promise<UpdatePreview>;
  createPreviews(evidenceId: string): Promise<UpdatePreview[]>;
  createCandidatePreview(links: ConfirmEvidenceInput["links"], credibility: number): Promise<UpdatePreview>;
  applyPreview(
    preview: UpdatePreview,
    likelihoodRunId?: string,
    likelihoodRunIds?: string[]
  ): Promise<BayesianUpdateEventRecord>;
  applyEvidenceUpdates(
    evidenceId: string,
    likelihoodRunId?: string,
    likelihoodRunIdsByBeliefId?: Map<string, string[]>
  ): Promise<BayesianUpdateEventRecord[]>;
  rebaseActiveUpdatesForBelief(beliefId: string): Promise<ProbabilitySnapshot>;
  rollbackEvent(eventId: string): Promise<BayesianUpdateEventRecord & { restoredProbabilities: ProbabilitySnapshot }>;
  rollbackAppliedEvidenceEvents(evidenceId: string): Promise<void>;
};

function evidenceLinkToPreviewLink(link: EvidenceHypothesisLinkRecord, credibility: number): EvidenceLinkForUpdate {
  return {
    hypothesisId: link.hypothesisId,
    likelihoodRatio: link.likelihoodRatio,
    credibility,
    confidence: link.confidence,
    rationale: link.rationale
  };
}

async function resolveHypothesesForLinks(
  context: WorldModelServiceContext,
  links: Array<{ hypothesisId: string }>
): Promise<HypothesisRecord[]> {
  const hypotheses = await Promise.all(links.map((link) => context.store.getHypothesis(link.hypothesisId)));
  const missingIndex = hypotheses.findIndex((hypothesis) => !hypothesis);
  if (missingIndex >= 0) {
    throw new Error(`Hypothesis not found: ${links[missingIndex].hypothesisId}`);
  }
  return hypotheses as HypothesisRecord[];
}

async function evidenceLinksForBelief(context: WorldModelServiceContext, evidence: EvidenceRecord, beliefId: string) {
  const hypotheses = await resolveHypothesesForLinks(context, evidence.links);
  const hypothesisById = new Map(hypotheses.map((hypothesis) => [hypothesis.id, hypothesis] as const));
  return evidence.links.filter((link) => {
    const hypothesis = hypothesisById.get(link.hypothesisId);
    return hypothesis?.beliefId === beliefId && isCurrentlyEffectiveHypothesis(hypothesis);
  });
}

async function createEvidencePreviews(context: WorldModelServiceContext, evidence: EvidenceRecord): Promise<UpdatePreview[]> {
  const { store } = context;

  if (evidence.status !== "ACTIVE") throw new Error(`Evidence is not active and cannot be applied: ${evidence.title}`);
  const hypotheses = await resolveHypothesesForLinks(context, evidence.links);
  const hypothesisById = new Map(hypotheses.map((hypothesis) => [hypothesis.id, hypothesis] as const));
  const linksByBeliefId = new Map<string, EvidenceHypothesisLinkRecord[]>();

  for (const link of evidence.links) {
    const hypothesis = hypothesisById.get(link.hypothesisId);
    if (!hypothesis) throw new Error(`Hypothesis not found: ${link.hypothesisId}`);
    if (!isCurrentlyEffectiveHypothesis(hypothesis)) continue;
    linksByBeliefId.set(hypothesis.beliefId, [...(linksByBeliefId.get(hypothesis.beliefId) ?? []), link]);
  }

  const previews: UpdatePreview[] = [];
  for (const [beliefId, links] of linksByBeliefId) {
    const belief = await store.getBelief(beliefId);
    if (!belief) throw new Error(`Belief not found: ${beliefId}`);
    previews.push({
      ...createUpdatePreview(
        {
          id: belief.id,
          probabilityMode: belief.probabilityMode,
          hypotheses: belief.hypotheses.map((hypothesis) => ({
            id: hypothesis.id,
            proposition: hypothesis.proposition,
            currentProbability: hypothesis.currentProbability,
            strength: hypothesis.strength
          }))
        },
        links.map((link) => evidenceLinkToPreviewLink(link, evidence.credibility))
      ),
      evidenceId: evidence.id
    });
  }

  return previews;
}

function baseProbabilitySnapshot(belief: BeliefRecord) {
  const probabilities =
    belief.probabilityMode === "MUTUALLY_EXCLUSIVE"
      ? normalizeMutuallyExclusive(belief.hypotheses.map((hypothesis) => hypothesis.priorProbability))
      : belief.hypotheses.map((hypothesis) => hypothesis.priorProbability);
  return Object.fromEntries(belief.hypotheses.map((hypothesis, index) => [hypothesis.id, probabilities[index]]));
}

function createBeliefForSnapshotPreview(belief: BeliefRecord, probabilities: Record<string, number>): BeliefForUpdate {
  return {
    id: belief.id,
    probabilityMode: belief.probabilityMode,
    hypotheses: belief.hypotheses.map((hypothesis) => ({
      id: hypothesis.id,
      proposition: hypothesis.proposition,
      currentProbability: probabilities[hypothesis.id] ?? hypothesis.currentProbability,
      strength: probabilities[hypothesis.id] ?? hypothesis.strength
    }))
  };
}

export function createUpdateWorkflow(context: WorldModelServiceContext): UpdateWorkflow {
  const { store } = context;

  async function createPreview(evidenceId: string) {
    const previews = await createPreviews(evidenceId);
    if (previews.length !== 1) {
      throw new Error("Evidence spans multiple beliefs and must be applied as grouped updates.");
    }
    return previews[0];
  }

  async function createPreviews(evidenceId: string) {
    const evidence = await store.getEvidence(evidenceId);
    if (!evidence) throw new Error(`Evidence not found: ${evidenceId}`);
    return createEvidencePreviews(context, evidence);
  }

  async function createCandidatePreview(links: ConfirmEvidenceInput["links"], credibility: number) {
    const hypotheses = await Promise.all(links.map((link) => store.getHypothesis(link.hypothesisId)));
    const presentHypotheses = hypotheses.filter((hypothesis): hypothesis is HypothesisRecord => Boolean(hypothesis));
    if (presentHypotheses.length !== links.length) {
      throw new Error("Evidence links reference missing hypotheses.");
    }
    const beliefIds = new Set(presentHypotheses.map((hypothesis) => hypothesis.beliefId));
    if (beliefIds.size !== 1) {
      throw new Error("A single update preview must target one belief.");
    }
    const belief = await store.getBelief(presentHypotheses[0].beliefId);
    if (!belief) throw new Error(`Belief not found: ${presentHypotheses[0].beliefId}`);

    return createUpdatePreview(
      {
        id: belief.id,
        probabilityMode: belief.probabilityMode,
        hypotheses: belief.hypotheses.map((hypothesis) => ({
          id: hypothesis.id,
          proposition: hypothesis.proposition,
          currentProbability: hypothesis.currentProbability,
          strength: hypothesis.strength
        }))
      },
      links.map((link) => ({
        hypothesisId: link.hypothesisId,
        likelihoodRatio: link.likelihoodRatio,
        credibility,
        confidence: link.confidence,
        rationale: link.rationale
      }))
    );
  }

  async function assertEvidenceHasNoActiveUpdate(evidenceId: string | undefined, beliefId?: string) {
    if (!evidenceId) return;
    const activeUpdate = (await store.listUpdateEvents()).find(
      (event) =>
        event.evidenceId === evidenceId &&
        event.status === "APPLIED" &&
        (beliefId === undefined || event.beliefId === beliefId)
    );
    if (activeUpdate) {
      throw new Error(`Evidence already has an active update: ${evidenceId}`);
    }
  }

  async function applyPreview(
    preview: UpdatePreview,
    likelihoodRunId?: string,
    likelihoodRunIds: string[] = likelihoodRunId ? [likelihoodRunId] : []
  ): Promise<BayesianUpdateEventRecord> {
    await assertEvidenceHasNoActiveUpdate(preview.evidenceId, preview.beliefId);
    const event = applyUpdate(preview, { id: createRecordId("update"), createdAt: now() });
    await store.updateHypothesisProbabilities(event.posteriorSnapshot);
    return store.createUpdateEvent({
      id: event.id,
      beliefId: event.beliefId,
      evidenceId: preview.evidenceId ?? "unknown",
      likelihoodRunId,
      likelihoodRunIds,
      priorSnapshot: event.priorSnapshot,
      posteriorSnapshot: event.posteriorSnapshot,
      mode: "APPLIED",
      status: "APPLIED",
      confidence: event.confidence,
      explanations: event.explanations,
      createdAt: event.createdAt
    });
  }

  async function applyEvidenceUpdates(
    evidenceId: string,
    likelihoodRunId?: string,
    likelihoodRunIdsByBeliefId: Map<string, string[]> = new Map()
  ): Promise<BayesianUpdateEventRecord[]> {
    const evidence = await store.getEvidence(evidenceId);
    if (!evidence) throw new Error(`Evidence not found: ${evidenceId}`);
    const previews = await createEvidencePreviews(context, evidence);
    const events: BayesianUpdateEventRecord[] = [];
    for (const preview of previews) {
      const beliefLikelihoodRunIds = likelihoodRunIdsByBeliefId.get(preview.beliefId) ?? (likelihoodRunId ? [likelihoodRunId] : []);
      events.push(await applyPreview(preview, beliefLikelihoodRunIds[0], beliefLikelihoodRunIds));
    }
    return events;
  }

  async function rebaseActiveUpdatesForBelief(beliefId: string) {
    const belief = await store.getBelief(beliefId);
    if (!belief) throw new Error(`Belief not found: ${beliefId}`);
    let probabilities = baseProbabilitySnapshot(belief);
    const activeEvents = (await store.listUpdateEvents())
      .filter((event) => event.beliefId === beliefId && event.status === "APPLIED")
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    for (const event of activeEvents) {
      const evidence = await store.getEvidence(event.evidenceId);
      if (!evidence || evidence.status !== "ACTIVE") continue;
      const links = await evidenceLinksForBelief(context, evidence, beliefId);
      if (links.length === 0) {
        await store.updateUpdateEvent(event.id, {
          status: "ROLLED_BACK",
          rolledBackAt: now()
        });
        continue;
      }
      const preview = createUpdatePreview(
        createBeliefForSnapshotPreview(belief, probabilities),
        links.map((link) => evidenceLinkToPreviewLink(link, evidence.credibility))
      );
      probabilities = preview.posteriorSnapshot;
      await store.updateUpdateEvent(event.id, {
        priorSnapshot: preview.priorSnapshot,
        posteriorSnapshot: preview.posteriorSnapshot
      });
    }

    await store.updateHypothesisProbabilities(probabilities);
    return probabilities;
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
    const saved = await store.updateUpdateEvent(eventId, {
      status: "ROLLED_BACK",
      rolledBackAt: rolledBack.rolledBackAt
    });
    const restoredProbabilities = await rebaseActiveUpdatesForBelief(event.beliefId);
    return { ...saved, restoredProbabilities };
  }

  async function rollbackAppliedEvidenceEvents(evidenceId: string) {
    const events = (await store.listUpdateEvents())
      .filter((event) => event.evidenceId === evidenceId && event.status === "APPLIED")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    for (const event of events) {
      await rollbackEvent(event.id);
    }
  }

  return {
    resolveHypothesesForLinks: (links) => resolveHypothesesForLinks(context, links),
    createEvidencePreviews: (evidence) => createEvidencePreviews(context, evidence),
    createPreview,
    createPreviews,
    createCandidatePreview,
    applyPreview,
    applyEvidenceUpdates,
    rebaseActiveUpdatesForBelief,
    rollbackEvent,
    rollbackAppliedEvidenceEvents
  };
}
