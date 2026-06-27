import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

describe("lightweight training script", () => {
  it("refuses to train on demo samples even when training-samples.jsonl is hand-written", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "world-model-light-"));
    const artifactsDir = path.join(directory, "model-artifacts");
    await mkdir(artifactsDir, { recursive: true });
    await writeFile(
      path.join(artifactsDir, "training-samples.jsonl"),
      `${JSON.stringify({
        source: "demo",
        claim: "Demo claim",
        evidence: "Demo evidence",
        label: "SUPPORTS",
        relevance: 0.8,
        likelihoodRatio: 2.5,
        confidence: 0.8,
        provenance: { dataset: "demo", split: "unit", sourceId: "demo-1" }
      })}\n`,
      "utf8"
    );

    try {
      await expect(
        execFileAsync("python3", [path.join(process.cwd(), "scripts", "train_light.py")], { cwd: directory })
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("Refusing to train lightweight model on demo training samples")
      });

      await expect(readFile(path.join(artifactsDir, "lightweight-local.json"), "utf8")).rejects.toMatchObject({
        code: "ENOENT"
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("trains from a custom output directory when requested", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "world-model-light-"));
    const outputDir = path.join(directory, "output", "training");
    await mkdir(outputDir, { recursive: true });
    await writeFile(
      path.join(outputDir, "training-samples.jsonl"),
      `${JSON.stringify({
        source: "scifact",
        claim: "A biomaterials result is contradicted by trial evidence.",
        evidence: "Trial evidence contradicts the biomaterials result.",
        label: "OPPOSES",
        relevance: 0.9,
        likelihoodRatio: 0.4,
        confidence: 0.8,
        provenance: { dataset: "allenai/scifact_entailment", split: "train", sourceId: "row-1" }
      })}\n`,
      "utf8"
    );

    try {
      await execFileAsync("python3", [path.join(process.cwd(), "scripts", "train_light.py"), "--output-dir", outputDir], {
        cwd: directory
      });

      const artifact = JSON.parse(await readFile(path.join(outputDir, "lightweight-local.json"), "utf8")) as {
        trained: boolean;
        metrics: { sampleCount: number; trainingData: string };
      };
      expect(artifact.trained).toBe(true);
      expect(artifact.metrics.sampleCount).toBe(1);
      expect(artifact.metrics.trainingData).toContain(path.join("output", "training", "training-samples.jsonl"));
      await expect(readFile(path.join(directory, "model-artifacts", "lightweight-local.json"), "utf8")).rejects.toMatchObject({
        code: "ENOENT"
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
