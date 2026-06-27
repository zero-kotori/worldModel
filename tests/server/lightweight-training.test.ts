import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runLightweightTrainingCommand } from "@/server/training/lightweight-training";

describe("lightweight training runner", () => {
  it("falls back across Python launchers and returns the trained artifact summary", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "world-model-light-train-"));
    const artifactDirectory = path.join(directory, "model-artifacts");
    const artifactPath = path.join(artifactDirectory, "lightweight-local.json");
    const calls: Array<{ file: string; args: string[] }> = [];

    try {
      await mkdir(artifactDirectory, { recursive: true });
      await writeFile(
        artifactPath,
        JSON.stringify({
          name: "lightweight-local",
          kind: "LIGHTWEIGHT",
          version: "0.1.0",
          trained: true,
          metrics: {
            sampleCount: 12,
            sourceCounts: { fever: 8, local_confirmed: 4 }
          }
        }),
        "utf8"
      );

      const result = await runLightweightTrainingCommand({
        cwd: directory,
        scriptPath: path.join(directory, "scripts", "train_light.py"),
        pythonCommands: ["python3", "python"],
        execFile: async (file, args) => {
          calls.push({ file, args });
          if (file === "python3") {
            const error = new Error("not found") as NodeJS.ErrnoException;
            error.code = "ENOENT";
            throw error;
          }
          return { stdout: "Trained lightweight artifact", stderr: "" };
        }
      });

      expect(calls).toEqual([
        { file: "python3", args: [path.join(directory, "scripts", "train_light.py")] },
        { file: "python", args: [path.join(directory, "scripts", "train_light.py")] }
      ]);
      expect(result).toMatchObject({
        artifactPath,
        trained: true,
        sampleCount: 12,
        sourceCounts: { fever: 8, local_confirmed: 4 },
        stdout: "Trained lightweight artifact"
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("passes a custom output directory through to the Python training script", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "world-model-light-train-"));
    const outputDir = path.join(directory, "output", "training");
    const artifactPath = path.join(outputDir, "lightweight-local.json");
    const calls: Array<{ file: string; args: string[] }> = [];

    try {
      await mkdir(outputDir, { recursive: true });
      await writeFile(
        artifactPath,
        JSON.stringify({
          name: "lightweight-local",
          kind: "LIGHTWEIGHT",
          version: "0.1.0",
          trained: true,
          metrics: {
            sampleCount: 7,
            sourceCounts: { scifact: 7 }
          }
        }),
        "utf8"
      );

      const result = await runLightweightTrainingCommand({
        cwd: directory,
        outputDir,
        scriptPath: path.join(directory, "scripts", "train_light.py"),
        pythonCommands: ["python"],
        execFile: async (file, args) => {
          calls.push({ file, args });
          return { stdout: "Trained lightweight artifact", stderr: "" };
        }
      });

      expect(calls).toEqual([
        { file: "python", args: [path.join(directory, "scripts", "train_light.py"), "--output-dir", outputDir] }
      ]);
      expect(result).toMatchObject({
        artifactPath,
        trained: true,
        sampleCount: 7,
        sourceCounts: { scifact: 7 }
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
