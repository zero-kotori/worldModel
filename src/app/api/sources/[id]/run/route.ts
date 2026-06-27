import { getWorldModelServices } from "@/server/services";
import { jsonError, jsonOk, readJson } from "@/app/api/_utils";
import { guardAutoApply } from "@/server/automation/auto-apply-policy";
import type { RawObservationInput, RunSourceOptions } from "@/server/services/types";
import type { WorldModelServices } from "@/server/services/types";

type RouteContext = { params: Promise<{ id: string }> };
type RunSourceRequestBody = RunSourceOptions & { observations?: RawObservationInput[] };

function sourceRunOptions(body: RunSourceRequestBody): RunSourceOptions {
  return {
    reviewOnly: body.reviewOnly,
    forceAutoApply: body.forceAutoApply,
    beliefIds: body.beliefIds,
    candidateThreshold: body.candidateThreshold,
    autoConfirmThreshold: body.autoConfirmThreshold,
    maxQueries: body.maxQueries,
    maxObservations: body.maxObservations,
    queries: body.queries
  };
}

function joinNotices(...notices: string[]) {
  return notices.filter(Boolean).join("；");
}

async function guardedSourceRunOptions(services: WorldModelServices, sourceId: string, options: RunSourceOptions) {
  const guardScopedOptions = { ...options, sourceIds: [sourceId] };
  const stripSourceIds = (guardedOptions: typeof guardScopedOptions): RunSourceOptions => ({
    reviewOnly: guardedOptions.reviewOnly,
    forceAutoApply: guardedOptions.forceAutoApply,
    beliefIds: guardedOptions.beliefIds,
    candidateThreshold: guardedOptions.candidateThreshold,
    autoConfirmThreshold: guardedOptions.autoConfirmThreshold,
    maxQueries: guardedOptions.maxQueries,
    maxObservations: guardedOptions.maxObservations,
    queries: guardedOptions.queries
  });
  const directGuard = await guardAutoApply(services, guardScopedOptions);
  if (directGuard.options.reviewOnly || directGuard.options.forceAutoApply) {
    return { options: stripSourceIds(directGuard.options), notice: directGuard.notice };
  }

  const source = (await services.sources.listSources()).find((item) => item.id === sourceId);
  if (!source?.autoConfirm) return { options: stripSourceIds(directGuard.options), notice: directGuard.notice };

  const sourceDefaultGuard = await guardAutoApply(services, { ...directGuard.options, sourceIds: [sourceId], forceAutoApply: true });
  if (!sourceDefaultGuard.options.reviewOnly) {
    return { options: stripSourceIds(directGuard.options), notice: joinNotices(directGuard.notice, sourceDefaultGuard.notice) };
  }
  return {
    options: stripSourceIds({
      ...directGuard.options,
      reviewOnly: true,
      forceAutoApply: false
    }),
    notice: sourceDefaultGuard.notice
  };
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await readJson<RunSourceRequestBody>(request);
    const services = getWorldModelServices();
    if (Array.isArray(body.observations)) {
      return jsonOk(await services.sources.runDryRun(id, body.observations), { status: 201 });
    }
    const guarded = await guardedSourceRunOptions(services, id, sourceRunOptions(body));
    const run = await services.sources.runSource(id, guarded.options);
    return jsonOk(guarded.notice ? { ...run, notice: guarded.notice } : run, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
