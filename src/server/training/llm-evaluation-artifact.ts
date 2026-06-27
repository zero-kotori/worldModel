import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LlmEvaluationSummary } from "@/server/training/llm-evaluation";

export { runLlmEvaluationCommand, selectEvaluationSamples } from "@/server/training/llm-evaluation-runner";

export type LlmEvaluationArtifact = {
  generatedAt?: Date;
  samplesPath?: string;
  summary: LlmEvaluationSummary;
};

type RawLlmEvaluationArtifact = {
  generatedAt?: string;
  samplesPath?: string;
  summary?: LlmEvaluationSummary;
};

function defaultEvaluationPath() {
  return path.join(process.cwd(), "model-artifacts", "llm-evaluation.json");
}

function parseGeneratedAt(value: string | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export async function loadLlmEvaluationArtifact(options: { filePath?: string } = {}): Promise<LlmEvaluationArtifact | null> {
  const filePath = options.filePath ?? defaultEvaluationPath();
  try {
    const raw = JSON.parse(await readFile(filePath, "utf8")) as RawLlmEvaluationArtifact;
    if (!raw.summary) return null;
    return {
      generatedAt: parseGeneratedAt(raw.generatedAt),
      samplesPath: raw.samplesPath,
      summary: raw.summary
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}
