import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";
import type { EstimatorOutput } from "@/domain/likelihood";
import { createConfiguredLlmEstimator } from "@/server/models/estimators";
import { summarizeLlmEvaluation, type LlmEvaluationItem } from "@/server/training/llm-evaluation";
import type { TrainingSample } from "@/server/training/training-data";

config({ path: ".env.local" });
config();

const tokenPattern = /[a-z0-9\u4e00-\u9fa5]+/gi;

type LightweightLocalArtifact = {
  name?: string;
  kind?: string;
  version?: string;
  trained?: boolean;
  biasLogLikelihoodRatio?: number;
  tokenWeights?: Record<string, number>;
};

function argValue(name: string, fallback: string) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function positiveInteger(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

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
  const direction = likelihoodRatio > 1.1 ? "SUPPORTS" : likelihoodRatio < 0.9 ? "OPPOSES" : "NEUTRAL";

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

async function main() {
  const outputDir = path.join(process.cwd(), "model-artifacts");
  const samplesPath = argValue("--samples", path.join(outputDir, "training-samples.jsonl"));
  const artifactPath = argValue("--fallback", path.join(outputDir, "lightweight-local.json"));
  const outputPath = argValue("--output", path.join(outputDir, "llm-evaluation.json"));
  const limit = positiveInteger(argValue("--limit", "5"), 5);
  const samples = (await readJsonl<TrainingSample>(samplesPath)).slice(0, limit);
  if (samples.length === 0) {
    throw new Error(`No real training samples found at ${samplesPath}. Run npm run train:fetch and npm run train:prepare first.`);
  }
  if (samples.some((sample) => String(sample.source) === "demo")) {
    throw new Error("Refusing to evaluate demo training samples.");
  }

  const llm = createConfiguredLlmEstimator();
  const fallbackArtifact = await readLightweightArtifact(artifactPath);
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

  const modelName = items.find((item) => item.llm.modelVersion)?.llm.modelVersion ?? `${process.env.LLM_PROVIDER ?? "llm"}:${process.env.LLM_MODEL ?? "unconfigured"}`;
  const summary = summarizeLlmEvaluation(items, { modelName });
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    outputPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        samplesPath,
        artifactPath,
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

  console.log(JSON.stringify({ evaluated: true, outputPath, summary }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
