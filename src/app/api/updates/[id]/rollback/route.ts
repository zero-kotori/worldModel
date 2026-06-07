import { getWorldModelServices } from "@/server/services";
import { jsonError, jsonOk, verifyApiRequest } from "@/app/api/_utils";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  try {
    verifyApiRequest(_request);
    const { id } = await context.params;
    const services = getWorldModelServices();
    return jsonOk(await services.updates.rollback(id));
  } catch (error) {
    return jsonError(error);
  }
}
