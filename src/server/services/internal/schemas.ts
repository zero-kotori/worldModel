import { z } from "zod";

import type { EstimatorOutput } from "@/domain/likelihood";
import type { CreateBeliefInput } from "@/server/services/types";

// Shared Zod validation schemas for the world-model service layer.
// Keeping them here keeps the service modules focused on behaviour while
// every input boundary validates against one canonical schema set (AGENTS.md §3).

export const probabilitySchema = z.number().finite().min(0).max(1);

export const createBeliefSchema = z.object({
  title: z.string().trim().min(1, "Belief title is required"),
  category: z.enum(["AI_TREND", "INVESTMENT", "TECH_TREND", "CAREER", "SOURCE_RELIABILITY"]),
  description: z.string(),
  probabilityMode: z.enum(["MUTUALLY_EXCLUSIVE", "INDEPENDENT"]),
  origin: z.enum(["INTERNAL", "EXTERNAL"]).optional(),
  sourceObservationId: z.string().trim().min(1).optional(),
  hypotheses: z
    .array(
      z.object({
        proposition: z.string().trim().min(1, "Hypothesis proposition is required"),
        priorProbability: z.number().finite().nonnegative(),
        stance: z.enum(["SUPPORTS", "OPPOSES"]).optional(),
        notes: z.string().optional(),
        evidenceSearchQuery: z.string().optional(),
        startsAt: z.date().optional(),
        expiresAt: z.date().optional(),
        expiryCondition: z.string().optional()
      })
    )
    .min(1, "At least one hypothesis is required")
});

export const independentBeliefSchema = createBeliefSchema.extend({
  probabilityMode: z.literal("INDEPENDENT"),
  hypotheses: createBeliefSchema.shape.hypotheses.pipe(
    z.array(
      z.object({
        proposition: z.string(),
        priorProbability: probabilitySchema,
        currentProbability: probabilitySchema.optional(),
        stance: z.enum(["SUPPORTS", "OPPOSES"]).optional(),
        notes: z.string().optional(),
        evidenceSearchQuery: z.string().optional(),
        startsAt: z.date().optional(),
        expiresAt: z.date().optional(),
        expiryCondition: z.string().optional()
      })
    )
  )
});

export const createHypothesisSchema = z.object({
  proposition: z.string().trim().min(1, "Hypothesis proposition is required"),
  priorProbability: probabilitySchema,
  currentProbability: probabilitySchema.optional(),
  stance: z.enum(["SUPPORTS", "OPPOSES"]).default("SUPPORTS"),
  notes: z.string().optional(),
  evidenceSearchQuery: z.string().optional(),
  startsAt: z.date().optional(),
  expiresAt: z.date().optional(),
  expiryCondition: z.string().optional(),
  sourceObservationId: z.string().trim().min(1).optional()
});

export const updateBeliefSchema = z.object({
  title: z.string().trim().min(1).optional(),
  category: z.enum(["AI_TREND", "INVESTMENT", "TECH_TREND", "CAREER", "SOURCE_RELIABILITY"]).optional(),
  description: z.string().optional(),
  probabilityMode: z.enum(["MUTUALLY_EXCLUSIVE", "INDEPENDENT"]).optional(),
  status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]).optional()
});

export const updateHypothesisSchema = z.object({
  beliefId: z.string().min(1).optional(),
  proposition: z.string().trim().min(1).optional(),
  notes: z.string().optional(),
  evidenceSearchQuery: z.string().optional(),
  stance: z.enum(["SUPPORTS", "OPPOSES"]).optional(),
  priorProbability: probabilitySchema.optional(),
  currentProbability: probabilitySchema.optional(),
  status: z.enum(["ACTIVE", "PAUSED", "RESOLVED_TRUE", "RESOLVED_FALSE", "ARCHIVED"]).optional(),
  startsAt: z.date().nullable().optional(),
  expiresAt: z.date().nullable().optional(),
  expiryCondition: z.string().optional(),
  resolvedOutcome: z.string().optional()
});

