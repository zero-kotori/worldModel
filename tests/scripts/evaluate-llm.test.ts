import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { parseEvaluateLlmArgs, selectEvaluationSamples } from "../../scripts/evaluate_llm";
import { runLlmEvaluationCommand } from "@/server/training/llm-evaluation-runner";
import type { TrainingSample } from "@/server/training/training-data";

const execFileAsync = promisify(execFile);

function sample(sourceId: string, label: TrainingSample["label"], source: TrainingSample["source"] = "fever"): TrainingSample {
  return {
    source,
    claim: `claim ${sourceId}`,
    evidence: `evidence ${sourceId}`,
    label,
    relevance: 0.8,
    likelihoodRatio: label === "SUPPORTS" ? 2.5 : label === "OPPOSES" ? 0.4 : 1,
    confidence: 0.85,
    provenance: { dataset: "test", split: "unit", sourceId }
  };
}

describe("LLM evaluation script helpers", () => {
  it("parses a custom output directory for aligned evaluation artifacts", () => {
    expect(parseEvaluateLlmArgs(["node", "evaluate_llm.ts", "--output-dir", "C:\\tmp\\world-model", "--limit", "9"])).toEqual({
      outputDir: "C:\\tmp\\world-model",
      limit: 9,
      env: process.env
    });
  });

  it("selects evaluation samples across labels instead of taking only the file prefix", () => {
    const samples = [
      sample("support-1", "SUPPORTS"),
      sample("support-2", "SUPPORTS"),
      sample("support-3", "SUPPORTS"),
      sample("oppose-1", "OPPOSES"),
      sample("oppose-2", "OPPOSES"),
      sample("neutral-1", "NEUTRAL")
    ];

    expect(selectEvaluationSamples(samples, 3).map((item) => item.label)).toEqual(["SUPPORTS", "OPPOSES", "NEUTRAL"]);
    expect(selectEvaluationSamples(samples, 4).map((item) => item.provenance.sourceId)).toEqual([
      "support-1",
      "oppose-1",
      "neutral-1",
      "support-2"
    ]);
  });

  it("returns all samples when the limit covers the dataset", () => {
    const samples = [sample("support-1", "SUPPORTS"), sample("neutral-1", "NEUTRAL")];

    expect(selectEvaluationSamples(samples, 10)).toEqual(samples);
  });

  it("keeps local confirmed samples in small evaluation batches", () => {
    const samples = [
      sample("support-1", "SUPPORTS"),
      sample("support-2", "SUPPORTS"),
      sample("oppose-1", "OPPOSES"),
      sample("neutral-1", "NEUTRAL"),
      sample("local-1", "SUPPORTS", "local_confirmed")
    ];

    const selected = selectEvaluationSamples(samples, 3);

    expect(selected.map((item) => item.provenance.sourceId)).toContain("local-1");
    expect(selected.map((item) => item.label)).toEqual(expect.arrayContaining(["OPPOSES", "NEUTRAL"]));
  });

  it("keeps local resolved samples in small evaluation batches", () => {
    const samples = [
      sample("support-1", "SUPPORTS"),
      sample("support-2", "SUPPORTS"),
      sample("oppose-1", "OPPOSES"),
      sample("neutral-1", "NEUTRAL"),
      sample("resolved-1", "OPPOSES", "local_resolved")
    ];

    const selected = selectEvaluationSamples(samples, 3);

    expect(selected.map((item) => item.provenance.sourceId)).toContain("resolved-1");
    expect(selected.map((item) => item.label)).toEqual(expect.arrayContaining(["SUPPORTS", "NEUTRAL"]));
  });

  it("keeps GitHub and Hugging Face samples in bounded evaluation batches", () => {
    const samples = [
      sample("fever-support-1", "SUPPORTS", "fever"),
      sample("fever-support-2", "SUPPORTS", "fever"),
      sample("fever-oppose-1", "OPPOSES", "fever"),
      sample("fever-neutral-1", "NEUTRAL", "fever"),
      sample("github-support-1", "SUPPORTS", "github"),
      sample("hugging-face-neutral-1", "NEUTRAL", "hugging_face"),
      sample("scifact-oppose-1", "OPPOSES", "scifact")
    ];

    const selected = selectEvaluationSamples(samples, 5);

    expect(selected.map((item) => item.source)).toEqual(expect.arrayContaining(["github", "hugging_face"]));
    expect(selected.map((item) => item.label)).toEqual(expect.arrayContaining(["SUPPORTS", "OPPOSES", "NEUTRAL"]));
  });

  it("does not write an evaluation artifact when scorer credentials are blank", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "world-model-evaluate-"));
    const samplesPath = path.join(tempDir, "samples.jsonl");
    const outputPath = path.join(tempDir, "llm-evaluation.json");
    await writeFile(samplesPath, `${JSON.stringify(sample("support-1", "SUPPORTS"))}\n`, "utf8");

    await expect(
      execFileAsync(
        process.execPath,
        [
          path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"),
          path.join(process.cwd(), "scripts", "evaluate_llm.ts"),
          "--samples",
          samplesPath,
          "--fallback",
          path.join(tempDir, "missing-lightweight.json"),
          "--output",
          outputPath,
          "--limit",
          "1"
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            LLM_PROVIDER: "",
            LLM_BASE_URL: "",
            LLM_MODEL: "",
            LLM_API_KEY: ""
          }
        }
      )
    ).rejects.toThrow(/LLM evaluation requires configured LLM_API_KEY/);

    await expect(access(outputPath)).rejects.toThrow();
  });

  it("evaluates enough samples by default to satisfy the auto-apply readiness gate", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "world-model-evaluate-"));
    const samplesPath = path.join(tempDir, "samples.jsonl");
    const outputPath = path.join(tempDir, "llm-evaluation.json");
    const samples = Array.from({ length: 35 }, (_, index) =>
      sample(`support-${index + 1}`, index % 3 === 0 ? "SUPPORTS" : index % 3 === 1 ? "OPPOSES" : "NEUTRAL")
    );
    const fetcher = async () =>
      new Response(
        JSON.stringify({
          model: "deepseek-chat",
          choices: [
            {
              message: {
                content: JSON.stringify({
                  direction: "SUPPORTS",
                  relevance: 0.8,
                  likelihoodRatio: 2.1,
                  confidence: 0.8,
                  reviewRequired: false,
                  rationale: "The evidence supports the claim."
                })
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    await writeFile(samplesPath, `${samples.map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8");

    const result = await runLlmEvaluationCommand({
      samplesPath,
      fallbackPath: path.join(tempDir, "missing-lightweight.json"),
      outputPath,
      env: {
        LLM_PROVIDER: "",
        LLM_BASE_URL: "",
        LLM_MODEL: "",
        LLM_API_KEY: "test-key"
      },
      fetcher
    });

    const artifact = JSON.parse(await readFile(outputPath, "utf8")) as { summary: { sampleCount: number; modelName: string } };

    expect(result.summary.sampleCount).toBe(30);
    expect(artifact.summary.sampleCount).toBe(30);
    expect(artifact.summary.modelName).toBe("deepseek:deepseek-chat");
  });

  it("evaluates samples from a custom artifact directory", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "world-model-evaluate-"));
    const samplesPath = path.join(outputDir, "training-samples.jsonl");
    const fallbackPath = path.join(outputDir, "lightweight-local.json");
    const outputPath = path.join(outputDir, "llm-evaluation.json");
    await writeFile(samplesPath, `${JSON.stringify(sample("support-1", "SUPPORTS"))}\n`, "utf8");
    await writeFile(
      fallbackPath,
      JSON.stringify({
        name: "lightweight-local",
        version: "0.1.0",
        trained: true,
        biasLogLikelihoodRatio: Math.log(2),
        tokenWeights: {}
      }),
      "utf8"
    );

    const result = await runLlmEvaluationCommand({
      outputDir,
      limit: 1,
      env: {
        LLM_PROVIDER: "",
        LLM_BASE_URL: "",
        LLM_MODEL: "",
        LLM_API_KEY: "test-key"
      },
      fetcher: async () =>
        new Response(
          JSON.stringify({
            model: "deepseek-chat",
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    direction: "SUPPORTS",
                    relevance: 0.8,
                    likelihoodRatio: 2.1,
                    confidence: 0.8,
                    reviewRequired: false,
                    rationale: "The evidence supports the claim."
                  })
                }
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    });

    const artifact = JSON.parse(await readFile(outputPath, "utf8")) as {
      samplesPath: string;
      artifactPath: string;
      summary: { sampleCount: number };
    };

    expect(result.outputPath).toBe(outputPath);
    expect(artifact.samplesPath).toBe(samplesPath);
    expect(artifact.artifactPath).toBe(fallbackPath);
    expect(artifact.summary.sampleCount).toBe(1);
  });

  it("uses normalized DeepSeek defaults for configured evaluation artifacts", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "world-model-evaluate-"));
    const samplesPath = path.join(tempDir, "samples.jsonl");
    const outputPath = path.join(tempDir, "llm-evaluation.json");
    await writeFile(samplesPath, `${JSON.stringify(sample("support-1", "SUPPORTS"))}\n`, "utf8");

    await runLlmEvaluationCommand({
      samplesPath,
      fallbackPath: path.join(tempDir, "missing-lightweight.json"),
      outputPath,
      limit: 1,
      env: {
        LLM_PROVIDER: "",
        LLM_BASE_URL: "",
        LLM_MODEL: "",
        LLM_API_KEY: "test-key"
      },
      fetcher: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    direction: "SUPPORTS",
                    relevance: 0.8,
                    likelihoodRatio: 2.1,
                    confidence: 0.8,
                    reviewRequired: false,
                    rationale: "The evidence supports the claim."
                  })
                }
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    });

    const artifact = JSON.parse(await readFile(outputPath, "utf8")) as { summary: { modelName: string } };

    expect(artifact.summary.modelName).toBe("deepseek:deepseek-chat");
  });

  it("keeps weak lightweight fallback likelihood ratios neutral during LLM evaluation", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "world-model-evaluate-"));
    const samplesPath = path.join(tempDir, "samples.jsonl");
    const fallbackPath = path.join(tempDir, "lightweight-local.json");
    const outputPath = path.join(tempDir, "llm-evaluation.json");
    await writeFile(samplesPath, `${JSON.stringify(sample("neutral-1", "NEUTRAL"))}\n`, "utf8");
    await writeFile(
      fallbackPath,
      JSON.stringify({
        name: "lightweight-local",
        kind: "LIGHTWEIGHT",
        version: "0.1.0",
        trained: true,
        biasLogLikelihoodRatio: Math.log(1.3),
        tokenWeights: {}
      }),
      "utf8"
    );

    await runLlmEvaluationCommand({
      samplesPath,
      fallbackPath,
      outputPath,
      limit: 1,
      env: {
        LLM_PROVIDER: "",
        LLM_BASE_URL: "",
        LLM_MODEL: "",
        LLM_API_KEY: "test-key"
      },
      fetcher: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    direction: "NEUTRAL",
                    relevance: 0.3,
                    likelihoodRatio: 1,
                    confidence: 0.8,
                    reviewRequired: true,
                    rationale: "The evidence is not enough to move the claim."
                  })
                }
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    });

    const artifact = JSON.parse(await readFile(outputPath, "utf8")) as {
      items: Array<{ fallback?: { direction?: string; likelihoodRatio?: number } }>;
      summary: { fallbackComparedCount: number; fallbackDivergenceRate: number | null };
    };

    expect(artifact.items[0].fallback).toMatchObject({
      direction: "NEUTRAL",
      likelihoodRatio: expect.closeTo(1.3, 5)
    });
    expect(artifact.summary.fallbackComparedCount).toBe(0);
    expect(artifact.summary.fallbackDivergenceRate).toBeNull();
  });

  it("keeps the CLI default evaluation limit aligned with the readiness gate", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "world-model-evaluate-"));
    const samplesPath = path.join(tempDir, "samples.jsonl");
    const outputPath = path.join(tempDir, "llm-evaluation.json");
    const samples = Array.from({ length: 35 }, (_, index) =>
      sample(`support-${index + 1}`, index % 3 === 0 ? "SUPPORTS" : index % 3 === 1 ? "OPPOSES" : "NEUTRAL")
    );
    await writeFile(samplesPath, `${samples.map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8");

    await expect(
      execFileAsync(
      process.execPath,
      [
        path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"),
        path.join(process.cwd(), "scripts", "evaluate_llm.ts"),
        "--samples",
        samplesPath,
        "--fallback",
        path.join(tempDir, "missing-lightweight.json"),
        "--output",
        outputPath
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          LLM_PROVIDER: "",
          LLM_BASE_URL: "",
          LLM_MODEL: "",
          LLM_API_KEY: ""
        }
      }
      )
    ).rejects.toThrow(/LLM evaluation requires configured LLM_API_KEY/);
  });
});
