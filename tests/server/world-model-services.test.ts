import { createInMemoryWorldModelStore } from "@/server/services/in-memory-store";
import { createWorldModelServices } from "@/server/services/world-model-services";
import { createWorldModelGraph } from "@/lib/world-model-graph";

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

  it("rejects a pending observation without creating evidence", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const observation = await services.observations.createObservation({
      title: "Unrelated market note",
      content: "A note that should not affect any current hypothesis.",
      credibility: 0.4
    });

    const rejected = await services.observations.rejectObservation(observation.id);
    const observations = await services.observations.listObservations();
    const evidence = await services.evidence.listEvidence();

    expect(rejected.status).toBe("REJECTED");
    expect(observations[0].status).toBe("REJECTED");
    expect(evidence).toHaveLength(0);
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

  it("adds a hypothesis to an existing belief with an explicit stance", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const belief = await services.beliefs.createBelief({
      title: "AI workflow adoption",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [{ proposition: "Agents become routine in engineering teams", priorProbability: 0.35, notes: "" }]
    });

    const hypothesis = await services.beliefs.createHypothesis(belief.id, {
      proposition: "Teams reject agents because review overhead stays high",
      priorProbability: 0.25,
      stance: "OPPOSES",
      notes: "Counter-hypothesis for adoption."
    });
    const updatedBelief = await services.beliefs.getBelief(belief.id);

    expect(hypothesis.stance).toBe("OPPOSES");
    expect(updatedBelief?.hypotheses).toHaveLength(2);
    expect(updatedBelief?.hypotheses[1].currentProbability).toBeCloseTo(0.25, 8);
  });

  it("edits beliefs and moves hypotheses between belief groups", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const sourceBelief = await services.beliefs.createBelief({
      title: "Source group",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [{ proposition: "Hypothesis belongs elsewhere", priorProbability: 0.4, notes: "" }]
    });
    const targetBelief = await services.beliefs.createBelief({
      title: "Target group",
      category: "TECH_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [{ proposition: "Existing target hypothesis", priorProbability: 0.3, notes: "" }]
    });

    await services.beliefs.updateBelief(targetBelief.id, {
      title: "Updated target group",
      description: "Edited from the graph workspace."
    });
    const moved = await services.beliefs.updateHypothesis(sourceBelief.hypotheses[0].id, {
      beliefId: targetBelief.id,
      proposition: "Moved hypothesis",
      notes: "Moved from the graph workspace.",
      stance: "OPPOSES",
      currentProbability: 0.2
    });
    const oldGroup = await services.beliefs.getBelief(sourceBelief.id);
    const newGroup = await services.beliefs.getBelief(targetBelief.id);

    expect(moved.beliefId).toBe(targetBelief.id);
    expect(moved.proposition).toBe("Moved hypothesis");
    expect(moved.stance).toBe("OPPOSES");
    expect(oldGroup?.hypotheses).toHaveLength(0);
    expect(newGroup?.title).toBe("Updated target group");
    expect(newGroup?.hypotheses.map((hypothesis) => hypothesis.id)).toEqual(
      expect.arrayContaining([targetBelief.hypotheses[0].id, sourceBelief.hypotheses[0].id])
    );
  });

  it("confirms evidence and applies the linked hypothesis update in one service call", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const belief = await services.beliefs.createBelief({
      title: "Evidence automation",
      category: "TECH_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "Observation evidence can update hypotheses automatically",
          priorProbability: 0.4,
          stance: "SUPPORTS",
          notes: ""
        }
      ]
    });
    const observation = await services.observations.createObservation({
      title: "Automation signal",
      content: "Observation evidence can update hypotheses automatically in the local service.",
      credibility: 0.8
    });

    const result = await services.evidence.confirmAndApplyObservation({
      observationId: observation.id,
      confirmationMode: "MANUAL",
      links: [
        {
          hypothesisId: belief.hypotheses[0].id,
          direction: "SUPPORTS",
          relevance: 0.9,
          likelihoodRatio: 2,
          confidence: 0.75,
          rationale: "The observation directly supports the hypothesis."
        }
      ]
    });
    const updatedBelief = await services.beliefs.getBelief(belief.id);

    expect(result.evidence.links).toHaveLength(1);
    expect(result.event.evidenceId).toBe(result.evidence.id);
    expect(updatedBelief?.hypotheses[0].currentProbability).toBeGreaterThan(0.4);
  });

  it("runs a source, stores fetched observations, and auto-applies high-confidence recommendations", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: async () =>
          "<html><head><title>AI agents accelerate engineering teams</title></head><body>AI agents accelerate engineering teams by handling routine implementation work.</body></html>"
      }
    });
    const belief = await services.beliefs.createBelief({
      title: "AI agents",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "AI agents accelerate engineering teams",
          priorProbability: 0.35,
          stance: "SUPPORTS",
          notes: ""
        }
      ]
    });
    const source = await services.sources.createSource({
      name: "Agent signal page",
      kind: "WEB_PAGE",
      url: "https://example.com/agent-signal",
      adapter: "web_page",
      credentialRef: undefined,
      credibility: 0.8,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.2
    });

    const run = await services.sources.runSource(source.id);
    const observations = await services.observations.listObservations();
    const evidence = await services.evidence.listEvidence();
    const updates = await services.updates.listEvents();
    const runs = await services.sources.listRuns();
    const updatedBelief = await services.beliefs.getBelief(belief.id);

    expect(run.status).toBe("SUCCESS");
    expect(run.itemCount).toBe(1);
    expect(run.candidateCount).toBe(1);
    expect(run.autoAppliedCount).toBe(1);
    expect(run.reviewCount).toBe(0);
    expect(observations).toHaveLength(1);
    expect(evidence).toHaveLength(1);
    expect(updates).toHaveLength(1);
    expect(runs).toEqual([run]);
    expect(updatedBelief?.hypotheses[0].currentProbability).toBeGreaterThan(0.35);
  });

  it("runs a source in review-only mode without changing probabilities", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: async () =>
          "<html><head><title>AI agents accelerate engineering teams</title></head><body>AI agents accelerate engineering teams by handling routine implementation work.</body></html>"
      }
    });
    const belief = await services.beliefs.createBelief({
      title: "AI agents",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "AI agents accelerate engineering teams",
          priorProbability: 0.35,
          stance: "SUPPORTS",
          notes: ""
        }
      ]
    });
    const source = await services.sources.createSource({
      name: "Agent review-only page",
      kind: "WEB_PAGE",
      url: "https://example.com/agent-review-only",
      adapter: "web_page",
      credentialRef: undefined,
      credibility: 0.8,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.2
    });

    const run = await services.sources.runSource(source.id, { reviewOnly: true });
    const evidence = await services.evidence.listEvidence();
    const updates = await services.updates.listEvents();
    const updatedBelief = await services.beliefs.getBelief(belief.id);

    expect(run.status).toBe("REVIEW_ONLY");
    expect(run.itemCount).toBe(1);
    expect(run.candidateCount).toBe(1);
    expect(run.autoAppliedCount).toBe(0);
    expect(run.reviewCount).toBe(1);
    expect(evidence).toHaveLength(0);
    expect(updates).toHaveLength(0);
    expect(updatedBelief?.hypotheses[0].currentProbability).toBe(0.35);
  });

  it("runs an evidence loop with generated belief and hypothesis search queries", async () => {
    const requestedUrls: string[] = [];
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: async (url) => {
          requestedUrls.push(url);
          return "<html><head><title>AI agents accelerate engineering teams</title></head><body>AI agents accelerate engineering teams by handling routine implementation work.</body></html>";
        }
      }
    });
    const belief = await services.beliefs.createBelief({
      title: "AI agents",
      category: "AI_TREND",
      description: "Track agent adoption.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "AI agents accelerate engineering teams",
          priorProbability: 0.35,
          stance: "SUPPORTS",
          notes: "enterprise rollout"
        }
      ]
    });
    await services.sources.createSource({
      name: "Search adapter",
      kind: "SEARCH",
      url: "https://example.com/search?q={query}",
      adapter: "search",
      credentialRef: undefined,
      credibility: 0.8,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.2
    });

    const loop = await services.automation.runEvidenceLoop({
      reviewOnly: true,
      maxObservations: 1,
      autoConfirmThreshold: 0.2
    });
    const observations = await services.observations.listObservations();
    const evidence = await services.evidence.listEvidence();
    const updatedBelief = await services.beliefs.getBelief(belief.id);

    expect(loop.queryCount).toBe(1);
    expect(loop.sourceRunCount).toBe(1);
    expect(loop.candidateCount).toBe(1);
    expect(loop.reviewCount).toBe(1);
    expect(loop.autoAppliedCount).toBe(0);
    expect(loop.runs[0]).toMatchObject({ queryCount: 1, reviewCount: 1 });
    expect(requestedUrls[0]).toContain("AI%20agents");
    expect(requestedUrls[0]).toContain("engineering%20teams");
    expect(observations[0].metadata).toMatchObject({ query: expect.stringContaining("AI agents") });
    expect(evidence).toHaveLength(0);
    expect(updatedBelief?.hypotheses[0].currentProbability).toBe(0.35);
  });

  it("moves unmatched source observations into the unknown evidence queue", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: async () =>
          "<html><head><title>Semiconductor supply chain disruption</title></head><body>A shipping delay affected mature-node semiconductor supply chains.</body></html>"
      }
    });
    await services.beliefs.createBelief({
      title: "AI agents",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "AI agents accelerate engineering teams",
          priorProbability: 0.35,
          stance: "SUPPORTS",
          notes: ""
        }
      ]
    });
    const source = await services.sources.createSource({
      name: "Unmatched source",
      kind: "WEB_PAGE",
      url: "https://example.com/unmatched",
      adapter: "web_page",
      credentialRef: undefined,
      credibility: 0.7,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.4
    });

    const run = await services.sources.runSource(source.id);
    const observations = await services.observations.listObservations();
    const evidence = await services.evidence.listEvidence();

    expect(run.status).toBe("SUCCESS");
    expect(run.candidateCount).toBe(0);
    expect(run.autoAppliedCount).toBe(0);
    expect(run.reviewCount).toBe(1);
    expect(observations[0].status).toBe("UNKNOWN");
    expect(evidence).toHaveLength(0);
  });

  it("uses the LLM scorer as the primary likelihood source for auto-confirmed evidence", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: async () =>
          "<html><head><title>Enterprise agent rollout</title></head><body>Enterprise agent rollout accelerated engineering teams.</body></html>"
      },
      likelihoodEstimator: {
        name: "llm",
        estimate: async () => ({
          estimator: "llm",
          likelihoodRatio: 3.2,
          confidence: 0.82,
          weight: 3,
          rationale: "LLM primary score: the rollout directly supports acceleration.",
          modelVersion: "deepseek:deepseek-chat",
          abstain: false
        })
      }
    });
    const belief = await services.beliefs.createBelief({
      title: "AI agent adoption",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "Enterprise agent rollout accelerates engineering teams",
          priorProbability: 0.35,
          stance: "SUPPORTS",
          notes: ""
        }
      ]
    });
    const source = await services.sources.createSource({
      name: "Agent rollout page",
      kind: "WEB_PAGE",
      url: "https://example.com/agent-rollout",
      adapter: "web_page",
      credentialRef: undefined,
      credibility: 0.8,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.2
    });

    const run = await services.sources.runSource(source.id);
    const evidence = await services.evidence.listEvidence();
    const updatedBelief = await services.beliefs.getBelief(belief.id);

    expect(run.status).toBe("SUCCESS");
    expect(evidence[0].links[0]).toMatchObject({
      hypothesisId: belief.hypotheses[0].id,
      likelihoodRatio: 3.2,
      confidence: 0.82,
      rationale: "LLM primary score: the rollout directly supports acceleration."
    });
    expect(updatedBelief?.hypotheses[0].currentProbability).toBeGreaterThan(0.35);
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
    await expect(services.updates.listEvents()).resolves.toHaveLength(1);
    expect(updatedBelief?.hypotheses[0].currentProbability).toBeGreaterThan(0.45);

    const rollback = await services.updates.rollback(event.id);
    const restoredBelief = await services.beliefs.getBelief(belief.id);

    expect(rollback.status).toBe("ROLLED_BACK");
    expect(restoredBelief?.hypotheses[0].currentProbability).toBeCloseTo(0.45, 8);

    await expect(services.updates.rollback(event.id)).rejects.toThrow("already rolled back");
  });

  it("edits applied evidence by rolling back the old update and reapplying with per-hypothesis links", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const belief = await services.beliefs.createBelief({
      title: "Agent adoption",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        { proposition: "Agents accelerate enterprise workflows", priorProbability: 0.4, notes: "" },
        { proposition: "Agents remain niche", priorProbability: 0.4, notes: "" }
      ]
    });
    const observation = await services.observations.createObservation({
      title: "Large enterprise rollout",
      content: "A large enterprise rolled out agents to several teams.",
      credibility: 0.8
    });
    const result = await services.evidence.confirmAndApplyObservation({
      observationId: observation.id,
      confirmationMode: "MANUAL",
      links: [
        {
          hypothesisId: belief.hypotheses[0].id,
          direction: "SUPPORTS",
          relevance: 0.8,
          likelihoodRatio: 2,
          confidence: 0.7,
          rationale: "Rollout supports acceleration."
        }
      ]
    });

    const edited = await services.evidence.updateAndReapply(result.evidence.id, {
      title: "Large enterprise rollout updated",
      credibility: 0.9,
      links: [
        {
          hypothesisId: belief.hypotheses[0].id,
          direction: "SUPPORTS",
          relevance: 0.95,
          likelihoodRatio: 3,
          confidence: 0.85,
          rationale: "The rollout was broader than initially recorded."
        },
        {
          hypothesisId: belief.hypotheses[1].id,
          direction: "OPPOSES",
          relevance: 0.6,
          likelihoodRatio: 0.5,
          confidence: 0.65,
          rationale: "Broad rollout weakens the niche scenario."
        }
      ]
    });
    const events = await services.updates.listEvents();
    const updatedBelief = await services.beliefs.getBelief(belief.id);

    expect(edited.evidence.title).toBe("Large enterprise rollout updated");
    expect(edited.evidence.links).toHaveLength(2);
    expect(edited.event.evidenceId).toBe(result.evidence.id);
    expect(events.filter((event) => event.status === "ROLLED_BACK")).toHaveLength(1);
    expect(events.filter((event) => event.status === "APPLIED")).toHaveLength(1);
    expect(updatedBelief?.hypotheses[0].currentProbability).toBeGreaterThan(0.4);
    expect(updatedBelief?.hypotheses[1].currentProbability).toBeLessThan(0.4);
  });

  it("connects evidence to another hypothesis and reapplies the update from the graph workspace", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const belief = await services.beliefs.createBelief({
      title: "Graph connections",
      category: "TECH_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        { proposition: "The first hypothesis is supported", priorProbability: 0.4, notes: "" },
        { proposition: "The second hypothesis is weakened", priorProbability: 0.4, notes: "" }
      ]
    });
    const observation = await services.observations.createObservation({
      title: "Connection evidence",
      content: "This evidence supports the first hypothesis and weakens the second.",
      credibility: 0.8
    });
    const result = await services.evidence.confirmAndApplyObservation({
      observationId: observation.id,
      confirmationMode: "MANUAL",
      links: [
        {
          hypothesisId: belief.hypotheses[0].id,
          direction: "SUPPORTS",
          relevance: 0.8,
          likelihoodRatio: 2,
          confidence: 0.7,
          rationale: "Initial graph link."
        }
      ]
    });

    const connected = await services.evidence.connectHypothesis(result.evidence.id, {
      hypothesisId: belief.hypotheses[1].id,
      direction: "OPPOSES",
      relevance: 0.75,
      likelihoodRatio: 0.5,
      confidence: 0.8,
      rationale: "Connected from the graph workspace."
    });
    const events = await services.updates.listEvents();
    const updatedBelief = await services.beliefs.getBelief(belief.id);

    expect(connected.evidence.links).toHaveLength(2);
    expect(connected.evidence.links.find((link) => link.hypothesisId === belief.hypotheses[1].id)).toMatchObject({
      direction: "OPPOSES",
      likelihoodRatio: 0.5,
      rationale: "Connected from the graph workspace."
    });
    expect(events.filter((event) => event.status === "ROLLED_BACK")).toHaveLength(1);
    expect(events.filter((event) => event.status === "APPLIED")).toHaveLength(1);
    expect(updatedBelief?.hypotheses[1].currentProbability).toBeLessThan(0.4);
  });

  it("rejects applied evidence by rolling back its update before excluding it", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const belief = await services.beliefs.createBelief({
      title: "Tooling demand",
      category: "CAREER",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [{ proposition: "AI tooling demand rises", priorProbability: 0.45, notes: "" }]
    });
    const observation = await services.observations.createObservation({
      title: "Demand signal",
      content: "Demand for AI tooling rises.",
      credibility: 0.8
    });
    const result = await services.evidence.confirmAndApplyObservation({
      observationId: observation.id,
      confirmationMode: "MANUAL",
      links: [
        {
          hypothesisId: belief.hypotheses[0].id,
          direction: "SUPPORTS",
          relevance: 0.9,
          likelihoodRatio: 2,
          confidence: 0.8,
          rationale: "Demand signal supports the hypothesis."
        }
      ]
    });

    const rejected = await services.evidence.reject(result.evidence.id);
    const restoredBelief = await services.beliefs.getBelief(belief.id);
    const events = await services.updates.listEvents();

    expect(rejected.status).toBe("REJECTED");
    expect(events[0].status).toBe("ROLLED_BACK");
    expect(restoredBelief?.hypotheses[0].currentProbability).toBeCloseTo(0.45, 8);
  });

  it("creates a graph model for beliefs, hypotheses, evidence, and update events", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const belief = await services.beliefs.createBelief({
      title: "Graph belief",
      category: "TECH_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [{ proposition: "Graph view clarifies relationships", priorProbability: 0.5, notes: "" }]
    });
    const observation = await services.observations.createObservation({
      title: "Graph evidence",
      content: "A graph view shows belief relationships clearly.",
      credibility: 0.7
    });
    const result = await services.evidence.confirmAndApplyObservation({
      observationId: observation.id,
      confirmationMode: "MANUAL",
      links: [
        {
          hypothesisId: belief.hypotheses[0].id,
          direction: "SUPPORTS",
          relevance: 0.8,
          likelihoodRatio: 2,
          confidence: 0.7,
          rationale: "Graph evidence supports the relationship view."
        }
      ]
    });
    const data = {
      beliefs: await services.beliefs.listBeliefs(),
      evidence: await services.evidence.listEvidence(),
      updates: await services.updates.listEvents()
    };

    const graph = createWorldModelGraph(data);

    expect(graph.nodes.map((node) => node.type)).toEqual(expect.arrayContaining(["belief", "hypothesis", "evidence", "update"]));
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: belief.id, target: belief.hypotheses[0].id, relation: "OWNS" }),
        expect.objectContaining({ source: result.evidence.id, target: belief.hypotheses[0].id, relation: "INFLUENCES" }),
        expect.objectContaining({ source: result.evidence.id, target: result.event.id, relation: "PRODUCED" }),
        expect.objectContaining({ source: result.event.id, target: belief.id, relation: "UPDATED" })
      ])
    );
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
    await expect(services.sources.listSources()).resolves.toHaveLength(1);
    await expect(services.models.listArtifacts()).resolves.toHaveLength(1);
  });
});