export const createObservationSchema = z.object({
  sourceId: z.string().optional(),
  title: z.string().trim().min(1, "Observation title is required"),
  content: z.string().trim().min(1, "Observation content is required"),
  url: z.string().url().optional(),
  author: z.string().optional(),
  publishedAt: z.date().optional(),
  credibility: probabilitySchema.optional(),
  normalizedHash: z.string().optional(),
  semanticKey: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export const updateObservationSchema = z.object({
  sourceId: z.string().nullable().optional(),
  title: z.string().trim().min(1, "Observation title is required").optional(),
  content: z.string().trim().min(1, "Observation content is required").optional(),
  url: z.string().url().optional(),
  author: z.string().optional(),
  credibility: probabilitySchema.optional(),
  normalizedHash: z.string().optional(),
  semanticKey: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export const evidenceLinkSchema = z.object({
  hypothesisId: z.string().min(1),
  direction: z.enum(["SUPPORTS", "OPPOSES", "MIXED", "NEUTRAL"]),
  relevance: probabilitySchema,
  likelihoodRatio: z.number().finite().positive(),
  confidence: probabilitySchema,
  rationale: z.string().trim().min(1),
  reviewRequired: z.boolean().optional(),
  estimatorOutputs: z.array(z.custom<EstimatorOutput>()).optional()
});
export const evidenceLinksSchema = z.array(evidenceLinkSchema).min(1);
export const editableEvidenceLinksSchema = z.array(evidenceLinkSchema);

export const confirmEvidenceSchema = z.object({
  observationId: z.string().min(1),
  confirmationMode: z.enum(["MANUAL", "AUTO"]),
  links: evidenceLinksSchema
});

export const updateEvidenceSchema = z.object({
  title: z.string().trim().min(1).optional(),
  content: z.string().trim().min(1).optional(),
  url: z.string().url().optional(),
  credibility: probabilitySchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  links: editableEvidenceLinksSchema.optional()
});

export const connectEvidenceHypothesisSchema = z.object({
  hypothesisId: z.string().min(1),
  direction: z.enum(["SUPPORTS", "OPPOSES", "MIXED", "NEUTRAL"]),
  relevance: probabilitySchema,
  likelihoodRatio: z.number().finite().positive(),
  confidence: probabilitySchema,
  rationale: z.string().trim().min(1)
});

export const disconnectEvidenceHypothesisSchema = z.object({
  hypothesisId: z.string().min(1)
});

export const sourceSchema = z.object({
  name: z.string().trim().min(1),
  kind: z.enum(["MANUAL", "RSS", "WEB_PAGE", "SEARCH", "GITHUB", "HUGGING_FACE", "GDELT", "PREDICTION_MARKET", "SOCIAL"]),
  url: z.string().url().optional(),
  adapter: z.string().trim().min(1),
  credentialRef: z.string().optional(),
  credibility: probabilitySchema,
  enabled: z.boolean(),
  autoConfirm: z.boolean(),
  autoConfirmThreshold: probabilitySchema
});
export const updateSourceSchema = sourceSchema.partial();

export const artifactSchema = z.object({
  name: z.string().trim().min(1),
  kind: z.enum(["LIGHTWEIGHT", "LLM", "DEEP_ADAPTER"]),
  version: z.string().trim().min(1),
  path: z.string().trim().min(1),
  metrics: z.record(z.string(), z.unknown()),
  enabled: z.boolean()
});

export const automationHeartbeatSchema = z.object({
  id: z.string().trim().min(1),
  status: z.enum(["RUNNING", "IDLE", "ERROR"]),
  heartbeatAt: z.date(),
  nextRunAt: z.date().optional(),
  intervalMs: z.number().int().nonnegative(),
  consecutiveFailureCount: z.number().int().nonnegative(),
  lastNotice: z.string().optional(),
  lastError: z.string().optional()
});

export const automationWorkerConfigSchema = z.object({
  id: z.string().trim().min(1),
  enabled: z.boolean(),
  intervalMs: z.number().int().positive(),
  failureBackoffMultiplier: z.number().finite().min(1),
  maxIntervalMs: z.number().int().positive(),
  reviewOnly: z.boolean(),
  maxQueries: z.number().int().positive().optional(),
  maxSources: z.number().int().positive().optional(),
  beliefIds: z.array(z.string().trim().min(1)).optional(),
  sourceIds: z.array(z.string().trim().min(1)).optional(),
  maxObservations: z.number().int().positive().optional(),
  candidateThreshold: probabilitySchema.optional(),
  autoConfirmThreshold: probabilitySchema.optional(),
  bootstrapDefaultSources: z.boolean(),
  forceAutoApply: z.boolean(),
  duplicateObservationCleanup: z.enum(["KEEP", "REJECT", "DELETE"]).optional(),
  unmatchedObservationCleanup: z.enum(["KEEP", "REJECT", "DELETE"]).optional(),
  lowImpactObservationCleanup: z.enum(["KEEP", "REJECT", "DELETE"]).optional()
});

export function parseBeliefInput(input: CreateBeliefInput) {
  if (input.probabilityMode === "INDEPENDENT") {
    return independentBeliefSchema.parse(input);
  }
  return createBeliefSchema.parse(input);
}
