import { mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import {
  convertClimateFeverRow,
  convertFeverNliRow,
  convertSciFactRow,
  type TrainingSample
} from "@/server/training/training-data";

const execFileAsync = promisify(execFile);

type DatasetConfig = {
  source: "fever" | "scifact" | "climate_fever";
  dataset: string;
  config: string;
  split: string;
  convert: (row: unknown, context: { dataset: string; split: string; rowIndex: number }) => TrainingSample[];
};

const datasets: DatasetConfig[] = [
  {
    source: "fever",
    dataset: "pietrolesci/nli_fever",
    config: "default",
    split: "train",
    convert: (row, context) => convertFeverNliRow(row as Parameters<typeof convertFeverNliRow>[0], context)
  },
  {
    source: "scifact",
    dataset: "allenai/scifact_entailment",
    config: "default",
    split: "train",
    convert: (row, context) => convertSciFactRow(row as Parameters<typeof convertSciFactRow>[0], context)
  },
  {
    source: "climate_fever",
    dataset: "tdiggelm/climate_fever",
    config: "default",
    split: "test",
    convert: (row, context) => convertClimateFeverRow(row as Parameters<typeof convertClimateFeverRow>[0], context)
  }
];

function argValue(name: string, fallback: string) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function positiveInteger(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function fetchJsonWithRetry(url: URL, attempts = 3) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
      }
      return response.json();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    } finally {
      clearTimeout(timeout);
    }
  }
  if (process.platform === "win32") {
    const escapedUrl = url.toString().replaceAll("'", "''");
    const command = `(Invoke-WebRequest -Uri '${escapedUrl}' -UseBasicParsing -TimeoutSec 60).Content`;
    const { stdout } = await execFileAsync(
      "powershell",
      ["-NoProfile", "-Command", command],
      { maxBuffer: 20 * 1024 * 1024 }
    );
    return JSON.parse(stdout);
  }
  throw lastError;
}

async function fetchDatasetRows(dataset: DatasetConfig, limit: number) {
  const url = new URL("https://datasets-server.huggingface.co/rows");
  url.searchParams.set("dataset", dataset.dataset);
  url.searchParams.set("config", dataset.config);
  url.searchParams.set("split", dataset.split);
  url.searchParams.set("offset", "0");
  url.searchParams.set("length", String(limit));
  const payload = (await fetchJsonWithRetry(url)) as { rows?: Array<{ row_idx: number; row: unknown }> };
  return payload.rows ?? [];
}

async function main() {
  const limit = positiveInteger(argValue("--limit", "20"), 20);
  const outputDir = path.join(process.cwd(), "model-artifacts");
  const samplesPath = path.join(outputDir, "external-training-samples.jsonl");
  const manifestPath = path.join(outputDir, "external-training-manifest.json");
  const samples: TrainingSample[] = [];
  const sourceCounts: Record<string, number> = {};

  for (const dataset of datasets) {
    const rows = await fetchDatasetRows(dataset, limit);
    const converted = rows.flatMap((item) =>
      dataset.convert(item.row, { dataset: dataset.dataset, split: dataset.split, rowIndex: item.row_idx })
    );
    sourceCounts[dataset.source] = converted.length;
    samples.push(...converted);
  }

  if (samples.some((sample) => String(sample.source) === "demo")) {
    throw new Error("Refusing to write demo training samples.");
  }

  await mkdir(outputDir, { recursive: true });
  await writeFile(samplesPath, samples.map((sample) => JSON.stringify(sample)).join("\n"), "utf8");
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sampleCount: samples.length,
        sourceCounts,
        datasets: datasets.map(({ source, dataset, config, split }) => ({ source, dataset, config, split })),
        samplesPath
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(JSON.stringify({ fetched: true, sampleCount: samples.length, sourceCounts, samplesPath, manifestPath }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
