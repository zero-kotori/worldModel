import type {
  BayesianUpdateEvent,
  Belief,
  Evidence,
  EvidenceHypothesisLink,
  Hypothesis,
  LikelihoodRun,
  ModelArtifact,
  Observation,
  ObservationRun,
  ObservationSource,
  Prisma,
  PrismaClient
} from "@prisma/client";
import type { EstimatorOutput } from "@/domain/likelihood";
import type { ProbabilitySnapshot } from "@/domain/updates";
import type {
  BayesianUpdateEventRecord,
  BeliefRecord,
  EvidenceRecord,
  HypothesisRecord,
  LikelihoodRunRecord,
  ModelArtifactRecord,
  ObservationRecord,
  ObservationRunRecord,
  ObservationSourceRecord,
  WorldModelStore
} from "@/server/services/types";

type BeliefWithHypotheses = Belief & { hypotheses: Hypothesis[] };
type EvidenceWithLinks = Evidence & { hypothesisLinks: EvidenceHypothesisLink[] };

function jsonObject(value: Prisma.JsonValue): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function probabilitySnapshot(value: Prisma.JsonValue): ProbabilitySnapshot {
  const object = jsonObject(value);
  return Object.fromEntries(Object.entries(object).filter((entry): entry is [string, number] => typeof entry[1] === "number"));
}

function estimatorOutputs(value: Prisma.JsonValue): EstimatorOutput[] {
  return Array.isArray(value) ? (value as EstimatorOutput[]) : [];
}

