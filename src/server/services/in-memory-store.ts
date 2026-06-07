import { randomUUID } from "node:crypto";
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

function cloneDate(date: Date | undefined) {
  return date ? new Date(date) : undefined;
}

function cloneHypothesis(record: HypothesisRecord): HypothesisRecord {
  return {
    ...record,
    startsAt: cloneDate(record.startsAt),
    expiresAt: cloneDate(record.expiresAt),
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt)
  };
}

function cloneBelief(record: BeliefRecord): BeliefRecord {
  return {
    ...record,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    hypotheses: record.hypotheses.map(cloneHypothesis)
  };
}

function cloneObservation(record: ObservationRecord): ObservationRecord {
  return {
    ...record,
    publishedAt: cloneDate(record.publishedAt),
    observedAt: new Date(record.observedAt),
    metadata: { ...record.metadata }
  };
}

function cloneEvidence(record: EvidenceRecord): EvidenceRecord {
  return {
    ...record,
    confirmedAt: new Date(record.confirmedAt),
    metadata: { ...record.metadata },
    links: record.links.map((link) => ({ ...link, createdAt: new Date(link.createdAt) }))
  };
}

export function createInMemoryWorldModelStore(): WorldModelStore {
  const beliefs: BeliefRecord[] = [];
  const observations: ObservationRecord[] = [];
  const evidenceItems: EvidenceRecord[] = [];
  const likelihoodRuns: LikelihoodRunRecord[] = [];
  const updateEvents: BayesianUpdateEventRecord[] = [];
  const sources: ObservationSourceRecord[] = [];
  const observationRuns: ObservationRunRecord[] = [];
  const modelArtifacts: ModelArtifactRecord[] = [];

  return {
    async createBelief(input, hypotheses) {
      const record = { ...input, hypotheses: hypotheses.map(cloneHypothesis) };
      beliefs.push(record);
      return cloneBelief(record);
    },
    async listBeliefs() {
      return beliefs.map(cloneBelief);
    },
    async getBelief(id) {
      const record = beliefs.find((belief) => belief.id === id);
      return record ? cloneBelief(record) : null;
    },
    async getHypothesis(id) {
      const hypothesis = beliefs.flatMap((belief) => belief.hypotheses).find((item) => item.id === id);
      return hypothesis ? cloneHypothesis(hypothesis) : null;
    },
    async updateHypothesisProbabilities(probabilities) {
      const now = new Date();
      for (const belief of beliefs) {
        belief.hypotheses = belief.hypotheses.map((hypothesis) => {
          if (probabilities[hypothesis.id] === undefined) return hypothesis;
          return {
            ...hypothesis,
            currentProbability: probabilities[hypothesis.id],
            strength: probabilities[hypothesis.id],
            updatedAt: now
          };
        });
      }
    },
    async createObservation(input) {
      observations.push(input);
      return cloneObservation(input);
    },
    async listObservations() {
      return observations.map(cloneObservation);
    },
    async getObservation(id) {
      const observation = observations.find((item) => item.id === id);
      return observation ? cloneObservation(observation) : null;
    },
    async updateObservation(id, patch) {
      const index = observations.findIndex((item) => item.id === id);
      if (index === -1) throw new Error(`Observation not found: ${id}`);
      observations[index] = { ...observations[index], ...patch };
      return cloneObservation(observations[index]);
    },
    async createEvidence(evidence) {
      evidenceItems.push(evidence);
      return cloneEvidence(evidence);
    },
    async getEvidence(id) {
      const evidence = evidenceItems.find((item) => item.id === id);
      return evidence ? cloneEvidence(evidence) : null;
    },
    async listEvidence() {
      return evidenceItems.map(cloneEvidence);
    },
    async createLikelihoodRun(input) {
      likelihoodRuns.push(input);
      return { ...input, createdAt: new Date(input.createdAt) };
    },
    async createUpdateEvent(input) {
      updateEvents.push(input);
      return { ...input, createdAt: new Date(input.createdAt), rolledBackAt: cloneDate(input.rolledBackAt) };
    },
    async getUpdateEvent(id) {
      const event = updateEvents.find((item) => item.id === id);
      return event ? { ...event, createdAt: new Date(event.createdAt), rolledBackAt: cloneDate(event.rolledBackAt) } : null;
    },
    async updateUpdateEvent(id, patch) {
      const index = updateEvents.findIndex((item) => item.id === id);
      if (index === -1) throw new Error(`Update event not found: ${id}`);
      updateEvents[index] = { ...updateEvents[index], ...patch };
      return {
        ...updateEvents[index],
        createdAt: new Date(updateEvents[index].createdAt),
        rolledBackAt: cloneDate(updateEvents[index].rolledBackAt)
      };
    },
    async createSource(input) {
      sources.push(input);
      return { ...input, createdAt: new Date(input.createdAt), updatedAt: new Date(input.updatedAt) };
    },
    async getSource(id) {
      const source = sources.find((item) => item.id === id);
      return source ? { ...source, createdAt: new Date(source.createdAt), updatedAt: new Date(source.updatedAt) } : null;
    },
    async createObservationRun(input) {
      observationRuns.push(input);
      return {
        ...input,
        startedAt: new Date(input.startedAt),
        finishedAt: cloneDate(input.finishedAt)
      };
    },
    async createModelArtifact(input) {
      const existing = modelArtifacts.find((item) => item.name === input.name && item.version === input.version);
      const record = existing ? { ...input, id: existing.id, createdAt: existing.createdAt } : input;
      if (existing) {
        Object.assign(existing, record);
      } else {
        modelArtifacts.push(record);
      }
      return { ...record, createdAt: new Date(record.createdAt) };
    }
  };
}

export function createRecordId(prefix: string) {
  return `${prefix}_${randomUUID()}`;
}
