import { createInMemoryWorldModelStore } from "@/server/services/in-memory-store";
import { createWorldModelServices } from "@/server/services/world-model-services";
import { createWorldModelGraph } from "@/lib/world-model-graph";
import { sourcePresetDefinitions } from "@/lib/world-model-source-presets";
import type { ConfirmEvidenceInput, LikelihoodRunRecord, ObservationRecord } from "@/server/services/types";

async function fetchSourcePresetFixtureText(url: string) {
  if (url.includes("api.github.com/search/repositories")) {
    return JSON.stringify({
      items: [
        {
          full_name: "example/platform-signal",
          description: "Unrelated repository maintenance signal",
          html_url: "https://github.com/example/platform-signal",
          updated_at: "2026-06-10T12:00:00Z",
          stargazers_count: 10,
          owner: { login: "example" }
        }
      ]
    });
  }

  if (url.includes("huggingface.co/api/models")) {
    return JSON.stringify([
      {
        id: "example/platform-signal-model",
        modelId: "example/platform-signal-model",
        pipeline_tag: "text-classification",
        tags: ["platform-signal"],
        downloads: 10,
        likes: 1,
        lastModified: "2026-06-10T12:00:00Z"
      }
    ]);
  }

  if (url.includes("api.gdeltproject.org")) {
    return JSON.stringify({
      articles: [
        {
          title: "Unrelated platform signal",
          url: "https://news.example/platform-signal",
          domain: "news.example",
          sourceCountry: "US",
          seendate: "20260610T120000Z"
        }
      ]
    });
  }

  if (url.includes("gamma-api.polymarket.com/events")) {
    return JSON.stringify({
      events: [
        {
          id: "event_fixture",
          title: "Unrelated prediction event",
          slug: "unrelated-prediction-event",
          volume: 1000,
          liquidity: 100,
          markets: [
            {
              id: "market_fixture",
              question: "Will an unrelated platform metric improve?",
              outcomes: ["Yes", "No"],
              outcomePrices: ["0.5", "0.5"]
            }
          ]
        }
      ]
    });
  }

  if (url.includes("gamma-api.polymarket.com")) {
    return JSON.stringify({
      markets: [
        {
          question: "Will an unrelated platform metric improve?",
          description: "Prediction market fixture not tied to the test hypothesis.",
          slug: "unrelated-platform-metric",
          endDate: "2026-12-31T00:00:00Z",
          volume: 1000,
          liquidity: 100
        }
      ]
    });
  }

  if (url.includes("reddit.com/search")) {
    return [
      "<html><head><title>Reddit public search fixture</title></head>",
      "<body>Unrelated social discussion about hobby communities and moderation changes.</body></html>"
    ].join("");
  }

  return [
    "<rss><channel>",
    "<item>",
    "<title>AI agents accelerate engineering teams</title>",
    "<description>AI agents accelerate engineering teams in repeated production workflows.</description>",
    "<link>https://example.com/agent-evidence</link>",
    "</item>",
    "</channel></rss>"
  ].join("");
}

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

  it("marks observations with tracking-only URL variants as duplicates", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());

    const first = await services.observations.createObservation({
      title: "A new model benchmark",
      content: "Benchmark details",
      url: "https://example.com/benchmark",
      author: "Example",
      credibility: 0.7
    });
    const duplicate = await services.observations.createObservation({
      title: "Same benchmark from newsletter",
      content: "Reposted details",
      url: "https://EXAMPLE.com/benchmark/?utm_source=newsletter&utm_medium=email#comments",
      credibility: 0.6
    });

    expect(duplicate.status).toBe("DUPLICATE");
    expect(duplicate.duplicateOfId).toBe(first.id);
  });

  it("updates an editable observation without changing its review status", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const observation = await services.observations.createObservation({
      title: "Raw source note",
      content: "Original text",
      url: "https://example.com/original",
      author: "Original feed",
      credibility: 0.4,
      normalizedHash: "raw-hash",
      semanticKey: "raw-key"
    });

    const updated = await (services.observations as {
      updateObservation(id: string, input: {
        title: string;
        content: string;
        url?: string;
        author?: string;
        credibility: number;
        normalizedHash?: string;
        semanticKey?: string;
      }): Promise<ObservationRecord>;
    }).updateObservation(observation.id, {
      title: "Reviewed source note",
      content: "Cleaned text",
      url: "https://example.com/reviewed",
      author: "Reviewed feed",
      credibility: 0.75,
      normalizedHash: "reviewed-hash",
      semanticKey: "reviewed-key"
    });

    expect(updated).toMatchObject({
      id: observation.id,
      title: "Reviewed source note",
      content: "Cleaned text",
      url: "https://example.com/reviewed",
      author: "Reviewed feed",
      credibility: 0.75,
      normalizedHash: "reviewed-hash",
      semanticKey: "reviewed-key",
      status: "PENDING"
    });
  });

  it("updates an observation source assignment without changing its review status", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const source = await services.sources.createSource({
      name: "News source",
      kind: "WEB_PAGE",
      adapter: "web_page",
      credibility: 0.7,
      enabled: true,
      autoConfirm: false,
      autoConfirmThreshold: 0.8
    });
    const observation = await services.observations.createObservation({
      title: "Unassigned observation",
      content: "Observation that should be assigned to a source.",
      credibility: 0.6
    });

    const updated = await services.observations.updateObservation(observation.id, {
      sourceId: source.id
    });

    expect(updated).toMatchObject({
      id: observation.id,
      sourceId: source.id,
      title: "Unassigned observation",
      status: "PENDING"
    });
  });

  it("refreshes recommended hypothesis links when editable observation text changes", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const belief = await services.beliefs.createBelief({
      title: "GPU supply outlook",
      category: "AI_TREND",
      description: "Track whether GPU supply is constrained or expanding.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "GPU export restrictions tighten",
          priorProbability: 0.4,
          notes: "export restrictions licensing China controls"
        },
        {
          proposition: "GPU supply expands through foundry capacity",
          priorProbability: 0.4,
          notes: "supply capacity foundry wafers shipments"
        }
      ]
    });
    const staleLink: ConfirmEvidenceInput["links"][number] = {
      hypothesisId: belief.hypotheses[0].id,
      direction: "SUPPORTS",
      relevance: 0.8,
      likelihoodRatio: 1.8,
      confidence: 0.7,
      rationale: "Initial source matched export restrictions."
    };
    const observation = await services.observations.createObservation({
      title: "GPU export restrictions tighten",
      content: "GPU export restrictions licensing controls tighten.",
      credibility: 0.6,
      metadata: {
        recommendedLinks: [staleLink],
        reviewReason: "SOURCE_REQUIRES_REVIEW"
      }
    });

    const updated = await services.observations.updateObservation(observation.id, {
      title: "Foundry capacity expands GPU supply",
      content: "GPU supply capacity foundry wafers shipments expand.",
      credibility: 0.7
    });

    expect(updated.metadata.recommendedLinks).toEqual([
      expect.objectContaining({
        hypothesisId: belief.hypotheses[1].id,
        direction: "SUPPORTS"
      })
    ]);
    expect(JSON.stringify(updated.metadata.recommendedLinks)).not.toContain(belief.hypotheses[0].id);
  });

  it("moves edited observations without matching hypotheses out of the pending review queue", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const belief = await services.beliefs.createBelief({
      title: "AI governance adoption",
      category: "AI_TREND",
      description: "Track whether governance tools become standard.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "Governance procurement cycles accelerate",
          priorProbability: 0.4,
          notes: "governance procurement adoption"
        }
      ]
    });
    const observation = await services.observations.createObservation({
      title: "Governance procurement accelerates",
      content: "Governance procurement adoption accelerates across enterprise buyers.",
      credibility: 0.6,
      metadata: {
        recommendedLinks: [
          {
            hypothesisId: belief.hypotheses[0].id,
            direction: "SUPPORTS",
            relevance: 0.8,
            likelihoodRatio: 1.8,
            confidence: 0.7,
            rationale: "Initial source matched governance procurement."
          }
        ],
        reviewReason: "SOURCE_REQUIRES_REVIEW"
      }
    });

    const updated = await services.observations.updateObservation(observation.id, {
      title: "Maritime insurance weather note",
      content: "Harbor wind conditions changed overnight near the shipping lane."
    });

    expect(updated.status).toBe("UNKNOWN");
    expect(updated.metadata).toMatchObject({
      ignoredReason: "UNMATCHED"
    });
    expect(updated.metadata.recommendedLinks).toBeUndefined();
    expect(updated.metadata.reviewReason).toBeUndefined();
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

  it("does not confirm rejected observations as evidence", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const belief = await services.beliefs.createBelief({
      title: "Rejected observation safety",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [{ proposition: "Rejected observations stay excluded", priorProbability: 0.4, notes: "" }]
    });
    const observation = await services.observations.createObservation({
      title: "Rejected observation",
      content: "This observation was rejected.",
      credibility: 0.5
    });
    await services.observations.rejectObservation(observation.id);

    await expect(
      services.evidence.confirmObservation({
        observationId: observation.id,
        confirmationMode: "MANUAL",
        links: [
          {
            hypothesisId: belief.hypotheses[0].id,
            direction: "SUPPORTS",
            relevance: 0.8,
            likelihoodRatio: 2,
            confidence: 0.7,
            rationale: "Rejected observations must not be revived as evidence."
          }
        ]
      })
    ).rejects.toThrow("Rejected observations cannot be confirmed as evidence");
    await expect(services.evidence.listEvidence()).resolves.toHaveLength(0);
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

  it("recommends measurable support and counter hypotheses for a belief", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const belief = await services.beliefs.createBelief({
      title: "AI agents improve software delivery",
      category: "AI_TREND",
      description: "Track whether agentic coding systems materially change engineering throughput and review quality.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "AI agents improve software delivery through faster implementation cycles",
          priorProbability: 0.45,
          stance: "SUPPORTS",
          notes: ""
        }
      ]
    });

    const recommendations = await services.beliefs.recommendHypotheses(belief.id, { limit: 4 });

    expect(recommendations).toHaveLength(4);
    expect(recommendations.map((item) => item.proposition)).not.toContain(belief.hypotheses[0].proposition);
    expect(recommendations.map((item) => item.stance)).toEqual(expect.arrayContaining(["SUPPORTS", "OPPOSES"]));
    expect(recommendations[0]).toMatchObject({
      priorProbability: expect.any(Number),
      notes: expect.stringContaining("可观察"),
      evidenceSearchQuery: expect.stringContaining("AI agents improve software delivery")
    });
    expect(recommendations.every((item) => item.priorProbability > 0 && item.priorProbability < 1)).toBe(true);
  });

  it("recommends calibration repair hypotheses after high-error settlements", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const belief = await services.beliefs.createBelief({
      title: "AI procurement timing",
      category: "AI_TREND",
      description: "Track whether enterprise procurement timelines are realistic.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "Enterprise AI procurement finishes this quarter",
          priorProbability: 0.86,
          stance: "SUPPORTS",
          notes: "procurement completion"
        },
        {
          proposition: "Security review remains a major delay source",
          priorProbability: 0.45,
          stance: "OPPOSES",
          notes: "security review"
        }
      ]
    });
    await services.beliefs.updateHypothesis(belief.hypotheses[0].id, {
      status: "RESOLVED_FALSE",
      currentProbability: 0.86,
      resolvedOutcome: "The procurement decision slipped into the next quarter."
    });

    const recommendations = await services.beliefs.recommendHypotheses(belief.id, { limit: 4 });

    expect(recommendations[0]).toMatchObject({
      stance: "OPPOSES",
      priorProbability: 0.35,
      calibrationHypothesisId: belief.hypotheses[0].id,
      calibrationError: 0.86,
      proposition: "导致「Enterprise AI procurement finishes this quarter」被证伪的条件仍可能复现",
      notes: expect.stringContaining("The procurement decision slipped into the next quarter."),
      evidenceSearchQuery: expect.stringContaining("Enterprise AI procurement finishes this quarter"),
      rationale: expect.stringContaining("校准偏差")
    });
  });

  it("prefers injected LLM calibration repair recommendations while preserving calibration metadata", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      hypothesisRecommendationGenerator: async ({ calibration }) => {
        if (!calibration) return [];
        return [
          {
            proposition: "Procurement slips when security owners require additional model risk review",
            stance: "OPPOSES",
            priorProbability: 0.42,
            notes: "可观察：跟踪安全负责人是否追加模型风险审查、供应商问卷或法务评估。",
            evidenceSearchQuery: "enterprise AI procurement security owner model risk review delay",
            rationale: `LLM 校准复盘：${calibration.hypothesis.proposition} 的失败更像安全审查触发条件被低估。`
          }
        ];
      }
    });
    const belief = await services.beliefs.createBelief({
      title: "AI procurement timing",
      category: "AI_TREND",
      description: "Track whether enterprise procurement timelines are realistic.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "Enterprise AI procurement finishes this quarter",
          priorProbability: 0.86,
          stance: "SUPPORTS",
          notes: "procurement completion"
        }
      ]
    });
    await services.beliefs.updateHypothesis(belief.hypotheses[0].id, {
      status: "RESOLVED_FALSE",
      currentProbability: 0.86,
      resolvedOutcome: "The procurement decision slipped into the next quarter."
    });

    const recommendations = await services.beliefs.recommendHypotheses(belief.id, { limit: 4 });

    expect(recommendations[0]).toMatchObject({
      proposition: "Procurement slips when security owners require additional model risk review",
      stance: "OPPOSES",
      priorProbability: 0.42,
      calibrationHypothesisId: belief.hypotheses[0].id,
      calibrationError: 0.86,
      rationale: expect.stringContaining("LLM 校准复盘")
    });
    expect(recommendations[0].proposition).not.toContain("导致「Enterprise AI procurement finishes this quarter」");
  });

  it("recommends hypotheses from unmatched observations related to a belief", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: async () =>
          "<html><head><title>AI governance procurement delays slow enterprise adoption</title></head><body>AI governance procurement delays slow enterprise adoption across regulated buyers.</body></html>"
      }
    });
    const belief = await services.beliefs.createBelief({
      title: "AI governance adoption",
      category: "AI_TREND",
      description: "Track whether governance platforms become a default enterprise workflow.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "Audit quality improves after governance rollout",
          priorProbability: 0.45,
          stance: "SUPPORTS",
          notes: ""
        }
      ]
    });
    const source = await services.sources.createSource({
      name: "Governance unmatched source",
      kind: "WEB_PAGE",
      url: "https://example.com/governance-procurement",
      adapter: "web_page",
      credibility: 0.8,
      enabled: true,
      autoConfirm: false,
      autoConfirmThreshold: 0.85
    });
    const run = await services.sources.runSource(source.id, { candidateThreshold: 0.9 });

    const recommendations = await services.beliefs.recommendHypotheses(belief.id, { limit: 3 });

    expect(run.unmatchedCount).toBe(1);
    expect(recommendations[0]).toMatchObject({
      stance: "OPPOSES",
      priorProbability: expect.any(Number),
      proposition: expect.stringContaining("AI governance procurement delays slow enterprise adoption"),
      notes: expect.stringContaining("来源观察"),
      evidenceSearchQuery: expect.stringContaining("AI governance procurement delays slow enterprise adoption"),
      rationale: expect.stringContaining("未匹配观察"),
      sourceObservationId: expect.any(String)
    });
    expect(recommendations[0].sourceObservationId).toBe((await services.observations.listObservations())[0].id);
    expect(recommendations.map((item) => item.proposition)).not.toContain(belief.hypotheses[0].proposition);
  });

  it("scopes hypothesis recommendations to a selected source observation before applying the limit", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const belief = await services.beliefs.createBelief({
      title: "AI agents",
      category: "AI_TREND",
      description: "Track delivery impact.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [{ proposition: "AI agents improve delivery", priorProbability: 0.45, notes: "" }]
    });
    const observations = [];
    for (let index = 1; index <= 5; index += 1) {
      observations.push(
        await services.observations.createObservation({
          title: `Agent adoption signal ${index}`,
          content: `AI agents delivery impact signal ${index}`,
          credibility: 0.7,
          metadata: { ignoredReason: "UNMATCHED" }
        })
      );
    }

    const recommendations = await services.beliefs.recommendHypotheses(belief.id, {
      limit: 1,
      sourceObservationId: observations[4].id
    });

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0].sourceObservationId).toBe(observations[4].id);
    expect(recommendations[0].proposition).toContain("Agent adoption signal 5");
  });

  it("prefers injected LLM recommendations for unmatched observation driven hypotheses", async () => {
    const generatorInputs: string[] = [];
    const store = createInMemoryWorldModelStore();
    const services = createWorldModelServices(store, {
      hypothesisRecommendationGenerator: async (input) => {
        if (!input.sourceObservation) return [];
        generatorInputs.push(input.sourceObservation.title);
        return [
          {
            proposition: "Regulated buyers delay AI governance adoption when procurement owners require legal review",
            stance: "OPPOSES",
            priorProbability: 0.38,
            notes: "可观察：跟踪采购负责人、法务审查和治理平台上线之间的延迟。",
            evidenceSearchQuery: "AI governance adoption procurement legal review delay regulated buyers",
            rationale: `LLM 从未匹配观察提炼：${input.sourceObservation.title}`
          }
        ];
      }
    });
    const belief = await services.beliefs.createBelief({
      title: "AI governance adoption",
      category: "AI_TREND",
      description: "Track whether governance platforms become a default enterprise workflow.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "Audit quality improves after governance rollout",
          priorProbability: 0.45,
          stance: "SUPPORTS",
          notes: ""
        }
      ]
    });
    await store.createObservation({
      id: "observation_governance_delay",
      title: "AI governance procurement delays slow enterprise adoption",
      content: "Regulated buyers say legal and procurement review delays slow AI governance platform adoption.",
      observedAt: new Date("2026-06-11T08:00:00.000Z"),
      status: "UNKNOWN",
      credibility: 0.78,
      sourceId: undefined,
      url: undefined,
      author: undefined,
      publishedAt: undefined,
      normalizedHash: undefined,
      semanticKey: undefined,
      duplicateOfId: undefined,
      metadata: { ignoredReason: "UNMATCHED" }
    });

    const recommendations = await services.beliefs.recommendHypotheses(belief.id, { limit: 3 });

    expect(generatorInputs).toEqual(["AI governance procurement delays slow enterprise adoption"]);
    expect(recommendations[0]).toMatchObject({
      proposition: "Regulated buyers delay AI governance adoption when procurement owners require legal review",
      stance: "OPPOSES",
      priorProbability: 0.38,
      sourceObservationId: expect.any(String),
      rationale: expect.stringContaining("LLM 从未匹配观察提炼")
    });
    expect(recommendations[0].proposition).not.toContain("持续影响");
  });

  it("keeps a missing counter-hypothesis recommendation when unmatched observations fill the limit", async () => {
    const store = createInMemoryWorldModelStore();
    const services = createWorldModelServices(store);
    const belief = await services.beliefs.createBelief({
      title: "AI agents improve software delivery",
      category: "AI_TREND",
      description: "Track whether agentic coding systems materially change engineering throughput and review quality.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "AI agents improve software delivery through faster implementation cycles",
          priorProbability: 0.45,
          stance: "SUPPORTS",
          notes: ""
        }
      ]
    });

    const supportObservationTitles = [
      "AI agents improve software delivery in incident response",
      "AI agents improve software delivery in test generation",
      "AI agents improve software delivery in refactoring work",
      "AI agents improve software delivery in code review preparation"
    ];
    for (let index = 0; index < supportObservationTitles.length; index += 1) {
      const title = supportObservationTitles[index];
      await store.createObservation({
        id: `observation_support_${index}`,
        title,
        content: `${title} with measurable adoption gains.`,
        observedAt: new Date(`2026-06-11T08:0${index}:00.000Z`),
        status: "UNKNOWN",
        credibility: 0.75,
        sourceId: undefined,
        url: undefined,
        author: undefined,
        publishedAt: undefined,
        normalizedHash: undefined,
        semanticKey: undefined,
        duplicateOfId: undefined,
        metadata: { ignoredReason: "UNMATCHED" }
      });
    }

    const recommendations = await services.beliefs.recommendHypotheses(belief.id, { limit: 4 });

    expect(recommendations).toHaveLength(4);
    expect(recommendations.some((item) => item.sourceObservationId)).toBe(true);
    expect(recommendations.some((item) => item.stance === "OPPOSES" && !item.sourceObservationId)).toBe(true);
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

  it("clears editable hypothesis time windows", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const belief = await services.beliefs.createBelief({
      title: "Timed hypothesis",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "This hypothesis has a bounded review window",
          priorProbability: 0.4,
          notes: "",
          startsAt: new Date("2026-06-12T00:00:00.000Z"),
          expiresAt: new Date("2026-06-20T00:00:00.000Z"),
          expiryCondition: "The review window closes."
        }
      ]
    });

    const updated = await services.beliefs.updateHypothesis(belief.hypotheses[0].id, {
      startsAt: null,
      expiresAt: null,
      expiryCondition: ""
    });

    expect(updated.startsAt).toBeUndefined();
    expect(updated.expiresAt).toBeUndefined();
    expect(updated.expiryCondition).toBe("");
  });

  it("stores settlement outcome when resolving a hypothesis", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const belief = await services.beliefs.createBelief({
      title: "Settlement calibration",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "The tracked rollout improves delivery throughput",
          priorProbability: 0.4,
          notes: ""
        }
      ]
    });

    const updated = await services.beliefs.updateHypothesis(belief.hypotheses[0].id, {
      status: "RESOLVED_TRUE",
      currentProbability: 0.82,
      resolvedOutcome: "2026 Q2 internal rollout improved delivery throughput."
    });

    expect(updated).toMatchObject({
      status: "RESOLVED_TRUE",
      currentProbability: 0.82,
      resolvedOutcome: "2026 Q2 internal rollout improved delivery throughput."
    });
  });

  it("settles a hypothesis from a settlement review observation without marking the observation rejected", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const belief = await services.beliefs.createBelief({
      title: "Observation settlement",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "The tracked rollout reaches production",
          priorProbability: 0.4,
          notes: "",
          expiresAt: new Date(Date.now() - 60_000)
        }
      ]
    });
    const observation = await services.observations.createObservation({
      title: "Final rollout result",
      content: "The rollout did not reach production.",
      credibility: 0.82,
      metadata: {
        reviewReason: "SETTLEMENT_REVIEW",
        queryPurpose: "SETTLEMENT_REVIEW",
        settlementHypothesisId: belief.hypotheses[0].id
      }
    });

    const settled = await services.observations.settleObservation({
      observationId: observation.id,
      hypothesisId: belief.hypotheses[0].id,
      outcome: "RESOLVED_FALSE",
      resolvedOutcome: "The rollout did not reach production."
    });
    const observations = await services.observations.listObservations();
    const updatedBelief = await services.beliefs.getBelief(belief.id);

    expect(settled.hypothesis).toMatchObject({
      id: belief.hypotheses[0].id,
      status: "RESOLVED_FALSE",
      currentProbability: 0,
      resolvedOutcome: "The rollout did not reach production."
    });
    expect(settled.observation).toMatchObject({
      id: observation.id,
      status: "SETTLED",
      metadata: expect.objectContaining({
        reviewReason: "SETTLEMENT_REVIEW",
        queryPurpose: "SETTLEMENT_REVIEW",
        settlementHypothesisId: belief.hypotheses[0].id,
        settlementResolved: true,
        settlementOutcome: "RESOLVED_FALSE",
        settlementResolvedHypothesisId: belief.hypotheses[0].id,
        settlementResolvedOutcome: "The rollout did not reach production.",
        settlementResolvedAt: expect.any(String)
      })
    });
    expect(observations[0].status).toBe("SETTLED");
    expect(updatedBelief?.hypotheses[0].status).toBe("RESOLVED_FALSE");
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
    expect(result.event!.evidenceId).toBe(result.evidence.id);
    expect(updatedBelief?.hypotheses[0].currentProbability).toBeGreaterThan(0.4);
  });

  it("confirms one evidence across belief groups and applies one update per affected belief", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const adoptionBelief = await services.beliefs.createBelief({
      title: "AI adoption",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [{ proposition: "AI agents improve delivery quality", priorProbability: 0.4, notes: "" }]
    });
    const careerBelief = await services.beliefs.createBelief({
      title: "Engineering career",
      category: "CAREER",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [{ proposition: "AI agents increase review overhead", priorProbability: 0.6, notes: "" }]
    });
    const observation = await services.observations.createObservation({
      title: "Agent rollout evidence",
      content: "Agent rollout improves delivery quality while increasing review overhead.",
      credibility: 0.8
    });

    const result = await services.evidence.confirmAndApplyObservation({
      observationId: observation.id,
      confirmationMode: "MANUAL",
      links: [
        {
          hypothesisId: adoptionBelief.hypotheses[0].id,
          direction: "SUPPORTS",
          relevance: 0.9,
          likelihoodRatio: 2,
          confidence: 0.8,
          rationale: "Quality signal supports adoption."
        },
        {
          hypothesisId: careerBelief.hypotheses[0].id,
          direction: "OPPOSES",
          relevance: 0.75,
          likelihoodRatio: 0.5,
          confidence: 0.7,
          rationale: "Review overhead weakens the career benefit belief."
        }
      ]
    });
    const updates = await services.updates.listEvents();
    const updatedAdoptionBelief = await services.beliefs.getBelief(adoptionBelief.id);
    const updatedCareerBelief = await services.beliefs.getBelief(careerBelief.id);

    expect(result.evidence.links).toHaveLength(2);
    expect(result.events).toHaveLength(2);
    expect(result.event).toEqual(result.events[0]);
    expect(new Set(result.events.map((event) => event.beliefId))).toEqual(new Set([adoptionBelief.id, careerBelief.id]));
    expect(updates).toHaveLength(2);
    expect(updatedAdoptionBelief?.hypotheses[0].currentProbability).toBeGreaterThan(0.4);
    expect(updatedCareerBelief?.hypotheses[0].currentProbability).toBeLessThan(0.6);
  });

  it("creates grouped update previews for evidence that spans belief groups", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const adoptionBelief = await services.beliefs.createBelief({
      title: "AI adoption preview",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [{ proposition: "AI agents improve delivery quality", priorProbability: 0.4, notes: "" }]
    });
    const careerBelief = await services.beliefs.createBelief({
      title: "Career preview",
      category: "CAREER",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [{ proposition: "AI agents increase review overhead", priorProbability: 0.6, notes: "" }]
    });
    const observation = await services.observations.createObservation({
      title: "Preview evidence",
      content: "Agent rollout improves delivery quality while increasing review overhead.",
      credibility: 0.8
    });
    const evidence = await services.evidence.confirmObservation({
      observationId: observation.id,
      confirmationMode: "MANUAL",
      links: [
        {
          hypothesisId: adoptionBelief.hypotheses[0].id,
          direction: "SUPPORTS",
          relevance: 0.9,
          likelihoodRatio: 2,
          confidence: 0.8,
          rationale: "Quality signal supports adoption."
        },
        {
          hypothesisId: careerBelief.hypotheses[0].id,
          direction: "OPPOSES",
          relevance: 0.75,
          likelihoodRatio: 0.5,
          confidence: 0.7,
          rationale: "Review overhead weakens the career benefit belief."
        }
      ]
    });

    const previews = await services.updates.createPreviews(evidence.id);

    expect(previews).toHaveLength(2);
    expect(new Set(previews.map((preview) => preview.beliefId))).toEqual(new Set([adoptionBelief.id, careerBelief.id]));
    expect(previews.find((preview) => preview.beliefId === adoptionBelief.id)?.links).toEqual([
      expect.objectContaining({ hypothesisId: adoptionBelief.hypotheses[0].id })
    ]);
    expect(previews.find((preview) => preview.beliefId === careerBelief.id)?.links).toEqual([
      expect.objectContaining({ hypothesisId: careerBelief.hypotheses[0].id })
    ]);
    expect(previews.find((preview) => preview.beliefId === adoptionBelief.id)?.posteriorSnapshot[adoptionBelief.hypotheses[0].id]).toBeGreaterThan(0.4);
    expect(previews.find((preview) => preview.beliefId === careerBelief.id)?.posteriorSnapshot[careerBelief.hypotheses[0].id]).toBeLessThan(0.6);
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

  it("downgrades source auto-confirm through the injected auto-apply policy", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: async () =>
          "<html><head><title>AI agents accelerate engineering teams</title></head><body>AI agents accelerate engineering teams by handling routine implementation work.</body></html>"
      },
      autoApplyPolicy: async (input) => (input.autoConfirm ? { ...input, reviewOnly: true, autoConfirm: false } : input)
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
    const evidence = await services.evidence.listEvidence();
    const updates = await services.updates.listEvents();
    const updatedBelief = await services.beliefs.getBelief(belief.id);

    expect(run.status).toBe("REVIEW_ONLY");
    expect(run.candidateCount).toBe(1);
    expect(run.autoAppliedCount).toBe(0);
    expect(run.reviewCount).toBe(1);
    expect(evidence).toHaveLength(0);
    expect(updates).toHaveLength(0);
    expect(updatedBelief?.hypotheses[0].currentProbability).toBe(0.35);
  });

  it("updates an existing source configuration without replacing unchanged fields", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const source = await services.sources.createSource({
      name: "Agent signal page",
      kind: "WEB_PAGE",
      url: "https://example.com/agent-signal",
      adapter: "web_page",
      credentialRef: "agent-feed",
      credibility: 0.55,
      enabled: true,
      autoConfirm: false,
      autoConfirmThreshold: 0.85
    });

    const updated = await (services.sources as {
      updateSource(id: string, input: {
        name?: string;
        enabled?: boolean;
        credibility?: number;
        autoConfirm?: boolean;
        autoConfirmThreshold?: number;
      }): Promise<typeof source>;
    }).updateSource(source.id, {
      name: "Reviewed agent signal page",
      enabled: false,
      credibility: 0.72,
      autoConfirm: true,
      autoConfirmThreshold: 0.62
    });

    expect(updated).toMatchObject({
      id: source.id,
      name: "Reviewed agent signal page",
      kind: "WEB_PAGE",
      url: "https://example.com/agent-signal",
      adapter: "web_page",
      credentialRef: "agent-feed",
      credibility: 0.72,
      enabled: false,
      autoConfirm: true,
      autoConfirmThreshold: 0.62
    });
    await expect(services.sources.listSources()).resolves.toEqual([updated]);
  });

  it("keeps moderate evidence candidates in review when auto-apply requires a higher threshold", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: async () =>
          "<html><head><title>AI agents accelerate pilot workflows</title></head><body>AI agents accelerate pilot workflows in a limited engineering trial.</body></html>"
      }
    });
    await services.beliefs.createBelief({
      title: "AI agents",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "AI agents accelerate engineering teams through autonomous code review deployment planning",
          priorProbability: 0.35,
          stance: "SUPPORTS",
          notes: "enterprise rollout"
        }
      ]
    });
    const source = await services.sources.createSource({
      name: "Agent candidate page",
      kind: "WEB_PAGE",
      url: "https://example.com/agent-candidate",
      adapter: "web_page",
      credentialRef: undefined,
      credibility: 0.8,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.95
    });

    const run = await services.sources.runSource(source.id, {
      candidateThreshold: 0.2,
      autoConfirmThreshold: 0.95
    });
    const observations = await services.observations.listObservations();
    const evidence = await services.evidence.listEvidence();

    expect(run.candidateCount).toBe(1);
    expect(run.autoAppliedCount).toBe(0);
    expect(run.reviewCount).toBe(1);
    expect(evidence).toHaveLength(0);
    expect(observations[0].status).toBe("PENDING");
    expect(observations[0].metadata).toMatchObject({
      reviewReason: "QUALITY_THRESHOLD",
      recommendedLinks: [expect.objectContaining({ relevance: expect.any(Number) })]
    });
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
    expect(loop.runs[0]).toMatchObject({ queryCount: 1, reviewCount: 1, sourceCode: "S-001" });
    expect(loop.queries[0]).toMatchObject({ beliefCode: "B-001", hypothesisCode: "H-001" });
    expect(loop.runs[0].querySummary[0]).toMatchObject({ beliefCode: "B-001", hypothesisCode: "H-001" });
    expect(requestedUrls[0]).toContain("AI%20agents");
    expect(requestedUrls[0]).toContain("engineering%20teams");
    expect(observations[0].metadata).toMatchObject({
      query: expect.stringContaining("AI agents"),
      queryBeliefId: belief.id,
      queryBeliefCode: "B-001",
      queryHypothesisId: belief.hypotheses[0].id,
      queryHypothesisCode: "H-001",
      queryPriority: expect.any(Number),
      queryPriorityReason: expect.stringContaining("evidence")
    });
    expect(evidence).toHaveLength(0);
    expect(updatedBelief?.hypotheses[0].currentProbability).toBe(0.35);
  });

  it("plans source-specific evidence loop queries for comparison hypotheses", async () => {
    const requestedUrls: string[] = [];
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: async (url) => {
          requestedUrls.push(url);
          if (url.includes("gamma-api.polymarket.com")) {
            return JSON.stringify({ markets: [] });
          }
          return "<html><head><title>GPT Claude benchmark</title></head><body>GPT and Claude benchmark comparison.</body></html>";
        }
      }
    });
    await services.beliefs.createBelief({
      title: "gpt 暴打 claude",
      category: "AI_TREND",
      description: "Track whether OpenAI models outperform Anthropic Claude.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "gpt 6 > claude mythos",
          priorProbability: 0.5,
          stance: "SUPPORTS",
          notes: ""
        }
      ]
    });
    await services.sources.createSource({
      name: "Generic search",
      kind: "SEARCH",
      url: "https://example.com/search?q={query}",
      adapter: "search",
      credibility: 0.7,
      enabled: true,
      autoConfirm: false,
      autoConfirmThreshold: 0.8
    });
    await services.sources.createSource({
      name: "Polymarket",
      kind: "PREDICTION_MARKET",
      url: "https://gamma-api.polymarket.com/markets?search={query}&limit=10&active=true&closed=false",
      adapter: "polymarket_markets",
      credibility: 0.6,
      enabled: true,
      autoConfirm: false,
      autoConfirmThreshold: 0.8
    });

    const loop = await services.automation.runEvidenceLoop({ reviewOnly: true });
    const genericUrls = requestedUrls.filter((url) => url.includes("example.com/search"));
    const predictionUrls = requestedUrls.filter((url) => url.includes("gamma-api.polymarket.com"));
    const decodedGenericQueries = genericUrls.map((url) => decodeURIComponent(new URL(url).searchParams.get("q") ?? ""));
    const decodedPredictionQueries = predictionUrls.map((url) => decodeURIComponent(new URL(url).searchParams.get("search") ?? ""));

    expect(loop.queries.some((query) => query.plannerStrategy === "RULE_COMPARISON")).toBe(true);
    expect(decodedGenericQueries).toContain("GPT-6 vs Claude Mythos benchmark");
    expect(decodedPredictionQueries).toContain("Will GPT-6 outperform Claude Mythos?");
    expect(decodedPredictionQueries.join(" ")).not.toContain("暴打");
    expect(decodedPredictionQueries.join(" ")).not.toContain(">");
  });

  it("uses an injected evidence query planner before rule-based query planning", async () => {
    const requestedUrls: string[] = [];
    const plannerInputs: Array<{ baseQuery: string; proposition: string }> = [];
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      evidenceQueryPlanner: (input) => {
        plannerInputs.push({ baseQuery: input.baseQuery, proposition: input.hypothesis.proposition });
        return [
          {
            query: "custom semantic planner query",
            strategy: "LLM",
            purpose: "GENERAL",
            sourceKinds: ["SEARCH"]
          }
        ];
      },
      sourceAdapterDependencies: {
        fetchText: async (url) => {
          requestedUrls.push(url);
          return "<html><head><title>Custom planner result</title></head><body>Custom semantic planner query evidence.</body></html>";
        }
      }
    });
    await services.beliefs.createBelief({
      title: "gpt 暴打 claude",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [{ proposition: "gpt 6 > claude mythos", priorProbability: 0.5, stance: "SUPPORTS", notes: "" }]
    });
    await services.sources.createSource({
      name: "Generic search",
      kind: "SEARCH",
      url: "https://example.com/search?q={query}",
      adapter: "search",
      credibility: 0.7,
      enabled: true,
      autoConfirm: false,
      autoConfirmThreshold: 0.8
    });

    const loop = await services.automation.runEvidenceLoop({ reviewOnly: true });

    expect(plannerInputs).toEqual([{ baseQuery: "gpt 暴打 claude gpt 6 > claude mythos", proposition: "gpt 6 > claude mythos" }]);
    expect(loop.queries[0]).toMatchObject({ query: "custom semantic planner query", plannerStrategy: "LLM" });
    expect(decodeURIComponent(new URL(requestedUrls[0]).searchParams.get("q") ?? "")).toBe("custom semantic planner query");
  });

  it("does not auto-apply fetched source observations to beliefs outside the loop scope", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: async () =>
          "<html><head><title>Developer agent delivery metric</title></head><body>Engineering teams report that developer agents are shortening implementation cycles.</body></html>"
      }
    });
    const targetBelief = await services.beliefs.createBelief({
      title: "Hospital staffing retention",
      category: "CAREER",
      description: "Track whether rotating shift schedules reduce nurse retention.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "Rotating shift schedules reduce nurse retention",
          priorProbability: 0.4,
          stance: "OPPOSES",
          notes: "hospital staffing"
        }
      ]
    });
    const otherBelief = await services.beliefs.createBelief({
      title: "Developer agent adoption",
      category: "AI_TREND",
      description: "Track whether developer agents become a routine engineering tool.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "Developer agents shorten implementation cycles",
          priorProbability: 0.35,
          stance: "SUPPORTS",
          notes: "engineering teams"
        }
      ]
    });
    await services.sources.createSource({
      name: "Scoped search adapter",
      kind: "SEARCH",
      url: "https://example.com/search?q={query}",
      adapter: "search",
      credibility: 0.8,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.2
    });

    const loop = await services.automation.runEvidenceLoop({
      beliefIds: [targetBelief.id],
      maxObservations: 1,
      forceAutoApply: true,
      candidateThreshold: 0.2,
      autoConfirmThreshold: 0.2
    });
    const observations = await services.observations.listObservations();
    const evidence = await services.evidence.listEvidence();
    const updatedOtherBelief = await services.beliefs.getBelief(otherBelief.id);

    expect(loop).toMatchObject({
      queryCount: 1,
      sourceRunCount: 1,
      itemCount: 1,
      candidateCount: 0,
      autoAppliedCount: 0,
      unmatchedCount: 1
    });
    expect(observations[0]).toMatchObject({
      status: "UNKNOWN",
      metadata: expect.objectContaining({ ignoredReason: "UNMATCHED" })
    });
    expect(evidence).toHaveLength(0);
    expect(updatedOtherBelief?.hypotheses[0].currentProbability).toBe(0.35);
  });

  it("limits evidence loop source runs for bounded CLI-style checks", async () => {
    const requestedUrls: string[] = [];
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: async (url) => {
          requestedUrls.push(url);
          return "<html><head><title>AI agents accelerate engineering teams</title></head><body>AI agents accelerate engineering teams adoption evidence.</body></html>";
        }
      }
    });
    await services.beliefs.createBelief({
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
      name: "Search adapter one",
      kind: "SEARCH",
      url: "https://one.example/search?q={query}",
      adapter: "search",
      credibility: 0.8,
      enabled: true,
      autoConfirm: false,
      autoConfirmThreshold: 0.85
    });
    await services.sources.createSource({
      name: "Search adapter two",
      kind: "SEARCH",
      url: "https://two.example/search?q={query}",
      adapter: "search",
      credibility: 0.8,
      enabled: true,
      autoConfirm: false,
      autoConfirmThreshold: 0.85
    });

    const loop = await services.automation.runEvidenceLoop({ reviewOnly: true, maxObservations: 1, maxSources: 1 });

    expect(loop.sourceRunCount).toBe(1);
    expect(loop.runs).toHaveLength(1);
    expect(requestedUrls).toHaveLength(1);
    expect(requestedUrls[0]).toContain("one.example");
  });

  it("keeps evidence queries scoped to effective hypotheses while collecting settlement queries for expired hypotheses", async () => {
    const requestedUrls: string[] = [];
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: async (url) => {
          requestedUrls.push(url);
          return "<html><head><title>AI governance adoption changes audit workflows</title></head><body>AI governance adoption changes audit workflows in regulated teams.</body></html>";
        }
      }
    });
    const now = Date.now();
    await services.beliefs.createBelief({
      title: "AI governance",
      category: "AI_TREND",
      description: "Track governance adoption.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "Expired AI governance pilots dominate audit workflows",
          priorProbability: 0.25,
          stance: "SUPPORTS",
          notes: "expired signal",
          expiresAt: new Date(now - 60_000)
        },
        {
          proposition: "Future AI governance regulation reshapes audit workflows",
          priorProbability: 0.25,
          stance: "SUPPORTS",
          notes: "future signal",
          startsAt: new Date(now + 86_400_000)
        },
        {
          proposition: "AI governance adoption changes audit workflows",
          priorProbability: 0.35,
          stance: "SUPPORTS",
          notes: "current signal"
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
      autoConfirm: false,
      autoConfirmThreshold: 0.85
    });

    const loop = await services.automation.runEvidenceLoop({ reviewOnly: true, maxObservations: 1 });

    const evidenceQueries = loop.queries.filter((query) => query.purpose !== "SETTLEMENT_REVIEW");
    const settlementQueries = loop.queries.filter((query) => query.purpose === "SETTLEMENT_REVIEW");

    expect(loop.queryCount).toBe(2);
    expect(evidenceQueries).toHaveLength(1);
    expect(evidenceQueries[0].query).toContain("AI governance adoption changes audit workflows");
    expect(evidenceQueries[0].query).not.toContain("Expired");
    expect(evidenceQueries[0].query).not.toContain("Future");
    expect(settlementQueries).toEqual([
      expect.objectContaining({
        query: expect.stringContaining("Expired AI governance pilots dominate audit workflows"),
        priority: 1,
        priorityReason: "settlement review due",
        settlementDue: true
      })
    ]);
    expect(loop.queries.map((query) => query.query).join(" ")).not.toContain("Future");
    expect(requestedUrls).toHaveLength(2);
    expect(requestedUrls.some((url) => url.includes("adoption%20changes%20audit%20workflows"))).toBe(true);
    expect(requestedUrls.some((url) => url.includes("final%20outcome"))).toBe(true);
  });

  it("prioritizes uncertain hypotheses with thin evidence coverage in evidence loop queries", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const belief = await services.beliefs.createBelief({
      title: "AI governance adoption",
      category: "AI_TREND",
      description: "Track which governance adoption narrative needs new evidence first.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "AI governance adoption is already saturated in enterprise teams",
          priorProbability: 0.95,
          stance: "SUPPORTS",
          notes: "saturated enterprise adoption"
        },
        {
          proposition: "AI governance adoption remains unresolved for regulated teams",
          priorProbability: 0.5,
          stance: "SUPPORTS",
          notes: "regulated teams unresolved adoption"
        }
      ]
    });

    const loop = await services.automation.runEvidenceLoop({ reviewOnly: true });

    expect(loop.queries.map((query) => query.hypothesisId)).toEqual([belief.hypotheses[1].id, belief.hypotheses[0].id]);
    expect(loop.queries[0]).toMatchObject({
      priorityReason: "high uncertainty; no active evidence",
      evidenceCount: 0
    });
    expect(loop.queries[0].priority ?? 0).toBeGreaterThan(loop.queries[1].priority ?? 0);
  });

  it("prioritizes counter-evidence collection for high-confidence one-sided evidence", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const belief = await services.beliefs.createBelief({
      title: "AI governance adoption",
      category: "AI_TREND",
      description: "Track whether strong beliefs are getting one-sided evidence.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "AI governance adoption remains uncertain for regulated teams",
          priorProbability: 0.5,
          stance: "SUPPORTS",
          notes: "regulated teams uncertain adoption",
          evidenceSearchQuery: "regulated teams uncertain adoption evidence"
        },
        {
          proposition: "AI governance adoption is already saturated in enterprise teams",
          priorProbability: 0.91,
          stance: "SUPPORTS",
          notes: "saturated enterprise adoption",
          evidenceSearchQuery: "enterprise AI governance saturation counter evidence"
        }
      ]
    });
    const supportObservation = await services.observations.createObservation({
      title: "Enterprise governance saturation signal",
      content: "Large enterprises report that AI governance workflows are already saturated.",
      credibility: 0.8
    });
    await services.evidence.confirmObservation({
      observationId: supportObservation.id,
      confirmationMode: "MANUAL",
      links: [
        {
          hypothesisId: belief.hypotheses[1].id,
          direction: "SUPPORTS",
          relevance: 0.88,
          likelihoodRatio: 2.1,
          confidence: 0.82,
          rationale: "The observation supports the saturation hypothesis."
        }
      ]
    });

    const loop = await services.automation.runEvidenceLoop({ reviewOnly: true, maxQueries: 1 });

    expect(loop.queries).toHaveLength(1);
    expect(loop.queries[0]).toMatchObject({
      hypothesisId: belief.hypotheses[1].id,
      query: "enterprise AI governance saturation counter evidence",
      priorityReason: "low uncertainty; 1 active evidence; needs counter-evidence",
      evidenceCount: 1,
      supportEvidenceCount: 1,
      opposingEvidenceCount: 0,
      counterEvidenceGap: true
    });
  });

  it("prioritizes stale evidence refreshes in evidence loop queries", async () => {
    const store = createInMemoryWorldModelStore();
    const services = createWorldModelServices(store);
    const belief = await services.beliefs.createBelief({
      title: "AI governance adoption",
      category: "AI_TREND",
      description: "Track whether existing evidence has gone stale.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "AI governance adoption remains unresolved for regulated teams",
          priorProbability: 0.5,
          stance: "SUPPORTS",
          notes: "regulated teams unresolved adoption",
          evidenceSearchQuery: "regulated teams unresolved adoption evidence"
        },
        {
          proposition: "AI governance adoption is improving through security tooling",
          priorProbability: 0.72,
          stance: "SUPPORTS",
          notes: "security tooling adoption refresh",
          evidenceSearchQuery: "security tooling adoption refresh evidence"
        }
      ]
    });
    const staleConfirmedAt = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000 - 60_000);
    await store.createEvidence({
      id: "evidence_stale_security_tooling",
      observationId: "observation_stale_security_tooling",
      title: "Old security tooling evidence",
      content: "Security tooling was improving governance adoption several weeks ago.",
      confirmedAt: staleConfirmedAt,
      confirmationMode: "MANUAL",
      credibility: 0.75,
      status: "ACTIVE",
      metadata: {},
      links: [
        {
          id: "link_stale_security_tooling",
          evidenceId: "evidence_stale_security_tooling",
          hypothesisId: belief.hypotheses[1].id,
          direction: "SUPPORTS",
          relevance: 0.7,
          likelihoodRatio: 1.5,
          confidence: 0.7,
          rationale: "The old evidence supported the tooling hypothesis.",
          createdAt: staleConfirmedAt
        }
      ]
    });

    const loop = await services.automation.runEvidenceLoop({ reviewOnly: true, maxQueries: 1 });

    expect(loop.queries).toHaveLength(1);
    expect(loop.queries[0]).toMatchObject({
      hypothesisId: belief.hypotheses[1].id,
      query: "security tooling adoption refresh evidence",
      priorityReason: "moderate uncertainty; 1 active evidence; evidence stale 45d",
      evidenceCount: 1,
      staleEvidenceDays: 45
    });
  });

  it("prioritizes fragile extreme probabilities backed by weak evidence", async () => {
    const store = createInMemoryWorldModelStore();
    const services = createWorldModelServices(store);
    const belief = await services.beliefs.createBelief({
      title: "AI governance adoption",
      category: "AI_TREND",
      description: "Track whether extreme conclusions are supported by evidence quality.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "AI governance adoption remains unresolved for regulated teams",
          priorProbability: 0.5,
          stance: "SUPPORTS",
          notes: "regulated teams unresolved adoption",
          evidenceSearchQuery: "regulated teams unresolved adoption evidence"
        },
        {
          proposition: "AI governance adoption is unlikely to expand this quarter",
          priorProbability: 0.08,
          stance: "OPPOSES",
          notes: "weak evidence created an extreme rejection",
          evidenceSearchQuery: "AI governance adoption expansion verification evidence"
        }
      ]
    });
    const confirmedAt = new Date("2026-06-11T08:00:00.000Z");
    await store.createEvidence({
      id: "evidence_weak_governance_rejection",
      observationId: "observation_weak_governance_rejection",
      title: "Weak governance adoption rejection",
      content: "A narrow anecdote says adoption may not expand this quarter.",
      confirmedAt,
      confirmationMode: "MANUAL",
      credibility: 0.65,
      status: "ACTIVE",
      metadata: {},
      links: [
        {
          id: "link_weak_governance_rejection",
          evidenceId: "evidence_weak_governance_rejection",
          hypothesisId: belief.hypotheses[1].id,
          direction: "OPPOSES",
          relevance: 0.42,
          likelihoodRatio: 0.7,
          confidence: 0.45,
          rationale: "The evidence weakly opposes expansion.",
          createdAt: confirmedAt
        }
      ]
    });

    const loop = await services.automation.runEvidenceLoop({ reviewOnly: true, maxQueries: 1 });

    expect(loop.queries).toHaveLength(1);
    expect(loop.queries[0]).toMatchObject({
      hypothesisId: belief.hypotheses[1].id,
      query: "AI governance adoption expansion verification evidence",
      priorityReason: "low uncertainty; 1 active evidence; weak evidence quality",
      evidenceCount: 1,
      averageEvidenceRelevance: 0.42,
      averageEvidenceConfidence: 0.45,
      fragileCertainty: true
    });
  });

  it("raises evidence loop priority for active hypotheses in poorly calibrated belief tables", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const calibratedBelief = await services.beliefs.createBelief({
      title: "AI procurement calibration",
      category: "AI_TREND",
      description: "Track procurement assumptions after a bad miss.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "AI procurement remains focused on security reviews",
          priorProbability: 0.83,
          stance: "SUPPORTS",
          notes: "security review cycle"
        },
        {
          proposition: "AI procurement will finish this quarter",
          priorProbability: 0.9,
          stance: "SUPPORTS",
          notes: "resolved procurement miss"
        }
      ]
    });
    await services.beliefs.updateHypothesis(calibratedBelief.hypotheses[1].id, {
      status: "RESOLVED_FALSE",
      currentProbability: 0.9,
      resolvedOutcome: "The procurement decision slipped into the next quarter."
    });
    const baselineBelief = await services.beliefs.createBelief({
      title: "Baseline AI adoption",
      category: "AI_TREND",
      description: "Track a moderately uncertain but uncalibrated belief.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "Baseline AI adoption expands through internal champions",
          priorProbability: 0.75,
          stance: "SUPPORTS",
          notes: "internal champion adoption"
        }
      ]
    });

    const loop = await services.automation.runEvidenceLoop({ reviewOnly: true, maxQueries: 2 });

    expect(loop.queries.map((query) => query.hypothesisId)).toEqual([
      calibratedBelief.hypotheses[0].id,
      baselineBelief.hypotheses[0].id
    ]);
    expect(loop.queries[0]).toMatchObject({
      calibrationError: 0.9,
      calibrationHypothesisId: calibratedBelief.hypotheses[1].id,
      priorityReason: "moderate uncertainty; no active evidence; calibration error 90.0pp"
    });
    expect(loop.queries[0].priority ?? 0).toBeGreaterThan(loop.queries[1].priority ?? 0);
  });

  it("limits evidence loop queries after applying uncertainty priority", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const belief = await services.beliefs.createBelief({
      title: "AI governance adoption",
      category: "AI_TREND",
      description: "Track which governance adoption narrative needs the next source query.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "AI governance adoption is already saturated in enterprise teams",
          priorProbability: 0.95,
          stance: "SUPPORTS",
          notes: "saturated enterprise adoption"
        },
        {
          proposition: "AI governance adoption remains unresolved for regulated teams",
          priorProbability: 0.5,
          stance: "SUPPORTS",
          notes: "regulated teams unresolved adoption"
        }
      ]
    });

    const loop = await services.automation.runEvidenceLoop({ reviewOnly: true, maxQueries: 1 });

    expect(loop.queryCount).toBe(1);
    expect(loop.queries).toHaveLength(1);
    expect(loop.queries[0].hypothesisId).toBe(belief.hypotheses[1].id);
  });

  it("scopes generated source-run queries to requested beliefs before fetching", async () => {
    const requestedUrls: string[] = [];
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: async (url) => {
          requestedUrls.push(url);
          return "<html><head><title>Scoped query result</title></head><body>Scoped query evidence.</body></html>";
        }
      }
    });
    await services.beliefs.createBelief({
      title: "Other belief",
      category: "AI_TREND",
      description: "This belief should not be queried by the scoped source run.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "Other belief unrelated hypothesis",
          priorProbability: 0.5,
          stance: "SUPPORTS",
          notes: ""
        }
      ]
    });
    const targetBelief = await services.beliefs.createBelief({
      title: "Target belief",
      category: "CAREER",
      description: "Only this belief should generate source run queries.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "Target belief scoped hypothesis",
          priorProbability: 0.5,
          stance: "SUPPORTS",
          notes: ""
        }
      ]
    });
    const source = await services.sources.createSource({
      name: "Scoped search",
      kind: "SEARCH",
      url: "https://example.com/search?q={query}",
      adapter: "search",
      credentialRef: undefined,
      credibility: 0.8,
      enabled: true,
      autoConfirm: false,
      autoConfirmThreshold: 0.85
    });

    const run = await services.sources.runSource(source.id, {
      reviewOnly: true,
      beliefIds: [targetBelief.id],
      maxQueries: 1
    });

    expect(run.queryCount).toBe(1);
    expect(run.querySummary).toHaveLength(1);
    expect(run.querySummary[0].beliefId).toBe(targetBelief.id);
    expect(requestedUrls).toHaveLength(1);
    expect(decodeURIComponent(requestedUrls[0])).toContain("Target belief scoped hypothesis");
    expect(decodeURIComponent(requestedUrls[0])).not.toContain("Other belief unrelated hypothesis");
  });

  it("generates evidence queries for platform sources that rely on built-in URL templates", async () => {
    const requestedUrls: string[] = [];
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: async (url) => {
          requestedUrls.push(url);
          return JSON.stringify({
            items: [
              {
                full_name: "example/agentic-delivery",
                description: "Open-source agentic delivery workflows improve engineering teams.",
                html_url: "https://github.com/example/agentic-delivery",
                updated_at: "2026-06-18T06:00:00Z",
                stargazers_count: 320,
                owner: { login: "example" }
              }
            ]
          });
        }
      }
    });
    await services.beliefs.createBelief({
      title: "AI agents improve delivery",
      category: "AI_TREND",
      description: "Track whether open-source agentic workflows improve engineering delivery.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "Open-source agentic delivery workflows improve engineering teams",
          priorProbability: 0.45,
          stance: "SUPPORTS",
          notes: ""
        }
      ]
    });
    const source = await services.sources.createSource({
      name: "GitHub default search",
      kind: "GITHUB",
      adapter: "github_repositories",
      credentialRef: undefined,
      credibility: 0.64,
      enabled: true,
      autoConfirm: false,
      autoConfirmThreshold: 0.88
    });

    const run = await services.sources.runSource(source.id, { reviewOnly: true, maxQueries: 1 });

    expect(run.queryCount).toBe(1);
    expect(run.itemCount).toBe(1);
    expect(requestedUrls).toHaveLength(1);
    expect(requestedUrls[0]).toContain("https://api.github.com/search/repositories?q=");
    expect(decodeURIComponent(requestedUrls[0])).toContain("Open-source agentic delivery workflows improve engineering teams");
  });

  it("deduplicates overlapping belief and hypothesis text in generated search queries", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: async () =>
          "<html><head><title>AI agents accelerate engineering teams</title></head><body>AI agents accelerate engineering teams enterprise rollout evidence.</body></html>"
      }
    });
    await services.beliefs.createBelief({
      title: "AI agents accelerate engineering teams",
      category: "AI_TREND",
      description: "Track agent adoption.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "AI agents accelerate engineering teams",
          priorProbability: 0.35,
          stance: "SUPPORTS",
          notes: "AI agents accelerate engineering teams enterprise rollout"
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
      autoConfirm: false,
      autoConfirmThreshold: 0.85
    });

    const loop = await services.automation.runEvidenceLoop({ reviewOnly: true, maxObservations: 1 });
    const query = loop.queries[0].query;

    expect(query.match(/AI agents accelerate engineering teams/g)).toHaveLength(1);
    expect(query).toContain("enterprise rollout");
  });

  it("uses accepted recommendation evidence search queries directly in evidence loop searches", async () => {
    const requestedUrls: string[] = [];
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: async (url) => {
          requestedUrls.push(url);
          return "<html><head><title>AI procurement security review</title></head><body>Security owners require model risk review before procurement approval.</body></html>";
        }
      }
    });
    await services.beliefs.createBelief({
      title: "AI procurement timing",
      category: "AI_TREND",
      description: "Track enterprise procurement timing.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "Security review delays AI procurement",
          priorProbability: 0.41,
          stance: "OPPOSES",
          notes:
            "可观察：安全负责人追加模型风险评估、供应商问卷或法务审查。\n推荐依据：校准失败显示安全审查触发条件被低估。\n证据检索：enterprise AI procurement security owner model risk review delay"
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
      autoConfirm: false,
      autoConfirmThreshold: 0.85
    });

    const loop = await services.automation.runEvidenceLoop({ reviewOnly: true, maxObservations: 1 });

    expect(loop.queries[0].query).toBe("enterprise AI procurement security owner model risk review delay");
    expect(requestedUrls[0]).toBe(
      "https://example.com/search?q=enterprise%20AI%20procurement%20security%20owner%20model%20risk%20review%20delay"
    );
    expect(requestedUrls[0]).not.toContain("推荐依据");
  });

  it("uses structured hypothesis evidence search queries before notes or proposition text", async () => {
    const requestedUrls: string[] = [];
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: async (url) => {
          requestedUrls.push(url);
          return "<html><head><title>Structured query evidence</title></head><body>Structured search query evidence.</body></html>";
        }
      }
    });
    const belief = await services.beliefs.createBelief({
      title: "AI procurement timing",
      category: "AI_TREND",
      description: "Track enterprise procurement timing.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "Security review delays AI procurement",
          priorProbability: 0.41,
          stance: "OPPOSES",
          notes: "可观察：安全负责人追加模型风险评估。",
          evidenceSearchQuery: "enterprise AI procurement structured search query"
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
      autoConfirm: false,
      autoConfirmThreshold: 0.85
    });

    const loop = await services.automation.runEvidenceLoop({ reviewOnly: true, maxObservations: 1 });

    expect(belief.hypotheses[0].evidenceSearchQuery).toBe("enterprise AI procurement structured search query");
    expect(loop.queries[0].query).toBe("enterprise AI procurement structured search query");
    expect(requestedUrls[0]).toBe("https://example.com/search?q=enterprise%20AI%20procurement%20structured%20search%20query");
  });

  it("keeps only one shared prefix when generated query parts add different trailing signals", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: async () =>
          "<html><head><title>AI agents accelerate engineering teams</title></head><body>AI agents accelerate engineering teams acceptance evidence.</body></html>"
      }
    });
    await services.beliefs.createBelief({
      title: "AI agents accelerate engineering teams acceptance-123",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "AI agents accelerate engineering teams acceptance-123",
          priorProbability: 0.35,
          stance: "SUPPORTS",
          notes: "AI agents accelerate engineering teams acceptance evidence"
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
      autoConfirm: false,
      autoConfirmThreshold: 0.85
    });

    const loop = await services.automation.runEvidenceLoop({ reviewOnly: true, maxObservations: 1 });
    const query = loop.queries[0].query;

    expect(query.match(/AI agents accelerate engineering teams/g)).toHaveLength(1);
    expect(query).toContain("acceptance-123");
    expect(query).toContain("evidence");
  });

  it("uses generated hypothesis queries when running a query-template RSS source directly", async () => {
    const requestedUrls: string[] = [];
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: async (url) => {
          requestedUrls.push(url);
          return `<?xml version="1.0"?>
            <rss><channel>
              <item>
                <title>Remote AI product roles grow</title>
                <link>https://example.com/career-query-evidence</link>
                <description>Remote AI product roles grow as teams adopt AI product operations.</description>
              </item>
            </channel></rss>`;
        }
      }
    });
    await services.beliefs.createBelief({
      title: "Career direction",
      category: "CAREER",
      description: "Track career market signals.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "Remote AI product roles grow",
          priorProbability: 0.4,
          stance: "SUPPORTS",
          notes: "market demand"
        }
      ]
    });
    const source = await services.sources.createSource({
      name: "Query RSS",
      kind: "RSS",
      url: "https://news.example/rss?q={query}",
      adapter: "rss_query",
      credentialRef: undefined,
      credibility: 0.75,
      enabled: true,
      autoConfirm: false,
      autoConfirmThreshold: 0.85
    });

    const run = await services.sources.runSource(source.id, {
      reviewOnly: true,
      candidateThreshold: 0.2,
      maxObservations: 1
    });
    const observations = await services.observations.listObservations();

    expect(run).toMatchObject({
      status: "REVIEW_ONLY",
      queryCount: 1,
      itemCount: 1,
      candidateCount: 1,
      reviewCount: 1
    });
    expect(requestedUrls).toHaveLength(1);
    expect(requestedUrls[0]).toContain("Career%20direction");
    expect(requestedUrls[0]).toContain("Remote%20AI%20product%20roles%20grow");
    expect(observations[0].metadata).toMatchObject({
      query: expect.stringContaining("Remote AI product roles grow")
    });
  });

  it("continues an evidence loop when one enabled source fails and another succeeds", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: async (url) => {
          if (url.includes("bad-source")) {
            throw new Error("Source endpoint unavailable");
          }
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
      name: "Bad source",
      kind: "WEB_PAGE",
      url: "https://example.com/bad-source",
      adapter: "web_page",
      credentialRef: undefined,
      credibility: 0.8,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.2
    });
    await services.sources.createSource({
      name: "Good source",
      kind: "WEB_PAGE",
      url: "https://example.com/good-source",
      adapter: "web_page",
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
    const updatedBelief = await services.beliefs.getBelief(belief.id);
    const observations = await services.observations.listObservations();

    expect(loop.sourceRunCount).toBe(2);
    expect(loop.failureCount).toBe(1);
    expect(loop.candidateCount).toBe(1);
    expect(loop.reviewCount).toBe(1);
    expect(loop.runs.map((run) => run.status)).toEqual(expect.arrayContaining(["FAILED", "REVIEW_ONLY"]));
    expect(loop.runs.find((run) => run.status === "FAILED")?.errorMessage).toContain("Source endpoint unavailable");
    expect(observations).toHaveLength(1);
    expect(updatedBelief?.hypotheses[0].currentProbability).toBe(0.35);
  });

  it("skips repeatedly failing sources during automatic evidence loops while preserving explicit runs", async () => {
    let failingFetchCount = 0;
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: async (url) => {
          if (url.includes("flaky-source")) {
            failingFetchCount += 1;
            throw new Error("Source endpoint unavailable");
          }
          return "<html><head><title>AI agents accelerate engineering teams</title></head><body>AI agents accelerate engineering teams by handling routine implementation work.</body></html>";
        }
      }
    });
    await services.beliefs.createBelief({
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
    const flakySource = await services.sources.createSource({
      name: "Flaky source",
      kind: "WEB_PAGE",
      url: "https://example.com/flaky-source",
      adapter: "web_page",
      credentialRef: undefined,
      credibility: 0.8,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.2
    });
    await services.sources.createSource({
      name: "Good source",
      kind: "WEB_PAGE",
      url: "https://example.com/good-source",
      adapter: "web_page",
      credentialRef: undefined,
      credibility: 0.8,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.2
    });

    await services.sources.runSource(flakySource.id, { reviewOnly: true });
    await services.sources.runSource(flakySource.id, { reviewOnly: true });
    await services.sources.runSource(flakySource.id, { reviewOnly: true });
    failingFetchCount = 0;

    const loop = await services.automation.runEvidenceLoop({
      reviewOnly: true,
      maxObservations: 1,
      autoConfirmThreshold: 0.2
    });

    expect(failingFetchCount).toBe(0);
    expect(loop.sourceRunCount).toBe(1);
    expect(loop.failureCount).toBe(0);
    expect(loop.candidateCount).toBe(1);
    expect(loop.skippedSourceCount).toBe(1);
    expect(loop.skippedSources).toEqual([
      expect.objectContaining({
        sourceId: flakySource.id,
        sourceCode: expect.stringMatching(/^S-\d{3}$/),
        sourceName: "Flaky source",
        reason: "CONSECUTIVE_FAILURES",
        consecutiveFailureCount: 3,
        latestError: "Source endpoint unavailable",
        retryAfterAt: expect.any(Date)
      })
    ]);
    expect(loop.runs.every((run) => run.sourceId !== flakySource.id)).toBe(true);

    const explicitLoop = await services.automation.runEvidenceLoop({
      sourceIds: [flakySource.id],
      reviewOnly: true,
      maxObservations: 1,
      autoConfirmThreshold: 0.2
    });

    expect(failingFetchCount).toBe(1);
    expect(explicitLoop.sourceRunCount).toBe(1);
    expect(explicitLoop.failureCount).toBe(1);
    expect(explicitLoop.skippedSourceCount).toBe(0);
    expect(explicitLoop.skippedSources).toEqual([]);
    expect(explicitLoop.runs[0]?.sourceId).toBe(flakySource.id);
  });

  it("persists a diagnostic run when every eligible source is skipped", async () => {
    let fetchCount = 0;
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: async () => {
          fetchCount += 1;
          throw new Error("Source endpoint unavailable");
        }
      }
    });
    await services.beliefs.createBelief({
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
    const flakySource = await services.sources.createSource({
      name: "Flaky source",
      kind: "WEB_PAGE",
      url: "https://example.com/flaky-source",
      adapter: "web_page",
      credentialRef: undefined,
      credibility: 0.8,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.2
    });

    await services.sources.runSource(flakySource.id, { reviewOnly: true });
    await services.sources.runSource(flakySource.id, { reviewOnly: true });
    await services.sources.runSource(flakySource.id, { reviewOnly: true });
    fetchCount = 0;

    const loop = await services.automation.runEvidenceLoop({
      reviewOnly: true,
      maxObservations: 1,
      autoConfirmThreshold: 0.2
    });
    const runs = await services.sources.listRuns();

    expect(fetchCount).toBe(0);
    expect(loop.sourceRunCount).toBe(0);
    expect(loop.skippedSourceCount).toBe(1);
    expect(loop.failureCount).toBe(1);
    expect(loop.runs).toEqual([
      expect.objectContaining({
        sourceId: undefined,
        status: "FAILED",
        itemCount: 0,
        errorMessage: expect.stringContaining("Flaky source")
      })
    ]);
    expect(loop.runs[0]?.errorMessage).toContain("S-001");
    expect(loop.runs[0]?.errorMessage).toContain("CONSECUTIVE_FAILURES");
    expect(runs.at(-1)).toMatchObject({
      id: loop.runs[0]?.id,
      sourceId: undefined,
      status: "FAILED",
      errorMessage: loop.runs[0]?.errorMessage
    });
  });

  it("persists a diagnostic run when an evidence loop has no runnable source", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    await services.beliefs.createBelief({
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

    const loop = await services.automation.runEvidenceLoop({
      reviewOnly: true,
      maxObservations: 1,
      autoConfirmThreshold: 0.2
    });
    const runs = await services.sources.listRuns();

    expect(loop).toMatchObject({
      queryCount: 1,
      sourceRunCount: 0,
      skippedSourceCount: 0,
      itemCount: 0,
      candidateCount: 0,
      failureCount: 1
    });
    expect(loop.runs).toEqual([
      expect.objectContaining({
        sourceId: undefined,
        status: "FAILED",
        itemCount: 0,
        errorMessage: "没有可运行来源：当前没有配置非手动且启用的采集来源。"
      })
    ]);
    expect(runs).toEqual([
      expect.objectContaining({
        id: loop.runs[0]?.id,
        sourceId: undefined,
        status: "FAILED",
        errorMessage: loop.runs[0]?.errorMessage
      })
    ]);
  });

  it("persists a diagnostic run instead of collecting when an evidence loop has no runnable query", async () => {
    let fetchCount = 0;
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: async () => {
          fetchCount += 1;
          return "<html><head><title>Untargeted signal</title></head><body>Untargeted evidence should not be collected without active hypotheses.</body></html>";
        }
      }
    });
    await services.sources.createSource({
      name: "General web source",
      kind: "WEB_PAGE",
      url: "https://example.com/general",
      adapter: "web_page",
      credibility: 0.8,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.8
    });

    const loop = await services.automation.runEvidenceLoop({
      reviewOnly: true,
      maxObservations: 1,
      autoConfirmThreshold: 0.2
    });
    const runs = await services.sources.listRuns();
    const observations = await services.observations.listObservations();

    expect(fetchCount).toBe(0);
    expect(loop).toMatchObject({
      queryCount: 0,
      sourceRunCount: 0,
      skippedSourceCount: 0,
      itemCount: 0,
      candidateCount: 0,
      failureCount: 1
    });
    expect(loop.runs).toEqual([
      expect.objectContaining({
        sourceId: undefined,
        status: "FAILED",
        itemCount: 0,
        queryCount: 0,
        querySummary: [],
        errorMessage: "没有可运行查询：当前没有活跃信念或当前信念下没有活跃/待结算假设。"
      })
    ]);
    expect(runs).toEqual([
      expect.objectContaining({
        id: loop.runs[0]?.id,
        sourceId: undefined,
        status: "FAILED",
        errorMessage: loop.runs[0]?.errorMessage
      })
    ]);
    expect(observations).toEqual([]);
  });

  it("retries repeatedly failing sources after the failure cooldown has elapsed", async () => {
    const requestedUrls: string[] = [];
    const store = createInMemoryWorldModelStore();
    const services = createWorldModelServices(store, {
      sourceAdapterDependencies: {
        fetchText: async (url) => {
          requestedUrls.push(url);
          return "<html><head><title>Recovered source</title></head><body>AI agents accelerate engineering teams after recovery.</body></html>";
        }
      }
    });
    await services.beliefs.createBelief({
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
    const recoveredSource = await services.sources.createSource({
      name: "Recovered source",
      kind: "WEB_PAGE",
      url: "https://example.com/recovered-source",
      adapter: "web_page",
      credentialRef: undefined,
      credibility: 0.8,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.2
    });
    const oldFailureAt = new Date(Date.now() - 7 * 60 * 60 * 1000);
    for (let index = 0; index < 3; index += 1) {
      await store.createObservationRun({
        id: `old_failed_run_${index}`,
        sourceId: recoveredSource.id,
        status: "FAILED",
        startedAt: new Date(oldFailureAt.getTime() + index * 60_000),
        finishedAt: new Date(oldFailureAt.getTime() + index * 60_000 + 1000),
        itemCount: 0,
        reprocessedObservationCount: 0,
        deduplicatedCount: 0,
        candidateCount: 0,
        autoAppliedCount: 0,
        reviewCount: 0,
        lowImpactCount: 0,
        unmatchedCount: 0,
        queryCount: 0,
        querySummary: [],
        errorMessage: "Old fetch command failed"
      });
    }

    const loop = await services.automation.runEvidenceLoop({
      reviewOnly: true,
      maxObservations: 1,
      autoConfirmThreshold: 0.2
    });

    expect(requestedUrls).toContain("https://example.com/recovered-source");
    expect(loop.sourceRunCount).toBe(1);
    expect(loop.failureCount).toBe(0);
    expect(loop.skippedSourceCount).toBe(0);
    expect(loop.runs[0]?.sourceId).toBe(recoveredSource.id);
  });

  it("prioritizes sources without recent failures when automatic loops are source-limited", async () => {
    const requestedUrls: string[] = [];
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: async (url) => {
          requestedUrls.push(url);
          if (url.includes("rate-limited-source")) {
            throw new Error("Fetch failed 429 for https://example.com/rate-limited-source");
          }
          return "<html><head><title>AI agents accelerate engineering teams</title></head><body>AI agents accelerate engineering teams by handling routine implementation work.</body></html>";
        }
      }
    });
    await services.beliefs.createBelief({
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
    const rateLimitedSource = await services.sources.createSource({
      name: "Rate limited source",
      kind: "WEB_PAGE",
      url: "https://example.com/rate-limited-source",
      adapter: "web_page",
      credentialRef: undefined,
      credibility: 0.8,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.2
    });
    const healthySource = await services.sources.createSource({
      name: "Healthy source",
      kind: "WEB_PAGE",
      url: "https://example.com/healthy-source",
      adapter: "web_page",
      credentialRef: undefined,
      credibility: 0.8,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.2
    });
    await services.sources.runSource(rateLimitedSource.id, { reviewOnly: true });
    requestedUrls.length = 0;

    const loop = await services.automation.runEvidenceLoop({
      reviewOnly: true,
      maxSources: 1,
      maxObservations: 1,
      autoConfirmThreshold: 0.2
    });

    expect(loop.sourceRunCount).toBe(1);
    expect(loop.failureCount).toBe(0);
    expect(loop.runs[0]?.sourceId).toBe(healthySource.id);
    expect(requestedUrls).toEqual(["https://example.com/healthy-source"]);
  });

  it("skips low-increment sources during automatic evidence loops while preserving explicit runs", async () => {
    let staleFetchCount = 0;
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: async (url) => {
          if (url.includes("stale-source")) {
            staleFetchCount += 1;
            return "<html><head><title>AI agents accelerate engineering teams</title></head><body>AI agents accelerate engineering teams by handling routine implementation work.</body></html>";
          }
          return "<html><head><title>AI agents accelerate engineering teams</title></head><body>AI agents accelerate engineering teams by resolving implementation tasks.</body></html>";
        }
      }
    });
    await services.beliefs.createBelief({
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
    const staleSource = await services.sources.createSource({
      name: "Stale source",
      kind: "WEB_PAGE",
      url: "https://example.com/stale-source",
      adapter: "web_page",
      credentialRef: undefined,
      credibility: 0.8,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.2
    });
    await services.sources.createSource({
      name: "Good source",
      kind: "WEB_PAGE",
      url: "https://example.com/good-source",
      adapter: "web_page",
      credentialRef: undefined,
      credibility: 0.8,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.2
    });
    await services.observations.createObservation({
      title: "AI agents accelerate engineering teams",
      content: "AI agents accelerate engineering teams by handling routine implementation work.",
      url: "https://example.com/stale-source",
      credibility: 0.8
    });

    await services.sources.runSource(staleSource.id, { reviewOnly: true });
    await services.sources.runSource(staleSource.id, { reviewOnly: true });
    await services.sources.runSource(staleSource.id, { reviewOnly: true });
    staleFetchCount = 0;

    const loop = await services.automation.runEvidenceLoop({
      reviewOnly: true,
      maxObservations: 1,
      autoConfirmThreshold: 0.2
    });

    expect(staleFetchCount).toBe(0);
    expect(loop.sourceRunCount).toBe(1);
    expect(loop.skippedSourceCount).toBe(1);
    expect(loop.skippedSources).toEqual([
      expect.objectContaining({
        sourceId: staleSource.id,
        sourceName: "Stale source",
        reason: "LOW_INCREMENT",
        consecutiveDuplicateOnlyCount: 3,
        retryAfterAt: expect.any(Date)
      })
    ]);
    expect(loop.runs.every((run) => run.sourceId !== staleSource.id)).toBe(true);

    const explicitLoop = await services.automation.runEvidenceLoop({
      sourceIds: [staleSource.id],
      reviewOnly: true,
      maxObservations: 1,
      autoConfirmThreshold: 0.2
    });

    expect(staleFetchCount).toBe(1);
    expect(explicitLoop.sourceRunCount).toBe(1);
    expect(explicitLoop.skippedSourceCount).toBe(0);
    expect(explicitLoop.skippedSources).toEqual([]);
    expect(explicitLoop.runs[0]).toMatchObject({
      sourceId: staleSource.id,
      deduplicatedCount: 1,
      candidateCount: 0
    });
  });

  it("retries low-increment sources after the staleness cooldown has elapsed", async () => {
    const requestedUrls: string[] = [];
    const store = createInMemoryWorldModelStore();
    const services = createWorldModelServices(store, {
      sourceAdapterDependencies: {
        fetchText: async (url) => {
          requestedUrls.push(url);
          return "<html><head><title>Fresh source signal</title></head><body>AI agents accelerate engineering teams with new public evidence.</body></html>";
        }
      }
    });
    await services.beliefs.createBelief({
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
    const recoveredSource = await services.sources.createSource({
      name: "Recovered stale source",
      kind: "WEB_PAGE",
      url: "https://example.com/recovered-stale-source",
      adapter: "web_page",
      credentialRef: undefined,
      credibility: 0.8,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.2
    });
    const oldDuplicateAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
    for (let index = 0; index < 3; index += 1) {
      await store.createObservationRun({
        id: `old_duplicate_run_${index}`,
        sourceId: recoveredSource.id,
        status: "SUCCESS",
        startedAt: new Date(oldDuplicateAt.getTime() + index * 60_000),
        finishedAt: new Date(oldDuplicateAt.getTime() + index * 60_000 + 1000),
        itemCount: 1,
        reprocessedObservationCount: 0,
        deduplicatedCount: 1,
        candidateCount: 0,
        autoAppliedCount: 0,
        reviewCount: 0,
        lowImpactCount: 0,
        unmatchedCount: 0,
        queryCount: 0,
        querySummary: []
      });
    }

    const loop = await services.automation.runEvidenceLoop({
      reviewOnly: true,
      maxObservations: 1,
      autoConfirmThreshold: 0.2
    });

    expect(requestedUrls).toContain("https://example.com/recovered-stale-source");
    expect(loop.sourceRunCount).toBe(1);
    expect(loop.skippedSourceCount).toBe(0);
    expect(loop.runs[0]?.sourceId).toBe(recoveredSource.id);
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
    expect(run.reviewCount).toBe(0);
    expect(run.unmatchedCount).toBe(1);
    expect(observations[0]).toMatchObject({
      status: "UNKNOWN",
      metadata: {
        ignoredReason: "UNMATCHED"
      }
    });
    expect(evidence).toHaveLength(0);
  });

  it("requeues unmatched observations when a new hypothesis matches them", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: async () =>
          "<html><head><title>AI governance procurement delays slow enterprise adoption</title></head><body>AI governance procurement delays slow enterprise adoption across regulated buyers.</body></html>"
      }
    });
    const belief = await services.beliefs.createBelief({
      title: "AI governance adoption",
      category: "AI_TREND",
      description: "Track whether governance platforms become a default enterprise workflow.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "Audit quality improves after governance rollout",
          priorProbability: 0.45,
          stance: "SUPPORTS",
          notes: ""
        }
      ]
    });
    const source = await services.sources.createSource({
      name: "Governance unmatched source",
      kind: "WEB_PAGE",
      url: "https://example.com/governance-procurement",
      adapter: "web_page",
      credentialRef: undefined,
      credibility: 0.8,
      enabled: true,
      autoConfirm: false,
      autoConfirmThreshold: 0.85
    });
    await services.sources.runSource(source.id, { candidateThreshold: 0.9 });
    const [unmatchedObservation] = await services.observations.listObservations();
    expect(unmatchedObservation).toMatchObject({
      status: "UNKNOWN",
      metadata: {
        ignoredReason: "UNMATCHED"
      }
    });

    const hypothesis = await services.beliefs.createHypothesis(belief.id, {
      proposition: "AI governance procurement delays slow enterprise adoption",
      priorProbability: 0.35,
      stance: "OPPOSES",
      notes: "Track procurement cycle time and regulated buyer adoption."
    });
    const [requeuedObservation] = await services.observations.listObservations();
    const evidence = await services.evidence.listEvidence();

    expect(requeuedObservation.status).toBe("PENDING");
    expect(requeuedObservation.metadata.ignoredReason).toBeUndefined();
    expect(requeuedObservation.metadata.reviewReason).toBe("NEW_HYPOTHESIS_MATCH");
    expect(requeuedObservation.metadata.recommendedLinks).toEqual([
      expect.objectContaining({
        hypothesisId: hypothesis.id,
        direction: "SUPPORTS",
        relevance: expect.any(Number),
        likelihoodRatio: expect.any(Number),
        confidence: expect.any(Number),
        rationale: expect.stringContaining("新增假设")
      })
    ]);
    expect(evidence).toHaveLength(0);
  });

  it("requeues the explicit source observation when creating a recommended hypothesis", async () => {
    const store = createInMemoryWorldModelStore();
    const services = createWorldModelServices(store);
    const belief = await services.beliefs.createBelief({
      title: "AI governance adoption",
      category: "AI_TREND",
      description: "Track whether governance platforms become a default enterprise workflow.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "Audit quality improves after governance rollout",
          priorProbability: 0.45,
          stance: "SUPPORTS",
          notes: ""
        }
      ]
    });
    await store.createObservation({
      id: "observation_explicit_source",
      title: "Procurement committee memo",
      content: "Approval stalls in regulated buyers.",
      observedAt: new Date("2026-06-11T08:00:00.000Z"),
      status: "UNKNOWN",
      credibility: 0.8,
      metadata: {
        ignoredReason: "UNMATCHED"
      }
    });

    const hypothesis = await services.beliefs.createHypothesis(belief.id, {
      proposition: "Enterprise workflow adoption slows under governance review",
      priorProbability: 0.35,
      stance: "OPPOSES",
      notes: "Track review latency.",
      sourceObservationId: "observation_explicit_source"
    });
    const updatedObservation = await store.getObservation("observation_explicit_source");

    expect(updatedObservation).toMatchObject({
      status: "PENDING",
      metadata: {
        reviewReason: "RECOMMENDED_HYPOTHESIS_CREATED",
        convertedBeliefId: belief.id,
        convertedHypothesisId: hypothesis.id,
        convertedFromRecommendation: true
      }
    });
    expect(updatedObservation?.metadata.ignoredReason).toBeUndefined();
    expect(updatedObservation?.metadata.convertedAt).toEqual(expect.any(String));
    expect(updatedObservation?.metadata.recommendedLinks).toEqual([
      expect.objectContaining({
        hypothesisId: hypothesis.id,
        direction: "SUPPORTS",
        relevance: expect.any(Number),
        likelihoodRatio: expect.any(Number),
        confidence: expect.any(Number),
        rationale: expect.stringContaining("推荐假设")
      })
    ]);
  });

  it("auto-applies a requeued recommendation observation on the next evidence loop run", async () => {
    const store = createInMemoryWorldModelStore();
    const services = createWorldModelServices(store);
    const belief = await services.beliefs.createBelief({
      title: "AI governance adoption",
      category: "AI_TREND",
      description: "Track whether governance platforms become a default enterprise workflow.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "Audit quality improves after governance rollout",
          priorProbability: 0.45,
          stance: "SUPPORTS",
          notes: ""
        }
      ]
    });
    await store.createObservation({
      id: "observation_requeued_auto",
      title: "Governance procurement review",
      content: "Regulated buyers report that governance procurement reviews are slowing enterprise workflow adoption.",
      observedAt: new Date("2026-06-11T08:00:00.000Z"),
      status: "UNKNOWN",
      credibility: 0.82,
      metadata: {
        ignoredReason: "UNMATCHED"
      }
    });

    const hypothesis = await services.beliefs.createHypothesis(belief.id, {
      proposition: "Governance procurement reviews slow enterprise workflow adoption",
      priorProbability: 0.35,
      stance: "OPPOSES",
      notes: "Track procurement cycle time.",
      sourceObservationId: "observation_requeued_auto"
    });

    const loop = await services.automation.runEvidenceLoop({
      forceAutoApply: true,
      candidateThreshold: 0.2,
      autoConfirmThreshold: 0.2
    });
    const updatedObservation = await store.getObservation("observation_requeued_auto");
    const evidence = await services.evidence.listEvidence();
    const updatedBelief = await services.beliefs.getBelief(belief.id);
    const runs = await services.sources.listRuns();

    expect(loop).toMatchObject({
      sourceRunCount: 0,
      itemCount: 0,
      reprocessedObservationCount: 1,
      candidateCount: 1,
      autoAppliedCount: 1,
      reviewCount: 0,
      failureCount: 0
    });
    expect(updatedObservation?.status).toBe("CONFIRMED");
    expect(evidence).toHaveLength(1);
    expect(evidence[0].links).toEqual([
      expect.objectContaining({
        hypothesisId: hypothesis.id,
        relevance: expect.any(Number),
        likelihoodRatio: expect.any(Number),
        confidence: expect.any(Number)
      })
    ]);
    expect(updatedBelief?.hypotheses.find((item) => item.id === hypothesis.id)?.currentProbability).toBeGreaterThan(0.35);
    expect(runs[0]).toMatchObject({
      sourceId: undefined,
      status: "SUCCESS",
      reprocessedObservationCount: 1,
      autoAppliedCount: 1
    });
  });

  it("reprocesses queued observations even when no new evidence queries are runnable", async () => {
    const store = createInMemoryWorldModelStore();
    const services = createWorldModelServices(store);
    const belief = await services.beliefs.createBelief({
      title: "Future governance window",
      category: "AI_TREND",
      description: "Track a future evaluation window without running searches yet.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "Governance review begins next quarter",
          priorProbability: 0.45,
          stance: "SUPPORTS",
          notes: "",
          startsAt: new Date("2099-01-01T00:00:00.000Z")
        }
      ]
    });
    await store.createObservation({
      id: "observation_queued_no_queries",
      title: "Queued governance signal",
      content: "This queued signal should remain available for manual review.",
      observedAt: new Date("2026-06-11T08:00:00.000Z"),
      status: "PENDING",
      credibility: 0.82,
      metadata: {
        recommendedLinks: [
          {
            hypothesisId: belief.hypotheses[0].id,
            direction: "SUPPORTS",
            relevance: 0.8,
            likelihoodRatio: 1.7,
            confidence: 0.7,
            rationale: "Queued before the future hypothesis becomes searchable."
          }
        ]
      }
    });

    const loop = await services.automation.runEvidenceLoop({
      reviewOnly: true,
      candidateThreshold: 0.2,
      autoConfirmThreshold: 0.2
    });
    const runs = await services.sources.listRuns();

    expect(loop).toMatchObject({
      queryCount: 0,
      sourceRunCount: 0,
      itemCount: 0,
      reprocessedObservationCount: 1,
      candidateCount: 1,
      autoAppliedCount: 0,
      reviewCount: 1,
      failureCount: 0
    });
    expect(loop.runs[0]).toMatchObject({
      sourceId: undefined,
      status: "REVIEW_ONLY",
      queryCount: 0,
      reprocessedObservationCount: 1,
      reviewCount: 1
    });
    expect(runs[0]).toMatchObject({
      sourceId: undefined,
      status: "REVIEW_ONLY",
      queryCount: 0,
      reprocessedObservationCount: 1,
      reviewCount: 1
    });
  });

  it("records a failed reprocessing run instead of aborting the evidence loop", async () => {
    const store = createInMemoryWorldModelStore();
    const services = createWorldModelServices(store);
    await services.beliefs.createBelief({
      title: "AI governance adoption",
      category: "AI_TREND",
      description: "Track whether governance platforms become a default enterprise workflow.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "Audit quality improves after governance rollout",
          priorProbability: 0.45,
          stance: "SUPPORTS",
          notes: ""
        }
      ]
    });
    await store.createObservation({
      id: "observation_broken_requeued",
      title: "Governance procurement review",
      content: "Regulated buyers report that governance procurement reviews are slowing enterprise workflow adoption.",
      observedAt: new Date("2026-06-11T08:00:00.000Z"),
      status: "PENDING",
      credibility: 0.82,
      metadata: {
        recommendedLinks: [
          {
            hypothesisId: "hypothesis_missing",
            direction: "SUPPORTS",
            relevance: 0.9,
            likelihoodRatio: 2.4,
            confidence: 0.9,
            rationale: "Stale queued candidate."
          }
        ]
      }
    });

    const loop = await services.automation.runEvidenceLoop({
      forceAutoApply: true,
      candidateThreshold: 0.2,
      autoConfirmThreshold: 0.2
    });
    const runs = await services.sources.listRuns();

    expect(loop).toMatchObject({
      sourceRunCount: 0,
      itemCount: 0,
      reprocessedObservationCount: 1,
      candidateCount: 0,
      autoAppliedCount: 0,
      reviewCount: 0,
      failureCount: 1
    });
    expect(loop.runs[0]).toMatchObject({
      sourceId: undefined,
      status: "FAILED",
      reprocessedObservationCount: 1,
      errorMessage: expect.stringContaining("Hypothesis not found")
    });
    expect(runs[0]).toMatchObject({
      sourceId: undefined,
      status: "FAILED",
      reprocessedObservationCount: 1,
      errorMessage: expect.stringContaining("Hypothesis not found")
    });
  });

  it("auto-applies a requeued recommendation observation when the evidence loop is scoped to its source", async () => {
    const store = createInMemoryWorldModelStore();
    const services = createWorldModelServices(store);
    const source = await services.sources.createSource({
      name: "Scoped social source",
      kind: "SOCIAL",
      adapter: "social",
      credibility: 0.82,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.2
    });
    const belief = await services.beliefs.createBelief({
      title: "AI governance adoption",
      category: "AI_TREND",
      description: "Track whether governance platforms become a default enterprise workflow.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "Audit quality improves after governance rollout",
          priorProbability: 0.45,
          stance: "SUPPORTS",
          notes: ""
        }
      ]
    });
    await store.createObservation({
      id: "observation_source_scoped_requeued",
      sourceId: source.id,
      title: "Governance procurement review",
      content: "Regulated buyers report that governance procurement reviews are slowing enterprise workflow adoption.",
      observedAt: new Date("2026-06-11T08:00:00.000Z"),
      status: "UNKNOWN",
      credibility: 0.82,
      metadata: {
        ignoredReason: "UNMATCHED"
      }
    });

    const hypothesis = await services.beliefs.createHypothesis(belief.id, {
      proposition: "Governance procurement reviews slow enterprise workflow adoption",
      priorProbability: 0.35,
      stance: "OPPOSES",
      notes: "Track procurement cycle time.",
      sourceObservationId: "observation_source_scoped_requeued"
    });

    const loop = await services.automation.runEvidenceLoop({
      sourceIds: [source.id],
      forceAutoApply: true,
      candidateThreshold: 0.2,
      autoConfirmThreshold: 0.2
    });
    const updatedObservation = await store.getObservation("observation_source_scoped_requeued");
    const evidence = await services.evidence.listEvidence();
    const updatedBelief = await services.beliefs.getBelief(belief.id);

    expect(loop).toMatchObject({
      sourceRunCount: 1,
      itemCount: 0,
      reprocessedObservationCount: 1,
      candidateCount: 1,
      autoAppliedCount: 1,
      reviewCount: 0,
      failureCount: 0
    });
    expect(updatedObservation?.status).toBe("CONFIRMED");
    expect(evidence).toHaveLength(1);
    expect(evidence[0].links).toEqual([
      expect.objectContaining({
        hypothesisId: hypothesis.id,
        relevance: expect.any(Number),
        likelihoodRatio: expect.any(Number),
        confidence: expect.any(Number)
      })
    ]);
    expect(updatedBelief?.hypotheses.find((item) => item.id === hypothesis.id)?.currentProbability).toBeGreaterThan(0.35);
  });

  it("reprocesses only queued recommendation observations that target scoped beliefs", async () => {
    const store = createInMemoryWorldModelStore();
    const services = createWorldModelServices(store);
    const targetBelief = await services.beliefs.createBelief({
      title: "AI governance adoption",
      category: "AI_TREND",
      description: "Track whether governance platforms become a default enterprise workflow.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "Procurement reviews slow governance rollout",
          priorProbability: 0.35,
          stance: "OPPOSES",
          notes: ""
        }
      ]
    });
    const otherBelief = await services.beliefs.createBelief({
      title: "Developer agent adoption",
      category: "AI_TREND",
      description: "Track whether developer agents become a routine engineering tool.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "Developer agents shorten implementation cycles",
          priorProbability: 0.4,
          stance: "SUPPORTS",
          notes: ""
        }
      ]
    });
    const targetHypothesis = targetBelief.hypotheses[0];
    const otherHypothesis = otherBelief.hypotheses[0];
    await store.createObservation({
      id: "observation_target_belief_requeued",
      title: "Governance procurement review",
      content: "Regulated buyers report that governance procurement reviews are slowing enterprise workflow adoption.",
      observedAt: new Date("2026-06-11T08:00:00.000Z"),
      status: "PENDING",
      credibility: 0.82,
      metadata: {
        recommendedLinks: [
          {
            hypothesisId: targetHypothesis.id,
            direction: "OPPOSES",
            relevance: 0.82,
            likelihoodRatio: 2.2,
            confidence: 0.82,
            rationale: "Scoped belief candidate"
          }
        ],
        reviewReason: "SOURCE_REQUIRES_REVIEW"
      }
    });
    await store.createObservation({
      id: "observation_other_belief_requeued",
      title: "Developer agent delivery metric",
      content: "Engineering teams report that developer agents are shortening implementation cycles.",
      observedAt: new Date("2026-06-11T08:05:00.000Z"),
      status: "PENDING",
      credibility: 0.8,
      metadata: {
        recommendedLinks: [
          {
            hypothesisId: otherHypothesis.id,
            direction: "SUPPORTS",
            relevance: 0.8,
            likelihoodRatio: 2.1,
            confidence: 0.8,
            rationale: "Out-of-scope belief candidate"
          }
        ],
        reviewReason: "SOURCE_REQUIRES_REVIEW"
      }
    });

    const loop = await services.automation.runEvidenceLoop({
      beliefIds: [targetBelief.id],
      forceAutoApply: true,
      candidateThreshold: 0.2,
      autoConfirmThreshold: 0.2
    });
    const targetObservation = await store.getObservation("observation_target_belief_requeued");
    const otherObservation = await store.getObservation("observation_other_belief_requeued");
    const evidence = await services.evidence.listEvidence();

    expect(loop).toMatchObject({
      sourceRunCount: 0,
      reprocessedObservationCount: 1,
      candidateCount: 1,
      autoAppliedCount: 1,
      reviewCount: 0,
      failureCount: 0
    });
    expect(targetObservation?.status).toBe("CONFIRMED");
    expect(otherObservation?.status).toBe("PENDING");
    expect(evidence).toHaveLength(1);
    expect(evidence[0].links).toEqual([
      expect.objectContaining({
        hypothesisId: targetHypothesis.id
      })
    ]);
  });

  it("requeues the explicit source observation when creating a new belief table from it", async () => {
    const store = createInMemoryWorldModelStore();
    const services = createWorldModelServices(store);
    await store.createObservation({
      id: "observation_new_topic",
      title: "New enterprise agent signal",
      content: "Buyers report that agent platforms are becoming a required workflow.",
      observedAt: new Date("2026-06-11T08:00:00.000Z"),
      status: "UNKNOWN",
      credibility: 0.76,
      metadata: {
        ignoredReason: "UNMATCHED"
      }
    });

    const belief = await services.beliefs.createBelief({
      title: "New enterprise agent signal",
      category: "AI_TREND",
      description: "Buyers report that agent platforms are becoming a required workflow.",
      probabilityMode: "INDEPENDENT",
      sourceObservationId: "observation_new_topic",
      hypotheses: [
        {
          proposition: "New enterprise agent signal 会持续影响这个判断",
          priorProbability: 0.45,
          stance: "SUPPORTS",
          notes: ""
        },
        {
          proposition: "New enterprise agent signal 的影响有限或不可持续",
          priorProbability: 0.35,
          stance: "OPPOSES",
          notes: ""
        }
      ]
    });
    const updatedObservation = await store.getObservation("observation_new_topic");

    expect(updatedObservation).toMatchObject({
      status: "PENDING",
      metadata: {
        reviewReason: "RECOMMENDED_HYPOTHESIS_CREATED",
        convertedBeliefId: belief.id,
        convertedHypothesisId: belief.hypotheses[0].id,
        convertedHypothesisIds: [belief.hypotheses[0].id, belief.hypotheses[1].id],
        convertedFromRecommendation: true
      }
    });
    expect(updatedObservation?.metadata.ignoredReason).toBeUndefined();
    expect(updatedObservation?.metadata.convertedAt).toEqual(expect.any(String));
    expect(updatedObservation?.metadata.recommendedLinks).toEqual([
      expect.objectContaining({
        hypothesisId: belief.hypotheses[0].id,
        direction: "SUPPORTS",
        relevance: expect.any(Number),
        likelihoodRatio: expect.any(Number),
        confidence: expect.any(Number),
        rationale: expect.stringContaining("推荐假设")
      }),
      expect.objectContaining({
        hypothesisId: belief.hypotheses[1].id,
        direction: "OPPOSES",
        relevance: expect.any(Number),
        likelihoodRatio: expect.any(Number),
        confidence: expect.any(Number),
        rationale: expect.stringContaining("推荐假设")
      })
    ]);
  });

  it("records a failed run if the source disappears before the run record is saved", async () => {
    const store = createInMemoryWorldModelStore();
    const createObservationRun = store.createObservationRun;
    store.createObservationRun = async (input) => {
      if (input.sourceId) {
        throw new Error("Foreign key constraint violated on ObservationRun_sourceId_fkey");
      }
      return createObservationRun(input);
    };
    const services = createWorldModelServices(store, {
      sourceAdapterDependencies: {
        fetchText: async () =>
          "<html><head><title>AI agents accelerate engineering teams</title></head><body>AI agents accelerate engineering teams by handling routine implementation work.</body></html>"
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
      name: "Ephemeral source",
      kind: "WEB_PAGE",
      url: "https://example.com/ephemeral",
      adapter: "web_page",
      credibility: 0.8,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.2
    });

    const run = await services.sources.runSource(source.id);

    expect(run.status).toBe("FAILED");
    expect(run.sourceId).toBeUndefined();
    expect(run.errorMessage).toContain("ObservationRun_sourceId_fkey");
    await expect(services.sources.listRuns()).resolves.toEqual([run]);
  });

  it("does not recommend source observations for expired hypotheses", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: async () =>
          "<html><head><title>Expired governance pilot dominates audit workflows</title></head><body>Expired governance pilot dominates audit workflows across the organization.</body></html>"
      }
    });
    const belief = await services.beliefs.createBelief({
      title: "AI governance",
      category: "AI_TREND",
      description: "Track governance adoption.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "Expired governance pilot dominates audit workflows",
          priorProbability: 0.35,
          stance: "SUPPORTS",
          notes: "expired signal",
          expiresAt: new Date(Date.now() - 60_000)
        },
        {
          proposition: "Current compliance platform pricing changes procurement timing",
          priorProbability: 0.35,
          stance: "SUPPORTS",
          notes: "current signal"
        }
      ]
    });
    const source = await services.sources.createSource({
      name: "Governance page",
      kind: "WEB_PAGE",
      url: "https://example.com/governance",
      adapter: "web_page",
      credentialRef: undefined,
      credibility: 0.8,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.2
    });

    const run = await services.sources.runSource(source.id, { candidateThreshold: 0.2 });
    const evidence = await services.evidence.listEvidence();
    const updatedBelief = await services.beliefs.getBelief(belief.id);

    expect(run.status).toBe("SUCCESS");
    expect(run.candidateCount).toBe(0);
    expect(run.autoAppliedCount).toBe(0);
    expect(run.reviewCount).toBe(0);
    expect(run.unmatchedCount).toBe(1);
    expect(evidence).toHaveLength(0);
    expect(updatedBelief?.hypotheses[0].currentProbability).toBe(0.35);
  });

  it("collects settlement review observations for expired active hypotheses without auto-applying probability updates", async () => {
    const fetchedUrls: string[] = [];
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: async (url) => {
          fetchedUrls.push(url);
          return [
            "<html><head><title>Governance pilot final outcome</title></head>",
            "<body>The governance pilot ended and the final rollout outcome is ready for review.</body></html>"
          ].join("");
        }
      }
    });
    const belief = await services.beliefs.createBelief({
      title: "Governance pilot settlement",
      category: "AI_TREND",
      description: "Track whether the governance pilot becomes the default audit workflow.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "The governance pilot becomes the default audit workflow",
          priorProbability: 0.72,
          currentProbability: 0.72,
          stance: "SUPPORTS",
          notes: "pilot default audit workflow",
          expiresAt: new Date(Date.now() - 60_000),
          expiryCondition: "The pilot review window closes."
        }
      ]
    });
    await services.sources.createSource({
      name: "Settlement search",
      kind: "WEB_PAGE",
      url: "https://example.com/search?q={query}",
      adapter: "web_page",
      credibility: 0.82,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.2
    });

    const loop = await services.automation.runEvidenceLoop({
      forceAutoApply: true,
      candidateThreshold: 0.2,
      autoConfirmThreshold: 0.2
    });
    const observations = await services.observations.listObservations();
    const evidence = await services.evidence.listEvidence();
    const updatedBelief = await services.beliefs.getBelief(belief.id);

    expect(fetchedUrls).toHaveLength(1);
    expect(fetchedUrls[0]).toContain("final%20outcome");
    expect(loop).toMatchObject({
      queryCount: 1,
      sourceRunCount: 1,
      reviewCount: 1,
      candidateCount: 0,
      autoAppliedCount: 0,
      failureCount: 0
    });
    expect(loop.queries[0]).toMatchObject({
      beliefId: belief.id,
      hypothesisId: belief.hypotheses[0].id,
      purpose: "SETTLEMENT_REVIEW",
      settlementDue: true,
      priority: 1
    });
    expect(observations[0]).toMatchObject({
      status: "PENDING",
      metadata: {
        queryPurpose: "SETTLEMENT_REVIEW",
        querySettlementDue: true,
        reviewReason: "SETTLEMENT_REVIEW",
        settlementBeliefId: belief.id,
        settlementHypothesisId: belief.hypotheses[0].id
      }
    });
    expect(evidence).toHaveLength(0);
    expect(updatedBelief?.hypotheses[0].currentProbability).toBe(0.72);
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

  it("passes observed and published timestamps from source observations into the LLM scorer", async () => {
    const capturedInputs: Array<Record<string, unknown>> = [];
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: async () =>
          [
            "<rss><channel>",
            "<item>",
            "<title>AI agents accelerate engineering teams</title>",
            "<description>AI agents accelerate engineering teams after the June release.</description>",
            "<link>https://example.com/timed-agent-evidence</link>",
            "<pubDate>Wed, 17 Jun 2026 12:00:00 GMT</pubDate>",
            "</item>",
            "</channel></rss>"
          ].join("")
      },
      likelihoodEstimator: {
        name: "llm",
        async estimate(input) {
          capturedInputs.push(input as unknown as Record<string, unknown>);
          return {
            estimator: "llm",
            direction: "SUPPORTS",
            relevance: 0.86,
            likelihoodRatio: 2.2,
            confidence: 0.82,
            weight: 3,
            rationale: "The timed source observation supports the hypothesis.",
            modelVersion: "test-llm",
            abstain: false
          };
        }
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
      name: "Timed RSS source",
      kind: "RSS",
      url: "https://example.com/feed.xml",
      adapter: "rss",
      credentialRef: undefined,
      credibility: 0.8,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.7
    });

    await services.sources.runSource(source.id);

    expect(capturedInputs).toHaveLength(1);
    expect(capturedInputs[0].evidencePublishedAt).toEqual(new Date("2026-06-17T12:00:00.000Z"));
    expect(capturedInputs[0].evidenceObservedAt).toBeInstanceOf(Date);
    expect(Number.isFinite((capturedInputs[0].evidenceObservedAt as Date).getTime())).toBe(true);
    expect((await services.evidence.listEvidence())[0].links[0].hypothesisId).toBe(belief.hypotheses[0].id);
  });

  it("uses the LLM scorer to recover semantic candidates that lexical matching would miss", async () => {
    let estimateCalls = 0;
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: async () =>
          "<html><head><title>Zettelkasten workflow improves recall</title></head><body>A durable note network helped the team retrieve prior decisions and refine weekly commitments.</body></html>"
      },
      likelihoodEstimator: {
        name: "llm",
        estimate: async () => {
          estimateCalls += 1;
          return {
            estimator: "llm",
            direction: "SUPPORTS",
            relevance: 0.82,
            likelihoodRatio: 2.4,
            confidence: 0.78,
            weight: 3,
            rationale: "The evidence semantically supports building a reusable personal knowledge system.",
            modelVersion: "deepseek:deepseek-chat",
            abstain: false
          };
        }
      }
    });
    const belief = await services.beliefs.createBelief({
      title: "长期职业杠杆",
      category: "CAREER",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "建立可复用的个人知识系统会提升长期决策质量",
          priorProbability: 0.4,
          stance: "SUPPORTS",
          notes: ""
        }
      ]
    });
    const source = await services.sources.createSource({
      name: "Knowledge workflow page",
      kind: "WEB_PAGE",
      url: "https://example.com/knowledge-workflow",
      adapter: "web_page",
      credentialRef: undefined,
      credibility: 0.8,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.7
    });

    const run = await services.sources.runSource(source.id, { candidateThreshold: 0.25 });
    const evidence = await services.evidence.listEvidence();
    const updatedBelief = await services.beliefs.getBelief(belief.id);

    expect(estimateCalls).toBe(1);
    expect(run.candidateCount).toBe(1);
    expect(run.autoAppliedCount).toBe(1);
    expect(evidence[0].links[0]).toMatchObject({
      hypothesisId: belief.hypotheses[0].id,
      relevance: 0.82,
      likelihoodRatio: 2.4,
      confidence: 0.78
    });
    expect(updatedBelief?.hypotheses[0].currentProbability).toBeGreaterThan(0.4);
  });

  it("records LLM candidate diagnostics when semantic scoring abstains without matches", async () => {
    let estimateCalls = 0;
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: async () =>
          "<html><head><title>Zettelkasten workflow improves recall</title></head><body>A durable note network helped a team retrieve prior decisions.</body></html>"
      },
      likelihoodEstimator: {
        name: "llm",
        estimate: async () => {
          estimateCalls += 1;
          return {
            estimator: "llm",
            weight: 3,
            abstain: true,
            rationale: "LLM scorer is temporarily unavailable.",
            modelVersion: "deepseek:deepseek-chat"
          };
        }
      }
    });
    await services.beliefs.createBelief({
      title: "长期职业杠杆",
      category: "CAREER",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "建立可复用的个人知识系统会提升长期决策质量",
          priorProbability: 0.4,
          stance: "SUPPORTS",
          notes: ""
        }
      ]
    });
    const source = await services.sources.createSource({
      name: "Knowledge workflow page",
      kind: "WEB_PAGE",
      url: "https://example.com/knowledge-workflow-abstain",
      adapter: "web_page",
      credentialRef: undefined,
      credibility: 0.8,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.7
    });

    const run = await services.sources.runSource(source.id, { candidateThreshold: 0.25 });
    const observations = await services.observations.listObservations();

    expect(estimateCalls).toBe(1);
    expect(run.unmatchedCount).toBe(1);
    expect(observations[0]).toMatchObject({
      status: "UNKNOWN",
      metadata: {
        ignoredReason: "UNMATCHED",
        candidateEvaluation: {
          estimator: "llm",
          attemptedCount: 1,
          usableCount: 0,
          abstainedCount: 1,
          rejectedCount: 0,
          latestRationale: "LLM scorer is temporarily unavailable."
        }
      }
    });
  });

  it("reprocesses LLM-abstained unmatched observations during evidence loops", async () => {
    let estimateCalls = 0;
    const store = createInMemoryWorldModelStore();
    const services = createWorldModelServices(store, {
      likelihoodEstimator: {
        name: "llm",
        estimate: async () => {
          estimateCalls += 1;
          return {
            estimator: "llm",
            direction: "SUPPORTS",
            relevance: 0.86,
            likelihoodRatio: 2.6,
            confidence: 0.9,
            weight: 3,
            rationale: "Recovered scorer now links this observation to the hypothesis.",
            modelVersion: "deepseek:deepseek-chat",
            abstain: false
          };
        }
      }
    });
    const belief = await services.beliefs.createBelief({
      title: "长期职业杠杆",
      category: "CAREER",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "建立可复用的个人知识系统会提升长期决策质量",
          priorProbability: 0.4,
          stance: "SUPPORTS",
          notes: ""
        }
      ]
    });
    const observation = await services.observations.createObservation({
      title: "Zettelkasten workflow improves recall",
      content: "A durable note network helped a team retrieve prior decisions and improve long-term decision quality.",
      credibility: 0.8
    });
    await store.updateObservation(observation.id, {
      status: "UNKNOWN",
      metadata: {
        ignoredReason: "UNMATCHED",
        candidateEvaluation: {
          estimator: "llm",
          attemptedCount: 1,
          usableCount: 0,
          abstainedCount: 1,
          rejectedCount: 0,
          latestRationale: "LLM scorer is temporarily unavailable."
        }
      }
    });

    const loop = await services.automation.runEvidenceLoop({
      forceAutoApply: true,
      autoConfirmThreshold: 0.7,
      candidateThreshold: 0.25
    });
    const observations = await services.observations.listObservations();
    const evidence = await services.evidence.listEvidence();
    const updatedBelief = await services.beliefs.getBelief(belief.id);
    const runs = await services.sources.listRuns();

    expect(estimateCalls).toBe(1);
    expect(loop).toMatchObject({
      sourceRunCount: 0,
      itemCount: 0,
      reprocessedObservationCount: 1,
      candidateCount: 1,
      autoAppliedCount: 1,
      reviewCount: 0,
      lowImpactCount: 0,
      unmatchedCount: 0,
      failureCount: 0
    });
    expect(observations[0].status).toBe("CONFIRMED");
    expect(evidence[0].links[0]).toMatchObject({
      hypothesisId: belief.hypotheses[0].id,
      relevance: 0.86,
      likelihoodRatio: 2.6,
      confidence: 0.9
    });
    expect(runs[0]).toMatchObject({
      sourceId: undefined,
      status: "SUCCESS",
      itemCount: 0,
      reprocessedObservationCount: 1,
      candidateCount: 1,
      autoAppliedCount: 1,
      reviewCount: 0,
      lowImpactCount: 0,
      unmatchedCount: 0
    });
    expect(updatedBelief?.hypotheses[0].currentProbability).toBeGreaterThan(0.4);
  });

  it("prioritizes scoped retryable unmatched observations before applying max observation limits", async () => {
    const estimatedEvidence: string[] = [];
    const store = createInMemoryWorldModelStore();
    const services = createWorldModelServices(store, {
      likelihoodEstimator: {
        name: "llm",
        estimate: async (input) => {
          estimatedEvidence.push(input.evidenceText);
          if (input.evidenceText.includes("Zettelkasten")) {
            return {
              estimator: "llm",
              direction: "SUPPORTS",
              relevance: 0.86,
              likelihoodRatio: 2.6,
              confidence: 0.9,
              weight: 3,
              rationale: "Recovered scorer links this observation to the scoped belief.",
              modelVersion: "deepseek:deepseek-chat",
              abstain: false
            };
          }
          return {
            estimator: "llm",
            weight: 3,
            abstain: true,
            rationale: "The observation is unrelated to the scoped belief.",
            modelVersion: "deepseek:deepseek-chat"
          };
        }
      }
    });
    const belief = await services.beliefs.createBelief({
      title: "长期职业杠杆",
      category: "CAREER",
      description: "判断个人知识系统是否提升长期决策质量。",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "建立可复用的个人知识系统会提升长期决策质量",
          priorProbability: 0.4,
          stance: "SUPPORTS",
          notes: ""
        }
      ]
    });
    const unrelated = await services.observations.createObservation({
      title: "GPU supply chain pricing shifts",
      content: "Foundry pricing changes affect data center margins.",
      credibility: 0.8
    });
    const related = await services.observations.createObservation({
      title: "Zettelkasten personal knowledge system improves decisions",
      content: "A reusable personal knowledge system helped a team retrieve prior decisions and improve long-term decision quality.",
      credibility: 0.8
    });
    const retryableMetadata = {
      ignoredReason: "UNMATCHED",
      candidateEvaluation: {
        estimator: "llm",
        attemptedCount: 1,
        usableCount: 0,
        abstainedCount: 1,
        rejectedCount: 0,
        latestRationale: "LLM scorer was temporarily unavailable."
      }
    };
    await store.updateObservation(unrelated.id, { status: "UNKNOWN", metadata: retryableMetadata });
    await store.updateObservation(related.id, {
      status: "UNKNOWN",
      metadata: {
        ...retryableMetadata,
        query: "长期职业杠杆 建立可复用的个人知识系统会提升长期决策质量"
      }
    });

    const loop = await services.automation.runEvidenceLoop({
      beliefIds: [belief.id],
      forceAutoApply: true,
      autoConfirmThreshold: 0.7,
      candidateThreshold: 0.25,
      maxObservations: 1
    });
    const observations = await services.observations.listObservations();
    const evidence = await services.evidence.listEvidence();

    expect(estimatedEvidence).toHaveLength(1);
    expect(estimatedEvidence[0]).toContain("Zettelkasten");
    expect(loop.reprocessedObservationCount).toBe(1);
    expect(loop.autoAppliedCount).toBe(1);
    expect(evidence[0].observationId).toBe(related.id);
    expect(observations.find((observation) => observation.id === unrelated.id)?.status).toBe("UNKNOWN");
    expect(observations.find((observation) => observation.id === related.id)?.status).toBe("CONFIRMED");
  });

  it("keeps LLM semantic fallback candidates even when a weak lexical candidate exists", async () => {
    const scoredHypotheses: string[] = [];
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: async () =>
          "<html><head><title>Zettelkasten workflow improves recall</title></head><body>A durable note network helped the team retrieve prior decisions and refine weekly commitments.</body></html>"
      },
      likelihoodEstimator: {
        name: "llm",
        estimate: async (input) => {
          scoredHypotheses.push(input.hypothesis);
          if (input.hypothesis.includes("个人知识系统")) {
            return {
              estimator: "llm",
              direction: "SUPPORTS",
              relevance: 0.84,
              likelihoodRatio: 2.5,
              confidence: 0.8,
              weight: 3,
              rationale: "The note network evidence supports the personal knowledge system hypothesis.",
              modelVersion: "deepseek:deepseek-chat",
              abstain: false
            };
          }
          return {
            estimator: "llm",
            direction: "NEUTRAL",
            relevance: 0.08,
            likelihoodRatio: 1,
            confidence: 0.72,
            weight: 3,
            rationale: "The lexical overlap is incidental and not evidence for weekly commitments.",
            modelVersion: "deepseek:deepseek-chat",
            abstain: false
          };
        }
      }
    });
    await services.beliefs.createBelief({
      title: "Execution rituals",
      category: "CAREER",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "Weekly commitments are the strongest predictor of career growth",
          priorProbability: 0.35,
          stance: "SUPPORTS",
          notes: ""
        }
      ]
    });
    const semanticBelief = await services.beliefs.createBelief({
      title: "长期职业杠杆",
      category: "CAREER",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "建立可复用的个人知识系统会提升长期决策质量",
          priorProbability: 0.4,
          stance: "SUPPORTS",
          notes: ""
        }
      ]
    });
    const source = await services.sources.createSource({
      name: "Knowledge workflow page",
      kind: "WEB_PAGE",
      url: "https://example.com/knowledge-workflow-shadowed",
      adapter: "web_page",
      credentialRef: undefined,
      credibility: 0.8,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.7
    });

    const run = await services.sources.runSource(source.id, { candidateThreshold: 0.25 });
    const evidence = await services.evidence.listEvidence();
    const updatedBelief = await services.beliefs.getBelief(semanticBelief.id);

    expect(scoredHypotheses).toEqual(
      expect.arrayContaining([
        "Weekly commitments are the strongest predictor of career growth",
        "建立可复用的个人知识系统会提升长期决策质量"
      ])
    );
    expect(run.candidateCount).toBe(1);
    expect(run.autoAppliedCount).toBe(1);
    expect(evidence[0].links[0]).toMatchObject({
      hypothesisId: semanticBelief.hypotheses[0].id,
      relevance: 0.84,
      likelihoodRatio: 2.5,
      confidence: 0.8
    });
    expect(updatedBelief?.hypotheses[0].currentProbability).toBeGreaterThan(0.4);
  });

  it("auto-links one source observation to multiple hypotheses under the same belief", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: async () =>
          "<html><head><title>AI agents accelerate engineering teams</title></head><body>AI agents accelerate engineering teams and reduce manual QA work.</body></html>"
      },
      likelihoodEstimator: {
        name: "llm",
        estimate: async (input) => {
          if (input.hypothesis.includes("manual QA")) {
            return {
              estimator: "llm",
              direction: "SUPPORTS",
              relevance: 0.78,
              likelihoodRatio: 1.9,
              confidence: 0.76,
              weight: 3,
              rationale: "The evidence separately supports reduced manual QA work.",
              modelVersion: "deepseek:deepseek-chat",
              abstain: false
            };
          }
          return {
            estimator: "llm",
            direction: "SUPPORTS",
            relevance: 0.86,
            likelihoodRatio: 2.6,
            confidence: 0.82,
            weight: 3,
            rationale: "The evidence supports acceleration for engineering teams.",
            modelVersion: "deepseek:deepseek-chat",
            abstain: false
          };
        }
      }
    });
    const belief = await services.beliefs.createBelief({
      title: "AI agents",
      category: "AI_TREND",
      description: "Track practical agent adoption.",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "AI agents accelerate engineering teams",
          priorProbability: 0.35,
          stance: "SUPPORTS",
          notes: ""
        },
        {
          proposition: "AI agents reduce manual QA work",
          priorProbability: 0.3,
          stance: "SUPPORTS",
          notes: ""
        }
      ]
    });
    const source = await services.sources.createSource({
      name: "Agent multi-hypothesis page",
      kind: "WEB_PAGE",
      url: "https://example.com/agent-multi",
      adapter: "web_page",
      credentialRef: undefined,
      credibility: 0.8,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.5
    });

    const run = await services.sources.runSource(source.id);
    const evidence = await services.evidence.listEvidence();
    const likelihoodRuns = await services.likelihood.listRuns();
    const updates = await services.updates.listEvents();
    const updatedBelief = await services.beliefs.getBelief(belief.id);

    expect(run.candidateCount).toBe(1);
    expect(run.autoAppliedCount).toBe(1);
    expect(evidence).toHaveLength(1);
    expect(evidence[0].links).toHaveLength(2);
    expect(evidence[0].links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          hypothesisId: belief.hypotheses[0].id,
          likelihoodRatio: 2.6,
          confidence: 0.82
        }),
        expect.objectContaining({
          hypothesisId: belief.hypotheses[1].id,
          likelihoodRatio: 1.9,
          confidence: 0.76
        })
      ])
    );
    expect(likelihoodRuns).toHaveLength(2);
    expect(likelihoodRuns.map((item) => item.hypothesisId)).toEqual(
      expect.arrayContaining([belief.hypotheses[0].id, belief.hypotheses[1].id])
    );
    expect(updates[0].likelihoodRunIds).toHaveLength(2);
    expect(updates[0].likelihoodRunIds).toEqual(expect.arrayContaining(likelihoodRuns.map((item) => item.id)));
    expect(updates[0].likelihoodRunId).toBe(updates[0].likelihoodRunIds?.[0]);
    expect(updatedBelief?.hypotheses[0].currentProbability).toBeGreaterThan(0.35);
    expect(updatedBelief?.hypotheses[1].currentProbability).toBeGreaterThan(0.3);
  });

  it("keeps low-confidence LLM recommendations in review instead of auto-applying them", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: async () =>
          "<html><head><title>AI agents may accelerate engineering teams</title></head><body>The evidence is noisy but mentions AI agents and engineering teams.</body></html>"
      },
      likelihoodEstimator: {
        name: "llm",
        estimate: async () => ({
          estimator: "llm",
          direction: "SUPPORTS",
          relevance: 0.83,
          likelihoodRatio: 1.8,
          confidence: 0.31,
          weight: 3,
          rationale: "The evidence is relevant but too uncertain for automatic application.",
          modelVersion: "deepseek:deepseek-chat",
          abstain: false
        })
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
      name: "Low confidence page",
      kind: "WEB_PAGE",
      url: "https://example.com/agent-low-confidence",
      adapter: "web_page",
      credentialRef: undefined,
      credibility: 0.8,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.7
    });

    const run = await services.sources.runSource(source.id);
    const observations = await services.observations.listObservations();
    const evidence = await services.evidence.listEvidence();
    const updates = await services.updates.listEvents();
    const updatedBelief = await services.beliefs.getBelief(belief.id);

    expect(run.candidateCount).toBe(1);
    expect(run.autoAppliedCount).toBe(0);
    expect(run.reviewCount).toBe(1);
    expect(observations[0].metadata).toMatchObject({
      recommendedLinks: [
        {
          hypothesisId: belief.hypotheses[0].id,
          relevance: 0.83,
          confidence: 0.31,
          likelihoodRatio: 1.8
        }
      ],
      reviewReason: "QUALITY_THRESHOLD"
    });
    expect(evidence).toHaveLength(0);
    expect(updates).toHaveLength(0);
    expect(updatedBelief?.hypotheses[0].currentProbability).toBe(0.35);
  });

  it("keeps explicit LLM review-required recommendations in review even when thresholds pass", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: async () =>
          "<html><head><title>AI agents accelerate engineering teams</title></head><body>The source clearly describes AI agents accelerating engineering work.</body></html>"
      },
      likelihoodEstimator: {
        name: "llm",
        estimate: async () => ({
          estimator: "llm",
          direction: "SUPPORTS",
          relevance: 0.91,
          likelihoodRatio: 2.4,
          confidence: 0.88,
          weight: 3,
          rationale: "The evidence is strong but should be reviewed because source attribution is ambiguous.",
          modelVersion: "deepseek:deepseek-chat",
          reviewRequired: true,
          abstain: false
        })
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
      name: "Review required page",
      kind: "WEB_PAGE",
      url: "https://example.com/agent-review-required",
      adapter: "web_page",
      credentialRef: undefined,
      credibility: 0.8,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.7
    });

    const run = await services.sources.runSource(source.id);
    const observations = await services.observations.listObservations();
    const evidence = await services.evidence.listEvidence();
    const updates = await services.updates.listEvents();
    const updatedBelief = await services.beliefs.getBelief(belief.id);

    expect(run).toMatchObject({ candidateCount: 1, autoAppliedCount: 0, reviewCount: 1 });
    expect(observations[0].metadata).toMatchObject({
      recommendedLinks: [
        {
          hypothesisId: belief.hypotheses[0].id,
          relevance: 0.91,
          confidence: 0.88,
          likelihoodRatio: 2.4,
          reviewRequired: true
        }
      ],
      reviewReason: "LLM_REVIEW_REQUIRED"
    });
    expect(evidence).toHaveLength(0);
    expect(updates).toHaveLength(0);
    expect(updatedBelief?.hypotheses[0].currentProbability).toBe(0.35);
  });

  it("uses conservative effective likelihood ratios for review-required aggregator claims", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: async () =>
          [
            "<rss><channel>",
            "<item>",
            "<title>OpenAI announces GPT-5.6 beats Claude Mythos - finance.biggo.com</title>",
            "<description>OpenAI announces GPT-5.6 beats Claude Mythos across benchmark tiers.</description>",
            "<link>https://finance.biggo.com/news/openai-gpt-5-6-claude-mythos</link>",
            "</item>",
            "</channel></rss>"
          ].join("")
      },
      likelihoodEstimator: {
        name: "llm",
        estimate: async () => ({
          estimator: "llm",
          direction: "SUPPORTS",
          relevance: 0.95,
          likelihoodRatio: 20,
          confidence: 0.7,
          weight: 3,
          rationale: "The headline directly supports the hypothesis but the source is an aggregator and requires review.",
          modelVersion: "deepseek:deepseek-v4-flash",
          reviewRequired: true,
          abstain: false
        })
      }
    });
    const belief = await services.beliefs.createBelief({
      title: "GPT comparison",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "GPT-5.6 beats Claude Mythos",
          priorProbability: 0.5,
          stance: "SUPPORTS",
          notes: ""
        }
      ]
    });
    const source = await services.sources.createSource({
      name: "Biggo finance aggregator",
      kind: "RSS",
      url: "https://finance.biggo.com/feed.xml",
      adapter: "rss",
      credentialRef: undefined,
      credibility: 0.66,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.2
    });

    const run = await services.sources.runSource(source.id, { candidateThreshold: 0.2 });
    const observations = await services.observations.listObservations();
    const recommendedLink = (observations[0].metadata.recommendedLinks as Array<{
      likelihoodRatio: number;
      estimatorOutputs: Array<{ likelihoodRatio?: number }>;
    }>)[0];

    expect(run).toMatchObject({ candidateCount: 1, autoAppliedCount: 0, reviewCount: 1 });
    expect(recommendedLink.likelihoodRatio).toBe(2);
    expect(recommendedLink.estimatorOutputs[0].likelihoodRatio).toBe(20);
    expect(observations[0].metadata).toMatchObject({
      recommendedLinks: [
        {
          hypothesisId: belief.hypotheses[0].id,
          reviewRequired: true,
          confidence: 0.7
        }
      ],
      reviewReason: "LLM_REVIEW_REQUIRED"
    });
  });

  it("allows higher effective likelihood ratios for official source claims", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: async () =>
          [
            "<rss><channel>",
            "<item>",
            "<title>OpenAI announces GPT-5.6 beats Claude Mythos</title>",
            "<description>OpenAI announces GPT-5.6 beats Claude Mythos across benchmark tiers.</description>",
            "<link>https://openai.com/index/gpt-5-6-claude-mythos</link>",
            "</item>",
            "</channel></rss>"
          ].join("")
      },
      likelihoodEstimator: {
        name: "llm",
        estimate: async () => ({
          estimator: "llm",
          direction: "SUPPORTS",
          relevance: 0.95,
          likelihoodRatio: 12,
          confidence: 0.92,
          weight: 3,
          rationale: "The official source directly supports the hypothesis.",
          modelVersion: "deepseek:deepseek-v4-flash",
          abstain: false
        })
      }
    });
    const belief = await services.beliefs.createBelief({
      title: "GPT comparison",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "GPT-5.6 beats Claude Mythos",
          priorProbability: 0.5,
          stance: "SUPPORTS",
          notes: ""
        }
      ]
    });
    const source = await services.sources.createSource({
      name: "OpenAI official feed",
      kind: "RSS",
      url: "https://openai.com/news/rss.xml",
      adapter: "rss",
      credentialRef: undefined,
      credibility: 0.95,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.2
    });

    const run = await services.sources.runSource(source.id, { candidateThreshold: 0.2 });
    const evidence = await services.evidence.listEvidence();

    expect(run).toMatchObject({ candidateCount: 1, autoAppliedCount: 1, reviewCount: 0 });
    expect(evidence[0].links[0]).toMatchObject({
      hypothesisId: belief.hypotheses[0].id,
      likelihoodRatio: 12,
      confidence: 0.92
    });
  });

  it("keeps LLM candidate diagnostics on successful review candidates", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: async () =>
          "<html><head><title>AI agents may accelerate engineering teams</title></head><body>The source mentions AI agents and engineering teams with some uncertainty.</body></html>"
      },
      likelihoodEstimator: {
        name: "llm",
        estimate: async () => ({
          estimator: "llm",
          direction: "SUPPORTS",
          relevance: 0.83,
          likelihoodRatio: 1.8,
          confidence: 0.31,
          weight: 3,
          rationale: "The evidence is relevant but too uncertain for automatic application.",
          modelVersion: "deepseek:deepseek-chat",
          abstain: false
        })
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
      name: "Audited low confidence page",
      kind: "WEB_PAGE",
      url: "https://example.com/agent-low-confidence-audit",
      adapter: "web_page",
      credentialRef: undefined,
      credibility: 0.8,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.7
    });

    const run = await services.sources.runSource(source.id);
    const observations = await services.observations.listObservations();

    expect(run).toMatchObject({ candidateCount: 1, reviewCount: 1 });
    expect(observations[0].metadata).toMatchObject({
      recommendedLinks: [
        {
          hypothesisId: belief.hypotheses[0].id,
          relevance: 0.83,
          confidence: 0.31,
          likelihoodRatio: 1.8
        }
      ],
      reviewReason: "QUALITY_THRESHOLD",
      candidateEvaluation: {
        estimator: "llm",
        attemptedCount: 1,
        usableCount: 1,
        abstainedCount: 0,
        rejectedCount: 0,
        latestRationale: "The evidence is relevant but too uncertain for automatic application."
      }
    });
  });

  it("keeps LLM candidate diagnostics on auto-applied evidence", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: async () =>
          "<html><head><title>AI agents accelerate engineering teams</title></head><body>The source clearly describes AI agents accelerating engineering work.</body></html>"
      },
      likelihoodEstimator: {
        name: "llm",
        estimate: async () => ({
          estimator: "llm",
          direction: "SUPPORTS",
          relevance: 0.91,
          likelihoodRatio: 2.4,
          confidence: 0.92,
          weight: 3,
          rationale: "The evidence strongly supports the hypothesis and is safe to auto-apply.",
          modelVersion: "deepseek:deepseek-chat",
          abstain: false
        })
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
      name: "Audited high confidence page",
      kind: "WEB_PAGE",
      url: "https://example.com/agent-high-confidence-audit",
      adapter: "web_page",
      credentialRef: undefined,
      credibility: 0.85,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.7
    });

    const run = await services.sources.runSource(source.id);
    const [observation] = await services.observations.listObservations();
    const [evidence] = await services.evidence.listEvidence();

    expect(run).toMatchObject({ candidateCount: 1, autoAppliedCount: 1, reviewCount: 0 });
    expect(observation.status).toBe("CONFIRMED");
    expect(evidence.metadata).toMatchObject({
      candidateEvaluation: {
        estimator: "llm",
        attemptedCount: 1,
        usableCount: 1,
        abstainedCount: 0,
        rejectedCount: 0,
        latestRationale: "The evidence strongly supports the hypothesis and is safe to auto-apply."
      }
    });
    expect(evidence.metadata.recommendedLinks).toBeUndefined();
    expect(evidence.metadata.reviewReason).toBeUndefined();
  });

  it("filters high-confidence evidence candidates when the expected probability impact is negligible", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: async () =>
          "<html><head><title>AI agents mention engineering teams</title></head><body>The source is relevant but does not materially change the claim.</body></html>"
      },
      likelihoodEstimator: {
        name: "llm",
        estimate: async () => ({
          estimator: "llm",
          direction: "SUPPORTS",
          relevance: 0.9,
          likelihoodRatio: 1.01,
          confidence: 0.9,
          weight: 3,
          rationale: "The evidence is relevant but barely changes the likelihood.",
          modelVersion: "deepseek:deepseek-chat",
          abstain: false
        })
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
          priorProbability: 0.4,
          stance: "SUPPORTS",
          notes: ""
        }
      ]
    });
    const source = await services.sources.createSource({
      name: "Low impact page",
      kind: "WEB_PAGE",
      url: "https://example.com/agent-low-impact",
      adapter: "web_page",
      credentialRef: undefined,
      credibility: 0.8,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.7
    });

    const run = await services.sources.runSource(source.id);
    const observations = await services.observations.listObservations();
    const evidence = await services.evidence.listEvidence();
    const updates = await services.updates.listEvents();
    const updatedBelief = await services.beliefs.getBelief(belief.id);

    expect(run.candidateCount).toBe(0);
    expect(run.autoAppliedCount).toBe(0);
    expect(run.reviewCount).toBe(0);
    expect(run.lowImpactCount).toBe(1);
    const recommendedLinks = observations[0].metadata.recommendedLinks;
    expect(Array.isArray(recommendedLinks)).toBe(true);
    expect(observations[0]).toMatchObject({
      status: "UNKNOWN",
      metadata: {
        ignoredReason: "LOW_IMPACT"
      }
    });
    expect(evidence).toHaveLength(0);
    expect(updates).toHaveLength(0);
    expect(updatedBelief?.hypotheses[0].currentProbability).toBe(0.4);

    const override = await services.evidence.confirmAndApplyObservation({
      observationId: observations[0].id,
      confirmationMode: "MANUAL",
      links: recommendedLinks as ConfirmEvidenceInput["links"]
    });
    const manuallyUpdatedBelief = await services.beliefs.getBelief(belief.id);

    expect(override.evidence.links).toHaveLength(1);
    expect(manuallyUpdatedBelief?.hypotheses[0].currentProbability).toBeGreaterThan(0.4);
  });

  it("reprocesses low-impact observations on later evidence loop runs", async () => {
    let estimateCount = 0;
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: async () =>
          "<html><head><title>AI agents mention engineering teams</title></head><body>The source is relevant to engineering acceleration.</body></html>"
      },
      likelihoodEstimator: {
        name: "llm",
        estimate: async () => {
          estimateCount += 1;
          if (estimateCount === 1) {
            return {
              estimator: "llm",
              direction: "SUPPORTS",
              relevance: 0.9,
              likelihoodRatio: 1.01,
              confidence: 0.9,
              weight: 3,
              rationale: "The evidence is relevant but initially barely changes the likelihood.",
              modelVersion: "deepseek:deepseek-chat",
              abstain: false
            };
          }
          return {
            estimator: "llm",
            direction: "SUPPORTS",
            relevance: 0.91,
            likelihoodRatio: 2.4,
            confidence: 0.9,
            weight: 3,
            rationale: "A later scorer pass finds this observation materially supports the hypothesis.",
            modelVersion: "deepseek:deepseek-chat",
            abstain: false
          };
        }
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
          priorProbability: 0.4,
          stance: "SUPPORTS",
          notes: ""
        }
      ]
    });
    const source = await services.sources.createSource({
      name: "Low impact page",
      kind: "WEB_PAGE",
      url: "https://example.com/agent-low-impact",
      adapter: "web_page",
      credibility: 0.8,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.7
    });

    const firstRun = await services.sources.runSource(source.id);
    const lowImpactObservation = (await services.observations.listObservations())[0];
    const loop = await services.automation.runEvidenceLoop({
      forceAutoApply: true,
      autoConfirmThreshold: 0.7,
      candidateThreshold: 0.25
    });
    const observations = await services.observations.listObservations();
    const evidence = await services.evidence.listEvidence();
    const updatedBelief = await services.beliefs.getBelief(belief.id);

    expect(firstRun.lowImpactCount).toBe(1);
    expect(lowImpactObservation).toMatchObject({
      status: "UNKNOWN",
      metadata: {
        ignoredReason: "LOW_IMPACT"
      }
    });
    expect(loop).toMatchObject({
      sourceRunCount: 1,
      reprocessedObservationCount: 1,
      candidateCount: 1,
      autoAppliedCount: 1,
      lowImpactCount: 0,
      unmatchedCount: 0
    });
    expect(observations[0].status).toBe("CONFIRMED");
    expect(evidence[0]).toMatchObject({
      observationId: lowImpactObservation.id,
      links: [
        expect.objectContaining({
          hypothesisId: belief.hypotheses[0].id,
          likelihoodRatio: 2.4
        })
      ]
    });
    expect(updatedBelief?.hypotheses[0].currentProbability).toBeGreaterThan(0.4);
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
    const likelihoodRuns = await (services.likelihood as {
      listRuns(): Promise<LikelihoodRunRecord[]>;
    }).listRuns();

    const preview = await services.updates.createPreview(evidence.id);
    const event = await services.updates.applyPreview(preview, likelihoodRun.id);
    const updatedBelief = await services.beliefs.getBelief(belief.id);

    expect(likelihoodRuns).toEqual([likelihoodRun]);
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

  it("rejects applying the same active evidence update twice", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const belief = await services.beliefs.createBelief({
      title: "Duplicate update safety",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [{ proposition: "Duplicate application should be blocked", priorProbability: 0.4, notes: "" }]
    });
    const observation = await services.observations.createObservation({
      title: "Duplicate update evidence",
      content: "Duplicate application should be blocked.",
      credibility: 0.8
    });
    const evidence = await services.evidence.confirmObservation({
      observationId: observation.id,
      confirmationMode: "MANUAL",
      links: [
        {
          hypothesisId: belief.hypotheses[0].id,
          direction: "SUPPORTS",
          relevance: 0.8,
          likelihoodRatio: 2,
          confidence: 0.7,
          rationale: "Initial update."
        }
      ]
    });
    const preview = await services.updates.createPreview(evidence.id);
    await services.updates.applyPreview(preview);

    await expect(services.updates.applyPreview(preview)).rejects.toThrow("already has an active update");
    const events = await services.updates.listEvents();
    const updatedBelief = await services.beliefs.getBelief(belief.id);

    expect(events).toHaveLength(1);
    expect(updatedBelief?.hypotheses[0].currentProbability).toBe(events[0].posteriorSnapshot[belief.hypotheses[0].id]);
  });

  it("rebases later active evidence when an earlier update is rolled back", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const belief = await services.beliefs.createBelief({
      title: "Sequential evidence timeline",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "Sequential evidence should compose",
          priorProbability: 0.4,
          stance: "SUPPORTS",
          notes: ""
        }
      ]
    });
    const firstObservation = await services.observations.createObservation({
      title: "First supporting signal",
      content: "Sequential evidence should compose because the first signal is present.",
      credibility: 1
    });
    const first = await services.evidence.confirmAndApplyObservation({
      observationId: firstObservation.id,
      confirmationMode: "MANUAL",
      links: [
        {
          hypothesisId: belief.hypotheses[0].id,
          direction: "SUPPORTS",
          relevance: 0.9,
          likelihoodRatio: 2,
          confidence: 0.9,
          rationale: "First signal supports the hypothesis."
        }
      ]
    });
    const secondObservation = await services.observations.createObservation({
      title: "Second supporting signal",
      content: "Sequential evidence should compose because the second signal is also present.",
      credibility: 1
    });
    await services.evidence.confirmAndApplyObservation({
      observationId: secondObservation.id,
      confirmationMode: "MANUAL",
      links: [
        {
          hypothesisId: belief.hypotheses[0].id,
          direction: "SUPPORTS",
          relevance: 0.9,
          likelihoodRatio: 3,
          confidence: 0.9,
          rationale: "Second signal supports the hypothesis."
        }
      ]
    });

    await services.updates.rollback(first.event!.id);
    const updatedBelief = await services.beliefs.getBelief(belief.id);

    expect(updatedBelief?.hypotheses[0].currentProbability).toBeCloseTo(2 / 3, 8);
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
    expect(edited.event!.evidenceId).toBe(result.evidence.id);
    expect(events.filter((event) => event.status === "ROLLED_BACK")).toHaveLength(1);
    expect(events.filter((event) => event.status === "APPLIED")).toHaveLength(1);
    expect(updatedBelief?.hypotheses[0].currentProbability).toBeGreaterThan(0.4);
    expect(updatedBelief?.hypotheses[1].currentProbability).toBeLessThan(0.4);
  });

  it("records fresh likelihood runs when edited evidence is reapplied with estimator outputs", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const belief = await services.beliefs.createBelief({
      title: "LLM audited reapply",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [{ proposition: "Edited LLM evidence remains auditable", priorProbability: 0.4, notes: "" }]
    });
    const observation = await services.observations.createObservation({
      title: "Initial audited signal",
      content: "Initial evidence content.",
      credibility: 0.8
    });
    const result = await services.evidence.confirmAndApplyObservation({
      observationId: observation.id,
      confirmationMode: "MANUAL",
      links: [
        {
          hypothesisId: belief.hypotheses[0].id,
          direction: "SUPPORTS",
          relevance: 0.7,
          likelihoodRatio: 1.5,
          confidence: 0.6,
          rationale: "Initial manual link."
        }
      ]
    });

    const edited = await services.evidence.updateAndReapply(result.evidence.id, {
      title: "LLM reviewed audited signal",
      links: [
        {
          hypothesisId: belief.hypotheses[0].id,
          direction: "SUPPORTS",
          relevance: 0.91,
          likelihoodRatio: 2.4,
          confidence: 0.88,
          rationale: "LLM re-scored evidence remains supportive.",
          estimatorOutputs: [
            {
              estimator: "llm",
              direction: "SUPPORTS",
              relevance: 0.91,
              likelihoodRatio: 2.4,
              confidence: 0.88,
              weight: 3,
              rationale: "LLM re-scored evidence remains supportive.",
              modelVersion: "deepseek:deepseek-chat",
              abstain: false
            }
          ]
        }
      ]
    });
    const likelihoodRuns = await services.likelihood.listRuns();
    const appliedEvents = (await services.updates.listEvents()).filter((event) => event.status === "APPLIED");

    expect(likelihoodRuns).toEqual([
      expect.objectContaining({
        evidenceId: result.evidence.id,
        hypothesisId: belief.hypotheses[0].id,
        ensembleConfidence: 0.88,
        modelVersion: "deepseek:deepseek-chat"
      })
    ]);
    expect(likelihoodRuns[0].ensembleLikelihoodRatio).toBeCloseTo(2.4);
    expect(edited.events).toHaveLength(1);
    expect(edited.events[0].likelihoodRunIds).toEqual([likelihoodRuns[0].id]);
    expect(edited.events[0].likelihoodRunId).toBe(likelihoodRuns[0].id);
    expect(appliedEvents).toEqual([expect.objectContaining({ likelihoodRunIds: [likelihoodRuns[0].id] })]);
  });

  it("keeps the confirmed source observation synchronized when applied evidence is edited", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const belief = await services.beliefs.createBelief({
      title: "Evidence observation sync",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [{ proposition: "Edited evidence stays traceable", priorProbability: 0.4, notes: "" }]
    });
    const observation = await services.observations.createObservation({
      title: "Original evidence source",
      content: "Original evidence content",
      url: "https://example.com/original",
      credibility: 0.6,
      metadata: { reviewer: "initial" }
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
          rationale: "Initial evidence supports traceability."
        }
      ]
    });

    await services.evidence.updateAndReapply(result.evidence.id, {
      title: "Reviewed evidence source",
      content: "Reviewed evidence content",
      url: "https://example.com/reviewed",
      credibility: 0.85,
      metadata: { reviewer: "final" },
      links: [
        {
          hypothesisId: belief.hypotheses[0].id,
          direction: "SUPPORTS",
          relevance: 0.9,
          likelihoodRatio: 2.5,
          confidence: 0.8,
          rationale: "Reviewed evidence remains supportive."
        }
      ]
    });
    const [syncedObservation] = await services.observations.listObservations();

    expect(syncedObservation).toMatchObject({
      id: observation.id,
      title: "Reviewed evidence source",
      content: "Reviewed evidence content",
      url: "https://example.com/reviewed",
      credibility: 0.85,
      status: "CONFIRMED",
      metadata: { reviewer: "final" }
    });
  });

  it("keeps unchanged evidence fields when editing only part of an applied evidence record", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const belief = await services.beliefs.createBelief({
      title: "Partial evidence edits",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [{ proposition: "Partial edits preserve traceability", priorProbability: 0.4, notes: "" }]
    });
    const observation = await services.observations.createObservation({
      title: "Original partial evidence",
      content: "Content that must remain attached to the edited evidence.",
      url: "https://example.com/partial",
      credibility: 0.65,
      metadata: { reviewState: "kept" }
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
          rationale: "Initial evidence supports the partial edit scenario."
        }
      ]
    });

    const edited = await services.evidence.updateAndReapply(result.evidence.id, {
      title: "Retitled partial evidence"
    });
    const [syncedObservation] = await services.observations.listObservations();

    expect(edited.evidence).toMatchObject({
      title: "Retitled partial evidence",
      content: "Content that must remain attached to the edited evidence.",
      url: "https://example.com/partial",
      credibility: 0.65,
      metadata: { reviewState: "kept" }
    });
    expect(syncedObservation).toMatchObject({
      title: "Retitled partial evidence",
      content: "Content that must remain attached to the edited evidence.",
      url: "https://example.com/partial",
      credibility: 0.65,
      metadata: { reviewState: "kept" },
      status: "CONFIRMED"
    });
  });

  it("rebases later active evidence when earlier evidence is edited and reapplied", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const belief = await services.beliefs.createBelief({
      title: "Editable evidence timeline",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        {
          proposition: "Edited evidence should keep later evidence active",
          priorProbability: 0.4,
          stance: "SUPPORTS",
          notes: ""
        }
      ]
    });
    const firstObservation = await services.observations.createObservation({
      title: "Initial rollout signal",
      content: "Edited evidence should keep later evidence active because rollout started.",
      credibility: 1
    });
    const first = await services.evidence.confirmAndApplyObservation({
      observationId: firstObservation.id,
      confirmationMode: "MANUAL",
      links: [
        {
          hypothesisId: belief.hypotheses[0].id,
          direction: "SUPPORTS",
          relevance: 0.9,
          likelihoodRatio: 2,
          confidence: 0.9,
          rationale: "Initial signal supports the hypothesis."
        }
      ]
    });
    const secondObservation = await services.observations.createObservation({
      title: "Later rollout signal",
      content: "Edited evidence should keep later evidence active because rollout expanded.",
      credibility: 1
    });
    await services.evidence.confirmAndApplyObservation({
      observationId: secondObservation.id,
      confirmationMode: "MANUAL",
      links: [
        {
          hypothesisId: belief.hypotheses[0].id,
          direction: "SUPPORTS",
          relevance: 0.9,
          likelihoodRatio: 3,
          confidence: 0.9,
          rationale: "Later signal supports the hypothesis."
        }
      ]
    });

    await services.evidence.updateAndReapply(first.evidence.id, {
      title: first.evidence.title,
      content: first.evidence.content,
      credibility: 1,
      links: [
        {
          hypothesisId: belief.hypotheses[0].id,
          direction: "SUPPORTS",
          relevance: 0.9,
          likelihoodRatio: 1.2,
          confidence: 0.9,
          rationale: "Edited signal is weaker but still supportive."
        }
      ]
    });
    const updatedBelief = await services.beliefs.getBelief(belief.id);

    expect(updatedBelief?.hypotheses[0].currentProbability).toBeCloseTo(12 / 17, 8);
  });

  it("rebases active evidence updates when a linked hypothesis prior changes", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const belief = await services.beliefs.createBelief({
      title: "Prior recalibration",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [{ proposition: "Prior changes should rebase active evidence", priorProbability: 0.4, notes: "" }]
    });
    const observation = await services.observations.createObservation({
      title: "Prior-sensitive signal",
      content: "Prior changes should rebase active evidence.",
      credibility: 1
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
          rationale: "Signal supports the hypothesis."
        }
      ]
    });

    await services.beliefs.updateHypothesis(belief.hypotheses[0].id, { priorProbability: 0.2 });
    const [event] = await services.updates.listEvents();
    const updatedBelief = await services.beliefs.getBelief(belief.id);

    expect(event.id).toBe(result.event!.id);
    expect(event.status).toBe("APPLIED");
    expect(event.priorSnapshot[belief.hypotheses[0].id]).toBeCloseTo(0.2, 8);
    expect(event.posteriorSnapshot[belief.hypotheses[0].id]).toBeCloseTo(1 / 3, 8);
    expect(updatedBelief?.hypotheses[0]).toMatchObject({
      priorProbability: 0.2,
      currentProbability: expect.closeTo(1 / 3, 8)
    });
  });

  it("keeps current probability derived from active evidence instead of accepting a current-only overwrite", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const belief = await services.beliefs.createBelief({
      title: "Posterior integrity",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [{ proposition: "Active evidence should own the current probability", priorProbability: 0.4, notes: "" }]
    });
    const observation = await services.observations.createObservation({
      title: "Posterior-sensitive signal",
      content: "Active evidence should own the current probability.",
      credibility: 1
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
          rationale: "Signal supports the hypothesis."
        }
      ]
    });
    const posterior = result.event!.posteriorSnapshot[belief.hypotheses[0].id];

    const updated = await services.beliefs.updateHypothesis(belief.hypotheses[0].id, { currentProbability: 0.95 });
    const [event] = await services.updates.listEvents();
    const updatedBelief = await services.beliefs.getBelief(belief.id);

    expect(updated.currentProbability).toBeCloseTo(posterior, 8);
    expect(event.id).toBe(result.event!.id);
    expect(event.priorSnapshot[belief.hypotheses[0].id]).toBeCloseTo(0.4, 8);
    expect(event.posteriorSnapshot[belief.hypotheses[0].id]).toBeCloseTo(posterior, 8);
    expect(updatedBelief?.hypotheses[0].currentProbability).toBeCloseTo(posterior, 8);
  });

  it("allows settled outcomes to override active evidence derived probability", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const belief = await services.beliefs.createBelief({
      title: "Settlement overrides posterior",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [{ proposition: "The forecast resolves true", priorProbability: 0.4, notes: "" }]
    });
    const observation = await services.observations.createObservation({
      title: "Pre-settlement evidence",
      content: "The forecast resolves true received supporting evidence before settlement.",
      credibility: 1
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
          rationale: "Pre-settlement signal supports the forecast."
        }
      ]
    });

    const updated = await services.beliefs.updateHypothesis(belief.hypotheses[0].id, {
      status: "RESOLVED_TRUE",
      currentProbability: 1,
      resolvedOutcome: "The event happened."
    });
    const [event] = await services.updates.listEvents();
    const updatedBelief = await services.beliefs.getBelief(belief.id);

    expect(updated).toMatchObject({
      status: "RESOLVED_TRUE",
      currentProbability: 1,
      resolvedOutcome: "The event happened."
    });
    expect(event.id).toBe(result.event!.id);
    expect(event.status).toBe("ROLLED_BACK");
    expect(updatedBelief?.hypotheses[0].currentProbability).toBe(1);
  });

  it("rebases active evidence updates when belief probability mode changes", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const belief = await services.beliefs.createBelief({
      title: "Probability structure recalibration",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        { proposition: "Mutually exclusive path A becomes stronger", priorProbability: 0.4, notes: "" },
        { proposition: "Mutually exclusive path B remains possible", priorProbability: 0.6, notes: "" }
      ]
    });
    const observation = await services.observations.createObservation({
      title: "Path A signal",
      content: "Path A receives direct support.",
      credibility: 1
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
          rationale: "Path A signal supports the first path."
        }
      ]
    });

    await services.beliefs.updateBelief(belief.id, { probabilityMode: "MUTUALLY_EXCLUSIVE" });
    const [event] = await services.updates.listEvents();
    const updatedBelief = await services.beliefs.getBelief(belief.id);

    expect(event.id).toBe(result.event!.id);
    expect(event.status).toBe("APPLIED");
    expect(event.priorSnapshot).toMatchObject({
      [belief.hypotheses[0].id]: expect.closeTo(0.4, 8),
      [belief.hypotheses[1].id]: expect.closeTo(0.6, 8)
    });
    expect(event.posteriorSnapshot).toMatchObject({
      [belief.hypotheses[0].id]: expect.closeTo(4 / 7, 8),
      [belief.hypotheses[1].id]: expect.closeTo(3 / 7, 8)
    });
    expect(updatedBelief?.probabilityMode).toBe("MUTUALLY_EXCLUSIVE");
    expect(updatedBelief?.hypotheses[0].currentProbability).toBeCloseTo(4 / 7, 8);
    expect(updatedBelief?.hypotheses[1].currentProbability).toBeCloseTo(3 / 7, 8);
  });

  it("removes paused hypotheses from active evidence updates while preserving sibling links", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const belief = await services.beliefs.createBelief({
      title: "Effective hypothesis recalibration",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [
        { proposition: "Paused path should stop updating", priorProbability: 0.4, notes: "" },
        { proposition: "Active sibling should keep updating", priorProbability: 0.3, notes: "" }
      ]
    });
    const observation = await services.observations.createObservation({
      title: "Shared evidence",
      content: "Shared evidence supports both paths.",
      credibility: 1
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
          rationale: "Initial signal supports the soon-paused path."
        },
        {
          hypothesisId: belief.hypotheses[1].id,
          direction: "SUPPORTS",
          relevance: 0.9,
          likelihoodRatio: 3,
          confidence: 0.8,
          rationale: "Initial signal still supports the active sibling."
        }
      ]
    });

    await services.beliefs.updateHypothesis(belief.hypotheses[0].id, { status: "PAUSED" });
    const events = await services.updates.listEvents();
    const activeEvents = events.filter((event) => event.status === "APPLIED");
    const rolledBackEvents = events.filter((event) => event.status === "ROLLED_BACK");
    const updatedBelief = await services.beliefs.getBelief(belief.id);

    expect(rolledBackEvents).toHaveLength(1);
    expect(rolledBackEvents[0].id).toBe(result.event!.id);
    expect(activeEvents).toHaveLength(1);
    expect(activeEvents[0].posteriorSnapshot).toMatchObject({
      [belief.hypotheses[0].id]: expect.closeTo(0.4, 8),
      [belief.hypotheses[1].id]: expect.closeTo(9 / 16, 8)
    });
    expect(updatedBelief?.hypotheses[0]).toMatchObject({
      status: "PAUSED",
      currentProbability: expect.closeTo(0.4, 8)
    });
    expect(updatedBelief?.hypotheses[1].currentProbability).toBeCloseTo(9 / 16, 8);
  });

  it("confirms evidence without applying an update when all linked hypotheses are inactive", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const belief = await services.beliefs.createBelief({
      title: "Inactive hypothesis evidence",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [{ proposition: "Paused hypothesis should not be updated", priorProbability: 0.4, notes: "" }]
    });
    await services.beliefs.updateHypothesis(belief.hypotheses[0].id, { status: "PAUSED" });
    const observation = await services.observations.createObservation({
      title: "Paused-only evidence",
      content: "This signal only links to a paused hypothesis.",
      credibility: 1
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
          rationale: "The linked hypothesis is paused."
        }
      ]
    });
    const events = await services.updates.listEvents();
    const observations = await services.observations.listObservations();
    const updatedBelief = await services.beliefs.getBelief(belief.id);

    expect(result.evidence.status).toBe("ACTIVE");
    expect(result.event).toBeNull();
    expect(result.events).toEqual([]);
    expect(events).toEqual([]);
    expect(observations[0].status).toBe("CONFIRMED");
    expect(updatedBelief?.hypotheses[0]).toMatchObject({
      status: "PAUSED",
      currentProbability: 0.4
    });
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

  it("connects evidence across belief groups and reapplies one update per affected belief", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const sourceBelief = await services.beliefs.createBelief({
      title: "Source belief",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [{ proposition: "Agents accelerate source workflows", priorProbability: 0.4, notes: "" }]
    });
    const otherBelief = await services.beliefs.createBelief({
      title: "Other belief",
      category: "CAREER",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [{ proposition: "Career focus shifts to product strategy", priorProbability: 0.3, notes: "" }]
    });
    const observation = await services.observations.createObservation({
      title: "Source evidence",
      content: "Agents accelerate source workflows.",
      credibility: 0.8
    });
    const result = await services.evidence.confirmAndApplyObservation({
      observationId: observation.id,
      confirmationMode: "MANUAL",
      links: [
        {
          hypothesisId: sourceBelief.hypotheses[0].id,
          direction: "SUPPORTS",
          relevance: 0.8,
          likelihoodRatio: 2,
          confidence: 0.7,
          rationale: "Initial source link."
        }
      ]
    });
    const appliedBelief = await services.beliefs.getBelief(sourceBelief.id);

    const connected = await services.evidence.connectHypothesis(result.evidence.id, {
      hypothesisId: otherBelief.hypotheses[0].id,
      direction: "SUPPORTS",
      relevance: 0.7,
      likelihoodRatio: 1.5,
      confidence: 0.6,
      rationale: "Valid cross-belief connection."
    });
    const evidence = await services.evidence.listEvidence();
    const events = await services.updates.listEvents();
    const rebasedSourceBelief = await services.beliefs.getBelief(sourceBelief.id);
    const updatedOtherBelief = await services.beliefs.getBelief(otherBelief.id);

    expect(connected.evidence.links).toHaveLength(2);
    expect(connected.events).toHaveLength(2);
    expect(evidence[0].links.map((link) => link.hypothesisId)).toEqual(
      expect.arrayContaining([sourceBelief.hypotheses[0].id, otherBelief.hypotheses[0].id])
    );
    expect(events.filter((event) => event.status === "ROLLED_BACK")).toHaveLength(1);
    expect(events.filter((event) => event.status === "APPLIED")).toHaveLength(2);
    expect(new Set(events.filter((event) => event.status === "APPLIED").map((event) => event.beliefId))).toEqual(
      new Set([sourceBelief.id, otherBelief.id])
    );
    expect(rebasedSourceBelief?.hypotheses[0].currentProbability).toBeCloseTo(
      appliedBelief?.hypotheses[0].currentProbability ?? 0,
      8
    );
    expect(updatedOtherBelief?.hypotheses[0].currentProbability).toBeGreaterThan(0.3);
  });

  it("disconnects evidence from one hypothesis and reapplies only remaining linked beliefs", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const sourceBelief = await services.beliefs.createBelief({
      title: "Disconnect source belief",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [{ proposition: "Agents accelerate source workflows", priorProbability: 0.4, notes: "" }]
    });
    const remainingBelief = await services.beliefs.createBelief({
      title: "Disconnect remaining belief",
      category: "CAREER",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [{ proposition: "Career focus shifts to product strategy", priorProbability: 0.3, notes: "" }]
    });
    const observation = await services.observations.createObservation({
      title: "Disconnect evidence",
      content: "The evidence initially affected two separate belief groups.",
      credibility: 0.8
    });
    const result = await services.evidence.confirmAndApplyObservation({
      observationId: observation.id,
      confirmationMode: "MANUAL",
      links: [
        {
          hypothesisId: sourceBelief.hypotheses[0].id,
          direction: "SUPPORTS",
          relevance: 0.8,
          likelihoodRatio: 2,
          confidence: 0.7,
          rationale: "Initial source link."
        },
        {
          hypothesisId: remainingBelief.hypotheses[0].id,
          direction: "SUPPORTS",
          relevance: 0.7,
          likelihoodRatio: 1.6,
          confidence: 0.65,
          rationale: "Remaining link."
        }
      ]
    });

    const disconnected = await services.evidence.disconnectHypothesis(result.evidence.id, {
      hypothesisId: sourceBelief.hypotheses[0].id
    });
    const events = await services.updates.listEvents();
    const rebasedSourceBelief = await services.beliefs.getBelief(sourceBelief.id);
    const updatedRemainingBelief = await services.beliefs.getBelief(remainingBelief.id);

    expect(disconnected.evidence.links).toEqual([
      expect.objectContaining({
        hypothesisId: remainingBelief.hypotheses[0].id,
        rationale: "Remaining link."
      })
    ]);
    expect(disconnected.events).toHaveLength(1);
    expect(disconnected.events[0].beliefId).toBe(remainingBelief.id);
    expect(events.filter((event) => event.status === "ROLLED_BACK")).toHaveLength(2);
    expect(events.filter((event) => event.status === "APPLIED")).toHaveLength(1);
    expect(rebasedSourceBelief?.hypotheses[0].currentProbability).toBe(0.4);
    expect(updatedRemainingBelief?.hypotheses[0].currentProbability).toBeGreaterThan(0.3);
  });

  it("disconnects the final evidence link and rolls back the last applied update", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const belief = await services.beliefs.createBelief({
      title: "Final link disconnect",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [{ proposition: "Single link can be removed", priorProbability: 0.4, notes: "" }]
    });
    const observation = await services.observations.createObservation({
      title: "Single-link evidence",
      content: "This evidence initially has only one hypothesis link.",
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
          rationale: "Initial single link."
        }
      ]
    });

    const disconnected = await services.evidence.disconnectHypothesis(result.evidence.id, {
      hypothesisId: belief.hypotheses[0].id
    });
    const events = await services.updates.listEvents();
    const updatedBelief = await services.beliefs.getBelief(belief.id);

    expect(disconnected.evidence.links).toEqual([]);
    expect(disconnected.events).toEqual([]);
    expect(events.filter((event) => event.status === "ROLLED_BACK")).toHaveLength(1);
    expect(events.filter((event) => event.status === "APPLIED")).toHaveLength(0);
    expect(updatedBelief?.hypotheses[0].currentProbability).toBe(0.4);
  });

  it("moves active evidence updates to the new belief group when a linked hypothesis is moved", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const sourceBelief = await services.beliefs.createBelief({
      title: "Source belief group",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [{ proposition: "Agents accelerate source workflows", priorProbability: 0.4, notes: "" }]
    });
    const targetBelief = await services.beliefs.createBelief({
      title: "Target belief group",
      category: "CAREER",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [{ proposition: "Career work shifts toward strategy", priorProbability: 0.3, notes: "" }]
    });
    const observation = await services.observations.createObservation({
      title: "Movable evidence",
      content: "Agents accelerate source workflows.",
      credibility: 1
    });
    const result = await services.evidence.confirmAndApplyObservation({
      observationId: observation.id,
      confirmationMode: "MANUAL",
      links: [
        {
          hypothesisId: sourceBelief.hypotheses[0].id,
          direction: "SUPPORTS",
          relevance: 0.9,
          likelihoodRatio: 2,
          confidence: 0.8,
          rationale: "Initial source belief evidence."
        }
      ]
    });

    await services.beliefs.updateHypothesis(sourceBelief.hypotheses[0].id, { beliefId: targetBelief.id });
    const events = await services.updates.listEvents();
    const activeEvents = events.filter((event) => event.status === "APPLIED");
    const rolledBackEvents = events.filter((event) => event.status === "ROLLED_BACK");
    const movedHypothesis = await services.beliefs.getBelief(targetBelief.id);

    expect(rolledBackEvents).toHaveLength(1);
    expect(rolledBackEvents[0].id).toBe(result.event!.id);
    expect(activeEvents).toHaveLength(1);
    expect(activeEvents[0]).toMatchObject({
      evidenceId: result.evidence.id,
      beliefId: targetBelief.id
    });
    expect(activeEvents[0].priorSnapshot[sourceBelief.hypotheses[0].id]).toBeCloseTo(0.4, 8);
    expect(activeEvents[0].posteriorSnapshot[sourceBelief.hypotheses[0].id]).toBeCloseTo(4 / 7, 8);
    expect(movedHypothesis?.hypotheses.find((hypothesis) => hypothesis.id === sourceBelief.hypotheses[0].id)?.currentProbability).toBeCloseTo(
      4 / 7,
      8
    );
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

  it("edits rejected evidence by restoring it and applying the revised links", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const belief = await services.beliefs.createBelief({
      title: "Evidence recovery",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [{ proposition: "Recovered evidence supports the belief", priorProbability: 0.4, notes: "" }]
    });
    const observation = await services.observations.createObservation({
      title: "Original rejected signal",
      content: "Original content.",
      credibility: 0.6
    });
    const result = await services.evidence.confirmAndApplyObservation({
      observationId: observation.id,
      confirmationMode: "MANUAL",
      links: [
        {
          hypothesisId: belief.hypotheses[0].id,
          direction: "SUPPORTS",
          relevance: 0.7,
          likelihoodRatio: 1.5,
          confidence: 0.6,
          rationale: "Original link."
        }
      ]
    });
    await services.evidence.reject(result.evidence.id);

    const revised = await services.evidence.updateAndReapply(result.evidence.id, {
      title: "Revised signal",
      content: "Revised content supports the hypothesis more clearly.",
      credibility: 0.82,
      links: [
        {
          hypothesisId: belief.hypotheses[0].id,
          direction: "SUPPORTS",
          relevance: 0.9,
          likelihoodRatio: 2.2,
          confidence: 0.8,
          rationale: "Revised evidence should be restored and applied."
        }
      ]
    });
    const observations = await services.observations.listObservations();
    const events = await services.updates.listEvents();
    const updatedBelief = await services.beliefs.getBelief(belief.id);

    expect(revised.evidence.status).toBe("ACTIVE");
    expect(revised.evidence.title).toBe("Revised signal");
    expect(observations[0].status).toBe("CONFIRMED");
    expect(events.filter((event) => event.status === "ROLLED_BACK")).toHaveLength(1);
    expect(events.filter((event) => event.status === "APPLIED")).toHaveLength(1);
    expect(updatedBelief?.hypotheses[0].currentProbability).toBeGreaterThan(0.4);
  });

  it("deletes rejected evidence from the active evidence library while retaining rollback audit events", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const belief = await services.beliefs.createBelief({
      title: "Evidence deletion",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: [{ proposition: "Deleted evidence had supported this hypothesis", priorProbability: 0.4, notes: "" }]
    });
    const observation = await services.observations.createObservation({
      title: "Signal to delete",
      content: "This signal should be removed after rollback.",
      credibility: 0.6
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
          rationale: "Temporary signal."
        }
      ]
    });
    await services.evidence.reject(result.evidence.id);

    const deleted = await services.evidence.deleteEvidence(result.evidence.id);
    const visibleEvidence = await services.evidence.listEvidence();
    const events = await services.updates.listEvents();

    expect(deleted.status).toBe("DELETED");
    expect(visibleEvidence.map((item) => item.id)).not.toContain(result.evidence.id);
    expect(events).toEqual([
      expect.objectContaining({
        evidenceId: result.evidence.id,
        status: "ROLLED_BACK"
      })
    ]);
  });

  it("records and updates automation worker heartbeat state", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const startedAt = new Date("2026-06-11T04:00:00.000Z");
    const retryAt = new Date("2026-06-11T04:15:00.000Z");

    const first = await services.automation.recordHeartbeat({
      id: "default",
      status: "RUNNING",
      heartbeatAt: startedAt,
      nextRunAt: retryAt,
      intervalMs: 900_000,
      consecutiveFailureCount: 0,
      lastNotice: "2 条候选观察等待确认。",
      lastError: ""
    });
    const updated = await services.automation.recordHeartbeat({
      id: "default",
      status: "ERROR",
      heartbeatAt: new Date("2026-06-11T04:15:00.000Z"),
      nextRunAt: new Date("2026-06-11T04:45:00.000Z"),
      intervalMs: 900_000,
      consecutiveFailureCount: 2,
      lastNotice: "",
      lastError: "source endpoint unavailable"
    });
    const heartbeats = await services.automation.listHeartbeats();

    expect(first).toMatchObject({
      id: "default",
      status: "RUNNING",
      nextRunAt: retryAt,
      lastNotice: "2 条候选观察等待确认。",
      lastError: ""
    });
    expect(updated).toMatchObject({
      id: "default",
      status: "ERROR",
      consecutiveFailureCount: 2,
      lastNotice: "",
      lastError: "source endpoint unavailable"
    });
    expect(heartbeats).toHaveLength(1);
    expect(heartbeats[0]).toEqual(updated);
  });

  it("saves and updates automation worker configuration", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());

    const first = await services.automation.saveWorkerConfig({
      id: "default",
      enabled: true,
      intervalMs: 900_000,
      failureBackoffMultiplier: 2,
      maxIntervalMs: 3_600_000,
      reviewOnly: true,
      maxQueries: 3,
      maxSources: 2,
      maxObservations: 20,
      candidateThreshold: 0.25,
      autoConfirmThreshold: 0.85,
      bootstrapDefaultSources: true,
      forceAutoApply: false
    });
    const updated = await services.automation.saveWorkerConfig({
      id: "default",
      enabled: false,
      intervalMs: 300_000,
      failureBackoffMultiplier: 3,
      maxIntervalMs: 1_800_000,
      reviewOnly: false,
      maxQueries: 1,
      maxSources: 1,
      maxObservations: 5,
      candidateThreshold: 0.3,
      autoConfirmThreshold: 0.9,
      bootstrapDefaultSources: false,
      forceAutoApply: true
    });
    const configs = await services.automation.listWorkerConfigs();

    expect(first).toMatchObject({ id: "default", enabled: true, intervalMs: 900_000 });
    expect(updated).toMatchObject({
      id: "default",
      enabled: false,
      intervalMs: 300_000,
      failureBackoffMultiplier: 3,
      maxQueries: 1,
      maxSources: 1,
      forceAutoApply: true
    });
    expect(configs).toHaveLength(1);
    expect(configs[0]).toEqual(updated);
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
        expect.objectContaining({ source: result.evidence.id, target: result.event!.id, relation: "PRODUCED" }),
        expect.objectContaining({ source: result.event!.id, target: belief.id, relation: "UPDATED", label: "更新信念 · H-001 +13.0pp" })
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
    const run = await services.sources.runDryRun(
      source.id,
      [
        { title: "AI launch", content: "Launch details", url: "https://example.com/launch" },
        { title: "AI launch copy", content: "Launch details", url: "https://example.com/launch" }
      ],
      {
        queries: [
          {
            beliefId: "belief_ai",
            hypothesisId: "hypothesis_ai_launch",
            category: "AI_TREND",
            query: "AI launch"
          }
        ]
      }
    );
    const artifact = await services.models.importArtifact({
      name: "lightweight-local",
      kind: "LIGHTWEIGHT",
      version: "0.1.0",
      path: "./model-artifacts/lightweight-local.json",
      metrics: { sampleCount: 3, sourceCounts: { fever: 3 }, calibration: null },
      enabled: true
    });

    expect(run.status).toBe("DRY_RUN");
    expect(run.itemCount).toBe(2);
    expect(run.deduplicatedCount).toBe(1);
    expect(run.queryCount).toBe(1);
    expect(run.querySummary).toEqual([
      {
        beliefId: "belief_ai",
        hypothesisId: "hypothesis_ai_launch",
        category: "AI_TREND",
        query: "AI launch"
      }
    ]);
    expect(artifact.enabled).toBe(true);
    await expect(services.sources.listSources()).resolves.toHaveLength(1);
    await expect(services.models.listArtifacts()).resolves.toHaveLength(1);
  });

  it("rejects demo or untrained lightweight model artifact imports", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const baseArtifact = {
      name: "lightweight-local",
      kind: "LIGHTWEIGHT" as const,
      version: "0.1.0",
      path: "./model-artifacts/lightweight-local.json",
      metrics: { sampleCount: 3, sourceCounts: { fever: 3 } },
      enabled: true
    };

    await expect(
      services.models.importArtifact({
        ...baseArtifact,
        name: "lightweight-demo"
      })
    ).rejects.toThrow(/demo/i);
    await expect(
      services.models.importArtifact({
        ...baseArtifact,
        path: "./model-artifacts/lightweight-demo.json"
      })
    ).rejects.toThrow(/demo/i);
    await expect(
      services.models.importArtifact({
        ...baseArtifact,
        metrics: { sampleCount: 0 }
      })
    ).rejects.toThrow(/real training samples/i);
    await expect(
      services.models.importArtifact({
        ...baseArtifact,
        metrics: { sampleCount: 3, trained: false }
      })
    ).rejects.toThrow(/untrained/i);
    await expect(
      services.models.importArtifact({
        ...baseArtifact,
        metrics: {}
      })
    ).rejects.toThrow(/real training samples/i);
    await expect(services.models.listArtifacts()).resolves.toHaveLength(0);
  });

  it("bootstraps default source presets before running an evidence loop when requested", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: fetchSourcePresetFixtureText
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

    const loop = await services.automation.runEvidenceLoop({
      reviewOnly: true,
      maxObservations: 1,
      autoConfirmThreshold: 0.2,
      bootstrapDefaultSources: true
    });
    const sources = await services.sources.listSources();
    const evidence = await services.evidence.listEvidence();
    const updatedBelief = await services.beliefs.getBelief(belief.id);
    const enabledPresetCount = sourcePresetDefinitions.filter((preset) => preset.enabled).length;
    const enabledNonRssPresetCount = sourcePresetDefinitions.filter((preset) => preset.enabled && preset.kind !== "RSS").length;
    const enabledPredictionMarketPresetCount = sourcePresetDefinitions.filter(
      (preset) => preset.enabled && preset.kind === "PREDICTION_MARKET"
    ).length;

    expect(sources).toHaveLength(sourcePresetDefinitions.length);
    expect(sources.map((source) => source.name)).toEqual(expect.arrayContaining(sourcePresetDefinitions.map((preset) => preset.name)));
    expect(loop).toMatchObject({
      queryCount: 1,
      sourceRunCount: enabledPresetCount,
      itemCount: enabledPresetCount - enabledPredictionMarketPresetCount,
      candidateCount: 1,
      autoAppliedCount: 0,
      reviewCount: 1,
      failureCount: 0
    });
    expect(loop.deduplicatedCount).toBe(sourcePresetDefinitions.filter((preset) => preset.kind === "RSS").length - 1);
    expect(loop.unmatchedCount).toBe(enabledNonRssPresetCount - enabledPredictionMarketPresetCount);
    expect(evidence).toHaveLength(0);
    expect(updatedBelief?.hypotheses[0].currentProbability).toBe(0.35);
  });

  it("can force auto-apply for one bootstrapped evidence loop without changing source defaults", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: fetchSourcePresetFixtureText
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

    const loop = await services.automation.runEvidenceLoop({
      bootstrapDefaultSources: true,
      forceAutoApply: true,
      maxObservations: 1,
      autoConfirmThreshold: 0.2
    });
    const sources = await services.sources.listSources();
    const evidence = await services.evidence.listEvidence();
    const updates = await services.updates.listEvents();
    const updatedBelief = await services.beliefs.getBelief(belief.id);

    expect(sources).toHaveLength(sourcePresetDefinitions.length);
    expect(sources.every((source) => source.autoConfirm === false)).toBe(true);
    expect(loop).toMatchObject({
      candidateCount: 1,
      autoAppliedCount: 1,
      reviewCount: 0,
      failureCount: 0
    });
    expect(evidence).toHaveLength(1);
    expect(updates).toHaveLength(1);
    expect(updatedBelief?.hypotheses[0].currentProbability).toBeGreaterThan(0.35);
  });

  it("uses query metadata to route query-sourced observations into the LLM scorer beyond lexical fallback limits", async () => {
    const targetProposition = "Target hypothesis six should be scored from its search query";
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: {
        fetchText: async () =>
          "<html><head><title>Unrelated source result</title></head><body>Harbor weather and logistics updates.</body></html>"
      },
      likelihoodEstimator: {
        name: "llm",
        async estimate(input) {
          if (input.hypothesis !== targetProposition) {
            return {
              estimator: "llm",
              weight: 3,
              abstain: true,
              rationale: "Not the query-targeted hypothesis."
            };
          }
          return {
            estimator: "llm",
            direction: "SUPPORTS",
            relevance: 0.82,
            likelihoodRatio: 2.1,
            confidence: 0.78,
            weight: 3,
            rationale: "The query metadata routes this observation to the intended hypothesis.",
            modelVersion: "test-llm",
            abstain: false
          };
        }
      }
    });
    const belief = await services.beliefs.createBelief({
      title: "Query routed belief",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      hypotheses: Array.from({ length: 6 }, (_, index) => ({
        proposition: index === 5 ? targetProposition : `Distractor hypothesis ${index + 1}`,
        priorProbability: 0.3,
        notes: ""
      }))
    });
    const source = await services.sources.createSource({
      name: "Query source",
      kind: "WEB_PAGE",
      url: "https://example.com/search?q={query}",
      adapter: "web_page",
      credibility: 0.8,
      enabled: true,
      autoConfirm: false,
      autoConfirmThreshold: 0.85
    });

    const run = await services.sources.runSource(source.id, {
      reviewOnly: true,
      candidateThreshold: 0.25,
      maxObservations: 6
    });
    const observations = await services.observations.listObservations();
    const targetObservation = observations.find((observation) =>
      typeof observation.metadata.query === "string" && observation.metadata.query.includes(targetProposition)
    );

    expect(run).toMatchObject({
      queryCount: 6,
      itemCount: 6,
      candidateCount: 1,
      reviewCount: 1
    });
    expect(targetObservation).toMatchObject({
      status: "PENDING",
      metadata: {
        recommendedLinks: [
          expect.objectContaining({
            hypothesisId: belief.hypotheses[5].id,
            relevance: 0.82,
            likelihoodRatio: 2.1
          })
        ]
      }
    });
  });

  it("lists and creates default public source presets without duplicates", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());

    const presets = await services.sources.listPresets();
    const arxivPreset = presets.find((preset) => preset.id === "arxiv-cs-ai");
    const hnPreset = presets.find((preset) => preset.id === "hn-ai-search");

    expect(arxivPreset).toMatchObject({
      name: "arXiv cs.AI RSS",
      kind: "RSS",
      adapter: "rss",
      url: "https://rss.arxiv.org/rss/cs.AI",
      installed: false
    });
    expect(hnPreset).toMatchObject({
      name: "Hacker News AI Search",
      url: "https://hnrss.org/newest?q=AI+OR+LLM+OR+agent&count=50"
    });

    const created = await services.sources.createPreset("arxiv-cs-ai");
    const createdAgain = await services.sources.createPreset("arxiv-cs-ai");
    const sources = await services.sources.listSources();
    const updatedPresets = await services.sources.listPresets();

    expect(created).toMatchObject({
      name: "arXiv cs.AI RSS",
      kind: "RSS",
      url: "https://rss.arxiv.org/rss/cs.AI",
      enabled: true,
      autoConfirm: false
    });
    expect(createdAgain.id).toBe(created.id);
    expect(sources.filter((source) => source.url === "https://rss.arxiv.org/rss/cs.AI")).toHaveLength(1);
    expect(updatedPresets.find((preset) => preset.id === "arxiv-cs-ai")?.installed).toBe(true);
  });

  it("creates all missing public source presets without duplicating installed presets", async () => {
    const services = createWorldModelServices(createInMemoryWorldModelStore());
    const installedPreset = sourcePresetDefinitions[0];
    await services.sources.createSource({
      name: installedPreset.name,
      kind: installedPreset.kind,
      url: installedPreset.url,
      adapter: installedPreset.adapter,
      credentialRef: installedPreset.credentialRef,
      credibility: installedPreset.credibility,
      enabled: installedPreset.enabled,
      autoConfirm: installedPreset.autoConfirm,
      autoConfirmThreshold: installedPreset.autoConfirmThreshold
    });

    const created = await services.sources.createMissingPresets();
    const createdAgain = await services.sources.createMissingPresets();
    const sources = await services.sources.listSources();
    const presets = await services.sources.listPresets();

    expect(created).toHaveLength(sourcePresetDefinitions.length - 1);
    expect(created.map((source) => source.name)).not.toContain(installedPreset.name);
    expect(createdAgain).toEqual([]);
    expect(sources).toHaveLength(sourcePresetDefinitions.length);
    expect(presets.every((preset) => preset.installed)).toBe(true);
  });
});
