import { createConfiguredLlmHypothesisRecommendationGenerator } from "@/server/models/hypothesis-recommendations";
import type { BeliefRecord, HypothesisRecord, ObservationRecord } from "@/server/services/types";

function belief(hypothesis: HypothesisRecord): BeliefRecord {
  const createdAt = new Date("2026-06-11T07:00:00.000Z");
  return {
    id: "belief_procurement",
    title: "AI procurement timing",
    category: "AI_TREND",
    description: "Track whether enterprise procurement timelines are realistic.",
    probabilityMode: "INDEPENDENT",
    status: "ACTIVE",
    hypotheses: [hypothesis],
    createdAt,
    updatedAt: createdAt
  };
}

function resolvedHypothesis(): HypothesisRecord {
  const createdAt = new Date("2026-06-11T07:00:00.000Z");
  return {
    id: "hypothesis_procurement_finish",
    beliefId: "belief_procurement",
    proposition: "Enterprise AI procurement finishes this quarter",
    notes: "procurement completion",
    stance: "SUPPORTS",
    priorProbability: 0.86,
    currentProbability: 0.86,
    strength: 0.86,
    status: "RESOLVED_FALSE",
    resolvedOutcome: "The procurement decision slipped into the next quarter.",
    createdAt,
    updatedAt: createdAt
  };
}

function sourceObservation(): ObservationRecord {
  const observedAt = new Date("2026-06-11T08:00:00.000Z");
  return {
    id: "observation_governance_delay",
    title: "AI governance procurement delays slow enterprise adoption",
    content: "Regulated buyers say legal and procurement review delays slow AI governance platform adoption.",
    observedAt,
    status: "UNKNOWN",
    credibility: 0.78,
    sourceId: "source_governance",
    url: "https://example.com/governance-delay",
    author: "Governance Briefing",
    publishedAt: new Date("2026-06-10T12:00:00.000Z"),
    normalizedHash: undefined,
    semanticKey: undefined,
    duplicateOfId: undefined,
    metadata: { ignoredReason: "UNMATCHED" }
  };
}

describe("LLM hypothesis recommendation generator", () => {
  it("requests structured calibration repair recommendations from the configured LLM", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetcher: typeof fetch = async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response(
        JSON.stringify({
          model: "deepseek-chat",
          choices: [
            {
              message: {
                content: JSON.stringify({
                  recommendations: [
                    {
                      proposition: "Security-owner review delays recur in similar AI procurement cycles",
                      stance: "OPPOSES",
                      priorProbability: 0.42,
                      notes: "可观察：安全负责人追加风险审查、供应商问卷或法务评估。",
                      evidenceSearchQuery: "enterprise AI procurement security owner model risk review delay",
                      rationale: "The settlement miss suggests security-review delay conditions were under-modeled."
                    }
                  ]
                })
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };
    const hypothesis = resolvedHypothesis();
    const generator = createConfiguredLlmHypothesisRecommendationGenerator(
      {
        LLM_API_KEY: "test-key",
        LLM_PROVIDER: "",
        LLM_BASE_URL: "",
        LLM_MODEL: ""
      },
      fetcher
    );

    const recommendations = await generator({
      belief: belief(hypothesis),
      calibration: {
        hypothesis,
        outcome: 0,
        predictedProbability: 0.86,
        error: 0.86,
        resolvedOutcome: hypothesis.resolvedOutcome
      },
      limit: 2
    });

    expect(requests[0].url).toBe("https://api.deepseek.com/chat/completions");
    expect(requests[0].body).toMatchObject({
      model: "deepseek-chat",
      response_format: { type: "json_object" }
    });
    expect(JSON.stringify(requests[0].body)).toContain("Enterprise AI procurement finishes this quarter");
    expect(recommendations).toEqual([
      {
        proposition: "Security-owner review delays recur in similar AI procurement cycles",
        stance: "OPPOSES",
        priorProbability: 0.42,
        notes: "可观察：安全负责人追加风险审查、供应商问卷或法务评估。",
        evidenceSearchQuery: "enterprise AI procurement security owner model risk review delay",
        rationale: "The settlement miss suggests security-review delay conditions were under-modeled."
      }
    ]);
  });

  it("requests structured source-observation recommendations from the configured LLM", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetcher: typeof fetch = async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  recommendations: [
                    {
                      proposition: "Regulated buyers delay AI governance adoption when procurement owners require legal review",
                      stance: "OPPOSES",
                      priorProbability: 0.38,
                      notes: "可观察：采购负责人、法务审查和治理平台上线之间的延迟。",
                      evidenceSearchQuery: "AI governance adoption procurement legal review delay regulated buyers",
                      rationale: "The unmatched observation points to procurement review as a missing counter-hypothesis."
                    }
                  ]
                })
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };
    const hypothesis = resolvedHypothesis();
    const observation = sourceObservation();
    const generator = createConfiguredLlmHypothesisRecommendationGenerator({ LLM_API_KEY: "test-key" }, fetcher);

    const recommendations = await generator({
      belief: belief(hypothesis),
      sourceObservation: observation,
      limit: 2
    });

    expect(requests).toHaveLength(1);
    expect(JSON.stringify(requests[0].body)).toContain("AI governance procurement delays slow enterprise adoption");
    expect(JSON.stringify(requests[0].body)).toContain("Regulated buyers say legal and procurement review delays");
    expect(recommendations).toEqual([
      {
        proposition: "Regulated buyers delay AI governance adoption when procurement owners require legal review",
        stance: "OPPOSES",
        priorProbability: 0.38,
        notes: "可观察：采购负责人、法务审查和治理平台上线之间的延迟。",
        evidenceSearchQuery: "AI governance adoption procurement legal review delay regulated buyers",
        rationale: "The unmatched observation points to procurement review as a missing counter-hypothesis."
      }
    ]);
  });

  it("returns no recommendations when LLM credentials are missing", async () => {
    const generator = createConfiguredLlmHypothesisRecommendationGenerator({ LLM_API_KEY: "" });

    await expect(
      generator({
        belief: belief(resolvedHypothesis()),
        calibration: {
          hypothesis: resolvedHypothesis(),
          outcome: 0,
          predictedProbability: 0.86,
          error: 0.86,
          resolvedOutcome: "The procurement decision slipped into the next quarter."
        },
        limit: 2
      })
    ).resolves.toEqual([]);
  });
});
