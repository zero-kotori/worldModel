import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import { assertUsableTrainingSamples, labelToLikelihoodRatio, type TrainingLabel, type TrainingSample } from "@/server/training/training-data";

export type TrainPrepareMode = "prisma" | "external";

export type TrainPrepareCommandOptions = {
  mode: TrainPrepareMode;
  outputDir?: string;
  externalSamplesPath?: string;
};

export type TrainPrepareResult = {
  prepared: true;
  sampleCount: number;
  sourceCounts: Record<string, number>;
  samplesPath: string;
  manifestPath: string;
};

type LocalTrainingEvidenceRecord = {
  id: string;
  title: string;
  content: string;
  status: string;
  hypothesisLinks: Array<{
    hypothesisId: string;
    direction: string;
    relevance: number;
    likelihoodRatio: number;
    confidence: number;
    hypothesis: {
      proposition: string;
    };
  }>;
};

type LocalTrainingBeliefRecord = {
  hypotheses: Array<
    {
    id: string;
    proposition: string;
    status: string;
    currentProbability: number;
    resolvedOutcome?: string | null;
    } & Record<string, unknown>
  >;
} & Record<string, unknown>;

function defaultOutputDir() {
  return path.join(process.cwd(), "model-artifacts");
}

function labelFromDirection(direction: string): TrainingLabel {
  if (direction === "SUPPORTS") return "SUPPORTS";
  if (direction === "OPPOSES") return "OPPOSES";
  return "NEUTRAL";
}

function labelFromResolvedStatus(status: string): TrainingLabel | null {
  if (status === "RESOLVED_TRUE") return "SUPPORTS";
  if (status === "RESOLVED_FALSE") return "OPPOSES";
  return null;
}

function resolvedConfidence(status: string, currentProbability: number) {
  const clamped = Math.min(1, Math.max(0, currentProbability));
  const confidence = status === "RESOLVED_FALSE" ? 1 - clamped : clamped;
  return Number(Math.min(1, Math.max(0, confidence)).toFixed(4));
}

function argValue(argv: string[], name: string, fallback: string) {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  return argv[index + 1] ?? fallback;
}

function parseMode(value: string | undefined): TrainPrepareMode {
  return value === "external" || value === "external-only" ? "external" : "prisma";
}

export function parseTrainPrepareArgs(argv = process.argv, env: Record<string, string | undefined> = process.env): TrainPrepareCommandOptions {
  const outputDir = argValue(argv, "--output-dir", defaultOutputDir());
  return {
    mode: argv.includes("--external-only") ? "external" : parseMode(env.WORLDMODEL_TRAIN_PREPARE_MODE),
    outputDir,
    externalSamplesPath: argValue(argv, "--external-samples", path.join(outputDir, "external-training-samples.jsonl"))
  };
}

async function readExternalSamples(externalSamplesPath: string): Promise<TrainingSample[]> {
  try {
    const text = await readFile(externalSamplesPath, "utf8");
    return text
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as TrainingSample);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function localConfirmedSamplesFromEvidence(evidence: LocalTrainingEvidenceRecord[]): TrainingSample[] {
  return evidence
    .filter((item) => item.status === "ACTIVE")
    .flatMap((item) =>
      item.hypothesisLinks.map((link) => {
        const label = labelFromDirection(link.direction);
        const sample: TrainingSample = {
          source: "local_confirmed",
          claim: link.hypothesis.proposition,
          evidence: `${item.title}\n${item.content}`,
          label,
          relevance: link.relevance,
          likelihoodRatio: link.likelihoodRatio || labelToLikelihoodRatio(label),
          confidence: link.confidence,
          provenance: {
            dataset: "local_confirmed_evidence_links",
            split: "local",
            sourceId: `${item.id}:${link.hypothesisId}`
          }
        };
        return sample;
      })
    );
}

export function localResolvedSamplesFromBeliefs(beliefs: LocalTrainingBeliefRecord[]): TrainingSample[] {
  return beliefs.flatMap((belief) =>
    belief.hypotheses.flatMap((hypothesis) => {
      const label = labelFromResolvedStatus(hypothesis.status);
      const evidence = String(hypothesis.resolvedOutcome ?? "").trim();
      if (!label || !evidence) return [];

      const sample: TrainingSample = {
        source: "local_resolved",
        claim: hypothesis.proposition,
        evidence,
        label,
        relevance: 1,
        likelihoodRatio: labelToLikelihoodRatio(label),
        confidence: resolvedConfidence(hypothesis.status, hypothesis.currentProbability),
        provenance: {
          dataset: "local_resolved_hypotheses",
          split: "local",
          sourceId: hypothesis.id
        }
      };
      return [sample];
    })
  );
}

async function readLocalConfirmedSamples(prisma: PrismaClient): Promise<TrainingSample[]> {
  const evidence = await prisma.evidence.findMany({
    include: {
      observation: true,
      hypothesisLinks: {
        include: {
          hypothesis: {
            include: {
              belief: true
            }
          }
        }
      }
    },
    orderBy: { confirmedAt: "asc" }
  });

  return localConfirmedSamplesFromEvidence(evidence);
}

async function readLocalResolvedSamples(prisma: PrismaClient): Promise<TrainingSample[]> {
  const beliefs = await prisma.belief.findMany({
    include: {
      hypotheses: {
        where: {
          status: { in: ["RESOLVED_TRUE", "RESOLVED_FALSE"] }
        },
        orderBy: { createdAt: "asc" }
      }
    },
    orderBy: { createdAt: "asc" }
  });

  return localResolvedSamplesFromBeliefs(beliefs);
}

export async function runTrainPrepareCommand(options: TrainPrepareCommandOptions): Promise<TrainPrepareResult> {
  const outputDir = options.outputDir ?? defaultOutputDir();
  const samplesPath = path.join(outputDir, "training-samples.jsonl");
  const manifestPath = path.join(outputDir, "training-manifest.json");
  const externalSamplesPath = options.externalSamplesPath ?? path.join(outputDir, "external-training-samples.jsonl");
  const externalSamples = await readExternalSamples(externalSamplesPath);
  let localSamples: TrainingSample[] = [];
  let prisma: PrismaClient | undefined;

  try {
    if (options.mode === "prisma") {
      prisma = new PrismaClient();
      localSamples = [...(await readLocalConfirmedSamples(prisma)), ...(await readLocalResolvedSamples(prisma))];
    }

    const samples = [...externalSamples, ...localSamples];
    assertUsableTrainingSamples(samples, { action: "prepare", samplesPath });
    const sourceCounts = samples.reduce<Record<string, number>>((counts, sample) => {
      counts[sample.source] = (counts[sample.source] ?? 0) + 1;
      return counts;
    }, {});

    await mkdir(outputDir, { recursive: true });
    await writeFile(samplesPath, samples.map((sample) => JSON.stringify(sample)).join("\n"), "utf8");
    await writeFile(
      manifestPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          sampleCount: samples.length,
          sourceCounts,
          externalSamplesPath,
          samplesPath
        },
        null,
        2
      ),
      "utf8"
    );

    return { prepared: true, sampleCount: samples.length, sourceCounts, samplesPath, manifestPath };
  } finally {
    await prisma?.$disconnect();
  }
}

async function main() {
  config({ path: ".env.local" });
  config();

  const result = await runTrainPrepareCommand(parseTrainPrepareArgs());
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
