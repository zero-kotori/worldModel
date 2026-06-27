import path from "node:path";
import { pathToFileURL } from "node:url";
import { config } from "dotenv";
import { runLlmEvaluationCommand, selectEvaluationSamples } from "@/server/training/llm-evaluation-runner";

config({ path: ".env.local" });
config();

export { selectEvaluationSamples };

const DEFAULT_EVALUATION_LIMIT = 30;

function argValue(name: string, fallback: string, argv = process.argv) {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  return argv[index + 1] ?? fallback;
}

function positiveInteger(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseEvaluateLlmArgs(argv = process.argv, env: Record<string, string | undefined> = process.env) {
  const outputDir = argValue("--output-dir", path.join(process.cwd(), "model-artifacts"), argv);
  return {
    outputDir,
    ...(argv.includes("--samples") ? { samplesPath: argValue("--samples", path.join(outputDir, "training-samples.jsonl"), argv) } : {}),
    ...(argv.includes("--fallback") ? { fallbackPath: argValue("--fallback", path.join(outputDir, "lightweight-local.json"), argv) } : {}),
    ...(argv.includes("--output") ? { outputPath: argValue("--output", path.join(outputDir, "llm-evaluation.json"), argv) } : {}),
    limit: positiveInteger(argValue("--limit", String(DEFAULT_EVALUATION_LIMIT), argv), DEFAULT_EVALUATION_LIMIT),
    env
  };
}

async function main() {
  const result = await runLlmEvaluationCommand(parseEvaluateLlmArgs());

  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
