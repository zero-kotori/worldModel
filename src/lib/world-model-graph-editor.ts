import { getObservationRecommendedLinks } from "@/lib/world-model-observations-ui";
import type {
  BayesianUpdateEventRecord,
  BeliefRecord,
  EvidenceRecord,
  EvidenceStatus,
  LikelihoodRunRecord,
  ObservationRecord,
  ObservationSourceKind,
  ObservationSourceRecord
} from "@/server/services/types";
import { createReadableCodes, readableCode } from "@/lib/world-model-display";
import { isHypothesisCurrentlyEffective } from "@/lib/world-model-beliefs-ui";

export type WorldModelGraphEditorData = {
  sources: Array<{
    id: string;
    code: string;
    name: string;
    kind: ObservationSourceKind;
    url?: string;
    adapter: string;
    credentialRef?: string;
    credibility: number;
    enabled: boolean;
    autoConfirm: boolean;
    autoConfirmThreshold: number;
  }>;
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
    evidenceSearchQuery?: string;
    stance: string;
    priorProbability: number;
    currentProbability: number;
    status: string;
    startsAt?: Date;
    expiresAt?: Date;
    expiryCondition?: string;
    resolvedOutcome?: string;
  }>;
  evidence: Array<{
    id: string;
    code: string;
    title: string;
    content: string;
    url?: string;
    credibility: number;
    status: EvidenceStatus;
    links: Array<{
      hypothesisId: string;
      direction: string;
      relevance: number;
      likelihoodRatio: number;
      confidence: number;
      rationale: string;
    }>;
  }>;
  observations: Array<{
    id: string;
    sourceId?: string;
    code: string;
    title: string;
    content: string;
    url?: string;
    author?: string;
    credibility: number;
    status: string;
    links: WorldModelGraphEvidenceLinkEditorRow[];
  }>;
  updates: Array<{
    id: string;
    code: string;
    beliefId: string;
    evidenceId: string;
    likelihoodRunId?: string;
    likelihoodRunIds?: string[];
    likelihoodRunCode?: string;
    likelihoodRunCodes?: string[];
    priorSnapshot: Record<string, number>;
    posteriorSnapshot: Record<string, number>;
    status: BayesianUpdateEventRecord["status"];
    confidence: number;
    explanations: string[];
  }>;
};

export type WorldModelGraphEvidenceLinkEditorRow = {
  hypothesisId: string;
  hypothesisCode: string;
  beliefCode: string;
  beliefTitle: string;
  proposition: string;
  checked: boolean;
  direction: string;
  relevance: number;
  likelihoodRatio: number;
  confidence: number;
  rationale: string;
};

export type WorldModelGraphEvidenceEdgeEditorRow = WorldModelGraphEvidenceLinkEditorRow & {
  selected: boolean;
};

export type WorldModelGraphUpdateAudit = {
  updateId: string;
  updateCode: string;
  status: BayesianUpdateEventRecord["status"];
  confidence: number;
  likelihoodRunId?: string;
  likelihoodRunIds?: string[];
  likelihoodRunCode?: string;
  likelihoodRunCodes?: string[];
  evidenceCode: string;
  evidenceTitle: string;
  evidenceStatus?: EvidenceStatus;
  beliefCode: string;
  beliefTitle: string;
  explanations: string[];
  rows: Array<{
    hypothesisId: string;
    hypothesisCode: string;
    proposition: string;
    prior: number;
    posterior: number;
    delta: number;
    direction?: string;
    relevance?: number;
    likelihoodRatio?: number;
    linkConfidence?: number;
    rationale?: string;
  }>;
};

const defaultEvidenceLinkValues = {
  direction: "SUPPORTS",
  relevance: 0.5,
  likelihoodRatio: 1,
  confidence: 0.5,
  rationale: "从图谱编辑证据关联"
} as const;

function defaultObservationConnectionValues(hypothesis: WorldModelGraphEditorData["hypotheses"][number]) {
  const direction = hypothesis.stance === "OPPOSES" ? "OPPOSES" : "SUPPORTS";
  return {
    direction,
    relevance: 0.7,
    likelihoodRatio: direction === "OPPOSES" ? 0.67 : 1.5,
    confidence: 0.6,
    rationale: "从图谱连接确认的观察关联"
  };
}

