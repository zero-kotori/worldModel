import { createInMemoryWorldModelStore } from "@/server/services/in-memory-store";
import { createWorldModelServices } from "@/server/services/world-model-services";

describe("world model services", () => {
  it("creates a belief with normalized mutually exclusive hypotheses", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());

    const belief = await services.beliefs.createBelief({
      title: "AI inference cost keeps falling",
      category: "AI_TREND",
      description: "Track whether inference cost decline remains material.",
      probabilityMode: "MUTUALLY_EXCLUSIVE",
      hypotheses: [
        { proposition: "Costs fall quickly", priorProbability: 2, notes: "" },
        { proposition: "Costs plateau", priorProbability: 3, notes: "" }
      ]
    });

    expect(belief.hypotheses).toHaveLength(2);
    expect(belief.hypotheses.reduce((sum, hypothesis) => sum + hypothesis.currentProbability, 0)).toBeCloseTo(1, 8);
    expect(belief.hypotheses[0].currentProbability).toBeCloseTo(0.4, 8);
  });

  it("rejects invalid belief and hypothesis input", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());

    await expect(
      services.beliefs.createBelief({
        title: "",
        category: "AI_TREND",
        description: "",
        probabilityMode: "INDEPENDENT",
        hypotheses: [{ proposition: "Valid proposition", priorProbability: 0.5, notes: "" }]
      })
    ).rejects.toThrow("Belief title is required");

    await expect(
      services.beliefs.createBelief({
        title: "Invalid probability",
        category: "AI_TREND",
        description: "",
        probabilityMode: "INDEPENDENT",
        hypotheses: [{ proposition: "Invalid", priorProbability: 1.5, notes: "" }]
      })
    ).rejects.toThrow("priorProbability");
  });

  it("ingests observations and marks duplicate candidates without deleting them", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());

    const first = await services.observations.createObservation({
      title: "A new model benchmark",
      content: "Benchmark details",
      url: "https://example.com/benchmark",
      author: "Example",
      credibility: 0.7,
      normalizedHash: "hash-1",
      semanticKey: "model-benchmark"
    });
    const duplicate = await services.observations.createObservation({
      title: "Same benchmark repost",
      content: "Reposted details",
      url: "https://example.com/benchmark",
      credibility: 0.6
    });

    expect(first.status).toBe("PENDING");
    expect(duplicate.status).toBe("DUPLICATE");
    expect(duplicate.duplicateOfId).toBe(first.id);
  });

  it("confirms an observation as evidence linked to multiple hypotheses", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const belief = await services.beliefs.createBelief({
      title: "AI trend",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        { proposition: "Agents accelerate", priorProbability: 0.4, notes: "" },
        { proposition: "Agents stall", priorProbability: 0.3, notes: "" }
      ]
    });
    const observation = await services.observations.createObservation({
      title: "Enterprise adoption signal",
      content: "Several companies adopted agent workflows.",
      credibility: 0.8
    });

    const evidence = await services.evidence.confirmObservation({
      observationId: observation.id,
      confirmationMode: "MANUAL",
      links: [
        {
          hypothesisId: belief.hypotheses[0].id,
          direction: "SUPPORTS",
          relevance: 0.9,
          likelihoodRatio: 2,
          confidence: 0.75,
          rationale: "Adoption supports acceleration."
        },
        {
          hypothesisId: belief.hypotheses[1].id,
          direction: "OPPOSES",
          relevance: 0.7,
          likelihoodRatio: 0.7,
          confidence: 0.6,
          rationale: "Adoption weakens stall scenario."
        }
      ]
    });

    const observations = await services.observations.listObservations();
    expect(evidence.links).toHaveLength(2);
    expect(observations.find((item) => item.id === observation.id)?.status).toBe("CONFIRMED");
  });

  it("generates likelihood runs, applies updates, and rolls them back", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const belief = await services.beliefs.createBelief({
      title: "Career direction",
      category: "CAREER",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [{ proposition: "Focus on AI tooling", priorProbability: 0.45, notes: "" }]
    });
    const observation = await services.observations.createObservation({
      title: "Tooling demand",
      content: "Demand for AI tooling rose.",
      credibility: 0.8
    });
    const evidence = await services.evidence.confirmObservation({
      observationId: observation.id,
      confirmationMode: "MANUAL",
      links: [
        {
          hypothesisId: belief.hypotheses[0].id,
          direction: "SUPPORTS",
          relevance: 0.9,
          likelihoodRatio: 2.5,
          confidence: 0.8,
          rationale: "Demand supports the direction."
        }
      ]
    });
    const likelihoodRun = await services.likelihood.runLikelihood({
      evidenceId: evidence.id,
      hypothesisId: belief.hypotheses[0].id,
      outputs: [
        { estimator: "lightweight", likelihoodRatio: 2, confidence: 0.8, weight: 1, rationale: "feature match" },
        { estimator: "llm", likelihoodRatio: 3, confidence: 0.7, weight: 1, rationale: "semantic support" }
      ]
    });

    const preview = await services.updates.createPreview(evidence.id);
    const event = await services.updates.applyPreview(preview, likelihoodRun.id);
    const updatedBelief = await services.beliefs.getBelief(belief.id);

    expect(event.status).toBe("APPLIED");
    expect(event.evidenceId).toBe(evidence.id);
    expect(updatedBelief?.hypotheses[0].currentProbability).toBeGreaterThan(0.45);

    const rollback = await services.updates.rollback(event.id);
    const restoredBelief = await services.beliefs.getBelief(belief.id);

    expect(rollback.status).toBe("ROLLED_BACK");
    expect(restoredBelief?.hypotheses[0].currentProbability).toBeCloseTo(0.45, 8);
  });

  it("records source dry runs and model artifact imports", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const source = await services.sources.createSource({
      name: "Hacker News RSS",
      kind: "RSS",
      url: "https://news.ycombinator.com/rss",
      adapter: "rss",
      credentialRef: "HN_PUBLIC",
      credibility: 0.6,
      enabled: true,
      autoConfirm: false,
      autoConfirmThreshold: 0.9
    });
    const run = await services.sources.runDryRun(source.id, [
      { title: "AI launch", content: "Launch details", url: "https://example.com/launch" },
      { title: "AI launch copy", content: "Launch details", url: "https://example.com/launch" }
    ]);
    const artifact = await services.models.importArtifact({
      name: "lightweight-demo",
      kind: "LIGHTWEIGHT",
      version: "0.1.0",
      path: "./model-artifacts/lightweight-demo.json",
      metrics: { calibration: null },
      enabled: true
    });

    expect(run.status).toBe("DRY_RUN");
    expect(run.itemCount).toBe(2);
    expect(run.deduplicatedCount).toBe(1);
    expect(artifact.enabled).toBe(true);
  });
});
