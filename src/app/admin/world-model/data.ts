import "server-only";

import { getWorldModelServices } from "@/server/services";

function formatDataError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("WORLDMODEL_DATABASE_URL")) {
    return "数据库未配置或不可用：请设置 WORLDMODEL_DATABASE_URL 并运行 Prisma 迁移。";
  }
  return "数据加载失败，请检查 worldModel 服务日志。";
}

export async function loadWorldModelData() {
  if (!process.env.WORLDMODEL_DATABASE_URL) {
    return {
      beliefs: [],
      observations: [],
      evidence: [],
      sources: [],
      runs: [],
      heartbeats: [],
      workerConfigs: [],
      models: [],
      updates: [],
      error: "数据库未配置或不可用：请设置 WORLDMODEL_DATABASE_URL 并运行 Prisma 迁移。"
    };
  }

  try {
    const services = getWorldModelServices();
    const [beliefs, observations, evidence, sources, runs, heartbeats, workerConfigs, models, updates] = await Promise.all([
      services.beliefs.listBeliefs(),
      services.observations.listObservations(),
      services.evidence.listEvidence(),
      services.sources.listSources(),
      services.sources.listRuns(),
      services.automation.listHeartbeats(),
      services.automation.listWorkerConfigs(),
      services.models.listArtifacts(),
      services.updates.listEvents()
    ]);
    return { beliefs, observations, evidence, sources, runs, heartbeats, workerConfigs, models, updates, error: null };
  } catch (error) {
    return {
      beliefs: [],
      observations: [],
      evidence: [],
      sources: [],
      runs: [],
      heartbeats: [],
      workerConfigs: [],
      models: [],
      updates: [],
      error: formatDataError(error)
    };
  }
}
