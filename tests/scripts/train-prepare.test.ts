import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  localConfirmedSamplesFromEvidence,
  localResolvedSamplesFromBeliefs,
  parseTrainPrepareArgs,
  runTrainPrepareCommand
} from "../../scripts/train_prepare";
import type { TrainingSample } from "@/server/training/training-data";

function sample(sourceId: string): TrainingSample {
  return {
    source: "fever",
    claim: `claim ${sourceId}`,
    evidence: `evidence ${sourceId}`,
    label: "SUPPORTS",
    relevance: 0.8,
    likelihoodRatio: 2.5,
    confidence: 0.85,
    provenance: { dataset: "test", split: "unit", sourceId }
  };
}

describe("train prepare script", () => {
  it("parses explicit external-only mode", () => {
    expect(parseTrainPrepareArgs(["node", "train_prepare.ts", "--external-only"], {})).toMatchObject({
      mode: "external"
    });
    expect(parseTrainPrepareArgs(["node", "train_prepare.ts"], { WORLDMODEL_TRAIN_PREPARE_MODE: "external" })).toMatchObject({
      mode: "external"
    });
  });

  it("prepares samples from external data without requiring Prisma", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "world-model-train-"));
    try {
      const externalSamplesPath = path.join(directory, "external-training-samples.jsonl");
      await writeFile(externalSamplesPath, `${JSON.stringify(sample("row-1"))}\n`, "utf8");

      const result = await runTrainPrepareCommand({
        mode: "external",
        outputDir: directory,
        externalSamplesPath
      });

      expect(result).toMatchObject({
        prepared: true,
        sampleCount: 1,
        sourceCounts: { fever: 1 }
      });
      expect(await readFile(path.join(directory, "training-samples.jsonl"), "utf8")).toContain("row-1");
      expect(await readFile(path.join(directory, "training-manifest.json"), "utf8")).toContain("external-training-samples.jsonl");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps rejected and deleted local evidence out of local confirmed training samples", () => {
    const samples = localConfirmedSamplesFromEvidence([
      {
        id: "evidence_active",
        title: "Active evidence",
        content: "A verified observation that should train the scorer.",
        status: "ACTIVE",
        hypothesisLinks: [
          {
            hypothesisId: "hypothesis_active",
            direction: "SUPPORTS",
            relevance: 0.8,
            likelihoodRatio: 2.4,
            confidence: 0.86,
            hypothesis: { proposition: "Active local evidence improves calibration" }
          }
        ]
      },
      {
        id: "evidence_rejected",
        title: "Rejected evidence",
        content: "A rejected observation that should not train the scorer.",
        status: "REJECTED",
        hypothesisLinks: [
          {
            hypothesisId: "hypothesis_rejected",
            direction: "SUPPORTS",
            relevance: 0.95,
            likelihoodRatio: 4,
            confidence: 0.9,
            hypothesis: { proposition: "Rejected evidence must not be trusted" }
          }
        ]
      },
      {
        id: "evidence_deleted",
        title: "Deleted evidence",
        content: "A deleted observation that should not train the scorer.",
        status: "DELETED",
        hypothesisLinks: [
          {
            hypothesisId: "hypothesis_deleted",
            direction: "OPPOSES",
            relevance: 0.7,
            likelihoodRatio: 0.3,
            confidence: 0.7,
            hypothesis: { proposition: "Deleted evidence must not be trusted" }
          }
        ]
      }
    ]);

    expect(samples).toEqual([
      expect.objectContaining({
        source: "local_confirmed",
        claim: "Active local evidence improves calibration",
        evidence: "Active evidence\nA verified observation that should train the scorer.",
        label: "SUPPORTS",
        provenance: {
          dataset: "local_confirmed_evidence_links",
          split: "local",
          sourceId: "evidence_active:hypothesis_active"
        }
      })
    ]);
  });

  it("turns resolved hypotheses with outcome notes into local resolved training samples", () => {
    const createdAt = new Date("2026-06-18T00:00:00.000Z");
    const samples = localResolvedSamplesFromBeliefs([
      {
        id: "belief_delivery",
        title: "Delivery belief",
        category: "AI_TREND",
        description: "",
        probabilityMode: "INDEPENDENT",
        status: "ACTIVE",
        createdAt,
        updatedAt: createdAt,
        hypotheses: [
          {
            id: "hypothesis_true",
            beliefId: "belief_delivery",
            proposition: "Agent rollout improves delivery throughput",
            notes: "",
            stance: "SUPPORTS",
            priorProbability: 0.4,
            currentProbability: 0.82,
            strength: 0.82,
            status: "RESOLVED_TRUE",
            resolvedOutcome: "2026 Q2 rollout improved delivery throughput.",
            createdAt,
            updatedAt: createdAt
          },
          {
            id: "hypothesis_false",
            beliefId: "belief_delivery",
            proposition: "Hiring will accelerate this quarter",
            notes: "",
            stance: "SUPPORTS",
            priorProbability: 0.55,
            currentProbability: 0.7,
            strength: 0.7,
            status: "RESOLVED_FALSE",
            resolvedOutcome: "Hiring did not accelerate this quarter.",
            createdAt,
            updatedAt: createdAt
          },
          {
            id: "hypothesis_missing_outcome",
            beliefId: "belief_delivery",
            proposition: "Missing outcome should not train the scorer",
            notes: "",
            stance: "SUPPORTS",
            priorProbability: 0.5,
            currentProbability: 0.5,
            strength: 0.5,
            status: "RESOLVED_TRUE",
            createdAt,
            updatedAt: createdAt
          }
        ]
      }
    ]);

    expect(samples).toEqual([
      expect.objectContaining({
        source: "local_resolved",
        claim: "Agent rollout improves delivery throughput",
        evidence: "2026 Q2 rollout improved delivery throughput.",
        label: "SUPPORTS",
        confidence: 0.82,
        provenance: {
          dataset: "local_resolved_hypotheses",
          split: "local",
          sourceId: "hypothesis_true"
        }
      }),
      expect.objectContaining({
        source: "local_resolved",
        claim: "Hiring will accelerate this quarter",
        evidence: "Hiring did not accelerate this quarter.",
        label: "OPPOSES",
        confidence: 0.3,
        provenance: {
          dataset: "local_resolved_hypotheses",
          split: "local",
          sourceId: "hypothesis_false"
        }
      })
    ]);
  });
});