function toHypothesisRecord(record: Hypothesis): HypothesisRecord {
  return {
    id: record.id,
    beliefId: record.beliefId,
    proposition: record.proposition,
    notes: record.notes,
    priorProbability: record.priorProbability,
    currentProbability: record.currentProbability,
    strength: record.strength,
    status: record.status,
    startsAt: record.startsAt ?? undefined,
    expiresAt: record.expiresAt ?? undefined,
    expiryCondition: record.expiryCondition ?? undefined,
    resolvedOutcome: record.resolvedOutcome ?? undefined,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function toBeliefRecord(record: BeliefWithHypotheses): BeliefRecord {
  return {
    id: record.id,
    title: record.title,
    category: record.category,
    description: record.description,
    probabilityMode: record.probabilityMode,
    status: record.status,
    hypotheses: record.hypotheses.map(toHypothesisRecord),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function toObservationRecord(record: Observation): ObservationRecord {
  return {
    id: record.id,
    sourceId: record.sourceId ?? undefined,
    title: record.title,
    content: record.content,
    url: record.url ?? undefined,
    author: record.author ?? undefined,
    publishedAt: record.publishedAt ?? undefined,
    observedAt: record.observedAt,
    normalizedHash: record.normalizedHash ?? undefined,
    semanticKey: record.semanticKey ?? undefined,
    status: record.status,
    duplicateOfId: record.duplicateOfId ?? undefined,
    credibility: record.credibility,
    metadata: jsonObject(record.metadata)
  };
}

function toEvidenceRecord(record: EvidenceWithLinks): EvidenceRecord {
  return {
    id: record.id,
    observationId: record.observationId,
    title: record.title,
    content: record.content,
    url: record.url ?? undefined,
    confirmedAt: record.confirmedAt,
    confirmationMode: record.confirmationMode,
    credibility: record.credibility,
    status: record.status,
    metadata: jsonObject(record.metadata),
    links: record.hypothesisLinks.map((link) => ({
      id: link.id,
      evidenceId: link.evidenceId,
      hypothesisId: link.hypothesisId,
      direction: link.direction,
      relevance: link.relevance,
      likelihoodRatio: link.likelihoodRatio,
      confidence: link.confidence,
      rationale: link.rationale,
      createdAt: link.createdAt
    }))
  };
}

function toLikelihoodRunRecord(record: LikelihoodRun): LikelihoodRunRecord {
  return {
    id: record.id,
    evidenceId: record.evidenceId,
    hypothesisId: record.hypothesisId,
    ensembleLikelihoodRatio: record.ensembleLikelihoodRatio,
    ensembleConfidence: record.ensembleConfidence,
    estimatorOutputs: estimatorOutputs(record.estimatorOutputs),
    modelVersion: record.modelVersion,
    createdAt: record.createdAt
  };
}

function toUpdateEventRecord(record: BayesianUpdateEvent): BayesianUpdateEventRecord {
  return {
    id: record.id,
    beliefId: record.beliefId,
    evidenceId: record.evidenceId,
    likelihoodRunId: record.likelihoodRunId ?? undefined,
    priorSnapshot: probabilitySnapshot(record.priorSnapshot),
    posteriorSnapshot: probabilitySnapshot(record.posteriorSnapshot),
    mode: "APPLIED",
    status: record.status,
    confidence: 0,
    explanations: [],
    createdAt: record.createdAt,
    rolledBackAt: record.rolledBackAt ?? undefined
  };
}

function toSourceRecord(record: ObservationSource): ObservationSourceRecord {
  return {
    id: record.id,
    name: record.name,
    kind: record.kind,
    url: record.url ?? undefined,
    adapter: record.adapter,
    credentialRef: record.credentialRef ?? undefined,
    credibility: record.credibility,
    enabled: record.enabled,
    autoConfirm: record.autoConfirm,
    autoConfirmThreshold: record.autoConfirmThreshold,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function toObservationRunRecord(record: ObservationRun): ObservationRunRecord {
  return {
    id: record.id,
    sourceId: record.sourceId ?? undefined,
    status: record.status,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt ?? undefined,
    itemCount: record.itemCount,
    deduplicatedCount: record.deduplicatedCount,
    errorMessage: record.errorMessage ?? undefined
  };
}

function toModelArtifactRecord(record: ModelArtifact): ModelArtifactRecord {
  return {
    id: record.id,
    name: record.name,
    kind: record.kind,
    version: record.version,
    path: record.path,
    metrics: jsonObject(record.metrics),
    enabled: record.enabled,
    createdAt: record.createdAt
  };
}

export function createPrismaWorldModelStore(prisma: PrismaClient): WorldModelStore {
  return {
    async createBelief(input, hypotheses) {
      const record = await prisma.belief.create({
        data: {
          id: input.id,
          title: input.title,
          category: input.category,
          description: input.description,
          probabilityMode: input.probabilityMode,
          status: input.status,
          createdAt: input.createdAt,
          updatedAt: input.updatedAt,
          hypotheses: {
            create: hypotheses.map((hypothesis) => ({
              id: hypothesis.id,
              proposition: hypothesis.proposition,
              notes: hypothesis.notes,
              priorProbability: hypothesis.priorProbability,
              currentProbability: hypothesis.currentProbability,
              strength: hypothesis.strength,
              status: hypothesis.status,
              startsAt: hypothesis.startsAt,
              expiresAt: hypothesis.expiresAt,
              expiryCondition: hypothesis.expiryCondition,
              createdAt: hypothesis.createdAt,
              updatedAt: hypothesis.updatedAt
            }))
          }
        },
        include: { hypotheses: true }
      });
      return toBeliefRecord(record);
    },
    async listBeliefs() {
      const records = await prisma.belief.findMany({
        include: { hypotheses: true },
        orderBy: { updatedAt: "desc" }
      });
      return records.map(toBeliefRecord);
    },
    async getBelief(id) {
      const record = await prisma.belief.findUnique({ where: { id }, include: { hypotheses: true } });
      return record ? toBeliefRecord(record) : null;
    },
    async getHypothesis(id) {
      const record = await prisma.hypothesis.findUnique({ where: { id } });
      return record ? toHypothesisRecord(record) : null;
    },
    async updateHypothesisProbabilities(probabilities) {
      await prisma.$transaction(
        Object.entries(probabilities).map(([id, probability]) =>
          prisma.hypothesis.update({
            where: { id },
            data: { currentProbability: probability, strength: probability }
          })
        )
      );
    },
    async createObservation(input) {
      const record = await prisma.observation.create({
        data: {
          id: input.id,
          sourceId: input.sourceId,
          title: input.title,
          content: input.content,
          url: input.url,
          author: input.author,
          publishedAt: input.publishedAt,
          observedAt: input.observedAt,
          normalizedHash: input.normalizedHash,
          semanticKey: input.semanticKey,
          status: input.status,
          duplicateOfId: input.duplicateOfId,
          credibility: input.credibility,
          metadata: input.metadata as Prisma.InputJsonValue
        }
      });
      return toObservationRecord(record);
    },
    async listObservations() {
      const records = await prisma.observation.findMany({ orderBy: { observedAt: "desc" } });
      return records.map(toObservationRecord);
    },
    async getObservation(id) {
      const record = await prisma.observation.findUnique({ where: { id } });
      return record ? toObservationRecord(record) : null;
    },
    async updateObservation(id, patch) {
      const record = await prisma.observation.update({
        where: { id },
        data: {
          sourceId: patch.sourceId,
          title: patch.title,
          content: patch.content,
          url: patch.url,
          author: patch.author,
          publishedAt: patch.publishedAt,
          observedAt: patch.observedAt,
          normalizedHash: patch.normalizedHash,
          semanticKey: patch.semanticKey,
          status: patch.status,
          duplicateOfId: patch.duplicateOfId,
          credibility: patch.credibility,
          metadata: patch.metadata as Prisma.InputJsonValue | undefined
        }
      });
      return toObservationRecord(record);
    },
    async createEvidence(evidence) {
      const record = await prisma.evidence.create({
        data: {
          id: evidence.id,
          observationId: evidence.observationId,
          title: evidence.title,
          content: evidence.content,
          url: evidence.url,
          confirmedAt: evidence.confirmedAt,
          confirmationMode: evidence.confirmationMode,
          credibility: evidence.credibility,
          status: evidence.status,
          metadata: evidence.metadata as Prisma.InputJsonValue,
          hypothesisLinks: {
            create: evidence.links.map((link) => ({
              id: link.id,
              hypothesisId: link.hypothesisId,
              direction: link.direction,
              relevance: link.relevance,
              likelihoodRatio: link.likelihoodRatio,
              confidence: link.confidence,
              rationale: link.rationale,
              createdAt: link.createdAt
            }))
          }
        },
        include: { hypothesisLinks: true }
      });
      return toEvidenceRecord(record);
    },
    async getEvidence(id) {
      const record = await prisma.evidence.findUnique({ where: { id }, include: { hypothesisLinks: true } });
      return record ? toEvidenceRecord(record) : null;
    },
    async listEvidence() {
      const records = await prisma.evidence.findMany({
        include: { hypothesisLinks: true },
        orderBy: { confirmedAt: "desc" }
      });
      return records.map(toEvidenceRecord);
    },
    async createLikelihoodRun(input) {
      const record = await prisma.likelihoodRun.create({
        data: {
          id: input.id,
          evidenceId: input.evidenceId,
          hypothesisId: input.hypothesisId,
          ensembleLikelihoodRatio: input.ensembleLikelihoodRatio,
          ensembleConfidence: input.ensembleConfidence,
          estimatorOutputs: input.estimatorOutputs as Prisma.InputJsonValue,
          modelVersion: input.modelVersion,
          createdAt: input.createdAt
        }
      });
      return toLikelihoodRunRecord(record);
    },
    async createUpdateEvent(input) {
      const record = await prisma.bayesianUpdateEvent.create({
        data: {
          id: input.id,
          beliefId: input.beliefId,
          evidenceId: input.evidenceId,
          likelihoodRunId: input.likelihoodRunId,
          priorSnapshot: input.priorSnapshot as Prisma.InputJsonValue,
          posteriorSnapshot: input.posteriorSnapshot as Prisma.InputJsonValue,
          mode: input.mode,
          status: input.status,
          createdAt: input.createdAt,
          rolledBackAt: input.rolledBackAt
        }
      });
      return toUpdateEventRecord(record);
    },
    async listUpdateEvents() {
      const records = await prisma.bayesianUpdateEvent.findMany({ orderBy: { createdAt: "desc" } });
      return records.map(toUpdateEventRecord);
    },
    async getUpdateEvent(id) {
      const record = await prisma.bayesianUpdateEvent.findUnique({ where: { id } });
      return record ? toUpdateEventRecord(record) : null;
    },
    async updateUpdateEvent(id, patch) {
      const record = await prisma.bayesianUpdateEvent.update({
        where: { id },
        data: {
          status: patch.status,
          rolledBackAt: patch.rolledBackAt
        }
      });
      return toUpdateEventRecord(record);
    },
    async createSource(input) {
      const record = await prisma.observationSource.create({
        data: {
          id: input.id,
          name: input.name,
          kind: input.kind,
          url: input.url,
          adapter: input.adapter,
          credentialRef: input.credentialRef,
          credibility: input.credibility,
          enabled: input.enabled,
          autoConfirm: input.autoConfirm,
          autoConfirmThreshold: input.autoConfirmThreshold,
          createdAt: input.createdAt,
          updatedAt: input.updatedAt
        }
      });
      return toSourceRecord(record);
    },
    async listSources() {
      const records = await prisma.observationSource.findMany({ orderBy: { updatedAt: "desc" } });
      return records.map(toSourceRecord);
    },
    async getSource(id) {
      const record = await prisma.observationSource.findUnique({ where: { id } });
      return record ? toSourceRecord(record) : null;
    },
    async createObservationRun(input) {
      const record = await prisma.observationRun.create({
        data: {
          id: input.id,
          sourceId: input.sourceId,
          status: input.status,
          startedAt: input.startedAt,
          finishedAt: input.finishedAt,
          itemCount: input.itemCount,
          deduplicatedCount: input.deduplicatedCount,
          errorMessage: input.errorMessage
        }
      });
      return toObservationRunRecord(record);
    },
    async createModelArtifact(input) {
      const record = await prisma.modelArtifact.upsert({
        where: { name_version: { name: input.name, version: input.version } },
        update: {
          kind: input.kind,
          path: input.path,
          metrics: input.metrics as Prisma.InputJsonValue,
          enabled: input.enabled
        },
        create: {
          id: input.id,
          name: input.name,
          kind: input.kind,
          version: input.version,
          path: input.path,
          metrics: input.metrics as Prisma.InputJsonValue,
          enabled: input.enabled,
          createdAt: input.createdAt
        }
      });
      return toModelArtifactRecord(record);
    },
    async listModelArtifacts() {
      const records = await prisma.modelArtifact.findMany({ orderBy: { createdAt: "desc" } });
      return records.map(toModelArtifactRecord);
    }
  };
}
