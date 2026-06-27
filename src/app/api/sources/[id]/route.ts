import { getWorldModelServices } from "@/server/services";
import { jsonError, jsonOk, readJson } from "@/app/api/_utils";
import type { UpdateSourceInput } from "@/server/services/types";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const services = getWorldModelServices();
    const { id } = await context.params;
    const body = await readJson<UpdateSourceInput>(request);
    return jsonOk(await services.sources.updateSource(id, body));
  } catch (error) {
    return jsonError(error);
  }
}
