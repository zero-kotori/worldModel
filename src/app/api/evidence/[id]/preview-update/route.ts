import { getWorldModelServices } from "@/server/services";
import { jsonError, jsonOk } from "@/app/api/_utils";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const services = getWorldModelServices();
    return jsonOk(await services.updates.createPreview(id));
  } catch (error) {
    return jsonError(error);
  }
}
