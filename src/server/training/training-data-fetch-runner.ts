import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  assertUsableTrainingSamples,
  cfeverEvidencePageTitles,
  convertCfeverRow,
  convertClimateFeverRow,
  convertFeverNliRow,
  convertGithubRepositoryRow,
  convertHuggingFaceModelRow,
  convertManifoldMarketRow,
  convertSciFactRow,
  type CfeverWikiPageRow,
  type TrainingSample,
  type TrainingSampleSource
} from "@/server/training/training-data";
import {
  createDatasetFetchError,
  fetchJsonWithFallback,
  fetchTextWithFallback,
  type FetchFallbackOptions
} from "@/server/training/training-fetch";

export const FETCH_TRAINING_DATA_SOURCES = [
  "fever",
  "scifact",
  "climate_fever",
  "cfever",
  "github",
  "hugging_face",
  "manifold"
] as const satisfies readonly TrainingSampleSource[];

export type FetchTrainingDataSource = (typeof FETCH_TRAINING_DATA_SOURCES)[number];

type DatasetIdentity = {
  source: FetchTrainingDataSource;
  dataset: string;
  config: string;
  split: string;
};

type DatasetConfig = DatasetIdentity & {
  convert: (row: unknown, context: { dataset: string; split: string; rowIndex: number }) => TrainingSample[];
};

export type FetchTrainingDataCommandOptions = {
  limit?: number;
  outputDir?: string;
  sources?: FetchTrainingDataSource[];
} & Pick<FetchFallbackOptions, "fetchImpl" | "execFileImpl" | "platform">;

export type FetchTrainingDataCommandResult = {
  fetched: true;
  sampleCount: number;
  sourceCounts: Record<string, number>;
  samplesPath: string;
  manifestPath: string;
};

const DATASETS: DatasetConfig[] = [
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

const CFEVER_DATASET = {
  source: "cfever",
  dataset: "IKMLab-team/cfever",
  config: "default",
  split: "train"
} satisfies DatasetIdentity;

const GITHUB_REPOSITORY_DATASET = {
  source: "github",
  dataset: "github/search/repositories",
  config: "ai-repositories",
  split: "live"
} satisfies DatasetIdentity;

const HUGGING_FACE_MODELS_DATASET = {
  source: "hugging_face",
  dataset: "huggingface/api/models",
  config: "downloads",
  split: "live"
} satisfies DatasetIdentity;

const MANIFOLD_MARKETS_DATASET = {
  source: "manifold",
  dataset: "manifold/search-markets",
  config: "resolved-binary",
  split: "resolved-binary"
} satisfies DatasetIdentity;

const DEFAULT_LIMIT = 20;
const CFEVER_WIKI_FILE_COUNT = 3;
const CFEVER_WIKI_BASE_URL = "https://huggingface.co/datasets/IKMLab-team/cfever/resolve/main";
const FETCH_TRAINING_DATA_SOURCE_SET = new Set<string>(FETCH_TRAINING_DATA_SOURCES);

function defaultOutputDir() {
  return path.join(process.cwd(), "model-artifacts");
}

function positiveLimit(value: number | undefined) {
  return Number.isInteger(value) && value !== undefined && value > 0 ? value : DEFAULT_LIMIT;
}

function transportOptions(options: FetchTrainingDataCommandOptions): Pick<FetchFallbackOptions, "fetchImpl" | "execFileImpl" | "platform"> {
  return {
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.execFileImpl ? { execFileImpl: options.execFileImpl } : {}),
    ...(options.platform ? { platform: options.platform } : {})
  };
}

export function parseFetchTrainingDataSources(value: string | undefined): FetchTrainingDataSource[] | undefined {
  const rawSources = value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!rawSources || rawSources.length === 0) return undefined;

  const invalid = rawSources.filter((item) => !FETCH_TRAINING_DATA_SOURCE_SET.has(item));
  if (invalid.length > 0) {
    throw new Error(
      `Unsupported training-data source(s): ${invalid.join(", ")}. Supported sources: ${FETCH_TRAINING_DATA_SOURCES.join(", ")}.`
    );
  }

  return [...new Set(rawSources)] as FetchTrainingDataSource[];
}

function selectedSourceSet(options: FetchTrainingDataCommandOptions) {
  return new Set<FetchTrainingDataSource>(options.sources && options.sources.length > 0 ? options.sources : FETCH_TRAINING_DATA_SOURCES);
}

function selectedDatasets(sources: Set<FetchTrainingDataSource>) {
  return [...DATASETS, CFEVER_DATASET, GITHUB_REPOSITORY_DATASET, HUGGING_FACE_MODELS_DATASET, MANIFOLD_MARKETS_DATASET].filter((dataset) =>
    sources.has(dataset.source)
  );
}

