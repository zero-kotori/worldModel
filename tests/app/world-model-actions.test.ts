import { vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createBelief: vi.fn(),
  createHypothesis: vi.fn(),
  updateHypothesis: vi.fn(),
  createObservation: vi.fn(),
  updateObservation: vi.fn(),
  listObservations: vi.fn(),
  rejectObservation: vi.fn(),
  deleteObservation: vi.fn(),
  settleObservation: vi.fn(),
  applyEvidence: vi.fn(),
  updateAndReapplyEvidence: vi.fn(),
  disconnectEvidenceHypothesis: vi.fn(),
  listBeliefs: vi.fn(),
  confirmAndApplyObservation: vi.fn(),
  listEvidence: vi.fn(),
  listSources: vi.fn(),
  createMissingPresets: vi.fn(),
  updateSource: vi.fn(),
  runSource: vi.fn(),
  runDryRun: vi.fn(),
  importArtifact: vi.fn(),
  runEvidenceLoop: vi.fn(),
  createDryRunSourceServices: vi.fn((services: { sources: { runDryRun: unknown }; beliefs: { listBeliefs: unknown } }) => ({
    runDryRun: services.sources.runDryRun,
    listBeliefs: services.beliefs.listBeliefs
  })),
  runObserveLoopDryRun: vi.fn(),
  saveWorkerConfig: vi.fn(),
  listWorkerConfigs: vi.fn(),
  startWorker: vi.fn(),
  stopWorker: vi.fn(),
  loadLlmEvaluationArtifact: vi.fn(),
  runLlmEvaluationCommand: vi.fn(),
  runLocalLightweightTrainingPipeline: vi.fn(),
  runFetchTrainingDataCommand: vi.fn(),
  readModelArtifactImportInput: vi.fn(),
  redirect: vi.fn((target: string) => {
    throw new Error(`NEXT_REDIRECT:${target}`);
  }),
  revalidatePath: vi.fn()
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect
}));

vi.mock("@/server/services", () => ({
  getWorldModelServices: () => ({
    beliefs: {
      createBelief: mocks.createBelief,
      createHypothesis: mocks.createHypothesis,
      updateHypothesis: mocks.updateHypothesis,
      listBeliefs: mocks.listBeliefs
    },
    evidence: {
      confirmAndApplyObservation: mocks.confirmAndApplyObservation,
      updateAndReapply: mocks.updateAndReapplyEvidence,
      disconnectHypothesis: mocks.disconnectEvidenceHypothesis,
      listEvidence: mocks.listEvidence
    },
    updates: {
      applyEvidence: mocks.applyEvidence
    },
    observations: {
      createObservation: mocks.createObservation,
      updateObservation: mocks.updateObservation,
      listObservations: mocks.listObservations,
      rejectObservation: mocks.rejectObservation,
      deleteObservation: mocks.deleteObservation,
      settleObservation: mocks.settleObservation
    },
    sources: {
      listSources: mocks.listSources,
      createMissingPresets: mocks.createMissingPresets,
      updateSource: mocks.updateSource,
      runDryRun: mocks.runDryRun,
      runSource: mocks.runSource
    },
    models: {
      importArtifact: mocks.importArtifact
    },
    automation: {
      runEvidenceLoop: mocks.runEvidenceLoop,
      saveWorkerConfig: mocks.saveWorkerConfig,
      listWorkerConfigs: mocks.listWorkerConfigs
    }
  })
}));

vi.mock("@/server/automation/local-worker", () => ({
  getEvidenceLoopWorkerController: () => ({
    start: mocks.startWorker,
    stop: mocks.stopWorker,
    getStatus: vi.fn()
  })
}));

vi.mock("@/server/automation/evidence-loop-dry-run", () => ({
  createDryRunSourceServices: mocks.createDryRunSourceServices,
  runObserveLoopDryRun: mocks.runObserveLoopDryRun
}));

vi.mock("@/server/training/llm-evaluation-artifact", () => ({
  loadLlmEvaluationArtifact: mocks.loadLlmEvaluationArtifact,
  runLlmEvaluationCommand: mocks.runLlmEvaluationCommand
}));

vi.mock("@/server/training/model-artifact-import", () => ({
  readModelArtifactImportInput: mocks.readModelArtifactImportInput
}));

vi.mock("@/server/training/local-training-pipeline", () => ({
  runLocalLightweightTrainingPipeline: mocks.runLocalLightweightTrainingPipeline
}));

vi.mock("@/server/training/training-data-fetch-runner", () => ({
  runFetchTrainingDataCommand: mocks.runFetchTrainingDataCommand
}));

function beliefForm(overrides: Record<string, string> = {}) {
  const formData = new FormData();
  const values = {
    title: "Agent adoption signal",
    category: "AI_TREND",
    description: "Teams report that agent adoption changes delivery quality.",
    probabilityMode: "INDEPENDENT",
    proposition1: "Agent adoption signal 会持续影响这个判断",
    stance1: "SUPPORTS",
    priorProbability1: "0.45",
    proposition2: "Agent adoption signal 的影响有限或不可持续",
    stance2: "OPPOSES",
    priorProbability2: "0.35",
    sourceObservationId: "observation_unmatched",
    ...overrides
  };
  for (const [key, value] of Object.entries(values)) {
    formData.set(key, value);
  }
  return formData;
}

function observationConnectionForm() {
  const formData = new FormData();
  formData.set("returnPath", "/admin/world-model/graph");
  formData.set("observationId", "observation_orders");
  formData.append("linkHypothesisIds", "hypothesis_support");
  formData.set("direction:hypothesis_support", "SUPPORTS");
  formData.set("relevance:hypothesis_support", "0.8");
  formData.set("likelihoodRatio:hypothesis_support", "2.1");
  formData.set("confidence:hypothesis_support", "0.72");
  formData.set("rationale:hypothesis_support", "订单恢复支持需求改善。");
  formData.append("linkHypothesisIds", "hypothesis_oppose");
  formData.set("direction:hypothesis_oppose", "OPPOSES");
  formData.set("relevance:hypothesis_oppose", "0.64");
  formData.set("likelihoodRatio:hypothesis_oppose", "0.48");
  formData.set("confidence:hypothesis_oppose", "0.69");
  formData.set("rationale:hypothesis_oppose", "订单恢复削弱不可持续假设。");
  return formData;
}

function manualEvidenceForm() {
  const formData = observationConnectionForm();
  formData.delete("returnPath");
  formData.set("title", "Manual order recovery signal");
  formData.set("content", "The source says order recovery exceeded the prior expectation.");
  formData.set("url", "https://example.com/manual-orders");
  formData.set("author", "Operations review");
  formData.set("credibility", "0.82");
  return formData;
}

function sourceObservationConnectionForm() {
  const formData = new FormData();
  formData.set("returnPath", "/admin/world-model/graph?source=S-001");
  formData.set("sourceId", "source_news");
  formData.set("observationId", "observation_signal");
  return formData;
}

function evidenceUpdateForm() {
  const formData = new FormData();
  formData.set("returnPath", "/admin/world-model/graph?evidence=E-001");
  formData.set("evidenceId", "evidence_orders");
  formData.set("title", "Updated order recovery signal");
  formData.set("content", "Orders recovered faster than the base-rate expectation.");
  formData.set("url", "https://example.com/orders");
  formData.set("credibility", "0.82");
  formData.append("linkHypothesisIds", "hypothesis_support");
  formData.set("direction:hypothesis_support", "SUPPORTS");
  formData.set("relevance:hypothesis_support", "0.91");
  formData.set("likelihoodRatio:hypothesis_support", "2.4");
  formData.set("confidence:hypothesis_support", "0.77");
  formData.set("rationale:hypothesis_support", "订单恢复增强需求改善假设。");
  formData.append("linkHypothesisIds", "hypothesis_oppose");
  formData.set("direction:hypothesis_oppose", "OPPOSES");
  formData.set("relevance:hypothesis_oppose", "0.68");
  formData.set("likelihoodRatio:hypothesis_oppose", "0.44");
  formData.set("confidence:hypothesis_oppose", "0.71");
  formData.set("rationale:hypothesis_oppose", "订单恢复削弱需求不可持续假设。");
  return formData;
}

function evidenceApplyForm() {
  const formData = new FormData();
  formData.set("returnPath", "/admin/world-model/evidence?evidence=E-001#E-001");
  formData.set("evidenceId", "evidence_orders");
  return formData;
}

function evidenceDisconnectForm() {
  const formData = new FormData();
  formData.set("returnPath", "/admin/world-model/graph?evidence=E-001");
  formData.set("evidenceId", "evidence_orders");
  formData.set("hypothesisId", "hypothesis_support");
  return formData;
}

function hypothesisUpdateForm() {
  const formData = new FormData();
  formData.set("returnPath", "/admin/world-model/graph?hypothesis=H-001");
  formData.set("hypothesisId", "hypothesis_agents");
  formData.set("beliefId", "belief_ai_agents");
  formData.set("proposition", "AI agents improve delivery");
  formData.set("notes", "Tracked from real evidence.");
  formData.set("stance", "SUPPORTS");
  formData.set("priorProbability", "0.4");
  formData.set("currentProbability", "0.82");
  formData.set("status", "RESOLVED_TRUE");
  formData.set("resolvedOutcome", "2026 Q2 internal rollout improved delivery throughput.");
  return formData;
}

