import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

export type LightweightTrainingExecFile = (
  file: string,
  args: string[],
  options: { cwd: string; windowsHide: boolean; encoding: "utf8" }
) => Promise<{ stdout: string; stderr: string }>;

export type LightweightTrainingOptions = {
  cwd?: string;
  outputDir?: string;
  scriptPath?: string;
  pythonCommands?: string[];
  execFile?: LightweightTrainingExecFile;
};

export type LightweightTrainingResult = {
  artifactPath: string;
  trained: boolean;
  sampleCount?: number;
  sourceCounts?: Record<string, number>;
  stdout: string;
  stderr: string;
};

type LightweightArtifact = {
  trained?: boolean;
  metrics?: {
    sampleCount?: number;
    sourceCounts?: Record<string, number>;
  };
};

const defaultExecFile = promisify(execFileCallback) as LightweightTrainingExecFile;

function pythonArgs(command: string, scriptPath: string, outputDir?: string) {
  const scriptArgs = outputDir ? [scriptPath, "--output-dir", outputDir] : [scriptPath];
  return command === "py" ? ["-3", ...scriptArgs] : scriptArgs;
}

function isMissingExecutable(error: unknown) {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function normalizeSourceCounts(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, count]) => typeof count === "number" && Number.isFinite(count))
  ) as Record<string, number>;
}

export async function runLightweightTrainingCommand(options: LightweightTrainingOptions = {}): Promise<LightweightTrainingResult> {
  const cwd = options.cwd ?? process.cwd();
  const scriptPath = options.scriptPath ?? path.join(cwd, "scripts", "train_light.py");
  const outputDir = options.outputDir ? path.resolve(cwd, options.outputDir) : path.join(cwd, "model-artifacts");
  const artifactPath = path.join(outputDir, "lightweight-local.json");
  const pythonCommands = options.pythonCommands ?? ["python3", "python", "py"];
  const execFile = options.execFile ?? defaultExecFile;
  let latestError: unknown;
  let stdout = "";
  let stderr = "";

  for (const command of pythonCommands) {
    try {
      const result = await execFile(command, pythonArgs(command, scriptPath, options.outputDir ? outputDir : undefined), {
        cwd,
        windowsHide: true,
        encoding: "utf8"
      });
      stdout = result.stdout;
      stderr = result.stderr;
      latestError = undefined;
      break;
    } catch (error) {
      latestError = error;
      if (isMissingExecutable(error)) continue;
      throw error;
    }
  }

  if (latestError) throw latestError;

  const artifact = JSON.parse(await readFile(artifactPath, "utf8")) as LightweightArtifact;
  return {
    artifactPath,
    trained: artifact.trained === true,
    sampleCount: typeof artifact.metrics?.sampleCount === "number" ? artifact.metrics.sampleCount : undefined,
    sourceCounts: normalizeSourceCounts(artifact.metrics?.sourceCounts),
    stdout: stdout.trim(),
    stderr: stderr.trim()
  };
}
