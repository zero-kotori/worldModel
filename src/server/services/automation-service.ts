import {
  automationHeartbeatSchema,
  automationWorkerConfigSchema
} from "@/server/services/internal/schemas";
import type { WorldModelServiceContext } from "@/server/services/internal/service-context";
import { now } from "@/server/services/internal/shared";
import type { SourceWorkflow } from "@/server/services/internal/source-workflow";
import type { AutomationHeartbeatRecord, AutomationWorkerConfigRecord, WorldModelServices } from "@/server/services/types";

export function createAutomationService(
  context: WorldModelServiceContext,
  sourceWorkflow: SourceWorkflow
): WorldModelServices["automation"] {
  const { store } = context;

  async function recordAutomationHeartbeat(
    input: Omit<AutomationHeartbeatRecord, "createdAt" | "updatedAt">
  ): Promise<AutomationHeartbeatRecord> {
    const parsed = automationHeartbeatSchema.parse(input);
    const timestamp = now();
    const existing = (await store.listAutomationHeartbeats()).find((heartbeat) => heartbeat.id === parsed.id);

    return store.upsertAutomationHeartbeat({
      id: parsed.id,
      status: parsed.status,
      heartbeatAt: parsed.heartbeatAt,
      nextRunAt: parsed.nextRunAt,
      intervalMs: parsed.intervalMs,
      consecutiveFailureCount: parsed.consecutiveFailureCount,
      lastNotice: parsed.lastNotice?.trim() ?? "",
      lastError: parsed.lastError?.trim() ?? "",
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    });
  }

  async function saveAutomationWorkerConfig(
    input: Omit<AutomationWorkerConfigRecord, "createdAt" | "updatedAt">
  ): Promise<AutomationWorkerConfigRecord> {
    const parsed = automationWorkerConfigSchema.parse(input);
    const timestamp = now();
    const existing = (await store.listAutomationWorkerConfigs()).find((config) => config.id === parsed.id);

    return store.upsertAutomationWorkerConfig({
      ...parsed,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    });
  }

  return {
    runEvidenceLoop: sourceWorkflow.runEvidenceLoop,
    recordHeartbeat: recordAutomationHeartbeat,
    listHeartbeats() {
      return store.listAutomationHeartbeats();
    },
    saveWorkerConfig: saveAutomationWorkerConfig,
    listWorkerConfigs() {
      return store.listAutomationWorkerConfigs();
    }
  };
}
