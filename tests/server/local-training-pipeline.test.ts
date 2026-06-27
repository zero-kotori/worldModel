import path from "node:path";
import { runLocalLightweightTrainingPipeline } from "@/server/training/local-training-pipeline";

describe("local training pipeline", () => {
  it("prepares Prisma samples, trains the lightweight artifact, and imports it with source metrics", async () => {
    const prepare = vi.fn().mockResolvedValue({
      prepared: true,
      sampleCount: 15,
      sourceCounts: { fever: 10, local_confirmed: 5 },
      samplesPath: "model-artifacts/training-samples.jsonl",
      manifestPath: "model-artifacts/training-manifest.json"
    });
    const train = vi.fn().mockResolvedValue({
      artifactPath: path.join(process.cwd(), "model-artifacts", "lightweight-local.json"),
      trained: true,
      sampleCount: 15,
      sourceCounts: { fever: 10, local_confirmed: 5 },
      stdout: "Trained lightweight artifact",
      stderr: ""
    });
    const readInput = vi.fn().mockResolvedValue({
      name: "lightweight-local",
      kind: "LIGHTWEIGHT",
      version: "0.1.0",
      path: "model-artifacts/lightweight-local.json",
      metrics: {
        importedBy: "admin-train-lightweight",
        sampleCount: 15,
        sourceCounts: { fever: 10, local_confirmed: 5 },
        trained: true
      },
      enabled: true
    });
    const importArtifact = vi.fn().mockResolvedValue({
      id: "model_lightweight",
      name: "lightweight-local"
    });
    const listArtifacts = vi.fn().mockResolvedValue([]);

    const result = await runLocalLightweightTrainingPipeline(
      {
        models: { listArtifacts, importArtifact }
      },
      { prepare, train, readInput }
    );

    expect(prepare).toHaveBeenCalledWith({
      mode: "prisma",
      outputDir: path.join(process.cwd(), "model-artifacts")
    });
    expect(train).toHaveBeenCalledWith({ cwd: process.cwd(), outputDir: path.join(process.cwd(), "model-artifacts") });
    expect(readInput).toHaveBeenCalledWith(path.join(process.cwd(), "model-artifacts", "lightweight-local.json"), {
      name: "lightweight-local",
      kind: "LIGHTWEIGHT",
      version: "0.1.0",
      enabled: true,
      fallbackMetrics: {
        importedBy: "admin-train-lightweight",
        sampleCount: 15,
        sourceCounts: { fever: 10, local_confirmed: 5 }
      }
    });
    expect(importArtifact).toHaveBeenCalledWith({
      name: "lightweight-local",
      kind: "LIGHTWEIGHT",
      version: "0.1.0",
      path: "model-artifacts/lightweight-local.json",
      metrics: {
        importedBy: "admin-train-lightweight",
        sampleCount: 15,
        sourceCounts: { fever: 10, local_confirmed: 5 },
        trained: true
      },
      enabled: true
    });
    expect(result).toMatchObject({
      preparedSampleCount: 15,
      trained: true,
      artifact: { name: "lightweight-local" }
    });
  });

  it("uses the selected artifact directory for preparing, training, and importing", async () => {
    const outputDir = path.join(process.cwd(), "output", "training");
    const artifactPath = path.join(outputDir, "lightweight-local.json");
    const prepare = vi.fn().mockResolvedValue({
      prepared: true,
      sampleCount: 18,
      sourceCounts: { scifact: 10, local_resolved: 8 },
      samplesPath: path.join(outputDir, "training-samples.jsonl"),
      manifestPath: path.join(outputDir, "training-manifest.json")
    });
    const train = vi.fn().mockResolvedValue({
      artifactPath,
      trained: true,
      sampleCount: 18,
      sourceCounts: { scifact: 10, local_resolved: 8 },
      stdout: "Trained lightweight artifact",
      stderr: ""
    });
    const readInput = vi.fn().mockResolvedValue({
      name: "lightweight-local",
      kind: "LIGHTWEIGHT",
      version: "0.1.0",
      path: "output/training/lightweight-local.json",
      metrics: {
        importedBy: "admin-train-lightweight",
        sampleCount: 18,
        sourceCounts: { scifact: 10, local_resolved: 8 },
        trained: true
      },
      enabled: true
    });
    const importArtifact = vi.fn().mockResolvedValue({
      id: "model_lightweight",
      name: "lightweight-local"
    });
    const listArtifacts = vi.fn().mockResolvedValue([]);

    await runLocalLightweightTrainingPipeline(
      {
        models: { listArtifacts, importArtifact }
      },
      { outputDir, prepare, train, readInput }
    );

    expect(prepare).toHaveBeenCalledWith({ mode: "prisma", outputDir });
    expect(train).toHaveBeenCalledWith({ cwd: process.cwd(), outputDir });
    expect(readInput).toHaveBeenCalledWith(artifactPath, expect.objectContaining({
      fallbackMetrics: expect.objectContaining({
        sampleCount: 18,
        sourceCounts: { scifact: 10, local_resolved: 8 }
      })
    }));
  });
});
