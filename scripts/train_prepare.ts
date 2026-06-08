import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import { labelToLikelihoodRatio, type TrainingLabel, type TrainingSample } from "@/server/training/training-data";

config({ path: ".env.local" });
config();

const outputDir = path.join(process.cwd(), "model-artifacts");
const samplesPath = path.join(outputDir, "training-samples.jsonl");
const manifestPath = path.join(outputDir, "training-manifest.json");
const externalSamplesPath = path.join(outputDir, "external-training-samples.jsonl");

function labelFromDirection(direction: string): TrainingLabel {
  if (direction === "SUPPORTS") return "SUPPORTS";
  if (direction === "OPPOSES") return "OPPOSES";
  return "NEUTRAL";
}

async function readExternalSamples(): Promise<TrainingSample[]> {
  try {
    const text = await readFile(externalSamplesPath, "utf8");
    return text
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as TrainingSample)
      .filter((sample) => String(sample.source) !== "demo");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function main() {
  const prisma = new PrismaClient();
  try {
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

    const localSamples: TrainingSample[] = evidence.flatMap((item) =>
      item.hypothesisLinks.map((link) => {
        const label = labelFromDirection(link.direction);
        return {
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
      })
    );
    const externalSamples = await readExternalSamples();
    const samples = [...externalSamples, ...localSamples];
    if (samples.some((sample) => String(sample.source) === "demo")) {
      throw new Error("Refusing to prepare demo training samples.");
    }
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

    console.log(JSON.stringify({ prepared: true, sampleCount: samples.length, sourceCounts, samplesPath, manifestPath }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
