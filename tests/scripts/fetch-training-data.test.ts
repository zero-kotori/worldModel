import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runFetchTrainingDataCommand } from "@/server/training/training-data-fetch-runner";
import { parseFetchTrainingDataArgs } from "../../scripts/fetch_training_data";

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function textResponse(value: string) {
  return new Response(value, {
    status: 200,
    headers: { "content-type": "text/plain" }
  });
}

function rowsResponse(dataset: string | null) {
  if (dataset === "pietrolesci/nli_fever") {
    return jsonResponse({
      rows: [
        {
          row_idx: 0,
          row: {
            cid: 1,
            premise: "Nikolaj Coster-Waldau worked with Fox.",
            hypothesis: "Fox is an American broadcast network.",
            fever_gold_label: "SUPPORTS"
          }
        }
      ]
    });
  }

  if (dataset === "allenai/scifact_entailment") {
    return jsonResponse({
      rows: [
        {
          row_idx: 0,
          row: {
            claim_id: 2,
            claim: "0-dimensional biomaterials lack inductive properties.",
            title: "A biomaterials paper",
            abstract: ["Background.", "Evidence sentence."],
            verdict: "CONTRADICT",
            evidence: [1]
          }
        }
      ]
    });
  }

  if (dataset === "tdiggelm/climate_fever") {
    return jsonResponse({
      rows: [
        {
          row_idx: 0,
          row: {
            claim_id: "3",
            claim: "Global warming is not happening.",
            evidences: [{ evidence_id: "ev1", evidence_label: 1, evidence: "Instrumental records show warming." }]
          }
        }
      ]
    });
  }

  if (dataset === "IKMLab-team/cfever") {
    return jsonResponse({
      rows: [
        {
          row_idx: 0,
          row: {
            id: 4,
            label: "supports",
            claim: "金朝中期以後女真年輕人改漢姓的現象常見",
            evidence: [[{ annotation_id: 16, evidence_id: 15, page_title: "金朝", sentence_id: 34 }]]
          }
        }
      ]
    });
  }

  return jsonResponse({ rows: [] });
}

function githubSearchResponse() {
  return jsonResponse({
    items: [
      {
        id: 101,
        full_name: "example/agent-framework",
        description: "An open-source AI agent framework.",
        language: "TypeScript",
        topics: ["ai-agents", "llm"],
        stargazers_count: 12_500,
        forks_count: 780,
        open_issues_count: 38,
        archived: false,
        pushed_at: "2026-06-18T00:00:00Z",
        html_url: "https://github.com/example/agent-framework"
      }
    ]
  });
}

function huggingFaceModelsResponse() {
  return jsonResponse([
    {
      id: "org/model",
      modelId: "org/model",
      pipeline_tag: "text-generation",
      tags: ["transformers", "text-generation"],
      downloads: 250_000,
      likes: 340,
      lastModified: "2026-06-18T00:00:00.000Z"
    }
  ]);
}

function manifoldMarketsResponse() {
  return jsonResponse([
    {
      id: "market_1",
      question: "Will OpenAI release a new frontier model before 2026?",
      description: "Resolves YES if a generally available frontier model is released before Jan 1 2026.",
      url: "https://manifold.markets/example/frontier-model-before-2026",
      outcomeType: "BINARY",
      isResolved: true,
      resolution: "YES",
      probability: 0.72,
      volume: 50_000,
      uniqueBettorCount: 240,
      closeTime: 1767225600000,
      resolutionTime: 1767139200000
    }
  ]);
}

