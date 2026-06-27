import {
  assertUsableTrainingSamples,
  convertCfeverRow,
  convertClimateFeverRow,
  convertFeverNliRow,
  convertGithubRepositoryRow,
  convertHuggingFaceModelRow,
  convertManifoldMarketRow,
  convertSciFactRow,
  cfeverEvidencePageTitles,
  labelToLikelihoodRatio
} from "@/server/training/training-data";
import type { TrainingSample } from "@/server/training/training-data";

describe("external training data conversion", () => {
  it("converts FEVER NLI rows into sourced likelihood samples", () => {
    const [sample] = convertFeverNliRow(
      {
        cid: 75397,
        premise: "Nikolaj Coster-Waldau worked with the Fox Broadcasting Company.",
        hypothesis: "Fox is an American broadcast network.",
        fever_gold_label: "SUPPORTS",
        label: 0
      },
      { dataset: "pietrolesci/nli_fever", split: "train", rowIndex: 0 }
    );

    expect(sample).toMatchObject({
      source: "fever",
      claim: "Nikolaj Coster-Waldau worked with the Fox Broadcasting Company.",
      evidence: "Fox is an American broadcast network.",
      label: "SUPPORTS",
      likelihoodRatio: 2.5,
      provenance: { dataset: "pietrolesci/nli_fever", split: "train", sourceId: "75397:0" }
    });
  });

  it("converts SciFact rows and preserves evidence provenance", () => {
    const [sample] = convertSciFactRow(
      {
        claim_id: 1,
        claim: "0-dimensional biomaterials lack inductive properties.",
        title: "A biomaterials paper",
        abstract: ["First sentence.", "Evidence sentence."],
        verdict: "CONTRADICT",
        evidence: [1]
      },
      { dataset: "allenai/scifact_entailment", split: "train", rowIndex: 3 }
    );

    expect(sample.source).toBe("scifact");
    expect(sample.evidence).toBe("A biomaterials paper. Evidence sentence.");
    expect(sample.label).toBe("OPPOSES");
    expect(sample.provenance.sourceId).toBe("1:3");
  });

  it("converts Climate-FEVER rows into one sample per evidence item", () => {
    const samples = convertClimateFeverRow(
      {
        claim_id: "0",
        claim: "Global warming is not happening.",
        evidences: [
          { evidence_id: "ev1", evidence_label: 1, evidence: "Instrumental records show warming." },
          { evidence_id: "ev2", evidence_label: 2, evidence: "Insufficient context." }
        ]
      },
      { dataset: "tdiggelm/climate_fever", split: "test", rowIndex: 0 }
    );

    expect(samples).toHaveLength(2);
    expect(samples[0]).toMatchObject({ source: "climate_fever", label: "OPPOSES", likelihoodRatio: 0.4 });
    expect(samples[1]).toMatchObject({ source: "climate_fever", label: "NEUTRAL", likelihoodRatio: 1 });
    expect(samples.every((sample) => String(sample.source) !== "demo" && sample.provenance.dataset)).toBe(true);
  });

  it("converts CFEVER rows with referenced wiki lines into Chinese likelihood samples", () => {
    const samples = convertCfeverRow(
      {
        id: 50,
        label: "supports",
        claim: "金朝中期以後女真年輕人改漢姓的現象常見",
        evidence: [[{ annotation_id: 16, evidence_id: 15, page_title: "金朝", sentence_id: 34 }]],
        domain: "政治"
      },
      { dataset: "IKMLab-team/cfever", split: "train", rowIndex: 0 },
      new Map([
        [
          "金朝",
          {
            id: "金朝",
            lines: [
              "33\t金朝前期女真人保持本族姓氏 。",
              "34\t金朝中期以後 ， 女真年輕人改漢姓的現象常見 。\t女真\t女真"
            ].join("\n")
          }
        ]
      ])
    );

    expect(samples).toEqual([
      expect.objectContaining({
        source: "cfever",
        claim: "金朝中期以後女真年輕人改漢姓的現象常見",
        evidence: "金朝中期以後 ， 女真年輕人改漢姓的現象常見 。",
        label: "SUPPORTS",
        likelihoodRatio: 2.5,
        provenance: {
          dataset: "IKMLab-team/cfever",
          split: "train",
          sourceId: "50:0:0"
        }
      })
    ]);
  });

  it("converts GitHub repository metadata into real-source likelihood samples", () => {
    const [sample] = convertGithubRepositoryRow(
      {
        id: 42,
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
      },
      { dataset: "github/search/repositories", split: "live", rowIndex: 0 }
    );

    expect(sample).toMatchObject({
      source: "github",
      claim: "example/agent-framework is an actively adopted TypeScript project.",
      label: "SUPPORTS",
      likelihoodRatio: 2.5,
      provenance: {
        dataset: "github/search/repositories",
        split: "live",
        sourceId: "42:0"
      }
    });
    expect(sample.evidence).toContain("Stars: 12500");
    expect(sample.evidence).toContain("Topics: ai-agents, llm");
  });

  it("converts Hugging Face model metadata into real-source likelihood samples", () => {
    const [sample] = convertHuggingFaceModelRow(
      {
        id: "org/model",
        modelId: "org/model",
        pipeline_tag: "text-generation",
        tags: ["transformers", "text-generation"],
        downloads: 250_000,
        likes: 340,
        lastModified: "2026-06-18T00:00:00.000Z"
      },
      { dataset: "huggingface/api/models", split: "live", rowIndex: 0 }
    );

    expect(sample).toMatchObject({
      source: "hugging_face",
      claim: "org/model is a widely used Hugging Face text-generation model.",
      label: "SUPPORTS",
      likelihoodRatio: 2.5,
      provenance: {
        dataset: "huggingface/api/models",
        split: "live",
        sourceId: "org/model:0"
      }
    });
    expect(sample.evidence).toContain("Downloads: 250000");
    expect(sample.evidence).toContain("Tags: transformers, text-generation");
  });

  it("converts resolved Manifold binary markets into prediction outcome samples", () => {
    const [sample] = convertManifoldMarketRow(
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
      },
      { dataset: "manifold/search-markets", split: "resolved-binary", rowIndex: 0 }
    );

    expect(sample).toMatchObject({
      source: "manifold",
      claim: "Will OpenAI release a new frontier model before 2026?",
      label: "SUPPORTS",
      likelihoodRatio: 2.5,
      provenance: {
        dataset: "manifold/search-markets",
        split: "resolved-binary",
        sourceId: "market_1:0"
      }
    });
    expect(sample.evidence).toContain("Resolved: YES");
    expect(sample.evidence).toContain("Market probability before resolution: 72.0%");
    expect(sample.evidence).toContain("Unique bettors: 240");
  });

  it("skips unresolved and non-binary Manifold markets", () => {
    expect(
      convertManifoldMarketRow(
        {
          id: "market_unresolved",
          question: "Will this unresolved market count?",
          outcomeType: "BINARY",
          isResolved: false,
          resolution: "YES"
        },
        { dataset: "manifold/search-markets", split: "resolved-binary", rowIndex: 1 }
      )
    ).toEqual([]);
    expect(
      convertManifoldMarketRow(
        {
          id: "market_multi",
          question: "Which option wins?",
          outcomeType: "MULTIPLE_CHOICE",
          isResolved: true,
          resolution: "MKT"
        },
        { dataset: "manifold/search-markets", split: "resolved-binary", rowIndex: 2 }
      )
    ).toEqual([]);
  });

  it("does not create CFEVER samples when evidence references cannot be resolved", () => {
    expect(
      convertCfeverRow(
        {
          id: 54,
          label: "NOT ENOUGH INFO",
          claim: "金朝中期以後女真年輕人上大學的現象常見",
          evidence: [[{ annotation_id: 40, evidence_id: null, page_title: null, sentence_id: null }]],
          domain: "人文與社會科學"
        },
        { dataset: "IKMLab-team/cfever", split: "train", rowIndex: 1 },
        new Map()
      )
    ).toEqual([]);
  });

  it("extracts CFEVER evidence page titles without null placeholder references", () => {
    expect(
      cfeverEvidencePageTitles({
        id: 50,
        label: "supports",
        claim: "金朝中期以後女真年輕人改漢姓的現象常見",
        evidence: [
          [
            { annotation_id: 16, evidence_id: 15, page_title: "金朝", sentence_id: 34 },
            { annotation_id: 17, evidence_id: null, page_title: null, sentence_id: null }
          ],
          [{ annotation_id: 18, evidence_id: 16, page_title: "女真", sentence_id: 2 }]
        ],
        domain: "政治"
      })
    ).toEqual(["金朝", "女真"]);
  });

  it("maps labels into conservative likelihood ratios", () => {
    expect(labelToLikelihoodRatio("SUPPORTS")).toBe(2.5);
    expect(labelToLikelihoodRatio("OPPOSES")).toBe(0.4);
    expect(labelToLikelihoodRatio("NEUTRAL")).toBe(1);
  });

  it("rejects empty, demo, and structurally invalid training sample sets", () => {
    const valid: TrainingSample = {
      source: "fever",
      claim: "A claim.",
      evidence: "A sourced evidence passage.",
      label: "SUPPORTS",
      relevance: 0.8,
      likelihoodRatio: 2.5,
      confidence: 0.85,
      provenance: { dataset: "test", split: "unit", sourceId: "row-1" }
    };

    expect(() => assertUsableTrainingSamples([], { action: "prepare", samplesPath: "model-artifacts/training-samples.jsonl" })).toThrow(
      /No real training samples/
    );
    expect(() =>
      assertUsableTrainingSamples([{ ...valid, source: "demo" } as unknown as TrainingSample], { action: "prepare" })
    ).toThrow(/demo training samples/);
    expect(() => assertUsableTrainingSamples([{ ...valid, evidence: " " }], { action: "prepare" })).toThrow(/invalid training sample/);
    expect(() => assertUsableTrainingSamples([valid], { action: "prepare" })).not.toThrow();
  });
});
