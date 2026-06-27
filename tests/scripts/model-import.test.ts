import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

describe("model import CLI helpers", () => {
  it("carries the top-level trained flag into persisted artifact metrics", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "world-model-artifact-"));
    const artifactPath = path.join(tempDir, "lightweight-local.json");
    await writeFile(artifactPath, JSON.stringify({ name: "lightweight-local" }), "utf8");
    const originalArgv = process.argv;
    process.argv = ["node", "vitest", artifactPath];
    vi.resetModules();

    try {
      const imported = (await import("../../scripts/model-import")) as Record<string, unknown>;
      const modelArtifactImportInput = imported.modelArtifactImportInput as
        | ((artifactPath: string, artifact: Record<string, unknown>) => Record<string, unknown>)
        | undefined;

      expect(typeof modelArtifactImportInput).toBe("function");
      expect(
        modelArtifactImportInput?.(artifactPath, {
          name: "lightweight-local",
          kind: "LIGHTWEIGHT",
          version: "0.1.0",
          trained: false,
          metrics: { sampleCount: 3 }
        })
      ).toMatchObject({
        metrics: {
          sampleCount: 3,
          trained: false
        }
      });
    } finally {
      process.argv = originalArgv;
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