describe("fetch training data command", () => {
  it("parses a custom output directory for local training-data fetches", () => {
    expect(parseFetchTrainingDataArgs(["node", "fetch_training_data.ts", "--limit", "12", "--output-dir", "C:\\tmp\\world-model"])).toEqual({
      limit: 12,
      outputDir: "C:\\tmp\\world-model"
    });
  });

  it("parses selected external sources for focused training-data fetches", () => {
    expect(
      parseFetchTrainingDataArgs([
        "node",
        "fetch_training_data.ts",
        "--limit",
        "12",
        "--sources",
        "github,hugging_face",
        "--output-dir",
        "C:\\tmp\\world-model"
      ])
    ).toEqual({
      limit: 12,
      sources: ["github", "hugging_face"],
      outputDir: "C:\\tmp\\world-model"
    });
  });

  it("uses an injected fetcher to write real external samples without touching the network", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "world-model-fetch-"));
    const originalFetch = globalThis.fetch;
    const fetchedUrls: string[] = [];

    globalThis.fetch = vi.fn(async () => jsonResponse({ rows: [] })) as typeof fetch;

    const fetchImpl = vi.fn(async (url: URL) => {
      fetchedUrls.push(url.toString());
      if (url.hostname === "datasets-server.huggingface.co") {
        return rowsResponse(url.searchParams.get("dataset"));
      }
      if (url.hostname === "api.github.com" && url.pathname === "/search/repositories") {
        return githubSearchResponse();
      }
      if (url.hostname === "huggingface.co" && url.pathname === "/api/models") {
        return huggingFaceModelsResponse();
      }
      if (url.hostname === "api.manifold.markets" && url.pathname === "/v0/search-markets") {
        return manifoldMarketsResponse();
      }
      if (url.pathname.endsWith("/wiki-001.jsonl")) {
        return textResponse(JSON.stringify({ id: "金朝", lines: "34\t金朝中期以後 ， 女真年輕人改漢姓的現象常見 。" }));
      }
      return textResponse("");
    }) as typeof fetch;

    try {
      const result = await runFetchTrainingDataCommand({
        limit: 1,
        outputDir: directory,
        fetchImpl
      });
      const sampleLines = (await readFile(path.join(directory, "external-training-samples.jsonl"), "utf8"))
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line) as { source: string; provenance: { dataset: string; sourceId: string } });
      const manifest = JSON.parse(await readFile(path.join(directory, "external-training-manifest.json"), "utf8")) as {
        sourceCounts: Record<string, number>;
      };

      expect(result.sampleCount).toBe(7);
      expect(result.sourceCounts).toEqual({
        fever: 1,
        scifact: 1,
        climate_fever: 1,
        cfever: 1,
        github: 1,
        hugging_face: 1,
        manifold: 1
      });
      expect(manifest.sourceCounts).toEqual(result.sourceCounts);
      expect(sampleLines.map((sample) => sample.source).sort()).toEqual([
        "cfever",
        "climate_fever",
        "fever",
        "github",
        "hugging_face",
        "manifold",
        "scifact"
      ]);
      expect(sampleLines.every((sample) => sample.source !== "demo" && sample.provenance.dataset && sample.provenance.sourceId)).toBe(true);
      expect(fetchedUrls.some((url) => url.includes("datasets-server.huggingface.co"))).toBe(true);
      expect(fetchedUrls.some((url) => url.includes("api.github.com/search/repositories"))).toBe(true);
      expect(fetchedUrls.some((url) => url.includes("huggingface.co/api/models"))).toBe(true);
      expect(fetchedUrls.some((url) => url.includes("api.manifold.markets/v0/search-markets"))).toBe(true);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("fetches only selected real platform sources for a fast focused refresh", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "world-model-platform-fetch-"));
    const fetchedUrls: string[] = [];
    const fetchImpl = vi.fn(async (url: URL) => {
      fetchedUrls.push(url.toString());
      if (url.hostname === "api.github.com" && url.pathname === "/search/repositories") {
        return githubSearchResponse();
      }
      if (url.hostname === "huggingface.co" && url.pathname === "/api/models") {
        return huggingFaceModelsResponse();
      }
      return textResponse("");
    }) as typeof fetch;

    try {
      const result = await runFetchTrainingDataCommand({
        limit: 1,
        outputDir: directory,
        fetchImpl,
        sources: ["github", "hugging_face"]
      });
      const manifest = JSON.parse(await readFile(path.join(directory, "external-training-manifest.json"), "utf8")) as {
        sourceCounts: Record<string, number>;
        datasets: Array<{ source: string }>;
      };

      expect(result.sampleCount).toBe(2);
      expect(result.sourceCounts).toEqual({ github: 1, hugging_face: 1 });
      expect(manifest.sourceCounts).toEqual(result.sourceCounts);
      expect(manifest.datasets.map((dataset) => dataset.source)).toEqual(["github", "hugging_face"]);
      expect(fetchedUrls.some((url) => url.includes("datasets-server.huggingface.co"))).toBe(false);
      expect(fetchedUrls.some((url) => url.includes("api.github.com/search/repositories"))).toBe(true);
      expect(fetchedUrls.some((url) => url.includes("huggingface.co/api/models"))).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("fetches only Manifold resolved markets for focused prediction calibration refreshes", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "world-model-manifold-fetch-"));
    const fetchedUrls: string[] = [];
    const fetchImpl = vi.fn(async (url: URL) => {
      fetchedUrls.push(url.toString());
      if (url.hostname === "api.manifold.markets" && url.pathname === "/v0/search-markets") {
        return manifoldMarketsResponse();
      }
      return textResponse("");
    }) as typeof fetch;

    try {
      const result = await runFetchTrainingDataCommand({
        limit: 1,
        outputDir: directory,
        fetchImpl,
        sources: ["manifold"]
      });
      const manifest = JSON.parse(await readFile(path.join(directory, "external-training-manifest.json"), "utf8")) as {
        sourceCounts: Record<string, number>;
        datasets: Array<{ source: string }>;
      };

      expect(result.sampleCount).toBe(1);
      expect(result.sourceCounts).toEqual({ manifold: 1 });
      expect(manifest.sourceCounts).toEqual(result.sourceCounts);
      expect(manifest.datasets.map((dataset) => dataset.source)).toEqual(["manifold"]);
      expect(fetchedUrls).toHaveLength(1);
      expect(fetchedUrls[0]).toContain("filter=resolved");
      expect(fetchedUrls[0]).toContain("contractType=BINARY");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
