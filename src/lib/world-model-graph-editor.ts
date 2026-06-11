import type { BayesianUpdateEventRecord, BeliefRecord, EvidenceRecord } from "@/server/services/types";
import { createReadableCodes, readableCode } from "@/lib/world-model-display";

export type WorldModelGraphEditorData = {
  beliefs: Array<{
    id: string;
    code: string;
    title: string;
    category: string;
    description: string;
    probabilityMode: string;
    status: string;
  }>;
  hypotheses: Array<{
    id: string;
    code: string;
    beliefId: string;
    proposition: string;
    notes: string;
    stance: string;
    priorProbability: number;
    currentProbability: number;
    status: string;
    startsAt?: Date;
    expiresAt?: Date;
    expiryCondition?: string;
  }>;
  evidence: Array<{
    id: string;
    code: string;
    title: string;
    content: string;
    url?: string;
    credibility: number;
    status: string;
    links: Array<{
      hypothesisId: string;
      direction: string;
      relevance: number;
      likelihoodRatio: number;
      confidence: number;
      rationale: string;
    }>;
  }>;
  updates: Array<{
    id: string;
    code: string;
    evidenceId: string;
    status: string;
  }>;
};

export function createWorldModelGraphEditorData(data: {
  beliefs: BeliefRecord[];
  evidence: EvidenceRecord[];
  updates: BayesianUpdateEventRecord[];
}): WorldModelGraphEditorData {
  const hypotheses = data.beliefs.flatMap((belief) => belief.hypotheses);
  const beliefCodes = createReadableCodes(data.beliefs, "B", (belief) => belief.createdAt);
  const hypothesisCodes = createReadableCodes(hypotheses, "H", (hypothesis) => hypothesis.createdAt);
  const evidenceCodes = createReadableCodes(data.evidence, "E", (evidence) => evidence.confirmedAt);
  const updateCodes = createReadableCodes(data.updates, "U", (event) => event.createdAt);

  return {
    beliefs: data.beliefs.map((belief) => ({
      id: belief.id,
      code: readableCode(beliefCodes, belief.id, "B"),
      title: belief.title,
      category: belief.category,
      description: belief.description,
      probabilityMode: belief.probabilityMode,
      status: belief.status
    })),
    hypotheses: hypotheses.map((hypothesis) => ({
      id: hypothesis.id,
      code: readableCode(hypothesisCodes, hypothesis.id, "H"),
      beliefId: hypothesis.beliefId,
      proposition: hypothesis.proposition,
      notes: hypothesis.notes,
      stance: hypothesis.stance,
      priorProbability: hypothesis.priorProbability,
      currentProbability: hypothesis.currentProbability,
      status: hypothesis.status,
      startsAt: hypothesis.startsAt,
      expiresAt: hypothesis.expiresAt,
      expiryCondition: hypothesis.expiryCondition
    })),
    evidence: data.evidence.map((evidence) => ({
      id: evidence.id,
      code: readableCode(evidenceCodes, evidence.id, "E"),
      title: evidence.title,
      content: evidence.content,
      url: evidence.url,
      credibility: evidence.credibility,
      status: evidence.status,
      links: evidence.links.map((link) => ({
        hypothesisId: link.hypothesisId,
        direction: link.direction,
        relevance: link.relevance,
        likelihoodRatio: link.likelihoodRatio,
        confidence: link.confidence,
        rationale: link.rationale
      }))
    })),
    updates: data.updates.map((event) => ({
      id: event.id,
      code: readableCode(updateCodes, event.id, "U"),
      evidenceId: event.evidenceId,
      status: event.status
    }))
  };
}
