import { getWorldModelServices } from "@/server/services";
import { jsonError, jsonOk, verifyApiRequest } from "@/app/api/_utils";
import { createReadableCodes, readableCode } from "@/lib/world-model-display";
import type { WorldModelServices } from "@/server/services/types";

type RouteContext = { params: Promise<{ id: string }> };

async function sourceObservationIdFromSearchParams(searchParams: URLSearchParams, services: WorldModelServices) {
  const sourceObservationId = searchParams.get("sourceObservationId")?.trim();
  if (sourceObservationId) return sourceObservationId;

  const sourceObservationCode = searchParams.get("sourceObservation")?.trim();
  if (!sourceObservationCode) return undefined;

  const observations = await services.observations.listObservations();
  const observationCodes = createReadableCodes(observations, "O", (observation) => observation.observedAt);
  return observations.find(
    (observation) =>
      observation.id === sourceObservationCode || readableCode(observationCodes, observation.id, "O") === sourceObservationCode
  )?.id;
}

async function parseRecommendationOptions(url: string, services: WorldModelServices) {
  const searchParams = new URL(url).searchParams;
  const limitValue = Number(searchParams.get("limit"));
  const sourceObservationId = await sourceObservationIdFromSearchParams(searchParams, services);
  return {
    limit: Number.isFinite(limitValue) && limitValue > 0 ? limitValue : undefined,
    sourceObservationId
  };
}

export async function GET(request: Request, context: RouteContext) {
  try {
    verifyApiRequest(request);
    const { id } = await context.params;
    const services = getWorldModelServices();
    return jsonOk(await services.beliefs.recommendHypotheses(id, await parseRecommendationOptions(request.url, services)));
  } catch (error) {
    return jsonError(error);
  }
}
