import { getWorldModelServices } from "@/server/services";
import { jsonError, jsonOk, readJson } from "@/app/api/_utils";
import type { UpdateObservationInput } from "@/server/services/types";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await readJson<UpdateObservationInput>(request);
    const services = getWorldModelServices();
    return jsonOk(await services.observations.updateObservation(id, body));
  } catch (error) {
    return jsonError(error);
  }
}