export function createWorldModelGraphEditorData(data: {
  sources?: ObservationSourceRecord[];
  beliefs: BeliefRecord[];
  observations?: ObservationRecord[];
  evidence: EvidenceRecord[];
  updates: BayesianUpdateEventRecord[];
  likelihoodRuns?: LikelihoodRunRecord[];
}): WorldModelGraphEditorData {
  const hypotheses = data.beliefs.flatMap((belief) => belief.hypotheses);
  const sourceCodes = createReadableCodes(data.sources ?? [], "S", (source) => source.createdAt);
  const beliefCodes = createReadableCodes(data.beliefs, "B", (belief) => belief.createdAt);
  const hypothesisCodes = createReadableCodes(hypotheses, "H", (hypothesis) => hypothesis.createdAt);
  const observationCodes = createReadableCodes(data.observations ?? [], "O", (observation) => observation.observedAt);
  const evidenceCodes = createReadableCodes(data.evidence, "E", (evidence) => evidence.confirmedAt);
  const updateCodes = createReadableCodes(data.updates, "U", (event) => event.createdAt);
  const likelihoodRunCodes = createReadableCodes(data.likelihoodRuns ?? [], "L", (run) => run.createdAt);
  const beliefById = new Map(data.beliefs.map((belief) => [belief.id, belief] as const));
  const hypothesisById = new Map(hypotheses.map((hypothesis) => [hypothesis.id, hypothesis] as const));

  return {
    sources: (data.sources ?? []).map((source) => ({
      id: source.id,
      code: readableCode(sourceCodes, source.id, "S"),
      name: source.name,
      kind: source.kind,
      url: source.url,
      adapter: source.adapter,
      credentialRef: source.credentialRef,
      credibility: source.credibility,
      enabled: source.enabled,
      autoConfirm: source.autoConfirm,
      autoConfirmThreshold: source.autoConfirmThreshold
    })),
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
      evidenceSearchQuery: hypothesis.evidenceSearchQuery,
      stance: hypothesis.stance,
      priorProbability: hypothesis.priorProbability,
      currentProbability: hypothesis.currentProbability,
      status: hypothesis.status,
      startsAt: hypothesis.startsAt,
      expiresAt: hypothesis.expiresAt,
      expiryCondition: hypothesis.expiryCondition,
      resolvedOutcome: hypothesis.resolvedOutcome
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
    observations: (data.observations ?? []).map((observation) => ({
      id: observation.id,
      sourceId: observation.sourceId,
      code: readableCode(observationCodes, observation.id, "O"),
      title: observation.title,
      content: observation.content,
      url: observation.url,
      author: observation.author,
      credibility: observation.credibility,
      status: observation.status,
      links: getObservationRecommendedLinks(observation).flatMap((link) => {
        const hypothesis = hypothesisById.get(link.hypothesisId);
        if (!hypothesis) return [];
        if (!isHypothesisCurrentlyEffective(hypothesis)) return [];
        const belief = beliefById.get(hypothesis.beliefId);
        return {
          hypothesisId: hypothesis.id,
          hypothesisCode: readableCode(hypothesisCodes, hypothesis.id, "H"),
          beliefCode: belief ? readableCode(beliefCodes, belief.id, "B") : hypothesis.beliefId,
          beliefTitle: belief?.title ?? "已删除信念",
          proposition: hypothesis.proposition,
          checked: true,
          direction: link.direction,
          relevance: link.relevance,
          likelihoodRatio: link.likelihoodRatio,
          confidence: link.confidence,
          rationale: link.rationale
        };
      })
    })),
    updates: data.updates.map((event) => ({
      id: event.id,
      code: readableCode(updateCodes, event.id, "U"),
      beliefId: event.beliefId,
      evidenceId: event.evidenceId,
      likelihoodRunId: event.likelihoodRunId,
      likelihoodRunIds: event.likelihoodRunIds,
      likelihoodRunCode: event.likelihoodRunId ? readableCode(likelihoodRunCodes, event.likelihoodRunId, "L") : undefined,
      likelihoodRunCodes: (event.likelihoodRunIds ?? (event.likelihoodRunId ? [event.likelihoodRunId] : [])).map((id) =>
        readableCode(likelihoodRunCodes, id, "L")
      ),
      priorSnapshot: event.priorSnapshot,
      posteriorSnapshot: event.posteriorSnapshot,
      status: event.status,
      confidence: event.confidence,
      explanations: event.explanations
    }))
  };
}

