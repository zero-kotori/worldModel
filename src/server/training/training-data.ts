export type TrainingLabel = "SUPPORTS" | "OPPOSES" | "NEUTRAL";
export type TrainingSampleSource = "fever" | "scifact" | "climate_fever" | "cfever" | "local_confirmed";

export type TrainingSample = {
  source: TrainingSampleSource;
  claim: string;
  evidence: string;
  label: TrainingLabel;
  relevance: number;
  likelihoodRatio: number;
  confidence: number;
  provenance: {
    dataset: string;
    split: string;
    sourceId: string;
  };
};

type RowContext = {
  dataset: string;
  split: string;
  rowIndex: number;
};

type FeverNliRow = {
  cid?: number | string;
  premise?: string;
  hypothesis?: string;
  fever_gold_label?: string;
  label?: number | string;
};

type SciFactRow = {
  claim_id?: number | string;
  claim?: string;
  title?: string;
  abstract?: string[];
  verdict?: string;
  evidence?: number[];
};

type ClimateFeverRow = {
  claim_id?: number | string;
  claim?: string;
  evidences?: Array<{
    evidence_id?: number | string;
    evidence_label?: number | string;
    evidence?: string;
  }>;
};

function clean(value: unknown) {
  return String(value ?? "").replaceAll(/\s+/g, " ").trim();
}

export function labelToLikelihoodRatio(label: TrainingLabel) {
  if (label === "SUPPORTS") return 2.5;
  if (label === "OPPOSES") return 0.4;
  return 1;
}

function normalizeLabel(value: unknown): TrainingLabel {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "0" || normalized === "ENTAILMENT" || normalized === "SUPPORT" || normalized === "SUPPORTS") return "SUPPORTS";
  if (
    normalized === "2" ||
    normalized === "CONTRADICTION" ||
    normalized === "CONTRADICT" ||
    normalized === "REFUTE" ||
    normalized === "REFUTES"
  ) {
    return "OPPOSES";
  }
  return "NEUTRAL";
}

function normalizeClimateEvidenceLabel(value: unknown): TrainingLabel {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "0" || normalized === "SUPPORTS") return "SUPPORTS";
  if (normalized === "1" || normalized === "REFUTES") return "OPPOSES";
  return "NEUTRAL";
}

function createSample(input: {
  source: TrainingSampleSource;
  claim: string;
  evidence: string;
  label: TrainingLabel;
  relevance: number;
  confidence: number;
  context: RowContext;
  sourceId: string;
}): TrainingSample[] {
  const claim = clean(input.claim);
  const evidence = clean(input.evidence);
  if (!claim || !evidence) return [];
  return [
    {
      source: input.source,
      claim,
      evidence,
      label: input.label,
      relevance: input.relevance,
      likelihoodRatio: labelToLikelihoodRatio(input.label),
      confidence: input.confidence,
      provenance: {
        dataset: input.context.dataset,
        split: input.context.split,
        sourceId: input.sourceId
      }
    }
  ];
}

export function convertFeverNliRow(row: FeverNliRow, context: RowContext): TrainingSample[] {
  const label = normalizeLabel(row.fever_gold_label ?? row.label);
  return createSample({
    source: "fever",
    claim: row.premise ?? "",
    evidence: row.hypothesis ?? "",
    label,
    relevance: label === "NEUTRAL" ? 0.35 : 0.9,
    confidence: label === "NEUTRAL" ? 0.55 : 0.85,
    context,
    sourceId: `${row.cid ?? "unknown"}:${context.rowIndex}`
  });
}

export function convertSciFactRow(row: SciFactRow, context: RowContext): TrainingSample[] {
  const label = normalizeLabel(row.verdict);
  const abstract = Array.isArray(row.abstract) ? row.abstract : [];
  const selectedSentences =
    Array.isArray(row.evidence) && row.evidence.length > 0
      ? row.evidence.map((index) => abstract[index]).filter(Boolean)
      : abstract;
  const evidenceText = [row.title, selectedSentences.join(" ")].filter(Boolean).join(". ");
  return createSample({
    source: "scifact",
    claim: row.claim ?? "",
    evidence: evidenceText,
    label,
    relevance: label === "NEUTRAL" ? 0.4 : 0.95,
    confidence: label === "NEUTRAL" ? 0.55 : 0.9,
    context,
    sourceId: `${row.claim_id ?? "unknown"}:${context.rowIndex}`
  });
}

export function convertClimateFeverRow(row: ClimateFeverRow, context: RowContext): TrainingSample[] {
  const evidences = Array.isArray(row.evidences) ? row.evidences : [];
  return evidences.flatMap((evidence, index) => {
    const label = normalizeClimateEvidenceLabel(evidence.evidence_label);
    return createSample({
      source: "climate_fever",
      claim: row.claim ?? "",
      evidence: evidence.evidence ?? "",
      label,
      relevance: label === "NEUTRAL" ? 0.35 : 0.9,
      confidence: label === "NEUTRAL" ? 0.55 : 0.85,
      context,
      sourceId: `${row.claim_id ?? "unknown"}:${evidence.evidence_id ?? index}`
    });
  });
}
