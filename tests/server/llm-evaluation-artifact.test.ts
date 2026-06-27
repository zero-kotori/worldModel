import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadLlmEvaluationArtifact } from "@/server/training/llm-evaluation-artifact";

function summary() {
  return {
    modelName: "deepseek:deepseek-v4-flash",
    sampleCount: 12,
    scoredCount: 10,
    directionAccuracy: {
      SUPPORTS: { total: 4, scored: 4, correct: 3, accuracy: 0.75 },
      OPPOSES: { total: 4, scored: 3, correct: 2, accuracy: 2 / 3 },
      NEUTRAL: { total: 4, scored: 3, correct: 1, accuracy: 1 / 3 }
    },
    likelihoodRatio: { min: 0.4, max: 10, mean: 2.8 },
    lowConfidenceCount: 2,
    lowConfidenceRate: 1 / 6,
    reviewRequiredCount: 3,
    reviewRequiredRate: 0.25,
    fallbackComparedCount: 8,
    fallbackDivergenceCount: 2,
    fallbackDivergenceRate: 0.25
  };
}

describe("LLM evaluation artifact loader", () => {
  it("loads a local LLM evaluation artifact summary", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "world-model-llm-eval-"));
    const filePath = path.join(directory, "llm-evaluation.json");
    await writeFile(
      filePath,
      JSON.stringify({
        generatedAt: "2026-06-18T01:02:03.000Z",
        samplesPath: "model-artifacts/training-samples.jsonl",
        summary: summary(),
        items: [{ expectedLabel: "SUPPORTS" }]
      }),
      "utf8"
    );

    try {
      await expect(loadLlmEvaluationArtifact({ filePath })).resolves.toEqual({
        generatedAt: new Date("2026-06-18T01:02:03.000Z"),
        samplesPath: "model-artifacts/training-samples.jsonl",
        summary: summary()
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("returns null when the evaluation artifact is missing", async () => {
    await expect(loadLlmEvaluationArtifact({ filePath: path.join(os.tmpdir(), "missing-llm-evaluation.json") })).resolves.toBeNull();
  });

  it("returns null when the evaluation artifact is malformed", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "world-model-llm-eval-"));
    const filePath = path.join(directory, "llm-evaluation.json");
    await writeFile(filePath, "{not-json", "utf8");

    try {
      await expect(loadLlmEvaluationArtifact({ filePath })).resolves.toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
