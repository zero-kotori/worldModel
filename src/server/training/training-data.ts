export type TrainingLabel = "SUPPORTS" | "OPPOSES" | "NEUTRAL";
export type TrainingSampleSource =
  | "fever"
  | "scifact"
  | "climate_fever"
  | "cfever"
  | "github"
  | "hugging_face"
  | "manifold"
  | "local_confirmed"
  | "local_resolved";

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

type TrainingSampleValidationOptions = {
  action: string;
  samplesPath?: string;
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

type CfeverEvidenceReference = {
  annotation_id?: number | string | null;
  evidence_id?: number | string | null;
  page_title?: string | null;
  sentence_id?: number | string | null;
};

type CfeverRow = {
  id?: number | string;
  label?: string;
  claim?: string;
  evidence?: CfeverEvidenceReference[][];
  domain?: string;
};

export type CfeverWikiPageRow = {
  id: string;
  lines: string;
};

type GithubRepositoryRow = {
  id?: number | string;
  full_name?: string;
  description?: string | null;
  language?: string | null;
  topics?: string[];
  stargazers_count?: number;
  forks_count?: number;
  open_issues_count?: number;
  archived?: boolean;
  pushed_at?: string | null;
  html_url?: string | null;
};

type HuggingFaceModelRow = {
  id?: string;
  modelId?: string;
  pipeline_tag?: string | null;
  tags?: string[];
  downloads?: number;
  likes?: number;
  lastModified?: string | null;
};

type ManifoldMarketRow = {
  id?: string;
  question?: string;
  description?: unknown;
  descriptionMarkdown?: string | null;
  url?: string | null;
  outcomeType?: string;
  isResolved?: boolean;
  resolution?: string | null;
  probability?: number;
  volume?: number;
  uniqueBettorCount?: number;
  closeTime?: number;
  resolutionTime?: number;
  createdTime?: number;
  creatorName?: string | null;
};

function clean(value: unknown) {
  return String(value ?? "").replaceAll(/\s+/g, " ").trim();
}

function isPositiveFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isUnitIntervalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function nonNegativeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function compactList(values: unknown[] | undefined, limit = 6) {
  if (!Array.isArray(values)) return "";
  return values.map(clean).filter(Boolean).slice(0, limit).join(", ");
}

function descriptionText(primary: unknown, fallback: unknown) {
  if (typeof primary === "string" && primary.trim()) return clean(primary);
  if (typeof fallback === "string" && fallback.trim()) return clean(fallback);
  return "";
}

function timestampText(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function isTrainingLabel(value: unknown): value is TrainingLabel {
  return value === "SUPPORTS" || value === "OPPOSES" || value === "NEUTRAL";
}

export function assertUsableTrainingSamples(samples: TrainingSample[], options: TrainingSampleValidationOptions) {
  const samplesPath = options.samplesPath ? ` at ${options.samplesPath}` : "";
  if (samples.length === 0) {
    throw new Error(`No real training samples found${samplesPath}. Run npm run train:fetch and npm run train:prepare first.`);
  }

  if (samples.some((sample) => String(sample.source) === "demo")) {
    throw new Error(`Refusing to ${options.action} demo training samples.`);
  }

  const invalid = samples.find((sample) => {
    const candidate = sample as Partial<TrainingSample>;
    return (
      !clean(candidate.source) ||
      !clean(candidate.claim) ||
      !clean(candidate.evidence) ||
      !isTrainingLabel(candidate.label) ||
      !isUnitIntervalNumber(candidate.relevance) ||
      !isPositiveFiniteNumber(candidate.likelihoodRatio) ||
      !isUnitIntervalNumber(candidate.confidence) ||
      !clean(candidate.provenance?.dataset) ||
      !clean(candidate.provenance?.split) ||
      !clean(candidate.provenance?.sourceId)
    );
  });

  if (invalid) {
    throw new Error(`Refusing to ${options.action} invalid training sample ${invalid.provenance?.sourceId ?? "unknown"}.`);
  }
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

function normalizeCfeverLabel(value: unknown): TrainingLabel {
  const normalized = String(value ?? "").trim().toUpperCase().replaceAll(/\s+/g, "_");
  if (normalized === "SUPPORTS" || normalized === "SUPPORT") return "SUPPORTS";
  if (normalized === "REFUTES" || normalized === "REFUTE") return "OPPOSES";
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

function wikiLineText(lines: string, sentenceId: number) {
  for (const line of lines.split(/\r?\n/)) {
    const [id, sentence] = line.split("\t", 2);
    if (Number(id) === sentenceId) return clean(sentence);
  }
  return "";
}

function cfeverEvidenceGroupText(group: CfeverEvidenceReference[], wikiPagesByTitle: Map<string, CfeverWikiPageRow>) {
  return group
    .map((reference) => {
      const pageTitle = clean(reference.page_title);
      const sentenceId = Number(reference.sentence_id);
      if (!pageTitle || !Number.isInteger(sentenceId)) return "";
      const page = wikiPagesByTitle.get(pageTitle);
      return page ? wikiLineText(page.lines, sentenceId) : "";
    })
    .filter(Boolean)
    .join(" ");
}

export function cfeverEvidencePageTitles(row: CfeverRow) {
  const seen = new Set<string>();
  const evidenceGroups = Array.isArray(row.evidence) ? row.evidence : [];
  for (const group of evidenceGroups) {
    for (const reference of group) {
      const pageTitle = clean(reference.page_title);
      if (pageTitle) seen.add(pageTitle);
    }
  }
  return [...seen];
}

export function convertCfeverRow(
  row: CfeverRow,
  context: RowContext,
  wikiPagesByTitle: Map<string, CfeverWikiPageRow>
): TrainingSample[] {
  const label = normalizeCfeverLabel(row.label);
  if (label === "NEUTRAL") return [];
  const evidenceGroups = Array.isArray(row.evidence) ? row.evidence : [];

  return evidenceGroups.flatMap((group, index) => {
    const evidence = cfeverEvidenceGroupText(group, wikiPagesByTitle);
    return createSample({
      source: "cfever",
      claim: row.claim ?? "",
      evidence,
      label,
      relevance: 0.9,
      confidence: 0.85,
      context,
      sourceId: `${row.id ?? "unknown"}:${context.rowIndex}:${index}`
    });
  });
}

export function convertGithubRepositoryRow(row: GithubRepositoryRow, context: RowContext): TrainingSample[] {
  const fullName = clean(row.full_name);
  if (!fullName) return [];

  const language = clean(row.language) || "software";
  const stars = nonNegativeNumber(row.stargazers_count);
  const forks = nonNegativeNumber(row.forks_count);
  const openIssues = nonNegativeNumber(row.open_issues_count);
  const topics = compactList(row.topics);
  const label: TrainingLabel = row.archived ? "OPPOSES" : stars >= 1000 || forks >= 100 ? "SUPPORTS" : "NEUTRAL";
  const evidence = [
    clean(row.description),
    `Stars: ${stars}`,
    `Forks: ${forks}`,
    `Open issues: ${openIssues}`,
    topics ? `Topics: ${topics}` : "",
    row.pushed_at ? `Last pushed: ${row.pushed_at}` : "",
    row.html_url ? `URL: ${row.html_url}` : "",
    row.archived ? "Archived: true" : "Archived: false"
  ].filter(Boolean).join(". ");

  return createSample({
    source: "github",
    claim: `${fullName} is an actively adopted ${language} project.`,
    evidence,
    label,
    relevance: label === "NEUTRAL" ? 0.45 : 0.75,
    confidence: label === "NEUTRAL" ? 0.55 : 0.72,
    context,
    sourceId: `${row.id ?? fullName}:${context.rowIndex}`
  });
}

export function convertHuggingFaceModelRow(row: HuggingFaceModelRow, context: RowContext): TrainingSample[] {
  const modelId = clean(row.modelId || row.id);
  if (!modelId) return [];

  const task = clean(row.pipeline_tag) || "model";
  const downloads = nonNegativeNumber(row.downloads);
  const likes = nonNegativeNumber(row.likes);
  const tags = compactList(row.tags);
  const label: TrainingLabel = downloads >= 1000 || likes >= 20 ? "SUPPORTS" : "NEUTRAL";
  const evidence = [
    `Downloads: ${downloads}`,
    `Likes: ${likes}`,
    tags ? `Tags: ${tags}` : "",
    row.lastModified ? `Last modified: ${row.lastModified}` : ""
  ].filter(Boolean).join(". ");

  return createSample({
    source: "hugging_face",
    claim: `${modelId} is a widely used Hugging Face ${task} model.`,
    evidence,
    label,
    relevance: label === "NEUTRAL" ? 0.45 : 0.75,
    confidence: label === "NEUTRAL" ? 0.55 : 0.72,
    context,
    sourceId: `${modelId}:${context.rowIndex}`
  });
}

export function convertManifoldMarketRow(row: ManifoldMarketRow, context: RowContext): TrainingSample[] {
  const question = clean(row.question);
  const resolution = clean(row.resolution).toUpperCase();
  if (!question || row.outcomeType !== "BINARY" || row.isResolved !== true || (resolution !== "YES" && resolution !== "NO")) {
    return [];
  }

  const label: TrainingLabel = resolution === "YES" ? "SUPPORTS" : "OPPOSES";
  const probability = typeof row.probability === "number" && Number.isFinite(row.probability) ? row.probability : null;
  const evidence = [
    `Resolved: ${resolution}`,
    descriptionText(row.description, row.descriptionMarkdown),
    probability === null ? "" : `Market probability before resolution: ${(probability * 100).toFixed(1)}%`,
    `Volume: ${nonNegativeNumber(row.volume)}`,
    `Unique bettors: ${nonNegativeNumber(row.uniqueBettorCount)}`,
    row.creatorName ? `Creator: ${row.creatorName}` : "",
    row.url ? `URL: ${row.url}` : "",
    timestampText(row.closeTime) ? `Close time: ${timestampText(row.closeTime)}` : "",
    timestampText(row.resolutionTime) ? `Resolution time: ${timestampText(row.resolutionTime)}` : ""
  ].filter(Boolean).join(". ");

  return createSample({
    source: "manifold",
    claim: question,
    evidence,
    label,
    relevance: 0.85,
    confidence: 0.78,
    context,
    sourceId: `${row.id ?? row.url ?? "unknown"}:${context.rowIndex}`
  });
}
