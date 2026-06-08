import {
  convertClimateFeverRow,
  convertFeverNliRow,
  convertSciFactRow,
  labelToLikelihoodRatio
} from "@/server/training/training-data";

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

  it("maps labels into conservative likelihood ratios", () => {
    expect(labelToLikelihoodRatio("SUPPORTS")).toBe(2.5);
    expect(labelToLikelihoodRatio("OPPOSES")).toBe(0.4);
    expect(labelToLikelihoodRatio("NEUTRAL")).toBe(1);
  });
});
