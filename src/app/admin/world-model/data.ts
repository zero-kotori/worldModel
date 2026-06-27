import "server-only";

import { getEvidenceLoopWorkerController } from "@/server/automation/local-worker";
import { getWorldModelServices } from "@/server/services";
import { loadLlmEvaluationArtifact } from "@/server/training/llm-evaluation-artifact";

function formatDataError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("WORLDMODEL_DATABASE_URL")) {
    return "数据库未配置或不可用：请设置 WORLDMODEL_DATABASE_URL 并运行 Prisma 迁移。";
  }
  return "数据加载失败，请检查 worldModel 服务日志。";
}

function formatWorkerRestoreError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return `自动化守护进程恢复失败：${message}`;
}

function formatLlmEvaluationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return `LLM 评估加载失败：${message}`;
}

function joinDataErrors(...errors: Array<string | null>) {
  return errors.filter(Boolean).join("；") || null;
}

async function loadOptionalLlmEvaluation() {
  try {
    return {
      llmEvaluation: await loadLlmEvaluationArtifact(),
      error: null
    };
  } catch (error) {
    return {
      llmEvaluation: null,
      error: formatLlmEvaluationError(error)
    };
  }
}

export async function loadWorldModelData() {
  const { llmEvaluation, error: llmEvaluationError } = await loadOptionalLlmEvaluation();

  if (!process.env.WORLDMODEL_DATABASE_URL) {
    return {
      beliefs: [],
      observations: [],
      evidence: [],
      sources: [],
      runs: [],
      heartbeats: [],
      workerConfigs: [],
      workerRuntime: [],
      models: [],
      updates: [],
      likelihoodRuns: [],
      llmEvaluation,
      error: joinDataErrors(llmEvaluationError, "数据库未配置或不可用：请设置 WORLDMODEL_DATABASE_URL 并运行 Prisma 迁移。")
    };
  }

  try {
    const services = getWorldModelServices();
    let workerRuntime: Awaited<ReturnType<ReturnType<typeof getEvidenceLoopWorkerController>["restoreEnabled"]>> = [];
    let workerRestoreError: string | null = null;
    try {
      workerRuntime = await getEvidenceLoopWorkerController().restoreEnabled(services);
    } catch (error) {
      workerRestoreError = formatWorkerRestoreError(error);
    }
    const [beliefs, observations, evidence, sources, runs, heartbeats, workerConfigs, models, updates, likelihoodRuns] = await Promise.all([
      services.beliefs.listBeliefs(),
      services.observations.listObservations(),
      services.evidence.listEvidence(),
      services.sources.listSources(),
      services.sources.listRuns(),
      services.automation.listHeartbeats(),
      services.automation.listWorkerConfigs(),
      services.models.listArtifacts(),
      services.updates.listEvents(),
      services.likelihood.listRuns()
    ]);
    return {
      beliefs,
      observations,
      evidence,
      sources,
      runs,
      heartbeats,
      workerConfigs,
      workerRuntime,
      models,
      updates,
      likelihoodRuns,
      llmEvaluation,
      error: joinDataErrors(llmEvaluationError, workerRestoreError)
    };
  } catch (error) {
    return {
      beliefs: [],
      observations: [],
      evidence: [],
      sources: [],
      runs: [],
      heartbeats: [],
      workerConfigs: [],
      workerRuntime: [],
      models: [],
      updates: [],
      likelihoodRuns: [],
      llmEvaluation,
      error: joinDataErrors(llmEvaluationError, formatDataError(error))
    };
  }
}
