import { vi } from "vitest";
import { createPrismaWorldModelStore } from "@/server/services/prisma-store";

describe("Prisma world model store", () => {
  it("exposes a store factory for the service layer", () => {
    expect(typeof createPrismaWorldModelStore).toBe("function");
  });

  it("persists automation worker query and source bounds", async () => {
    const timestamp = new Date("2026-06-12T00:00:00.000Z");
    const upsert = vi.fn(async (args) => ({
      ...args.create,
      createdAt: timestamp,
      updatedAt: timestamp
    }));
    const findMany = vi.fn(async () => [
      {
        id: "default",
        enabled: true,
        intervalMs: 900_000,
        failureBackoffMultiplier: 2,
        maxIntervalMs: 3_600_000,
        reviewOnly: true,
        maxQueries: 4,
        maxSources: 2,
        beliefIds: ["belief_ai_agents", "belief_career"],
        sourceIds: ["source_github", "source_hf"],
        maxObservations: 20,
        candidateThreshold: 0.25,
        autoConfirmThreshold: 0.85,
        bootstrapDefaultSources: true,
        forceAutoApply: false,
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ]);
    const store = createPrismaWorldModelStore({
      automationWorkerConfig: {
        upsert,
        findMany
      }
    } as never);

    const record = await store.upsertAutomationWorkerConfig({
      id: "default",
      enabled: true,
      intervalMs: 900_000,
      failureBackoffMultiplier: 2,
      maxIntervalMs: 3_600_000,
      reviewOnly: true,
      maxQueries: 4,
      maxSources: 2,
      beliefIds: ["belief_ai_agents", "belief_career"],
      sourceIds: ["source_github", "source_hf"],
      maxObservations: 20,
      candidateThreshold: 0.25,
      autoConfirmThreshold: 0.85,
      bootstrapDefaultSources: true,
      forceAutoApply: false,
      createdAt: timestamp,
      updatedAt: timestamp
    } as never);
    const records = await store.listAutomationWorkerConfigs();

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          maxQueries: 4,
          maxSources: 2,
          beliefIds: ["belief_ai_agents", "belief_career"],
          sourceIds: ["source_github", "source_hf"]
        }),
        create: expect.objectContaining({
          maxQueries: 4,
          maxSources: 2,
          beliefIds: ["belief_ai_agents", "belief_career"],
          sourceIds: ["source_github", "source_hf"]
        })
      })
    );
    expect(record).toMatchObject({
      maxQueries: 4,
      maxSources: 2,
      beliefIds: ["belief_ai_agents", "belief_career"],
      sourceIds: ["source_github", "source_hf"]
    });
    expect(records[0]).toMatchObject({
      maxQueries: 4,
      maxSources: 2,
      beliefIds: ["belief_ai_agents", "belief_career"],
      sourceIds: ["source_github", "source_hf"]
    });
  });

  it("persists update event confidence and explanations for audit history", async () => {
    const createdAt = new Date("2026-06-18T04:00:00.000Z");
    const create = vi.fn(async (args) => args.data);
    const findMany = vi.fn(async () => [
      {
        id: "update_signal",
        beliefId: "belief_signal",
        evidenceId: "evidence_signal",
        likelihoodRunId: "likelihood_signal",
        priorSnapshot: { hypothesis_signal: 0.35 },
        posteriorSnapshot: { hypothesis_signal: 0.58 },
        mode: "APPLIED",
        status: "APPLIED",
        confidence: 0.82,
        explanations: ["hypothesis_signal: LLM primary score"],
        likelihoodRunIds: ["likelihood_signal", "likelihood_secondary"],
        createdAt,
        rolledBackAt: null
      }
    ]);
    const store = createPrismaWorldModelStore({
      bayesianUpdateEvent: {
        create,
        findMany
      }
    } as never);

    const record = await store.createUpdateEvent({
      id: "update_signal",
      beliefId: "belief_signal",
      evidenceId: "evidence_signal",
      likelihoodRunId: "likelihood_signal",
      priorSnapshot: { hypothesis_signal: 0.35 },
      posteriorSnapshot: { hypothesis_signal: 0.58 },
      mode: "APPLIED",
      status: "APPLIED",
      confidence: 0.82,
      explanations: ["hypothesis_signal: LLM primary score"],
      likelihoodRunIds: ["likelihood_signal", "likelihood_secondary"],
      createdAt
    });
    const records = await store.listUpdateEvents();

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          confidence: 0.82,
          explanations: ["hypothesis_signal: LLM primary score"],
          likelihoodRunIds: ["likelihood_signal", "likelihood_secondary"]
        })
      })
    );
    expect(record).toMatchObject({
      confidence: 0.82,
      explanations: ["hypothesis_signal: LLM primary score"],
      likelihoodRunIds: ["likelihood_signal", "likelihood_secondary"]
    });
    expect(records[0]).toMatchObject({
      confidence: 0.82,
      explanations: ["hypothesis_signal: LLM primary score"],
      likelihoodRunIds: ["likelihood_signal", "likelihood_secondary"]
    });
  });

  it("persists hypothesis evidence search queries", async () => {
    const timestamp = new Date("2026-06-18T06:00:00.000Z");
    const create = vi.fn(async (args) => ({
      ...args.data,
      createdAt: timestamp,
      updatedAt: timestamp
    }));
    const updateBelief = vi.fn(async () => ({}));
    const findUnique = vi.fn(async () => ({
      id: "hypothesis_signal",
      beliefId: "belief_signal",
      proposition: "Security review delays AI procurement",
      notes: "Track model risk review.",
      evidenceSearchQuery: "enterprise AI procurement model risk review",
      stance: "OPPOSES",
      priorProbability: 0.41,
      currentProbability: 0.41,
      strength: 0.41,
      status: "ACTIVE",
      startsAt: null,
      expiresAt: null,
      expiryCondition: null,
      resolvedOutcome: null,
      createdAt: timestamp,
      updatedAt: timestamp
    }));
    const store = createPrismaWorldModelStore({
      hypothesis: {
        create,
        findUnique
      },
      belief: {
        update: updateBelief
      }
    } as never);

    const created = await store.createHypothesis({
      id: "hypothesis_signal",
      beliefId: "belief_signal",
      proposition: "Security review delays AI procurement",
      notes: "Track model risk review.",
      evidenceSearchQuery: "enterprise AI procurement model risk review",
      stance: "OPPOSES",
      priorProbability: 0.41,
      currentProbability: 0.41,
      strength: 0.41,
      status: "ACTIVE",
      createdAt: timestamp,
      updatedAt: timestamp
    });
    const found = await store.getHypothesis("hypothesis_signal");

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          evidenceSearchQuery: "enterprise AI procurement model risk review"
        })
      })
    );
    expect(created.evidenceSearchQuery).toBe("enterprise AI procurement model risk review");
    expect(found?.evidenceSearchQuery).toBe("enterprise AI procurement model risk review");
  });
});