async function fetchDatasetRows(
  dataset: DatasetIdentity,
  limit: number,
  transport: Pick<FetchFallbackOptions, "fetchImpl" | "execFileImpl" | "platform"> = {}
) {
  const url = new URL("https://datasets-server.huggingface.co/rows");
  url.searchParams.set("dataset", dataset.dataset);
  url.searchParams.set("config", dataset.config);
  url.searchParams.set("split", dataset.split);
  url.searchParams.set("offset", "0");
  url.searchParams.set("length", String(limit));
  try {
    const payload = (await fetchJsonWithFallback(url, { ...transport, attempts: 1, httpTimeoutMs: 8000 })) as {
      rows?: Array<{ row_idx: number; row: unknown }>;
    };
    return payload.rows ?? [];
  } catch (error) {
    throw createDatasetFetchError(dataset, error);
  }
}

async function streamJsonlRows(
  url: URL,
  onRow: (row: unknown) => void | Promise<void>,
  transport: Pick<FetchFallbackOptions, "fetchImpl" | "execFileImpl" | "platform"> = {}
) {
  const text = await fetchTextWithFallback(url, { ...transport, attempts: 1, httpTimeoutMs: 30000 });
  for (const line of text.split(/\r?\n/)) {
    if (line.trim()) await onRow(JSON.parse(line));
  }
}

function cfeverWikiUrl(index: number) {
  return new URL(`${CFEVER_WIKI_BASE_URL}/wiki-${String(index).padStart(3, "0")}.jsonl`);
}

async function fetchCfeverWikiPages(
  pageTitles: string[],
  transport: Pick<FetchFallbackOptions, "fetchImpl" | "execFileImpl" | "platform"> = {}
) {
  const remaining = new Set(pageTitles);
  const pages = new Map<string, CfeverWikiPageRow>();
  if (remaining.size === 0) return pages;

  for (let index = 1; index <= CFEVER_WIKI_FILE_COUNT && remaining.size > 0; index += 1) {
    await streamJsonlRows(cfeverWikiUrl(index), (row) => {
      const candidate = row as Partial<CfeverWikiPageRow>;
      if (typeof candidate.id !== "string" || typeof candidate.lines !== "string") return;
      if (!remaining.has(candidate.id)) return;
      pages.set(candidate.id, { id: candidate.id, lines: candidate.lines });
      remaining.delete(candidate.id);
    }, transport);
  }

  return pages;
}

async function fetchCfeverSamples(
  limit: number,
  transport: Pick<FetchFallbackOptions, "fetchImpl" | "execFileImpl" | "platform"> = {}
) {
  try {
    const rows = await fetchDatasetRows(CFEVER_DATASET, limit, transport);
    const pageTitles = [
      ...new Set(rows.flatMap((item) => cfeverEvidencePageTitles(item.row as Parameters<typeof convertCfeverRow>[0])))
    ];
    const wikiPages = await fetchCfeverWikiPages(pageTitles, transport);
    return rows.flatMap((item) =>
      convertCfeverRow(
        item.row as Parameters<typeof convertCfeverRow>[0],
        {
          dataset: CFEVER_DATASET.dataset,
          split: CFEVER_DATASET.split,
          rowIndex: item.row_idx
        },
        wikiPages
      )
    );
  } catch (error) {
    throw createDatasetFetchError(CFEVER_DATASET, error);
  }
}

async function fetchGithubRepositorySamples(
  limit: number,
  transport: Pick<FetchFallbackOptions, "fetchImpl" | "execFileImpl" | "platform"> = {}
) {
  const url = new URL("https://api.github.com/search/repositories");
  url.searchParams.set("q", "topic:artificial-intelligence stars:>50 archived:false");
  url.searchParams.set("sort", "stars");
  url.searchParams.set("order", "desc");
  url.searchParams.set("per_page", String(Math.min(limit, 100)));

  try {
    const payload = (await fetchJsonWithFallback(url, { ...transport, attempts: 1, httpTimeoutMs: 8000 })) as {
      items?: unknown[];
    };
    return (payload.items ?? []).flatMap((row, rowIndex) =>
      convertGithubRepositoryRow(row as Parameters<typeof convertGithubRepositoryRow>[0], {
        dataset: GITHUB_REPOSITORY_DATASET.dataset,
        split: GITHUB_REPOSITORY_DATASET.split,
        rowIndex
      })
    );
  } catch (error) {
    throw createDatasetFetchError(GITHUB_REPOSITORY_DATASET, error);
  }
}