export function createEvidenceLinkEditorRows(
  editor: WorldModelGraphEditorData,
  evidenceId: string
): WorldModelGraphEvidenceLinkEditorRow[] {
  const evidence = editor.evidence.find((item) => item.id === evidenceId);
  if (!evidence) return [];
  if (evidence.status !== "ACTIVE" && evidence.status !== "REJECTED") return [];

  const linkByHypothesisId = new Map(evidence.links.map((link) => [link.hypothesisId, link] as const));
  const beliefById = new Map(editor.beliefs.map((belief) => [belief.id, belief] as const));

  return editor.hypotheses.map((hypothesis) => {
    const link = linkByHypothesisId.get(hypothesis.id);
    const belief = beliefById.get(hypothesis.beliefId);
    return {
      hypothesisId: hypothesis.id,
      hypothesisCode: hypothesis.code,
      beliefCode: belief?.code ?? hypothesis.beliefId,
      beliefTitle: belief?.title ?? "已删除信念",
      proposition: hypothesis.proposition,
      checked: Boolean(link),
      direction: link?.direction ?? defaultEvidenceLinkValues.direction,
      relevance: link?.relevance ?? defaultEvidenceLinkValues.relevance,
      likelihoodRatio: link?.likelihoodRatio ?? defaultEvidenceLinkValues.likelihoodRatio,
      confidence: link?.confidence ?? defaultEvidenceLinkValues.confidence,
      rationale: link?.rationale ?? defaultEvidenceLinkValues.rationale
    };
  });
}

export function createEvidenceAuditRows(
  editor: WorldModelGraphEditorData,
  evidenceId: string
): WorldModelGraphEvidenceLinkEditorRow[] {
  const evidence = editor.evidence.find((item) => item.id === evidenceId);
  if (!evidence) return [];

  const hypothesisById = new Map(editor.hypotheses.map((hypothesis) => [hypothesis.id, hypothesis] as const));
  const beliefById = new Map(editor.beliefs.map((belief) => [belief.id, belief] as const));

  return evidence.links.map((link) => {
    const hypothesis = hypothesisById.get(link.hypothesisId);
    const belief = hypothesis ? beliefById.get(hypothesis.beliefId) : undefined;
    return {
      hypothesisId: link.hypothesisId,
      hypothesisCode: hypothesis?.code ?? "H-?",
      beliefCode: belief?.code ?? hypothesis?.beliefId ?? "B-UNKNOWN",
      beliefTitle: belief?.title ?? "已删除信念",
      proposition: hypothesis?.proposition ?? "已删除假设",
      checked: true,
      direction: link.direction,
      relevance: link.relevance,
      likelihoodRatio: link.likelihoodRatio,
      confidence: link.confidence,
      rationale: link.rationale
    };
  });
}

export function createEvidenceEdgeEditorRows(
  editor: WorldModelGraphEditorData,
  evidenceId: string,
  hypothesisId: string
): WorldModelGraphEvidenceEdgeEditorRow[] {
  const evidence = editor.evidence.find((item) => item.id === evidenceId);
  if (!evidence || (evidence.status !== "ACTIVE" && evidence.status !== "REJECTED")) return [];

  return createEvidenceAuditRows(editor, evidenceId)
    .map((row) => ({
      ...row,
      selected: row.hypothesisId === hypothesisId
    }))
    .sort((left, right) => Number(right.selected) - Number(left.selected));
}

