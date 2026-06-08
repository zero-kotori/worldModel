import { createInMemoryWorldModelStore } from "@/server/services/in-memory-store";
import { createConfiguredWorldModelServices } from "@/server/services/configured";

describe("configured world model services", () => {
  it("uses the configured LLM estimator in the automated evidence loop", async () => {
    const services = createConfiguredWorldModelServices(createInMemoryWorldModelStore(), {
      env: {
        LLM_PROVIDER: "deepseek",
        LLM_BASE_URL: "https://llm.example",
        LLM_API_KEY: "test-key",
        LLM_MODEL: "test-model"
      },
      async llmFetch() {
        return new Response(
          JSON.stringify({
            model: "test-model",
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    direction: "OPPOSES",
                    relevance: 0.9,
                    likelihoodRatio: 0.5,
                    confidence: 0.8,
                    rationale: "LLM configured estimator result"
                  })
                }
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      },
      sourceAdapterDependencies: {
        async fetchText(url) {
          const query = new URL(url).searchParams.get("q") ?? "";
          return `<html><head><title>${query}</title></head><body>${query}</body></html>`;
        }
      }
    });

    const belief = await services.beliefs.createBelief({
      title: "LLM configured automation",
      category: "AI_TREND",
      description: "Checks configured estimator wiring.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "LLM configured automation should use model output",
          priorProbability: 0.5,
          notes: "model output"
        }
      ]
    });
    const source = await services.sources.createSource({
      name: "Configured search source",
      kind: "SEARCH",
      url: "https://example.test/search?q={query}",
      adapter: "search",
      credibility: 0.8,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.2
    });

    await services.automation.runEvidenceLoop({ beliefIds: [belief.id], sourceIds: [source.id], autoConfirmThreshold: 0.2 });
    const [evidence] = await services.evidence.listEvidence();
    const updated = await services.beliefs.getBelief(belief.id);

    expect(evidence.links[0]).toMatchObject({
      direction: "OPPOSES",
      likelihoodRatio: 0.5,
      confidence: 0.8,
      rationale: "LLM configured estimator result"
    });
    expect(updated?.hypotheses[0].currentProbability).toBeLessThan(0.5);
  });
});