async function fetchHuggingFaceModelSamples(
  limit: number,
  transport: Pick<FetchFallbackOptions, "fetchImpl" | "execFileImpl" | "platform"> = {}
) {
  const url = new URL("https://huggingface.co/api/models");
  url.searchParams.set("sort", "downloads");
  url.searchParams.set("direction", "-1");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("full", "true");

  try {
    const payload = await fetchJsonWithFallback(url, { ...transport, attempts: 1, httpTimeoutMs: 8000 });
    const rows = Array.isArray(payload)
      ? payload
      : Array.isArray((payload as { models?: unknown[] }).models)
        ? (payload as { models: unknown[] }).models
        : [];
    return rows.flatMap((row, rowIndex) =>
      convertHuggingFaceModelRow(row as Parameters<typeof convertHuggingFaceModelRow>[0], {
        dataset: HUGGING_FACE_MODELS_DATASET.dataset,
        split: HUGGING_FACE_MODELS_DATASET.split,
        rowIndex
      })
    );
  } catch (error) {
    throw createDatasetFetchError(HUGGING_FACE_MODELS_DATASET, error);
  }
}

async function fetchManifoldMarketSamples(
  limit: number,
  transport: Pick<FetchFallbackOptions, "fetchImpl" | "execFileImpl" | "platform"> = {}
) {
  const url = new URL("https://api.manifold.markets/v0/search-markets");
  url.searchParams.set("term", "");
  url.searchParams.set("sort", "resolve-date");
  url.searchParams.set("filter", "resolved");
  url.searchParams.set("contractType", "BINARY");
  url.searchParams.set("limit", String(Math.min(limit, 1000)));

  try {
    const payload = await fetchJsonWithFallback(url, { ...transport, attempts: 1, httpTimeoutMs: 8000 });
    const rows = Array.isArray(payload) ? payload : [];
    return rows.flatMap((row, rowIndex) =>
      convertManifoldMarketRow(row as Parameters<typeof convertManifoldMarketRow>[0], {
        dataset: MANIFOLD_MARKETS_DATASET.dataset,
        split: MANIFOLD_MARKETS_DATASET.split,
        rowIndex
      })
    );
  } catch (error) {
    throw createDatasetFetchError(MANIFOLD_MARKETS_DATASET, error);
  }
}

export async function runFetchTrainingDataCommand(
  options: FetchTrainingDataCommandOptions = {}
): Promise<FetchTrainingDataCommandResult> {
  const limit = positiveLimit(options.limit);
  const outputDir = options.outputDir ?? defaultOutputDir();
  const samplesPath = path.join(outputDir, "external-training-samples.jsonl");
  const manifestPath = path.join(outputDir, "external-training-manifest.json");
  const samples: TrainingSample[] = [];
  const sourceCounts: Record<string, number> = {};
  const transport = transportOptions(options);
  const selectedSources = selectedSourceSet(options);

  for (const dataset of DATASETS) {
    if (!selectedSources.has(dataset.source)) continue;

    const rows = await fetchDatasetRows(dataset, limit, transport);
    const converted = rows.flatMap((item) =>
      dataset.convert(item.row, { dataset: dataset.dataset, split: dataset.split, rowIndex: item.row_idx })
    );
    sourceCounts[dataset.source] = converted.length;
    samples.push(...converted);
  }

  if (selectedSources.has(CFEVER_DATASET.source)) {
    const cfeverSamples = await fetchCfeverSamples(limit, transport);
    sourceCounts[CFEVER_DATASET.source] = cfeverSamples.length;
    samples.push(...cfeverSamples);
  }

  if (selectedSources.has(GITHUB_REPOSITORY_DATASET.source)) {
    const githubSamples = await fetchGithubRepositorySamples(limit, transport);
    sourceCounts[GITHUB_REPOSITORY_DATASET.source] = githubSamples.length;
    samples.push(...githubSamples);
  }

  if (selectedSources.has(HUGGING_FACE_MODELS_DATASET.source)) {
    const huggingFaceSamples = await fetchHuggingFaceModelSamples(limit, transport);
    sourceCounts[HUGGING_FACE_MODELS_DATASET.source] = huggingFaceSamples.length;
    samples.push(...huggingFaceSamples);
  }

  if (selectedSources.has(MANIFOLD_MARKETS_DATASET.source)) {
    const manifoldSamples = await fetchManifoldMarketSamples(limit, transport);
    sourceCounts[MANIFOLD_MARKETS_DATASET.source] = manifoldSamples.length;
    samples.push(...manifoldSamples);
  }

  assertUsableTrainingSamples(samples, { action: "write", samplesPath });

  await mkdir(outputDir, { recursive: true });
  await writeFile(samplesPath, samples.map((sample) => JSON.stringify(sample)).join("\n"), "utf8");
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sampleCount: samples.length,
        sourceCounts,
        datasets: selectedDatasets(selectedSources).map(({ source, dataset, config, split }) => ({
          source,
          dataset,
          config,
          split
        })),
        samplesPath
      },
      null,
      2
    ),
    "utf8"
  );

  return { fetched: true, sampleCount: samples.length, sourceCounts, samplesPath, manifestPath };
}
