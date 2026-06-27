import type {
  BayesianUpdateEventRecord,
  BeliefRecord,
  EvidenceRecord,
  ObservationRecord,
  ObservationSourceRecord
} from "@/server/services/types";
import { createReadableCodes, readableCode } from "@/lib/world-model-display";
import { isHypothesisCurrentlyEffective } from "@/lib/world-model-beliefs-ui";

export type WorldModelGraphNodeType = "source" | "belief" | "hypothesis" | "observation" | "evidence" | "update";
export type WorldModelGraphEdgeRelation =
  | "COLLECTED"
  | "OWNS"
  | "CANDIDATE"
  | "CONFIRMED_AS"
  | "INFLUENCES"
  | "SETTLED"
  | "PRODUCED"
  | "UPDATED";

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

export type WorldModelGraphSourceData = {
  sources?: ObservationSourceRecord[];
  beliefs: BeliefRecord[];
  observations?: ObservationRecord[];
  evidence: EvidenceRecord[];
  updates: BayesianUpdateEventRecord[];
};

export type WorldModelGraphFocus =
  | string
  | {
      sourceId?: string;
      beliefId?: string;
      hypothesisId?: string;
      evidenceId?: string;
      updateId?: string;
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

function formatPointDelta(value: number) {
  const points = value * 100;
  const sign = points > 0 ? "+" : "";
  return `${sign}${points.toFixed(1)}pp`;
}

function largestUpdateDelta(event: BayesianUpdateEventRecord) {
  const hypothesisIds = new Set([...Object.keys(event.priorSnapshot), ...Object.keys(event.posteriorSnapshot)]);
  let selected: { hypothesisId: string; delta: number } | null = null;

  for (const hypothesisId of hypothesisIds) {
    const prior = event.priorSnapshot[hypothesisId] ?? 0;
    const posterior = event.posteriorSnapshot[hypothesisId] ?? prior;
    const delta = posterior - prior;
    if (!selected || Math.abs(delta) > Math.abs(selected.delta)) {
      selected = { hypothesisId, delta };
    }
  }

  return selected;
}

function updateEdgeLabel(event: BayesianUpdateEventRecord, hypothesisLabel: (hypothesisId: string) => string) {
  const delta = largestUpdateDelta(event);
  if (!delta) return "更新信念";
  return `更新信念 · ${hypothesisLabel(delta.hypothesisId)} ${formatPointDelta(delta.delta)}`;
}

function isReviewableObservation(observation: ObservationRecord) {
  return observation.status === "PENDING" || observation.status === "UNKNOWN";
}

function settlementHypothesisId(observation: ObservationRecord) {
  const hypothesisId = observation.metadata.settlementResolvedHypothesisId;
  return observation.status === "SETTLED" && typeof hypothesisId === "string" && hypothesisId.trim() ? hypothesisId : "";
}

function settlementEdgeLabel(observation: ObservationRecord) {
  if (observation.metadata.settlementOutcome === "RESOLVED_TRUE") return "结算为发生";
  if (observation.metadata.settlementOutcome === "RESOLVED_FALSE") return "结算为未发生";
  return "结算假设";
}

function graphableObservations(observations: ObservationRecord[] = [], evidence: EvidenceRecord[] = []) {
  const evidenceObservationIds = new Set(evidence.map((item) => item.observationId));
  return observations.filter(
    (observation) =>
      isReviewableObservation(observation) || evidenceObservationIds.has(observation.id) || Boolean(settlementHypothesisId(observation))
  );
}

function observationRecommendedLinks(observation: ObservationRecord) {
  const links = observation.metadata.recommendedLinks;
  if (!Array.isArray(links)) return [];
  return links.flatMap((link) => {
    if (!link || typeof link !== "object") return [];
    const candidate = link as Record<string, unknown>;
    if (
      typeof candidate.hypothesisId !== "string" ||
      typeof candidate.direction !== "string" ||
      typeof candidate.relevance !== "number" ||
      typeof candidate.likelihoodRatio !== "number"
    ) {
      return [];
    }
    return [
      {
        hypothesisId: candidate.hypothesisId,
        direction: candidate.direction,
        relevance: candidate.relevance,
        likelihoodRatio: candidate.likelihoodRatio
      }
    ];
  });
}

function evidenceInfluenceEdgeLabel(input: { status: string; direction: string; relevance: number; likelihoodRatio: number }) {
  const prefix = input.status === "REJECTED" ? "已拒绝 · " : "";
  return `${prefix}${input.direction} · 相关性 ${input.relevance.toFixed(2)} · LR ${input.likelihoodRatio.toFixed(2)}`;
}

function observationsForFocus(data: WorldModelGraphSourceData, evidenceIds: Set<string>, hypothesisIds: Set<string>) {
  const evidenceObservationIds = new Set(
    data.evidence.flatMap((item) => (evidenceIds.has(item.id) ? [item.observationId] : []))
  );
  return data.observations?.filter(
    (observation) =>
      evidenceObservationIds.has(observation.id) ||
      hypothesisIds.has(settlementHypothesisId(observation)) ||
      observationRecommendedLinks(observation).some((link) => hypothesisIds.has(link.hypothesisId))
  );
}

function focusByBelief(data: WorldModelGraphSourceData, beliefId?: string): WorldModelGraphSourceData {
  if (!beliefId) return data;

  const selectedBelief = data.beliefs.find((belief) => belief.id === beliefId);
  if (!selectedBelief) return data;

  const hypothesisIds = new Set(selectedBelief.hypotheses.map((hypothesis) => hypothesis.id));
  const evidence = data.evidence.flatMap((item) => {
    const links = item.links.filter((link) => hypothesisIds.has(link.hypothesisId));
    return links.length > 0 ? [{ ...item, links }] : [];
  });
  const evidenceIds = new Set(evidence.map((item) => item.id));
  const observations = observationsForFocus(data, evidenceIds, hypothesisIds);
  const updates = data.updates.filter((event) => event.beliefId === selectedBelief.id && evidenceIds.has(event.evidenceId));

  return {
    sources: data.sources,
    beliefs: [selectedBelief],
    observations,
    evidence,
    updates
  };
}

function beliefWithHypotheses(belief: BeliefRecord, hypothesisIds: Set<string>) {
  const hypotheses = belief.hypotheses.filter((hypothesis) => hypothesisIds.has(hypothesis.id));
  return { ...belief, hypotheses: hypotheses.length > 0 ? hypotheses : belief.hypotheses };
}

function focusByUpdate(data: WorldModelGraphSourceData, updateId: string): WorldModelGraphSourceData {
  const selectedUpdate = data.updates.find((event) => event.id === updateId);
  if (!selectedUpdate) return data;

  const selectedBelief = data.beliefs.find((belief) => belief.id === selectedUpdate.beliefId);
  const selectedEvidence = data.evidence.find((evidence) => evidence.id === selectedUpdate.evidenceId);
  if (!selectedBelief || !selectedEvidence) return data;

  const selectedBeliefHypothesisIds = new Set(selectedBelief.hypotheses.map((hypothesis) => hypothesis.id));
  const updatedHypothesisIds = new Set([...Object.keys(selectedUpdate.priorSnapshot), ...Object.keys(selectedUpdate.posteriorSnapshot)]);
  const linkedHypothesisIds = new Set(
    selectedEvidence.links
      .map((link) => link.hypothesisId)
      .filter((hypothesisId) => selectedBeliefHypothesisIds.has(hypothesisId))
  );
  const hypothesisIds = new Set(
    [...updatedHypothesisIds, ...linkedHypothesisIds].filter((hypothesisId) => selectedBeliefHypothesisIds.has(hypothesisId))
  );
  const evidenceIds = new Set([selectedEvidence.id]);

  return {
    sources: data.sources,
    beliefs: [beliefWithHypotheses(selectedBelief, hypothesisIds)],
    observations: observationsForFocus(data, evidenceIds, hypothesisIds),
    evidence: [
      {
        ...selectedEvidence,
        links: selectedEvidence.links.filter((link) => hypothesisIds.has(link.hypothesisId))
      }
    ],
    updates: [selectedUpdate]
  };
}

function focusByEvidence(data: WorldModelGraphSourceData, evidenceId: string): WorldModelGraphSourceData {
  const selectedEvidence = data.evidence.find((evidence) => evidence.id === evidenceId);
  if (!selectedEvidence) return data;

  const linkedHypothesisIds = new Set(selectedEvidence.links.map((link) => link.hypothesisId));
  const beliefs = data.beliefs.flatMap((belief) => {
    const hypothesisIds = new Set(belief.hypotheses.filter((hypothesis) => linkedHypothesisIds.has(hypothesis.id)).map((hypothesis) => hypothesis.id));
    return hypothesisIds.size > 0 ? [beliefWithHypotheses(belief, hypothesisIds)] : [];
  });
  const beliefIds = new Set(beliefs.map((belief) => belief.id));
  const evidenceIds = new Set([selectedEvidence.id]);

  return {
    sources: data.sources,
    beliefs,
    observations: observationsForFocus(data, evidenceIds, linkedHypothesisIds),
    evidence: [selectedEvidence],
    updates: data.updates.filter((event) => event.evidenceId === selectedEvidence.id && beliefIds.has(event.beliefId))
  };
}

function focusByHypothesis(data: WorldModelGraphSourceData, hypothesisId: string): WorldModelGraphSourceData {
  const selectedBelief = data.beliefs.find((belief) => belief.hypotheses.some((hypothesis) => hypothesis.id === hypothesisId));
  if (!selectedBelief) return data;

  const hypothesisIds = new Set([hypothesisId]);
  const evidence = data.evidence.flatMap((item) => {
    const links = item.links.filter((link) => link.hypothesisId === hypothesisId);
    return links.length > 0 ? [{ ...item, links }] : [];
  });
  const evidenceIds = new Set(evidence.map((item) => item.id));
  const updates = data.updates.filter(
    (event) =>
      event.beliefId === selectedBelief.id &&
      (evidenceIds.has(event.evidenceId) || hypothesisId in event.priorSnapshot || hypothesisId in event.posteriorSnapshot)
  );

  return {
    sources: data.sources,
    beliefs: [beliefWithHypotheses(selectedBelief, hypothesisIds)],
    observations: observationsForFocus(data, evidenceIds, hypothesisIds),
    evidence,
    updates
  };
}

function focusBySource(data: WorldModelGraphSourceData, sourceId: string): WorldModelGraphSourceData {
  const selectedSource = data.sources?.find((source) => source.id === sourceId);
  if (!selectedSource) return data;

  const observations = (data.observations ?? []).filter((observation) => observation.sourceId === sourceId);
  const observationIds = new Set(observations.map((observation) => observation.id));
  const evidence = data.evidence.filter((item) => observationIds.has(item.observationId));
  const evidenceIds = new Set(evidence.map((item) => item.id));
  const sourceUpdates = data.updates.filter((event) => evidenceIds.has(event.evidenceId));
  const hypothesisIds = new Set([
    ...observations.flatMap((observation) => observationRecommendedLinks(observation).map((link) => link.hypothesisId)),
    ...observations.map(settlementHypothesisId).filter(Boolean),
    ...evidence.flatMap((item) => item.links.map((link) => link.hypothesisId)),
    ...sourceUpdates.flatMap((event) => [...Object.keys(event.priorSnapshot), ...Object.keys(event.posteriorSnapshot)])
  ]);
  const beliefs = data.beliefs.flatMap((belief) => {
    const selectedHypothesisIds = new Set(
      belief.hypotheses.filter((hypothesis) => hypothesisIds.has(hypothesis.id)).map((hypothesis) => hypothesis.id)
    );
    return selectedHypothesisIds.size > 0 ? [beliefWithHypotheses(belief, selectedHypothesisIds)] : [];
  });
  const beliefIds = new Set(beliefs.map((belief) => belief.id));

  return {
    sources: [selectedSource],
    beliefs,
    observations,
    evidence,
    updates: sourceUpdates.filter((event) => beliefIds.size === 0 || beliefIds.has(event.beliefId))
  };
}

export function focusWorldModelGraphData(data: WorldModelGraphSourceData, focus?: WorldModelGraphFocus): WorldModelGraphSourceData {
  if (!focus) return data;
  if (typeof focus === "string") return focusByBelief(data, focus);
  if (focus.updateId) return focusByUpdate(data, focus.updateId);
  if (focus.evidenceId) return focusByEvidence(data, focus.evidenceId);
  if (focus.hypothesisId) return focusByHypothesis(data, focus.hypothesisId);
  if (focus.sourceId) return focusBySource(data, focus.sourceId);
  return focusByBelief(data, focus.beliefId);
}

function isSourceOnlyGraphData(data: WorldModelGraphSourceData) {
  return (
    (data.sources?.length ?? 0) === 1 &&
    data.beliefs.length === 0 &&
    (data.observations?.length ?? 0) === 0 &&
    data.evidence.length === 0 &&
    data.updates.length === 0
  );
}

export function createWorldModelGraph(data: WorldModelGraphSourceData, codeSourceData: WorldModelGraphSourceData = data): WorldModelGraph {
  const beliefs = data.beliefs;
  const hypotheses = beliefs.flatMap((belief) => belief.hypotheses);
  const effectiveHypothesisIds = new Set(hypotheses.filter((hypothesis) => isHypothesisCurrentlyEffective(hypothesis)).map((hypothesis) => hypothesis.id));
  const observations = graphableObservations(data.observations, data.evidence);
  const codeSourceObservations = graphableObservations(codeSourceData.observations, codeSourceData.evidence);
  const observationSourceIds = new Set(observations.map((observation) => observation.sourceId).filter((sourceId): sourceId is string => Boolean(sourceId)));
  const sources = isSourceOnlyGraphData(data) ? (data.sources ?? []) : (data.sources ?? []).filter((source) => observationSourceIds.has(source.id));
  const sourceIds = new Set(sources.map((source) => source.id));
  const codeSourceSources = codeSourceData.sources ?? [];
  const sourceCodes = createReadableCodes(codeSourceSources, "S", (source) => source.createdAt);
  const beliefCodes = createReadableCodes(codeSourceData.beliefs, "B", (belief) => belief.createdAt);
  const hypothesisCodes = createReadableCodes(
    codeSourceData.beliefs.flatMap((belief) => belief.hypotheses),
    "H",
    (hypothesis) => hypothesis.createdAt
  );
  const observationCodes = createReadableCodes(codeSourceObservations, "O", (observation) => observation.observedAt);
  const evidenceCodes = createReadableCodes(codeSourceData.evidence, "E", (evidence) => evidence.confirmedAt);
  const updateCodes = createReadableCodes(codeSourceData.updates, "U", (event) => event.createdAt);

  const nodes: WorldModelGraphNode[] = [
    ...sources.map((source) => ({
      id: source.id,
      type: "source" as const,
      code: readableCode(sourceCodes, source.id, "S"),
      label: source.name,
      status: source.enabled ? "ENABLED" : "DISABLED",
      credibility: source.credibility
    })),
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
    ...observations.map((observation) => ({
      id: observation.id,
      type: "observation" as const,
      code: readableCode(observationCodes, observation.id, "O"),
      label: observation.title,
      status: observation.status,
      credibility: observation.credibility
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
    ...observations.flatMap((observation) =>
      observation.sourceId && sourceIds.has(observation.sourceId)
        ? [
            {
              id: `source:${observation.sourceId}:observation:${observation.id}`,
              source: observation.sourceId,
              target: observation.id,
              relation: "COLLECTED" as const,
              label: "采集观察",
              status: observation.status
            }
          ]
        : []
    ),
    ...beliefs.flatMap((belief) =>
      belief.hypotheses.map((hypothesis) => ({
        id: `belief:${belief.id}:hypothesis:${hypothesis.id}`,
        source: belief.id,
        target: hypothesis.id,
        relation: "OWNS" as const,
        label: "包含"
      }))
    ),
    ...observations.flatMap((observation) =>
      observationRecommendedLinks(observation)
        .filter((link) => effectiveHypothesisIds.has(link.hypothesisId))
        .map((link) => ({
          id: `observation:${observation.id}:hypothesis:${link.hypothesisId}`,
          source: observation.id,
          target: link.hypothesisId,
          relation: "CANDIDATE" as const,
          label: `${link.direction} · 候选相关性 ${link.relevance.toFixed(2)} · LR ${link.likelihoodRatio.toFixed(2)}`,
          direction: link.direction,
          relevance: link.relevance,
          likelihoodRatio: link.likelihoodRatio,
          status: observation.status
        }))
    ),
    ...observations.flatMap((observation) => {
      const hypothesisId = settlementHypothesisId(observation);
      return hypothesisId && hypotheses.some((hypothesis) => hypothesis.id === hypothesisId)
        ? [
            {
              id: `observation:${observation.id}:settled:${hypothesisId}`,
              source: observation.id,
              target: hypothesisId,
              relation: "SETTLED" as const,
              label: settlementEdgeLabel(observation),
              status: observation.status
            }
          ]
        : [];
    }),
    ...data.evidence.flatMap((evidence) =>
      observations.some((observation) => observation.id === evidence.observationId)
        ? [
            {
              id: `observation:${evidence.observationId}:evidence:${evidence.id}`,
              source: evidence.observationId,
              target: evidence.id,
              relation: "CONFIRMED_AS" as const,
              label: "确认为证据",
              status: evidence.status
            }
          ]
        : []
    ),
    ...data.evidence.flatMap((evidence) =>
      evidence.links.map((link) => ({
        id: `evidence:${evidence.id}:hypothesis:${link.hypothesisId}`,
        source: evidence.id,
        target: link.hypothesisId,
        relation: "INFLUENCES" as const,
        label: evidenceInfluenceEdgeLabel({
          status: evidence.status,
          direction: link.direction,
          relevance: link.relevance,
          likelihoodRatio: link.likelihoodRatio
        }),
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
        label: updateEdgeLabel(event, (hypothesisId) => readableCode(hypothesisCodes, hypothesisId, "H")),
        status: event.status
      }
    ])
  ];

  return { nodes, edges };
}
