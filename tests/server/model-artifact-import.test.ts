import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { modelArtifactImportInput, readModelArtifactImportInput } from "@/server/training/model-artifact-import";

describe("model artifact import helpers", () => {
  it("preserves trained artifact metrics when building import input", () => {
    const artifactPath = path.join(process.cwd(), "model-artifacts", "lightweight-local.json");

    expect(
      modelArtifactImportInput(
        artifactPath,
        {
          name: "lightweight-local",
          kind: "LIGHTWEIGHT",
          version: "0.1.0",
          trained: true,
          metrics: {
            sampleCount: 14,
            sourceCounts: { fever: 2, scifact: 2, climate_fever: 10 },
            meanAbsoluteLogError: 0.67
          }
        },
        {
          fallbackMetrics: {
            importedBy: "admin-form",
            sampleCount: 99
          },
          enabled: false
        }
      )
    ).toMatchObject({
      name: "lightweight-local",
      kind: "LIGHTWEIGHT",
      version: "0.1.0",
      path: "model-artifacts/lightweight-local.json",
      metrics: {
        importedBy: "admin-form",
        trained: true,
        sampleCount: 14,
        sourceCounts: { fever: 2, scifact: 2, climate_fever: 10 },
        meanAbsoluteLogError: 0.67
      },
      enabled: false
    });
  });

  it("reads model artifact import input from a local JSON artifact", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "world-model-import-"));
    try {
      const artifactPath = path.join(directory, "lightweight-local.json");
      await writeFile(
        artifactPath,
        JSON.stringify({
          name: "lightweight-local",
          kind: "LIGHTWEIGHT",
          version: "0.1.0",
          trained: true,
          metrics: { sampleCount: 3, sourceCounts: { fever: 3 } }
        }),
        "utf8"
      );

      const result = await readModelArtifactImportInput(artifactPath, {
        fallbackMetrics: { importedBy: "unit-test" }
      });

      expect(result).toMatchObject({
        name: "lightweight-local",
        kind: "LIGHTWEIGHT",
        version: "0.1.0",
        metrics: {
          importedBy: "unit-test",
          trained: true,
          sampleCount: 3,
          sourceCounts: { fever: 3 }
        }
      });
      expect(JSON.parse(await readFile(artifactPath, "utf8")).metrics.sampleCount).toBe(3);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reports missing artifact paths clearly", async () => {
    await expect(readModelArtifactImportInput("model-artifacts/missing-local.json")).rejects.toThrow(
      /Model artifact path does not exist/
    );
  });
});
