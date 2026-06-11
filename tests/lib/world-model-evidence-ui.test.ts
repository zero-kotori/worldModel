import { readEvidenceLinksFromFormData } from "@/lib/world-model-evidence-ui";

describe("world model evidence UI", () => {
  it("reads per-hypothesis evidence link fields before shared defaults", () => {
    const formData = new FormData();
    formData.append("hypothesisIds", "hypothesis_shared");
    formData.append("direction", "SUPPORTS");
    formData.append("relevance", "0.1");
    formData.append("likelihoodRatio", "1.2");
    formData.append("confidence", "0.2");
    formData.append("rationale", "Shared rationale");
    formData.append("linkHypothesisIds", "hypothesis_a");
    formData.append("direction:hypothesis_a", "SUPPORTS");
    formData.append("relevance:hypothesis_a", "0.91");
    formData.append("likelihoodRatio:hypothesis_a", "2.4");
    formData.append("confidence:hypothesis_a", "0.82");
    formData.append("rationale:hypothesis_a", "Supports the first hypothesis");
    formData.append("linkHypothesisIds", "hypothesis_b");
    formData.append("direction:hypothesis_b", "OPPOSES");
    formData.append("relevance:hypothesis_b", "0.63");
    formData.append("likelihoodRatio:hypothesis_b", "0.48");
    formData.append("confidence:hypothesis_b", "0.74");
    formData.append("rationale:hypothesis_b", "Weakens the second hypothesis");

    expect(readEvidenceLinksFromFormData(formData)).toEqual([
      {
        hypothesisId: "hypothesis_a",
        direction: "SUPPORTS",
        relevance: 0.91,
        likelihoodRatio: 2.4,
        confidence: 0.82,
        rationale: "Supports the first hypothesis"
      },
      {
        hypothesisId: "hypothesis_b",
        direction: "OPPOSES",
        relevance: 0.63,
        likelihoodRatio: 0.48,
        confidence: 0.74,
        rationale: "Weakens the second hypothesis"
      }
    ]);
  });

  it("keeps the existing shared link behavior for manual confirmation forms", () => {
    const formData = new FormData();
    formData.append("hypothesisIds", "hypothesis_a");
    formData.append("hypothesisIds", "hypothesis_b");
    formData.append("direction", "OPPOSES");
    formData.append("relevance", "0.7");
    formData.append("likelihoodRatio", "2");
    formData.append("confidence", "0.6");
    formData.append("rationale", "Shared opposing evidence");

    expect(readEvidenceLinksFromFormData(formData)).toEqual([
      {
        hypothesisId: "hypothesis_a",
        direction: "OPPOSES",
        relevance: 0.7,
        likelihoodRatio: 0.5,
        confidence: 0.6,
        rationale: "Shared opposing evidence"
      },
      {
        hypothesisId: "hypothesis_b",
        direction: "OPPOSES",
        relevance: 0.7,
        likelihoodRatio: 0.5,
        confidence: 0.6,
        rationale: "Shared opposing evidence"
      }
    ]);
  });
});
