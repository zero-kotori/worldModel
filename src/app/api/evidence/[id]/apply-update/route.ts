import { getWorldModelServices } from "@/server/services";
import { jsonError, jsonOk, readJson } from "@/app/api/_utils";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await readJson<{ likelihoodRunId?: string }>(request);
    const services = getWorldModelServices();
    return jsonOk(await services.updates.applyEvidence(id, body.likelihoodRunId), { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
