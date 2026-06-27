import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EstimatorOutput } from "@/domain/likelihood";
import { normalizeLlmConfig } from "@/lib/world-model-llm-config";
import { createConfiguredLlmEstimator } from "@/server/models/estimators";
import { summarizeLlmEvaluation, type LlmEvaluationItem, type LlmEvaluationSummary } from "@/server/training/llm-evaluation";
import { assertUsableTrainingSamples, type TrainingLabel, type TrainingSample } from "@/server/training/training-data";

type LightweightLocalArtifact = {
  name?: string;
  kind?: string;
  version?: string;
  trained?: boolean;
  biasLogLikelihoodRatio?: number;
  tokenWeights?: Record<string, number>;
};

export type RunLlmEvaluationCommandOptions = {
  outputDir?: string;
  samplesPath?: string;
  fallbackPath?: string;
  outputPath?: string;
  limit?: number;
  env?: Record<string, string | undefined>;
  fetcher?: typeof fetch;
  now?: () => Date;
};

export type RunLlmEvaluationCommandResult = {
  evaluated: true;
  outputPath: string;
  summary: LlmEvaluationSummary;
};

const tokenPattern = /[a-z0-9\u4e00-\u9fa5]+/gi;
const labelOrder: TrainingLabel[] = ["SUPPORTS", "OPPOSES", "NEUTRAL"];
const DEFAULT_EVALUATION_LIMIT = 30;
const FALLBACK_SUPPORT_DIRECTION_THRESHOLD = 1.5;
const FALLBACK_OPPOSE_DIRECTION_THRESHOLD = 1 / FALLBACK_SUPPORT_DIRECTION_THRESHOLD;

async function readJsonl<T>(filePath: string): Promise<T[]> {
  const text = await readFile(filePath, "utf8");
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as T);
}

async function readLightweightArtifact(filePath: string): Promise<LightweightLocalArtifact | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as LightweightLocalArtifact;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function defaultArtifactDir() {
  return path.join(process.cwd(), "model-artifacts");
}

function evaluationPaths(options: RunLlmEvaluationCommandOptions) {
  const outputDir = options.outputDir?.trim() ? path.resolve(process.cwd(), options.outputDir) : defaultArtifactDir();
  return {
    samplesPath: options.samplesPath ?? path.join(outputDir, "training-samples.jsonl"),
    fallbackPath: options.fallbackPath ?? path.join(outputDir, "lightweight-local.json"),
    outputPath: options.outputPath ?? path.join(outputDir, "llm-evaluation.json")
  };
}

function positiveLimit(value: number | undefined, fallback = DEFAULT_EVALUATION_LIMIT) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function assertLlmEvaluationConfigured(env: Record<string, string | undefined>) {
  const config = normalizeLlmConfig(env);
  const missing = [
    !config.apiKey ? "LLM_API_KEY" : "",
    !config.baseUrl ? "LLM_BASE_URL" : "",
    !config.model ? "LLM_MODEL" : ""
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(`LLM evaluation requires configured ${missing.join(", ")}. Set them in .env.local before running real-sample evaluation.`);
  }

  return config;
}

function tokens(value: string) {
  return new Set((value.match(tokenPattern) ?? []).map((token) => token.toLowerCase()).filter((token) => token.length >= 2));
}

function fallbackEstimate(sample: TrainingSample, artifact: LightweightLocalArtifact | null): EstimatorOutput | undefined {
  if (!artifact?.trained || !artifact.tokenWeights || typeof artifact.biasLogLikelihoodRatio !== "number") return undefined;
  const evidenceTokens = tokens(sample.evidence);
  const claimTokens = tokens(sample.claim);
  const overlap = [...evidenceTokens].filter((token) => claimTokens.has(token));
  const logLikelihoodRatio =
    overlap.length === 0
      ? artifact.biasLogLikelihoodRatio
      : artifact.biasLogLikelihoodRatio + overlap.reduce((sum, token) => sum + (artifact.tokenWeights?.[token] ?? 0), 0) / overlap.length;
  const likelihoodRatio = Math.exp(logLikelihoodRatio);
  const direction =
    likelihoodRatio > FALLBACK_SUPPORT_DIRECTION_THRESHOLD
      ? "SUPPORTS"
      : likelihoodRatio < FALLBACK_OPPOSE_DIRECTION_THRESHOLD
        ? "OPPOSES"
        : "NEUTRAL";

  return {
    estimator: "lightweight",
    direction,
    likelihoodRatio,
    confidence: Math.min(0.85, 0.45 + overlap.length * 0.05),
    weight: 1,
    rationale: `Local lightweight artifact compared ${overlap.length} overlapping tokens.`,
    modelVersion: `${artifact.name ?? "lightweight-local"}:${artifact.version ?? "0.1.0"}`,
    abstain: false
  };
}