export function createObservationConnectionEditorRows(
  editor: WorldModelGraphEditorData,
  observationId: string,
  targetHypothesisId: string
): WorldModelGraphEvidenceLinkEditorRow[] {
  const observation = editor.observations.find((item) => item.id === observationId);
  const targetHypothesis = editor.hypotheses.find((item) => item.id === targetHypothesisId);
  if (!observation || !targetHypothesis) return [];
  if (!isHypothesisCurrentlyEffective(targetHypothesis)) return [];

  const linkByHypothesisId = new Map(observation.links.map((link) => [link.hypothesisId, link] as const));
  const belief = editor.beliefs.find((item) => item.id === targetHypothesis.beliefId);

  return editor.hypotheses
    .filter((hypothesis) => hypothesis.beliefId === targetHypothesis.beliefId)
    .filter((hypothesis) => isHypothesisCurrentlyEffective(hypothesis))
    .map((hypothesis) => {
      const link = linkByHypothesisId.get(hypothesis.id);
      const defaults = defaultObservationConnectionValues(hypothesis);
      return {
        hypothesisId: hypothesis.id,
        hypothesisCode: hypothesis.code,
        beliefCode: belief?.code ?? hypothesis.beliefId,
        beliefTitle: belief?.title ?? "已删除信念",
        proposition: hypothesis.proposition,
        checked: hypothesis.id === targetHypothesisId || Boolean(link),
        direction: link?.direction ?? defaults.direction,
        relevance: link?.relevance ?? defaults.relevance,
        likelihoodRatio: link?.likelihoodRatio ?? defaults.likelihoodRatio,
        confidence: link?.confidence ?? defaults.confidence,
        rationale: link?.rationale ?? defaults.rationale
      };
    });
}

export function createUpdateAuditRows(editor: WorldModelGraphEditorData, updateId: string): WorldModelGraphUpdateAudit | null {
  const update = editor.updates.find((item) => item.id === updateId);
  if (!update) return null;

  const evidence = editor.evidence.find((item) => item.id === update.evidenceId);
  const belief = editor.beliefs.find((item) => item.id === update.beliefId);
  const hypothesisById = new Map(editor.hypotheses.map((hypothesis) => [hypothesis.id, hypothesis] as const));
  const evidenceLinkByHypothesisId = new Map((evidence?.links ?? []).map((link) => [link.hypothesisId, link] as const));
  const hypothesisIds = new Set([...Object.keys(update.priorSnapshot), ...Object.keys(update.posteriorSnapshot)]);

  return {
    updateId: update.id,
    updateCode: update.code,
    status: update.status,
    confidence: update.confidence,
    likelihoodRunId: update.likelihoodRunId,
    likelihoodRunIds: update.likelihoodRunIds,
    likelihoodRunCode: update.likelihoodRunCode,
    likelihoodRunCodes: update.likelihoodRunCodes,
    evidenceCode: evidence?.code ?? update.evidenceId,
    evidenceTitle: evidence?.title ?? "已删除证据",
    evidenceStatus: evidence?.status,
    beliefCode: belief?.code ?? update.beliefId,
    beliefTitle: belief?.title ?? "已删除信念",
    explanations: update.explanations.map((explanation) => formatUpdateExplanation(explanation, hypothesisById)),
    rows: [...hypothesisIds].map((hypothesisId) => {
      const hypothesis = hypothesisById.get(hypothesisId);
      const link = evidenceLinkByHypothesisId.get(hypothesisId);
      const prior = update.priorSnapshot[hypothesisId] ?? 0;
      const posterior = update.posteriorSnapshot[hypothesisId] ?? prior;
      return {
        hypothesisId,
        hypothesisCode: hypothesis?.code ?? "H-?",
        proposition: hypothesis?.proposition ?? "已删除假设",
        prior,
        posterior,
        delta: posterior - prior,
        direction: link?.direction,
        relevance: link?.relevance,
        likelihoodRatio: link?.likelihoodRatio,
        linkConfidence: link?.confidence,
        rationale: link?.rationale
      };
    })
  };
}

function formatUpdateExplanation(
  explanation: string,
  hypothesisById: Map<string, WorldModelGraphEditorData["hypotheses"][number]>
) {
  const match = explanation.match(/^([^:]+):\s*(.*)$/);
  if (!match) return explanation;
  const [, hypothesisId, rationale] = match;
  const hypothesis = hypothesisById.get(hypothesisId);
  if (!hypothesis) {
    return hypothesisId.startsWith("hypothesis_") ? `H-? · 已删除假设: ${rationale}` : explanation;
  }
  return `${hypothesis.code} · ${hypothesis.proposition}: ${rationale}`;
}
