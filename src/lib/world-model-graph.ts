import type { BayesianUpdateEventRecord, BeliefRecord, EvidenceRecord } from "@/server/services/types";
import { createReadableCodes, readableCode } from "@/lib/world-model-display";

export type WorldModelGraphNodeType = "belief" | "hypothesis" | "evidence" | "update";
export type WorldModelGraphEdgeRelation = "OWNS" | "INFLUENCES" | "PRODUCED" | "UPDATED";

export type WorldModelGraphNode = {
  id: string;
  type: WorldModelGraphNodeType;
  code: string;
  label: string;
  status?: string;
  probability?: number;
  strength?: number;
  credibility?: number;
};

export type WorldModelGraphEdge = {
  id: string;
  source: string;
  target: string;
  relation: WorldModelGraphEdgeRelation;
  label: string;
  direction?: string;
  relevance?: number;
  likelihoodRatio?: number;
  status?: string;
};

export type WorldModelGraph = {
  nodes: WorldModelGraphNode[];
  edges: WorldModelGraphEdge[];
};

function beliefStrength(belief: BeliefRecord) {
  const active = belief.hypotheses.filter((hypothesis) => hypothesis.status === "ACTIVE");
  if (active.length === 0) return 0;
  return (
    active.reduce(
      (sum, hypothesis) => sum + (hypothesis.stance === "OPPOSES" ? 1 - hypothesis.currentProbability : hypothesis.currentProbability),
      0
    ) / active.length
  );
}

export function createWorldModelGraph(data: {
  beliefs: BeliefRecord[];
  evidence: EvidenceRecord[];
  updates: BayesianUpdateEventRecord[];
}): WorldModelGraph {
  const beliefs = data.beliefs;
  const hypotheses = beliefs.flatMap((belief) => belief.hypotheses);
  const beliefCodes = createReadableCodes(beliefs, "B", (belief) => belief.createdAt);
  const hypothesisCodes = createReadableCodes(hypotheses, "H", (hypothesis) => hypothesis.createdAt);
  const evidenceCodes = createReadableCodes(data.evidence, "E", (evidence) => evidence.confirmedAt);
  const updateCodes = createReadableCodes(data.updates, "U", (event) => event.createdAt);

  const nodes: WorldModelGraphNode[] = [
    ...beliefs.map((belief) => ({
      id: belief.id,
      type: "belief" as const,
      code: readableCode(beliefCodes, belief.id, "B"),
      label: belief.title,
      status: belief.status,
      strength: beliefStrength(belief)
    })),
    ...hypotheses.map((hypothesis) => ({
      id: hypothesis.id,
      type: "hypothesis" as const,
      code: readableCode(hypothesisCodes, hypothesis.id, "H"),
      label: hypothesis.proposition,
      status: hypothesis.status,
      probability: hypothesis.currentProbability
    })),
    ...data.evidence.map((evidence) => ({
      id: evidence.id,
      type: "evidence" as const,
      code: readableCode(evidenceCodes, evidence.id, "E"),
      label: evidence.title,
      status: evidence.status,
      credibility: evidence.credibility
    })),
    ...data.updates.map((event) => ({
      id: event.id,
      type: "update" as const,
      code: readableCode(updateCodes, event.id, "U"),
      label: event.status,
      status: event.status
    }))
  ];

  const edges: WorldModelGraphEdge[] = [
    ...beliefs.flatMap((belief) =>
      belief.hypotheses.map((hypothesis) => ({
        id: `belief:${belief.id}:hypothesis:${hypothesis.id}`,
        source: belief.id,
        target: hypothesis.id,
        relation: "OWNS" as const,
        label: "包含"
      }))
    ),
    ...data.evidence.flatMap((evidence) =>
      evidence.links.map((link) => ({
        id: `evidence:${evidence.id}:hypothesis:${link.hypothesisId}`,
        source: evidence.id,
        target: link.hypothesisId,
        relation: "INFLUENCES" as const,
        label: `${link.direction} · 相关性 ${link.relevance.toFixed(2)} · LR ${link.likelihoodRatio.toFixed(2)}`,
        direction: link.direction,
        relevance: link.relevance,
        likelihoodRatio: link.likelihoodRatio,
        status: evidence.status
      }))
    ),
    ...data.updates.flatMap((event) => [
      {
        id: `evidence:${event.evidenceId}:update:${event.id}`,
        source: event.evidenceId,
        target: event.id,
        relation: "PRODUCED" as const,
        label: "产生更新",
        status: event.status
      },
      {
        id: `update:${event.id}:belief:${event.beliefId}`,
        source: event.id,
        target: event.beliefId,
        relation: "UPDATED" as const,
        label: "更新信念",
        status: event.status
      }
    ])
  ];

  return { nodes, edges };
}
