import { pathToFileURL } from "node:url";
import { parseFetchTrainingDataSources, runFetchTrainingDataCommand } from "@/server/training/training-data-fetch-runner";

function argValue(name: string, fallback: string, argv = process.argv) {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  return argv[index + 1] ?? fallback;
}

function positiveInteger(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseFetchTrainingDataArgs(argv = process.argv) {
  const outputDir = argValue("--output-dir", "", argv).trim();
  const sources = parseFetchTrainingDataSources(argValue("--sources", "", argv).trim());
  return {
    limit: positiveInteger(argValue("--limit", "20", argv), 20),
    ...(sources ? { sources } : {}),
    ...(outputDir ? { outputDir } : {})
  };
}

async function main() {
  const result = await runFetchTrainingDataCommand(parseFetchTrainingDataArgs());
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