function settlementObservationForm(outcome = "RESOLVED_TRUE") {
  const formData = new FormData();
  formData.set("returnPath", "/admin/world-model/observations#review-candidates");
  formData.set("observationId", "observation_settlement");
  formData.set("hypothesisId", "hypothesis_agents");
  formData.set("outcome", outcome);
  formData.set("resolvedOutcome", "The tracked rollout reached the final outcome.");
  return formData;
}

function recommendedEvidenceForm() {
  const formData = new FormData();
  formData.set("observationId", "observation_review_required");
  return formData;
}

function duplicateRejectForm(...observationIds: string[]) {
  const formData = new FormData();
  formData.set("returnPath", "/admin/world-model/observations#duplicate-candidates");
  for (const observationId of observationIds) {
    formData.append("observationIds", observationId);
  }
  return formData;
}

function lowImpactRejectForm(...observationIds: string[]) {
  const formData = new FormData();
  formData.set("returnPath", "/admin/world-model/observations#unknown-evidence");
  for (const observationId of observationIds) {
    formData.append("observationIds", observationId);
  }
  return formData;
}

function unknownRejectForm(...observationIds: string[]) {
  const formData = new FormData();
  formData.set("returnPath", "/admin/world-model/observations#unknown-evidence");
  for (const observationId of observationIds) {
    formData.append("observationIds", observationId);
  }
  return formData;
}

function confirmedEvidenceRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "evidence_confirmed",
    observationId: "observation_review_required",
    title: "AI agents accelerate engineering teams",
    content: "The source is relevant but attribution should be reviewed.",
    confirmedAt: new Date("2026-06-18T02:00:00.000Z"),
    confirmationMode: "MANUAL",
    credibility: 0.8,
    status: "ACTIVE",
    metadata: {},
    links: [],
    ...overrides
  };
}

function sourceUpdateForm(overrides: Record<string, string> = {}) {
  const formData = new FormData();
  const values = {
    sourceId: "source_signal",
    name: "Reviewed signal source",
    kind: "RSS",
    url: "https://example.com/reviewed.xml",
    adapter: "rss",
    credentialRef: "signal-feed",
    credibility: "0.72",
    enabled: "on",
    autoConfirm: "on",
    autoConfirmThreshold: "0.62",
    ...overrides
  };
  for (const [key, value] of Object.entries(values)) {
    formData.set(key, value);
  }
  return formData;
}

function sourceCalibrationForm(overrides: Record<string, string> = {}) {
  const formData = new FormData();
  const values = {
    sourceId: "source_signal",
    credibility: "0.47",
    autoConfirmThreshold: "0.92",
    ...overrides
  };
  for (const [key, value] of Object.entries(values)) {
    formData.set(key, value);
  }
  return formData;
}

function sourceRunForm() {
  const formData = new FormData();
  formData.set("sourceId", "source_github");
  formData.append("beliefIds", "belief_ai_agents");
  formData.append("beliefIds", "belief_career");
  return formData;
}

function scopedSourceRunForm() {
  const formData = sourceRunForm();
  formData.set("returnPath", "/admin/world-model/sources?belief=B-001");
  return formData;
}

function sourceDryRunForm(overrides: Record<string, string> = {}) {
  const formData = new FormData();
  const values = {
    sourceId: "source_github",
    sampleTitle: "Dry run signal",
    sampleUrl: "https://example.com/dry-run",
    sampleContent: "Dry-run sample content from a real source parser.",
    ...overrides
  };
  for (const [key, value] of Object.entries(values)) {
    formData.set(key, value);
  }
  return formData;
}

function modelArtifactForm() {
  const formData = new FormData();
  formData.set("name", "lightweight-local");
  formData.set("kind", "LIGHTWEIGHT");
  formData.set("version", "0.1.0");
  formData.set("path", "./model-artifacts/lightweight-local.json");
  formData.set("sampleCount", "24");
  formData.set("enabled", "on");
  return formData;
}

function llmEvaluationForm() {
  const formData = new FormData();
  formData.set("outputDir", "D:\\working\\worldModel\\output\\training");
  formData.set("limit", "7");
  return formData;
}

function fetchTrainingDataForm() {
  const formData = new FormData();
  formData.set("limit", "12");
  formData.set("outputDir", "D:\\working\\worldModel\\output\\training");
  return formData;
}

function lightweightTrainingForm() {
  const formData = new FormData();
  formData.set("outputDir", "D:\\working\\worldModel\\output\\training");
  return formData;
}

function evidenceLoopForm() {
  const formData = new FormData();
  formData.set("reviewOnly", "on");
  formData.append("beliefIds", "belief_ai_agents");
  formData.append("beliefIds", "belief_career");
  formData.append("sourceIds", "source_github");
  formData.append("sourceIds", "source_hf");
  formData.set("maxQueries", "3");
  formData.set("maxSources", "2");
  formData.set("maxObservations", "5");
  formData.set("candidateThreshold", "0.2");
  formData.set("autoConfirmThreshold", "0.8");
  formData.set("bootstrapDefaultSources", "on");
  formData.set("duplicateObservationCleanup", "REJECT");
  formData.set("unmatchedObservationCleanup", "KEEP");
  formData.set("lowImpactObservationCleanup", "KEEP");
  return formData;
}

function scopedEvidenceLoopForm() {
  const formData = evidenceLoopForm();
  formData.set("returnPath", "/admin/world-model/sources?belief=B-001#evidence-loop");
  return formData;
}

function autoApplyEvidenceLoopForm() {
  const formData = new FormData();
  formData.set("maxQueries", "3");
  formData.set("maxSources", "2");
  formData.set("maxObservations", "5");
  formData.set("candidateThreshold", "0.2");
  formData.set("autoConfirmThreshold", "0.8");
  formData.set("bootstrapDefaultSources", "on");
  formData.set("forceAutoApply", "on");
  return formData;
}

function workerForm() {
  const formData = new FormData();
  formData.set("workerId", "nightly");
  formData.set("intervalSeconds", "600");
  formData.set("failureBackoffMultiplier", "3");
  formData.set("maxIntervalSeconds", "3600");
  formData.set("reviewOnly", "on");
  formData.append("beliefIds", "belief_ai_agents");
  formData.append("beliefIds", "belief_career");
  formData.append("sourceIds", "source_github");
  formData.append("sourceIds", "source_hf");
  formData.set("maxQueries", "4");
  formData.set("maxSources", "2");
  formData.set("maxObservations", "12");
  formData.set("candidateThreshold", "0.3");
  formData.set("autoConfirmThreshold", "0.82");
  formData.set("bootstrapDefaultSources", "on");
  formData.set("forceAutoApply", "on");
  formData.set("duplicateObservationCleanup", "REJECT");
  formData.set("unmatchedObservationCleanup", "DELETE");
  formData.set("lowImpactObservationCleanup", "REJECT");
  return formData;
}

function autoApplyWorkerForm() {
  const formData = workerForm();
  formData.delete("reviewOnly");
  formData.set("forceAutoApply", "on");
  return formData;
}

function riskyLlmEvaluationArtifact() {
  return {
    generatedAt: new Date("2026-06-18T01:00:00.000Z"),
    samplesPath: "model-artifacts/training-samples.jsonl",
    summary: {
      modelName: "deepseek:deepseek-v4-flash",
      sampleCount: 50,
      scoredCount: 50,
      directionAccuracy: {
        SUPPORTS: { total: 20, scored: 20, correct: 16, accuracy: 0.8 },
        OPPOSES: { total: 15, scored: 15, correct: 12, accuracy: 0.8 },
        NEUTRAL: { total: 15, scored: 15, correct: 12, accuracy: 0.8 }
      },
      likelihoodRatio: { min: 0.4, max: 10, mean: 2.4 },
      lowConfidenceCount: 4,
      lowConfidenceRate: 0.08,
      reviewRequiredCount: 23,
      reviewRequiredRate: 0.46,
      fallbackComparedCount: 50,
      fallbackDivergenceCount: 4,
      fallbackDivergenceRate: 0.08
    }
  };
}

function safeLlmEvaluationArtifact() {
  return {
    generatedAt: new Date("2026-06-18T01:00:00.000Z"),
    samplesPath: "model-artifacts/training-samples.jsonl",
    summary: {
      modelName: "deepseek:deepseek-v4-flash",
      sampleCount: 50,
      scoredCount: 50,
      directionAccuracy: {
        SUPPORTS: { total: 20, scored: 20, correct: 18, accuracy: 0.9 },
        OPPOSES: { total: 15, scored: 15, correct: 14, accuracy: 0.93 },
        NEUTRAL: { total: 15, scored: 15, correct: 14, accuracy: 0.93 }
      },
      likelihoodRatio: { min: 0.4, max: 10, mean: 2.4 },
      lowConfidenceCount: 1,
      lowConfidenceRate: 0.02,
      reviewRequiredCount: 4,
      reviewRequiredRate: 0.08,
      fallbackComparedCount: 50,
      fallbackDivergenceCount: 2,
      fallbackDivergenceRate: 0.04
    }
  };
}