function isLocalFeedbackSample(sample: TrainingSample) {
  return sample.source === "local_confirmed" || sample.source === "local_resolved";
}

function sampleSelectionKey(sample: TrainingSample) {
  return `${sample.source}:${sample.provenance.dataset}:${sample.provenance.split}:${sample.provenance.sourceId}`;
}

function takeSourceDiverseSample(bucket: TrainingSample[], coveredSources: Set<string>) {
  const diverseIndex = bucket.findIndex((sample) => !coveredSources.has(sample.source));
  const index = diverseIndex >= 0 ? diverseIndex : 0;
  const [sample] = bucket.splice(index, 1);
  return sample;
}

export function selectEvaluationSamples(samples: TrainingSample[], limit: number) {
  if (limit >= samples.length) return samples;
  const selected: TrainingSample[] = [];
  const selectedIds = new Set<string>();
  const coveredSources = new Set<string>();
  const localSamples = samples.filter(isLocalFeedbackSample);

  for (const label of labelOrder) {
    const localSample = localSamples.find((sample) => sample.label === label);
    if (!localSample) continue;
    selected.push(localSample);
    selectedIds.add(sampleSelectionKey(localSample));
    coveredSources.add(localSample.source);
    if (selected.length >= limit) return selected;
  }

  const buckets = new Map<TrainingLabel, TrainingSample[]>(
    labelOrder.map((label) => [
      label,
      samples.filter((sample) => sample.label === label && !selectedIds.has(sampleSelectionKey(sample)))
    ])
  );
  const coveredLabels = new Set(selected.map((sample) => sample.label));

  while (selected.length < limit) {
    let added = false;
    for (const label of labelOrder) {
      const hasUncoveredAvailableLabel = labelOrder.some((candidateLabel) => !coveredLabels.has(candidateLabel) && (buckets.get(candidateLabel)?.length ?? 0) > 0);
      if (coveredLabels.has(label) && hasUncoveredAvailableLabel) continue;
      const bucket = buckets.get(label);
      const next = bucket && bucket.length > 0 ? takeSourceDiverseSample(bucket, coveredSources) : undefined;
      if (!next) continue;
      selected.push(next);
      coveredSources.add(next.source);
      coveredLabels.add(next.label);
      added = true;
      if (selected.length >= limit) break;
    }
    if (!added) break;
  }

  return selected;
}

export async function runLlmEvaluationCommand(
  options: RunLlmEvaluationCommandOptions = {}
): Promise<RunLlmEvaluationCommandResult> {
  const { samplesPath, fallbackPath, outputPath } = evaluationPaths(options);
  const limit = positiveLimit(options.limit);
  const llmConfig = assertLlmEvaluationConfigured(options.env ?? process.env);
  const samples = selectEvaluationSamples(await readJsonl<TrainingSample>(samplesPath), limit);
  assertUsableTrainingSamples(samples, { action: "evaluate", samplesPath });

  const llm = createConfiguredLlmEstimator(options.env ?? process.env, options.fetcher);
  const fallbackArtifact = await readLightweightArtifact(fallbackPath);
  const items: LlmEvaluationItem[] = [];

  for (const sample of samples) {
    const llmOutput = await llm.estimate({
      evidenceText: sample.evidence,
      hypothesis: sample.claim,
      category: "TECH_TREND",
      sourceCredibility: sample.confidence,
      context: `${sample.source}:${sample.provenance.dataset}:${sample.provenance.split}:${sample.provenance.sourceId}`
    });
    items.push({
      sample,
      llm: llmOutput,
      fallback: fallbackEstimate(sample, fallbackArtifact)
    });
  }

  const modelName =
    items.find((item) => item.llm.modelVersion)?.llm.modelVersion ?? `${llmConfig.provider}:${llmConfig.model}`;
  const summary = summarizeLlmEvaluation(items, { modelName });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    JSON.stringify(
      {
        generatedAt: (options.now?.() ?? new Date()).toISOString(),
        samplesPath,
        artifactPath: fallbackPath,
        summary,
        items: items.map((item) => ({
          expectedLabel: item.sample.label,
          source: item.sample.source,
          provenance: item.sample.provenance,
          llm: item.llm,
          fallback: item.fallback
        }))
      },
      null,
      2
    ),
    "utf8"
  );

  return { evaluated: true, outputPath, summary };
}
