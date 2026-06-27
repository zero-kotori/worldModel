import { getWorldModelServices } from "@/server/services";
import { jsonError, jsonOk, verifyApiRequest } from "@/app/api/_utils";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    verifyApiRequest(request);
    const { id } = await context.params;
    const services = getWorldModelServices();
    return jsonOk(await services.observations.rejectObservation(id));
  } catch (error) {
    return jsonError(error);
  }
}