function activeBeliefWithHypothesis() {
  const createdAt = new Date("2026-06-11T00:00:00.000Z");
  return {
    id: "belief_ai_agents",
    title: "AI agents",
    category: "AI_TREND",
    description: "",
    probabilityMode: "INDEPENDENT",
    status: "ACTIVE",
    createdAt,
    updatedAt: createdAt,
    hypotheses: [
      {
        id: "hypothesis_agents",
        beliefId: "belief_ai_agents",
        proposition: "AI agents improve delivery",
        notes: "",
        stance: "SUPPORTS",
        priorProbability: 0.4,
        currentProbability: 0.4,
        strength: 0.4,
        status: "ACTIVE",
        createdAt,
        updatedAt: createdAt
      },
      {
        id: "hypothesis_agents_counter",
        beliefId: "belief_ai_agents",
        proposition: "AI agents have limited delivery impact",
        notes: "",
        stance: "OPPOSES",
        priorProbability: 0.35,
        currentProbability: 0.35,
        strength: 0.35,
        status: "ACTIVE",
        createdAt,
        updatedAt: createdAt
      }
    ]
  };
}

function upcomingBeliefWithHypothesis() {
  const belief = activeBeliefWithHypothesis();
  return {
    ...belief,
    hypotheses: belief.hypotheses.map((hypothesis) => ({
      ...hypothesis,
      startsAt: new Date("2099-01-01T00:00:00.000Z")
    }))
  };
}

function redirectedMessage() {
  const target = mocks.redirect.mock.calls[0]?.[0] ?? "";
  return new URLSearchParams(target.split("?", 2)[1] ?? "").get("message") ?? "";
}

describe("world model actions", () => {
  beforeEach(() => {
    mocks.createBelief.mockReset();
    mocks.createBelief.mockResolvedValue({});
    mocks.createHypothesis.mockReset();
    mocks.createHypothesis.mockResolvedValue({});
    mocks.updateHypothesis.mockReset();
    mocks.updateHypothesis.mockResolvedValue({});
    mocks.updateObservation.mockReset();
    mocks.updateObservation.mockResolvedValue({});
    mocks.createObservation.mockReset();
    mocks.createObservation.mockResolvedValue({
      id: "observation_manual",
      title: "Manual order recovery signal",
      content: "The source says order recovery exceeded the prior expectation.",
      url: "https://example.com/manual-orders",
      author: "Operations review",
      observedAt: new Date("2026-06-18T03:00:00.000Z"),
      status: "PENDING",
      credibility: 0.82,
      metadata: {}
    });
    mocks.listObservations.mockReset();
    mocks.listObservations.mockResolvedValue([]);
    mocks.rejectObservation.mockReset();
    mocks.rejectObservation.mockResolvedValue({});
    mocks.deleteObservation.mockReset();
    mocks.deleteObservation.mockResolvedValue({});
    mocks.settleObservation.mockReset();
    mocks.settleObservation.mockResolvedValue({});
    mocks.applyEvidence.mockReset();
    mocks.applyEvidence.mockResolvedValue([]);
    mocks.updateAndReapplyEvidence.mockReset();
    mocks.updateAndReapplyEvidence.mockResolvedValue({});
    mocks.disconnectEvidenceHypothesis.mockReset();
    mocks.disconnectEvidenceHypothesis.mockResolvedValue({});
    mocks.listBeliefs.mockReset();
    mocks.listBeliefs.mockResolvedValue([activeBeliefWithHypothesis()]);
    mocks.confirmAndApplyObservation.mockReset();
    mocks.confirmAndApplyObservation.mockResolvedValue({
      evidence: confirmedEvidenceRecord(),
      event: null,
      events: []
    });
    mocks.listEvidence.mockReset();
    mocks.listEvidence.mockResolvedValue([confirmedEvidenceRecord()]);
    mocks.listSources.mockReset();
    mocks.createMissingPresets.mockReset();
    mocks.listSources.mockResolvedValue([
      {
        id: "source_github",
        name: "GitHub Search",
        kind: "GITHUB",
        autoConfirm: false
      }
    ]);
    mocks.updateSource.mockReset();
    mocks.updateSource.mockResolvedValue({});
    mocks.runSource.mockReset();
    mocks.runSource.mockResolvedValue({
      id: "run_source_github",
      sourceId: "source_github",
      status: "SUCCESS",
      startedAt: new Date("2026-06-12T00:00:00.000Z"),
      itemCount: 0,
      reprocessedObservationCount: 0,
      deduplicatedCount: 0,
      candidateCount: 0,
      autoAppliedCount: 0,
      reviewCount: 0,
      lowImpactCount: 0,
      unmatchedCount: 0,
      queryCount: 0,
      querySummary: []
    });
    mocks.runDryRun.mockReset();
    mocks.runDryRun.mockResolvedValue({
      id: "run_dry",
      sourceId: "source_github",
      status: "DRY_RUN",
      startedAt: new Date("2026-06-12T00:00:00.000Z"),
      itemCount: 0,
      reprocessedObservationCount: 0,
      deduplicatedCount: 0,
      candidateCount: 0,
      autoAppliedCount: 0,
      reviewCount: 0,
      lowImpactCount: 0,
      unmatchedCount: 0,
      queryCount: 0,
      querySummary: []
    });
    mocks.runEvidenceLoop.mockReset();
    mocks.runEvidenceLoop.mockResolvedValue({
      mode: "review-only",
      queryCount: 0,
      sourceRunCount: 0,
      skippedSourceCount: 0,
      skippedSources: [],
      itemCount: 0,
      reprocessedObservationCount: 0,
      deduplicatedCount: 0,
      candidateCount: 0,
      autoAppliedCount: 0,
      reviewCount: 0,
      lowImpactCount: 0,
      unmatchedCount: 0,
      failureCount: 0,
      queries: [],
      runs: []
    });
    mocks.createDryRunSourceServices.mockClear();
    mocks.runObserveLoopDryRun.mockReset();
    mocks.runObserveLoopDryRun.mockResolvedValue({
      mode: "dry-run",
      runs: [
        {
          id: "run_dry",
          sourceId: "source_github",
          status: "DRY_RUN",
          startedAt: new Date("2026-06-12T00:00:00.000Z"),
          itemCount: 2,
          reprocessedObservationCount: 0,
          deduplicatedCount: 1,
          candidateCount: 0,
          autoAppliedCount: 0,
          reviewCount: 0,
          lowImpactCount: 0,
          unmatchedCount: 0,
          queryCount: 0,
          querySummary: [],
          source: "GitHub Search"
        }
      ]
    });
    mocks.saveWorkerConfig.mockReset();
    mocks.saveWorkerConfig.mockResolvedValue({
      id: "nightly",
      enabled: true,
      intervalMs: 600_000,
      failureBackoffMultiplier: 3,
      maxIntervalMs: 3_600_000,
      reviewOnly: true,
      maxQueries: 4,
      maxSources: 2,
      beliefIds: ["belief_ai_agents", "belief_career"],
      sourceIds: ["source_github", "source_hf"],
      maxObservations: 12,
      candidateThreshold: 0.3,
      autoConfirmThreshold: 0.82,
      bootstrapDefaultSources: true,
      forceAutoApply: true,
      duplicateObservationCleanup: "REJECT",
      unmatchedObservationCleanup: "DELETE",
      lowImpactObservationCleanup: "REJECT",
      createdAt: new Date("2026-06-12T00:00:00.000Z"),
      updatedAt: new Date("2026-06-12T00:00:00.000Z")
    });
    mocks.listWorkerConfigs.mockReset();
    mocks.listWorkerConfigs.mockResolvedValue([]);
    mocks.startWorker.mockReset();
    mocks.startWorker.mockResolvedValue({ workerId: "nightly", running: true });
    mocks.stopWorker.mockReset();
    mocks.stopWorker.mockResolvedValue(undefined);
    mocks.loadLlmEvaluationArtifact.mockReset();
    mocks.loadLlmEvaluationArtifact.mockResolvedValue(null);
    mocks.runLlmEvaluationCommand.mockReset();
    mocks.runLlmEvaluationCommand.mockResolvedValue({
      evaluated: true,
      outputPath: "model-artifacts/llm-evaluation.json",
      summary: {
        modelName: "deepseek:deepseek-chat",
        sampleCount: 12,
        scoredCount: 10,
        sourceCounts: { fever: 6, scifact: 6 },
        directionAccuracy: {
          SUPPORTS: { total: 4, scored: 4, correct: 3, accuracy: 0.75 },
          OPPOSES: { total: 4, scored: 3, correct: 2, accuracy: 2 / 3 },
          NEUTRAL: { total: 4, scored: 3, correct: 1, accuracy: 1 / 3 }
        },
        likelihoodRatio: { min: 0.4, max: 10, mean: 2.8 },
        lowConfidenceCount: 2,
        lowConfidenceRate: 1 / 6,
        reviewRequiredCount: 3,
        reviewRequiredRate: 0.25,
        fallbackComparedCount: 8,
        fallbackDivergenceCount: 2,
        fallbackDivergenceRate: 0.25
      }
    });
    mocks.runLocalLightweightTrainingPipeline.mockReset();
    mocks.runLocalLightweightTrainingPipeline.mockResolvedValue({
      preparedSampleCount: 153,
      trained: true,
      artifactPath: "model-artifacts/lightweight-local.json",
      artifact: {
        id: "model_lightweight",
        name: "lightweight-local",
        kind: "LIGHTWEIGHT",
        version: "0.1.0",
        path: "model-artifacts/lightweight-local.json",
        enabled: true,
        metrics: {
          sampleCount: 153,
          sourceCounts: { fever: 20, local_confirmed: 1 }
        },
        createdAt: new Date("2026-06-18T01:00:00.000Z")
      }
    });
    mocks.runFetchTrainingDataCommand.mockReset();
    mocks.runFetchTrainingDataCommand.mockResolvedValue({
      fetched: true,
      sampleCount: 48,
      sourceCounts: { fever: 12, scifact: 12, climate_fever: 20, cfever: 4 },
      samplesPath: "D:\\working\\worldModel\\model-artifacts\\external-training-samples.jsonl",
      manifestPath: "D:\\working\\worldModel\\model-artifacts\\external-training-manifest.json"
    });
    mocks.readModelArtifactImportInput.mockReset();
    mocks.readModelArtifactImportInput.mockResolvedValue({
      name: "lightweight-local",
      kind: "LIGHTWEIGHT",
      version: "0.1.0",
      path: "model-artifacts/lightweight-local.json",
      metrics: {
        importedBy: "admin-form",
        trained: true,
        sampleCount: 24,
        sourceCounts: { fever: 8, scifact: 8, climate_fever: 8 }
      },
      enabled: true
    });
    mocks.redirect.mockClear();
    mocks.revalidatePath.mockClear();
  });

  it("passes source observations through when creating a source-seeded belief table", async () => {
    const { createBeliefAction } = await import("@/app/admin/world-model/actions");

    await expect(createBeliefAction(beliefForm())).rejects.toThrow(
      "NEXT_REDIRECT:/admin/world-model/observations?message="
    );

    expect(mocks.createBelief).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceObservationId: "observation_unmatched",
        hypotheses: [
          expect.objectContaining({
            proposition: "Agent adoption signal 会持续影响这个判断",
            priorProbability: 0.45,
            stance: "SUPPORTS"
          }),
          expect.objectContaining({
            proposition: "Agent adoption signal 的影响有限或不可持续",
            priorProbability: 0.35,
            stance: "OPPOSES"
          })
        ]
      })
    );
    expect(mocks.redirect.mock.calls[0]?.[0]).toContain("#review-candidates");
  });

  it("routes a newly accepted recommended hypothesis back to the requeued review candidate", async () => {
    const formData = new FormData();
    formData.set("beliefId", "belief_agent_adoption");
    formData.set("proposition", "Agent adoption signal 持续影响「Agent adoption」");
    formData.set("stance", "SUPPORTS");
    formData.set("priorProbability", "0.45");
    formData.set("notes", "来自未匹配观察。");
    formData.set("evidenceSearchQuery", "AI agents adoption signal structured query");
    formData.set("sourceObservationId", "observation_unmatched");
    const { createRecommendedHypothesisAction } = await import("@/app/admin/world-model/actions");

    await expect(createRecommendedHypothesisAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/world-model/observations?message="
    );

    expect(mocks.createHypothesis).toHaveBeenCalledWith(
      "belief_agent_adoption",
      expect.objectContaining({
        proposition: "Agent adoption signal 持续影响「Agent adoption」",
        notes: "来自未匹配观察。",
        evidenceSearchQuery: "AI agents adoption signal structured query",
        sourceObservationId: "observation_unmatched"
      })
    );
    expect(mocks.redirect.mock.calls[0]?.[0]).toContain("#review-candidates");
  });

  it("confirms a graph observation connection with multiple hypothesis links", async () => {
    const { connectObservationHypothesisAction } = await import("@/app/admin/world-model/actions");

    await expect(connectObservationHypothesisAction(observationConnectionForm())).rejects.toThrow(
      "NEXT_REDIRECT:/admin/world-model/evidence?evidence=E-001&message="
    );

    expect(mocks.redirect.mock.calls[0]?.[0]).toContain("#E-001");
    expect(mocks.confirmAndApplyObservation).toHaveBeenCalledWith({
      observationId: "observation_orders",
      confirmationMode: "MANUAL",
      links: [
        {
          hypothesisId: "hypothesis_support",
          direction: "SUPPORTS",
          relevance: 0.8,
          likelihoodRatio: 2.1,
          confidence: 0.72,
          rationale: "订单恢复支持需求改善。"
        },
        {
          hypothesisId: "hypothesis_oppose",
          direction: "OPPOSES",
          relevance: 0.64,
          likelihoodRatio: 0.48,
          confidence: 0.69,
          rationale: "订单恢复削弱不可持续假设。"
        }
      ]
    });
  });

  it("focuses the created evidence after confirming a graph observation", async () => {
    const { confirmGraphObservationAction } = await import("@/app/admin/world-model/actions");

    await expect(confirmGraphObservationAction(observationConnectionForm())).rejects.toThrow(
      "NEXT_REDIRECT:/admin/world-model/evidence?evidence=E-001&message="
    );

    expect(mocks.redirect.mock.calls[0]?.[0]).toContain("#E-001");
    expect(mocks.confirmAndApplyObservation).toHaveBeenCalledWith({
      observationId: "observation_orders",
      confirmationMode: "MANUAL",
      links: [
        {
          hypothesisId: "hypothesis_support",
          direction: "SUPPORTS",
          relevance: 0.8,
          likelihoodRatio: 2.1,
          confidence: 0.72,
          rationale: "订单恢复支持需求改善。"
        },
        {
          hypothesisId: "hypothesis_oppose",
          direction: "OPPOSES",
          relevance: 0.64,
          likelihoodRatio: 0.48,
          confidence: 0.69,
          rationale: "订单恢复削弱不可持续假设。"
        }
      ]
    });
  });

  it("focuses the created evidence after confirming an evidence-page observation", async () => {
    const { confirmEvidenceAction } = await import("@/app/admin/world-model/actions");

    await expect(confirmEvidenceAction(observationConnectionForm())).rejects.toThrow(
      "NEXT_REDIRECT:/admin/world-model/evidence?evidence=E-001&message="
    );

    expect(mocks.redirect.mock.calls[0]?.[0]).toContain("#E-001");
    expect(mocks.confirmAndApplyObservation).toHaveBeenCalledWith({
      observationId: "observation_orders",
      confirmationMode: "MANUAL",
      links: [
        {
          hypothesisId: "hypothesis_support",
          direction: "SUPPORTS",
          relevance: 0.8,
          likelihoodRatio: 2.1,
          confidence: 0.72,
          rationale: "订单恢复支持需求改善。"
        },
        {
          hypothesisId: "hypothesis_oppose",
          direction: "OPPOSES",
          relevance: 0.64,
          likelihoodRatio: 0.48,
          confidence: 0.69,
          rationale: "订单恢复削弱不可持续假设。"
        }
      ]
    });
  });

  it("focuses the created evidence after manually recording evidence", async () => {
    const { createEvidenceFromObservationAction } = await import("@/app/admin/world-model/actions");

    await expect(createEvidenceFromObservationAction(manualEvidenceForm())).rejects.toThrow(
      "NEXT_REDIRECT:/admin/world-model/evidence?evidence=E-001&message="
    );

    expect(mocks.redirect.mock.calls[0]?.[0]).toContain("#E-001");
    expect(mocks.createObservation).toHaveBeenCalledWith({
      title: "Manual order recovery signal",
      content: "The source says order recovery exceeded the prior expectation.",
      url: "https://example.com/manual-orders",
      author: "Operations review",
      credibility: 0.82
    });
    expect(mocks.confirmAndApplyObservation).toHaveBeenCalledWith({
      observationId: "observation_manual",
      confirmationMode: "MANUAL",
      links: [
        {
          hypothesisId: "hypothesis_support",
          direction: "SUPPORTS",
          relevance: 0.8,
          likelihoodRatio: 2.1,
          confidence: 0.72,
          rationale: "订单恢复支持需求改善。"
        },
        {
          hypothesisId: "hypothesis_oppose",
          direction: "OPPOSES",
          relevance: 0.64,
          likelihoodRatio: 0.48,
          confidence: 0.69,
          rationale: "订单恢复削弱不可持续假设。"
        }
      ]
    });
  });

  it("assigns an observation to a source from a graph connection", async () => {
    const { connectSourceObservationAction } = await import("@/app/admin/world-model/actions");

    await expect(connectSourceObservationAction(sourceObservationConnectionForm())).rejects.toThrow(
      "NEXT_REDIRECT:/admin/world-model/graph?source=S-001&message="
    );

    expect(mocks.updateObservation).toHaveBeenCalledWith("observation_signal", {
      sourceId: "source_news"
    });
  });

  it("passes settlement outcomes through when updating a hypothesis", async () => {
    const { updateHypothesisAction } = await import("@/app/admin/world-model/actions");

    await expect(updateHypothesisAction(hypothesisUpdateForm())).rejects.toThrow(
      "NEXT_REDIRECT:/admin/world-model/graph?hypothesis=H-001&message="
    );

    expect(mocks.updateHypothesis).toHaveBeenCalledWith(
      "hypothesis_agents",
      expect.objectContaining({
        beliefId: "belief_ai_agents",
        status: "RESOLVED_TRUE",
        priorProbability: 0.4,
        currentProbability: 0.82,
        resolvedOutcome: "2026 Q2 internal rollout improved delivery throughput."
      })
    );
  });

  it("settles a hypothesis from a settlement review observation and consumes the observation", async () => {
    const { settleObservationAction } = await import("@/app/admin/world-model/actions");

    await expect(settleObservationAction(settlementObservationForm("RESOLVED_FALSE"))).rejects.toThrow(
      "NEXT_REDIRECT:/admin/world-model/observations?message="
    );

    expect(mocks.settleObservation).toHaveBeenCalledWith({
      observationId: "observation_settlement",
      hypothesisId: "hypothesis_agents",
      outcome: "RESOLVED_FALSE",
      resolvedOutcome: "The tracked rollout reached the final outcome."
    });
  });

  it("rejects duplicate observation candidates in bulk and returns to the duplicate queue", async () => {
    const { rejectDuplicateObservationsAction } = await import("@/app/admin/world-model/actions");

    await expect(rejectDuplicateObservationsAction(duplicateRejectForm("observation_dup_1", "observation_dup_2"))).rejects.toThrow(
      "NEXT_REDIRECT:/admin/world-model/observations?message="
    );

    expect(mocks.rejectObservation).toHaveBeenNthCalledWith(1, "observation_dup_1");
    expect(mocks.rejectObservation).toHaveBeenNthCalledWith(2, "observation_dup_2");
    expect(mocks.redirect.mock.calls[0]?.[0]).toContain("#duplicate-candidates");
  });

  it("deletes duplicate observation candidates in bulk and returns to the duplicate queue", async () => {
    const { deleteDuplicateObservationsAction } = await import("@/app/admin/world-model/actions");

    await expect(deleteDuplicateObservationsAction(duplicateRejectForm("observation_dup_1", "observation_dup_2"))).rejects.toThrow(
      "NEXT_REDIRECT:/admin/world-model/observations?message="
    );

    expect(mocks.deleteObservation).toHaveBeenNthCalledWith(1, "observation_dup_1");
    expect(mocks.deleteObservation).toHaveBeenNthCalledWith(2, "observation_dup_2");
    expect(mocks.redirect.mock.calls[0]?.[0]).toContain("#duplicate-candidates");
  });

  it("rejects low-impact unknown observations in bulk and returns to the unknown evidence queue", async () => {
    const { rejectLowImpactObservationsAction } = await import("@/app/admin/world-model/actions");

    await expect(rejectLowImpactObservationsAction(lowImpactRejectForm("observation_low_impact_1", "observation_low_impact_2"))).rejects.toThrow(
      "NEXT_REDIRECT:/admin/world-model/observations?message="
    );

    expect(mocks.rejectObservation).toHaveBeenNthCalledWith(1, "observation_low_impact_1");
    expect(mocks.rejectObservation).toHaveBeenNthCalledWith(2, "observation_low_impact_2");
    expect(mocks.redirect.mock.calls[0]?.[0]).toContain("#unknown-evidence");
  });

  it("deletes low-impact unknown observations in bulk and returns to the unknown evidence queue", async () => {
    const { deleteLowImpactObservationsAction } = await import("@/app/admin/world-model/actions");

    await expect(deleteLowImpactObservationsAction(lowImpactRejectForm("observation_low_impact_1", "observation_low_impact_2"))).rejects.toThrow(
      "NEXT_REDIRECT:/admin/world-model/observations?message="
    );

    expect(mocks.deleteObservation).toHaveBeenNthCalledWith(1, "observation_low_impact_1");
    expect(mocks.deleteObservation).toHaveBeenNthCalledWith(2, "observation_low_impact_2");
    expect(mocks.redirect.mock.calls[0]?.[0]).toContain("#unknown-evidence");
  });

  it("rejects unknown evidence queue observations in bulk and returns to the unknown evidence queue", async () => {
    const { rejectUnknownObservationsAction } = await import("@/app/admin/world-model/actions");

    await expect(rejectUnknownObservationsAction(unknownRejectForm("observation_unknown_1", "observation_unknown_2"))).rejects.toThrow(
      "NEXT_REDIRECT:/admin/world-model/observations?message="
    );

    expect(mocks.rejectObservation).toHaveBeenNthCalledWith(1, "observation_unknown_1");
    expect(mocks.rejectObservation).toHaveBeenNthCalledWith(2, "observation_unknown_2");
    expect(mocks.redirect.mock.calls[0]?.[0]).toContain("#unknown-evidence");
  });

  it("deletes unknown evidence queue observations in bulk and returns to the unknown evidence queue", async () => {
    const { deleteUnknownObservationsAction } = await import("@/app/admin/world-model/actions");

    await expect(deleteUnknownObservationsAction(unknownRejectForm("observation_unknown_1", "observation_unknown_2"))).rejects.toThrow(
      "NEXT_REDIRECT:/admin/world-model/observations?message="
    );

    expect(mocks.deleteObservation).toHaveBeenNthCalledWith(1, "observation_unknown_1");
    expect(mocks.deleteObservation).toHaveBeenNthCalledWith(2, "observation_unknown_2");
    expect(mocks.redirect.mock.calls[0]?.[0]).toContain("#unknown-evidence");
  });

  it("preserves LLM review-required metadata when confirming recommended evidence", async () => {
    mocks.listObservations.mockResolvedValue([
      {
        id: "observation_review_required",
        title: "AI agents accelerate engineering teams",
        content: "The source is relevant but attribution should be reviewed.",
        status: "PENDING",
        credibility: 0.8,
        observedAt: new Date("2026-06-18T01:00:00.000Z"),
        metadata: {
          recommendedLinks: [
            {
              hypothesisId: "hypothesis_agents",
              direction: "SUPPORTS",
              relevance: 0.91,
              likelihoodRatio: 2.4,
              confidence: 0.88,
              rationale: "LLM requires source attribution review.",
              reviewRequired: true,
              estimatorOutputs: [
                {
                  estimator: "llm",
                  direction: "SUPPORTS",
                  relevance: 0.91,
                  likelihoodRatio: 2.4,
                  confidence: 0.88,
                  weight: 3,
                  rationale: "LLM requires source attribution review.",
                  reviewRequired: true,
                  modelVersion: "deepseek:deepseek-chat"
                }
              ]
            }
          ],
          reviewReason: "LLM_REVIEW_REQUIRED"
        }
      }
    ]);
    const { confirmRecommendedEvidenceAction } = await import("@/app/admin/world-model/actions");

    await expect(confirmRecommendedEvidenceAction(recommendedEvidenceForm())).rejects.toThrow(
      "NEXT_REDIRECT:/admin/world-model/evidence?evidence=E-001&message="
    );

    expect(mocks.redirect.mock.calls[0]?.[0]).toContain("#E-001");
    expect(mocks.confirmAndApplyObservation).toHaveBeenCalledWith({
      observationId: "observation_review_required",
      confirmationMode: "MANUAL",
      links: [
        {
          hypothesisId: "hypothesis_agents",
          direction: "SUPPORTS",
          relevance: 0.91,
          likelihoodRatio: 2.4,
          confidence: 0.88,
          rationale: "LLM requires source attribution review.",
          reviewRequired: true,
          estimatorOutputs: [
            {
              estimator: "llm",
              direction: "SUPPORTS",
              relevance: 0.91,
              likelihoodRatio: 2.4,
              confidence: 0.88,
              weight: 3,
              rationale: "LLM requires source attribution review.",
              reviewRequired: true,
              modelVersion: "deepseek:deepseek-chat"
            }
          ]
        }
      ]
    });
    expect(mocks.listEvidence).toHaveBeenCalled();
  });

  it("updates evidence through the reapply service and preserves graph return context", async () => {
    const { updateEvidenceAction } = await import("@/app/admin/world-model/actions");

    await expect(updateEvidenceAction(evidenceUpdateForm())).rejects.toThrow(
      "NEXT_REDIRECT:/admin/world-model/graph?evidence=E-001&message="
    );

    expect(mocks.updateAndReapplyEvidence).toHaveBeenCalledWith("evidence_orders", {
      title: "Updated order recovery signal",
      content: "Orders recovered faster than the base-rate expectation.",
      url: "https://example.com/orders",
      credibility: 0.82,
      links: [
        {
          hypothesisId: "hypothesis_support",
          direction: "SUPPORTS",
          relevance: 0.91,
          likelihoodRatio: 2.4,
          confidence: 0.77,
          rationale: "订单恢复增强需求改善假设。"
        },
        {
          hypothesisId: "hypothesis_oppose",
          direction: "OPPOSES",
          relevance: 0.68,
          likelihoodRatio: 0.44,
          confidence: 0.71,
          rationale: "订单恢复削弱需求不可持续假设。"
        }
      ]
    });
  });

  it("applies evidence updates while preserving the focused evidence return context", async () => {
    const { applyEvidenceUpdateAction } = await import("@/app/admin/world-model/actions");

    await expect(applyEvidenceUpdateAction(evidenceApplyForm())).rejects.toThrow(
      "NEXT_REDIRECT:/admin/world-model/evidence?evidence=E-001&message="
    );

    expect(mocks.redirect.mock.calls[0]?.[0]).toContain("#E-001");
    expect(mocks.applyEvidence).toHaveBeenCalledWith("evidence_orders");
  });

  it("disconnects an evidence-hypothesis graph edge through the dedicated service", async () => {
    const { disconnectEvidenceHypothesisAction } = await import("@/app/admin/world-model/actions");

    await expect(disconnectEvidenceHypothesisAction(evidenceDisconnectForm())).rejects.toThrow(
      "NEXT_REDIRECT:/admin/world-model/graph?evidence=E-001&message="
    );

    expect(mocks.disconnectEvidenceHypothesis).toHaveBeenCalledWith("evidence_orders", {
      hypothesisId: "hypothesis_support"
    });
  });

  it("updates source configuration from the sources page form", async () => {
    const { updateSourceAction } = await import("@/app/admin/world-model/actions");

    await expect(updateSourceAction(sourceUpdateForm())).rejects.toThrow("NEXT_REDIRECT:/admin/world-model/sources?message=");

    expect(mocks.updateSource).toHaveBeenCalledWith("source_signal", {
      name: "Reviewed signal source",
      kind: "RSS",
      url: "https://example.com/reviewed.xml",
      adapter: "rss",
      credentialRef: "signal-feed",
      credibility: 0.72,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.62
    });
  });

  it("preserves graph return context when updating source configuration from the graph workspace", async () => {
    const { updateSourceAction } = await import("@/app/admin/world-model/actions");

    await expect(updateSourceAction(sourceUpdateForm({ returnPath: "/admin/world-model/graph?source=S-001" }))).rejects.toThrow(
      "NEXT_REDIRECT:/admin/world-model/graph?source=S-001&message="
    );

    expect(mocks.updateSource).toHaveBeenCalledWith("source_signal", {
      name: "Reviewed signal source",
      kind: "RSS",
      url: "https://example.com/reviewed.xml",
      adapter: "rss",
      credentialRef: "signal-feed",
      credibility: 0.72,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.62
    });
  });

  it("applies source evidence quality calibration without overwriting unrelated source fields", async () => {
    const { applySourceCalibrationAction } = await import("@/app/admin/world-model/actions");

    await expect(applySourceCalibrationAction(sourceCalibrationForm())).rejects.toThrow(
      "NEXT_REDIRECT:/admin/world-model/sources?message="
    );

    expect(mocks.updateSource).toHaveBeenCalledWith("source_signal", {
      credibility: 0.47,
      autoConfirmThreshold: 0.92
    });
  });

  it("preserves graph return context when applying source calibration", async () => {
    const { applySourceCalibrationAction } = await import("@/app/admin/world-model/actions");

    await expect(
      applySourceCalibrationAction(sourceCalibrationForm({ returnPath: "/admin/world-model/graph?source=S-001" }))
    ).rejects.toThrow("NEXT_REDIRECT:/admin/world-model/graph?source=S-001&message=");

    expect(mocks.updateSource).toHaveBeenCalledWith("source_signal", {
      credibility: 0.47,
      autoConfirmThreshold: 0.92
    });
  });

  it("passes selected belief scope into source collection runs", async () => {
    const { runSourceAction } = await import("@/app/admin/world-model/actions");

    await expect(runSourceAction(sourceRunForm())).rejects.toThrow("NEXT_REDIRECT:/admin/world-model/sources?message=");

    expect(mocks.runSource).toHaveBeenCalledWith("source_github", {
      beliefIds: ["belief_ai_agents", "belief_career"]
    });
  });

  it("passes selected belief scope into review-only source collection runs", async () => {
    const { runSourceReviewOnlyAction } = await import("@/app/admin/world-model/actions");

    await expect(runSourceReviewOnlyAction(sourceRunForm())).rejects.toThrow(
      "NEXT_REDIRECT:/admin/world-model/sources?message="
    );

    expect(mocks.runSource).toHaveBeenCalledWith("source_github", {
      reviewOnly: true,
      beliefIds: ["belief_ai_agents", "belief_career"]
    });
  });

  it("keeps source dry-run redirects on the selected belief context", async () => {
    const { runSourceDryRunAction } = await import("@/app/admin/world-model/actions");

    await expect(runSourceDryRunAction(sourceDryRunForm({ returnPath: "/admin/world-model/sources?belief=B-001" }))).rejects.toThrow(
      "NEXT_REDIRECT:/admin/world-model/sources?belief=B-001&message="
    );

    expect(mocks.runDryRun).toHaveBeenCalledWith("source_github", [
      {
        title: "Dry run signal",
        content: "Dry-run sample content from a real source parser.",
        url: "https://example.com/dry-run"
      }
    ]);
  });

  it("keeps source collection redirects on the selected belief context", async () => {
    const { runSourceAction } = await import("@/app/admin/world-model/actions");

    await expect(runSourceAction(scopedSourceRunForm())).rejects.toThrow(
      "NEXT_REDIRECT:/admin/world-model/sources?belief=B-001&message="
    );
  });

  it("routes source collection runs with review candidates to the observation review queue", async () => {
    mocks.runSource.mockResolvedValue({
      id: "run_source_github",
      sourceId: "source_github",
      status: "REVIEW_ONLY",
      startedAt: new Date("2026-06-12T00:00:00.000Z"),
      itemCount: 2,
      reprocessedObservationCount: 0,
      deduplicatedCount: 0,
      candidateCount: 2,
      autoAppliedCount: 0,
      reviewCount: 2,
      lowImpactCount: 0,
      unmatchedCount: 0,
      queryCount: 1,
      querySummary: []
    });
    const { runSourceAction } = await import("@/app/admin/world-model/actions");

    await expect(runSourceAction(sourceRunForm())).rejects.toThrow(
      "NEXT_REDIRECT:/admin/world-model/observations?message="
    );

    expect(mocks.redirect.mock.calls[0]?.[0]).toContain("#review-candidates");
  });

  it("focuses the latest evidence after an auto-confirming source run applies updates", async () => {
    mocks.listSources.mockResolvedValue([
      {
        id: "source_github",
        name: "GitHub Search",
        kind: "GITHUB",
        autoConfirm: true
      }
    ]);
    mocks.loadLlmEvaluationArtifact.mockResolvedValue(safeLlmEvaluationArtifact());
    mocks.runSource.mockResolvedValue({
      id: "run_source_github",
      sourceId: "source_github",
      status: "SUCCESS",
      startedAt: new Date("2026-06-12T00:00:00.000Z"),
      itemCount: 1,
      reprocessedObservationCount: 0,
      deduplicatedCount: 0,
      candidateCount: 1,
      autoAppliedCount: 1,
      reviewCount: 0,
      lowImpactCount: 0,
      unmatchedCount: 0,
      queryCount: 1,
      querySummary: []
    });
    mocks.listEvidence.mockResolvedValue([
      confirmedEvidenceRecord({
        id: "evidence_old",
        confirmedAt: new Date("2026-06-17T00:00:00.000Z")
      }),
      confirmedEvidenceRecord({
        id: "evidence_new",
        confirmedAt: new Date("2026-06-18T00:00:00.000Z")
      })
    ]);
    const { runSourceAction } = await import("@/app/admin/world-model/actions");

    await expect(runSourceAction(sourceRunForm())).rejects.toThrow(
      "NEXT_REDIRECT:/admin/world-model/evidence?evidence=E-002&message="
    );

    expect(mocks.redirect.mock.calls[0]?.[0]).toContain("#E-002");
  });

  it("downgrades auto-confirming source collection runs when LLM evaluation quality is risky", async () => {
    mocks.listSources.mockResolvedValue([
      {
        id: "source_github",
        name: "GitHub Search",
        kind: "GITHUB",
        autoConfirm: true
      }
    ]);
    mocks.loadLlmEvaluationArtifact.mockResolvedValue(riskyLlmEvaluationArtifact());
    const { runSourceAction } = await import("@/app/admin/world-model/actions");

    await expect(runSourceAction(sourceRunForm())).rejects.toThrow("NEXT_REDIRECT:/admin/world-model/sources?message=");

    expect(mocks.runSource).toHaveBeenCalledWith("source_github", {
      beliefIds: ["belief_ai_agents", "belief_career"],
      reviewOnly: true,
      forceAutoApply: false
    });
    expect(mocks.redirect.mock.calls[0]?.[0]).toContain("LLM");
  });

  it("downgrades auto-confirming source collection runs when no scoped hypothesis is currently effective", async () => {
    mocks.listSources.mockResolvedValue([
      {
        id: "source_github",
        name: "GitHub Search",
        kind: "GITHUB",
        autoConfirm: true
      }
    ]);
    mocks.listBeliefs.mockResolvedValue([upcomingBeliefWithHypothesis()]);
    mocks.loadLlmEvaluationArtifact.mockResolvedValue(safeLlmEvaluationArtifact());
    const { runSourceAction } = await import("@/app/admin/world-model/actions");

    await expect(runSourceAction(sourceRunForm())).rejects.toThrow("NEXT_REDIRECT:/admin/world-model/sources?message=");

    expect(mocks.runSource).toHaveBeenCalledWith("source_github", {
      beliefIds: ["belief_ai_agents", "belief_career"],
      reviewOnly: true,
      forceAutoApply: false
    });
    expect(redirectedMessage()).toContain("没有当前有效假设");
  });

  it("imports model artifacts with metrics read from the local artifact file", async () => {
    const { importModelArtifactAction } = await import("@/app/admin/world-model/actions");

    await expect(importModelArtifactAction(modelArtifactForm())).rejects.toThrow("NEXT_REDIRECT:/admin/world-model/models?message=");

    expect(mocks.readModelArtifactImportInput).toHaveBeenCalledWith("./model-artifacts/lightweight-local.json", {
      name: "lightweight-local",
      kind: "LIGHTWEIGHT",
      version: "0.1.0",
      enabled: true,
      fallbackMetrics: {
        importedBy: "admin-form",
        sampleCount: 24
      }
    });
    expect(mocks.importArtifact).toHaveBeenCalledWith({
      name: "lightweight-local",
      kind: "LIGHTWEIGHT",
      version: "0.1.0",
      path: "model-artifacts/lightweight-local.json",
      metrics: {
        importedBy: "admin-form",
        trained: true,
        sampleCount: 24,
        sourceCounts: { fever: 8, scifact: 8, climate_fever: 8 }
      },
      enabled: true
    });
  });

  it("runs LLM evaluation from the models page form", async () => {
    const { runLlmEvaluationAction } = await import("@/app/admin/world-model/actions");

    await expect(runLlmEvaluationAction(llmEvaluationForm())).rejects.toThrow(
      "NEXT_REDIRECT:/admin/world-model/models?message="
    );

    expect(mocks.runLlmEvaluationCommand).toHaveBeenCalledWith({
      outputDir: "D:\\working\\worldModel\\output\\training",
      outputPath: "model-artifacts/llm-evaluation.json",
      limit: 7,
      env: process.env
    });
    expect(redirectedMessage()).toContain("LLM 评估已完成：样本 12，已评分 10，需复核 3");
  });

  it("prepares local training samples, trains, and imports the lightweight model from the models page", async () => {
    const { trainLightweightModelAction } = await import("@/app/admin/world-model/actions");

    await expect(trainLightweightModelAction(lightweightTrainingForm())).rejects.toThrow(
      "NEXT_REDIRECT:/admin/world-model/models?message="
    );

    expect(mocks.runLocalLightweightTrainingPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        models: expect.objectContaining({
          importArtifact: mocks.importArtifact
        })
      }),
      { outputDir: "D:\\working\\worldModel\\output\\training" }
    );
    expect(redirectedMessage()).toContain("轻量模型训练已完成：样本 153，已导入 lightweight-local");
  });

  it("fetches real public training samples from the models page", async () => {
    const { fetchTrainingDataAction } = await import("@/app/admin/world-model/actions");

    await expect(fetchTrainingDataAction(fetchTrainingDataForm())).rejects.toThrow(
      "NEXT_REDIRECT:/admin/world-model/models?message="
    );

    expect(mocks.runFetchTrainingDataCommand).toHaveBeenCalledWith({
      limit: 12,
      outputDir: "D:\\working\\worldModel\\output\\training"
    });
    expect(redirectedMessage()).toContain("真实训练样本已抓取：样本 48");
    expect(redirectedMessage()).toContain("fever 12");
    expect(redirectedMessage()).toContain("cfever 4");
  });

  it("passes maximum query count into evidence loop runs", async () => {
    const { runEvidenceLoopAction } = await import("@/app/admin/world-model/actions");

    await expect(runEvidenceLoopAction(evidenceLoopForm())).rejects.toThrow("NEXT_REDIRECT:/admin/world-model/sources?message=");

    expect(mocks.runEvidenceLoop).toHaveBeenCalledWith({
      reviewOnly: true,
      beliefIds: ["belief_ai_agents", "belief_career"],
      sourceIds: ["source_github", "source_hf"],
      maxQueries: 3,
      maxSources: 2,
      maxObservations: 5,
      candidateThreshold: 0.2,
      autoConfirmThreshold: 0.8,
      bootstrapDefaultSources: true,
      forceAutoApply: false,
      duplicateObservationCleanup: "REJECT",
      unmatchedObservationCleanup: "KEEP",
      lowImpactObservationCleanup: "KEEP"
    });
  });

  it("keeps evidence loop redirects on the selected belief and loop anchor", async () => {
    const { runEvidenceLoopAction } = await import("@/app/admin/world-model/actions");

    await expect(runEvidenceLoopAction(scopedEvidenceLoopForm())).rejects.toThrow(
      "NEXT_REDIRECT:/admin/world-model/sources?belief=B-001&message="
    );
    expect(mocks.redirect.mock.calls[0]?.[0]).toContain("#evidence-loop");
  });

  it("runs evidence loop dry-runs through configured source dry-runs instead of the writable loop", async () => {
    const { runEvidenceLoopDryRunAction } = await import("@/app/admin/world-model/actions");
    const formData = scopedEvidenceLoopForm();
    formData.delete("sourceIds");

    await expect(runEvidenceLoopDryRunAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin/world-model/sources?belief=B-001&message="
    );

    expect(mocks.listSources).toHaveBeenCalled();
    expect(mocks.createMissingPresets).toHaveBeenCalled();
    expect(mocks.createMissingPresets.mock.invocationCallOrder[0]).toBeLessThan(mocks.listSources.mock.invocationCallOrder[0]);
    expect(mocks.runObserveLoopDryRun).toHaveBeenCalledWith(
      [
        {
          id: "source_github",
          name: "GitHub Search",
          kind: "GITHUB",
          autoConfirm: false
        }
      ],
      expect.objectContaining({
        runDryRun: mocks.runDryRun,
        listBeliefs: expect.any(Function)
      }),
      {
        beliefIds: ["belief_ai_agents", "belief_career"],
        sourceIds: undefined,
        maxQueries: 3,
        maxSources: 2,
        maxObservations: 5,
        bootstrapDefaultSources: true
      }
    );
    expect(mocks.runEvidenceLoop).not.toHaveBeenCalled();
    expect(mocks.redirect.mock.calls[0]?.[0]).toContain("#evidence-loop");
    expect(redirectedMessage()).toContain("闭环预检已运行：来源 1，查询 0，采集 2，去重 1，失败 0");
  });

  it("redirects evidence loop runs with remaining manual follow-up work", async () => {
    mocks.runEvidenceLoop.mockResolvedValue({
      mode: "review-only",
      queryCount: 1,
      sourceRunCount: 1,
      skippedSourceCount: 0,
      skippedSources: [],
      itemCount: 6,
      reprocessedObservationCount: 0,
      deduplicatedCount: 0,
      candidateCount: 5,
      autoAppliedCount: 0,
      reviewCount: 2,
      lowImpactCount: 1,
      unmatchedCount: 3,
      failureCount: 0,
      queries: [],
      runs: []
    });
    const { runEvidenceLoopAction } = await import("@/app/admin/world-model/actions");

    await expect(runEvidenceLoopAction(evidenceLoopForm())).rejects.toThrow(
      "NEXT_REDIRECT:/admin/world-model/observations?message="
    );

    expect(mocks.redirect.mock.calls[0]?.[0]).toContain("#review-candidates");
    expect(redirectedMessage()).toContain("仍需处理：2 条待审候选需要确认");
    expect(redirectedMessage()).toContain("1 条低影响观察需要人工确认、调整关系或拒绝");
    expect(redirectedMessage()).toContain("3 条未匹配观察需要补充假设");
  });

  it("routes unmatched evidence loop runs to hypothesis recommendations for the newest unmatched observation", async () => {
    mocks.runEvidenceLoop.mockResolvedValue({
      mode: "review-only",
      queryCount: 1,
      sourceRunCount: 1,
      skippedSourceCount: 0,
      skippedSources: [],
      itemCount: 2,
      reprocessedObservationCount: 0,
      deduplicatedCount: 0,
      candidateCount: 0,
      autoAppliedCount: 0,
      reviewCount: 0,
      lowImpactCount: 0,
      unmatchedCount: 1,
      failureCount: 0,
      queries: [],
      runs: []
    });
    mocks.listObservations.mockResolvedValue([
      {
        id: "observation_old_unmatched",
        title: "Old unmatched observation",
        content: "Old unmatched content",
        observedAt: new Date("2026-06-17T00:00:00.000Z"),
        status: "UNKNOWN",
        credibility: 0.6,
        metadata: { ignoredReason: "UNMATCHED" }
      },
      {
        id: "observation_new_unmatched",
        title: "New unmatched observation",
        content: "New unmatched content",
        observedAt: new Date("2026-06-18T00:00:00.000Z"),
        status: "UNKNOWN",
        credibility: 0.7,
        metadata: { ignoredReason: "UNMATCHED" }
      }
    ]);
    const { runEvidenceLoopAction } = await import("@/app/admin/world-model/actions");

    await expect(runEvidenceLoopAction(evidenceLoopForm())).rejects.toThrow(
      "NEXT_REDIRECT:/admin/world-model/beliefs?sourceObservation=O-002&message="
    );

    expect(mocks.redirect.mock.calls[0]?.[0]).toContain("#recommendations");
  });

  it("focuses the latest evidence when an evidence loop auto-applies updates without manual follow-up", async () => {
    mocks.loadLlmEvaluationArtifact.mockResolvedValue(safeLlmEvaluationArtifact());
    mocks.runEvidenceLoop.mockResolvedValue({
      mode: "auto-apply",
      queryCount: 1,
      sourceRunCount: 1,
      skippedSourceCount: 0,
      skippedSources: [],
      itemCount: 1,
      reprocessedObservationCount: 0,
      deduplicatedCount: 0,
      candidateCount: 1,
      autoAppliedCount: 1,
      reviewCount: 0,
      lowImpactCount: 0,
      unmatchedCount: 0,
      failureCount: 0,
      queries: [],
      runs: []
    });
    mocks.listEvidence.mockResolvedValue([
      confirmedEvidenceRecord({
        id: "evidence_old",
        confirmedAt: new Date("2026-06-17T00:00:00.000Z")
      }),
      confirmedEvidenceRecord({
        id: "evidence_new",
        confirmedAt: new Date("2026-06-18T00:00:00.000Z")
      })
    ]);
    const { runEvidenceLoopAction } = await import("@/app/admin/world-model/actions");

    await expect(runEvidenceLoopAction(autoApplyEvidenceLoopForm())).rejects.toThrow(
      "NEXT_REDIRECT:/admin/world-model/evidence?evidence=E-002&message="
    );

    expect(mocks.redirect.mock.calls[0]?.[0]).toContain("#E-002");
  });

  it("downgrades requested auto-apply evidence loops when LLM evaluation quality is risky", async () => {
    mocks.loadLlmEvaluationArtifact.mockResolvedValue(riskyLlmEvaluationArtifact());
    const { runEvidenceLoopAction } = await import("@/app/admin/world-model/actions");

    await expect(runEvidenceLoopAction(autoApplyEvidenceLoopForm())).rejects.toThrow(
      "NEXT_REDIRECT:/admin/world-model/sources?message="
    );

    expect(mocks.runEvidenceLoop).toHaveBeenCalledWith({
      reviewOnly: true,
      maxQueries: 3,
      maxSources: 2,
      maxObservations: 5,
      candidateThreshold: 0.2,
      autoConfirmThreshold: 0.8,
      bootstrapDefaultSources: true,
      forceAutoApply: false,
      duplicateObservationCleanup: "REJECT",
      unmatchedObservationCleanup: "KEEP",
      lowImpactObservationCleanup: "KEEP"
    });
    expect(redirectedMessage()).toContain("LLM 评估风险");
  });

  it("downgrades requested auto-apply evidence loops when no hypothesis is currently effective", async () => {
    mocks.listBeliefs.mockResolvedValue([upcomingBeliefWithHypothesis()]);
    mocks.loadLlmEvaluationArtifact.mockResolvedValue(safeLlmEvaluationArtifact());
    const { runEvidenceLoopAction } = await import("@/app/admin/world-model/actions");

    await expect(runEvidenceLoopAction(autoApplyEvidenceLoopForm())).rejects.toThrow(
      "NEXT_REDIRECT:/admin/world-model/sources?message="
    );

    expect(mocks.runEvidenceLoop).toHaveBeenCalledWith({
      reviewOnly: true,
      maxQueries: 3,
      maxSources: 2,
      maxObservations: 5,
      candidateThreshold: 0.2,
      autoConfirmThreshold: 0.8,
      bootstrapDefaultSources: true,
      forceAutoApply: false,
      duplicateObservationCleanup: "REJECT",
      unmatchedObservationCleanup: "KEEP",
      lowImpactObservationCleanup: "KEEP"
    });
    expect(redirectedMessage()).toContain("没有当前有效假设");
  });

  it("persists worker bounds and starts the evidence loop worker with an immediate run", async () => {
    const { startEvidenceLoopWorkerAction } = await import("@/app/admin/world-model/actions");

    await expect(startEvidenceLoopWorkerAction(workerForm())).rejects.toThrow("NEXT_REDIRECT:/admin/world-model/sources?message=");

    expect(mocks.saveWorkerConfig).toHaveBeenCalledWith({
      id: "nightly",
      enabled: true,
      intervalMs: 600_000,
      failureBackoffMultiplier: 3,
      maxIntervalMs: 3_600_000,
      reviewOnly: true,
      maxQueries: 4,
      maxSources: 2,
      beliefIds: ["belief_ai_agents", "belief_career"],
      sourceIds: ["source_github", "source_hf"],
      maxObservations: 12,
      candidateThreshold: 0.3,
      autoConfirmThreshold: 0.82,
      bootstrapDefaultSources: true,
      forceAutoApply: true,
      duplicateObservationCleanup: "REJECT",
      unmatchedObservationCleanup: "DELETE",
      lowImpactObservationCleanup: "REJECT"
    });
    expect(mocks.startWorker).toHaveBeenCalledWith(
      {
        workerId: "nightly",
        intervalMs: 600_000,
        failureBackoffMultiplier: 3,
        maxIntervalMs: 3_600_000,
        runImmediately: true,
        loopOptions: {
          reviewOnly: true,
          maxQueries: 4,
          maxSources: 2,
          beliefIds: ["belief_ai_agents", "belief_career"],
          sourceIds: ["source_github", "source_hf"],
          maxObservations: 12,
          candidateThreshold: 0.3,
          autoConfirmThreshold: 0.82,
          bootstrapDefaultSources: true,
          forceAutoApply: true,
          duplicateObservationCleanup: "REJECT",
          unmatchedObservationCleanup: "DELETE",
          lowImpactObservationCleanup: "REJECT"
        }
      },
      expect.objectContaining({
        automation: expect.objectContaining({
          saveWorkerConfig: mocks.saveWorkerConfig
        })
      })
    );
    expect(redirectedMessage()).toContain("已立即运行一次");
  });

  it("downgrades requested auto-apply workers when LLM evaluation quality is risky", async () => {
    mocks.loadLlmEvaluationArtifact.mockResolvedValue(riskyLlmEvaluationArtifact());
    mocks.saveWorkerConfig.mockResolvedValue({
      id: "nightly",
      enabled: true,
      intervalMs: 600_000,
      failureBackoffMultiplier: 3,
      maxIntervalMs: 3_600_000,
      reviewOnly: true,
      maxQueries: 4,
      maxSources: 2,
      beliefIds: ["belief_ai_agents", "belief_career"],
      sourceIds: ["source_github", "source_hf"],
      maxObservations: 12,
      candidateThreshold: 0.3,
      autoConfirmThreshold: 0.82,
      bootstrapDefaultSources: true,
      forceAutoApply: false,
      createdAt: new Date("2026-06-12T00:00:00.000Z"),
      updatedAt: new Date("2026-06-12T00:00:00.000Z")
    });
    const { startEvidenceLoopWorkerAction } = await import("@/app/admin/world-model/actions");

    await expect(startEvidenceLoopWorkerAction(autoApplyWorkerForm())).rejects.toThrow(
      "NEXT_REDIRECT:/admin/world-model/sources?message="
    );

    expect(mocks.saveWorkerConfig).toHaveBeenCalledWith({
      id: "nightly",
      enabled: true,
      intervalMs: 600_000,
      failureBackoffMultiplier: 3,
      maxIntervalMs: 3_600_000,
      reviewOnly: true,
      maxQueries: 4,
      maxSources: 2,
      beliefIds: ["belief_ai_agents", "belief_career"],
      sourceIds: ["source_github", "source_hf"],
      maxObservations: 12,
      candidateThreshold: 0.3,
      autoConfirmThreshold: 0.82,
      bootstrapDefaultSources: true,
      forceAutoApply: false,
      duplicateObservationCleanup: "REJECT",
      unmatchedObservationCleanup: "DELETE",
      lowImpactObservationCleanup: "REJECT"
    });
    expect(mocks.startWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        loopOptions: expect.objectContaining({
          reviewOnly: true,
          forceAutoApply: false
        })
      }),
      expect.objectContaining({
        automation: expect.objectContaining({
          saveWorkerConfig: mocks.saveWorkerConfig
        })
      })
    );
  });

  it("downgrades requested auto-apply workers when no hypothesis is currently effective", async () => {
    mocks.listBeliefs.mockResolvedValue([upcomingBeliefWithHypothesis()]);
    mocks.loadLlmEvaluationArtifact.mockResolvedValue(safeLlmEvaluationArtifact());
    mocks.saveWorkerConfig.mockImplementation(async (input) => ({
      ...input,
      createdAt: new Date("2026-06-12T00:00:00.000Z"),
      updatedAt: new Date("2026-06-12T00:00:00.000Z")
    }));
    const { startEvidenceLoopWorkerAction } = await import("@/app/admin/world-model/actions");

    await expect(startEvidenceLoopWorkerAction(autoApplyWorkerForm())).rejects.toThrow(
      "NEXT_REDIRECT:/admin/world-model/sources?message="
    );

    expect(mocks.saveWorkerConfig).toHaveBeenCalledWith({
      id: "nightly",
      enabled: true,
      intervalMs: 600_000,
      failureBackoffMultiplier: 3,
      maxIntervalMs: 3_600_000,
      reviewOnly: true,
      maxQueries: 4,
      maxSources: 2,
      beliefIds: ["belief_ai_agents", "belief_career"],
      sourceIds: ["source_github", "source_hf"],
      maxObservations: 12,
      candidateThreshold: 0.3,
      autoConfirmThreshold: 0.82,
      bootstrapDefaultSources: true,
      forceAutoApply: false,
      duplicateObservationCleanup: "REJECT",
      unmatchedObservationCleanup: "DELETE",
      lowImpactObservationCleanup: "REJECT"
    });
    expect(mocks.startWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        loopOptions: expect.objectContaining({
          reviewOnly: true,
          forceAutoApply: false
        })
      }),
      expect.objectContaining({
        automation: expect.objectContaining({
          saveWorkerConfig: mocks.saveWorkerConfig
        })
      })
    );
    expect(redirectedMessage()).toContain("没有当前有效假设");
  });
});
