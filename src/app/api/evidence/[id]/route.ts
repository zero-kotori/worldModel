import { getWorldModelServices } from "@/server/services";
import { jsonError, jsonOk, readJson, verifyApiRequest } from "@/app/api/_utils";
import type { UpdateEvidenceInput } from "@/server/services/types";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await readJson<UpdateEvidenceInput>(request);
    const services = getWorldModelServices();
    return jsonOk(await services.evidence.updateAndReapply(id, body));
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    verifyApiRequest(request);
    const { id } = await context.params;
    const services = getWorldModelServices();
    return jsonOk(await services.evidence.deleteEvidence(id));
  } catch (error) {
    return jsonError(error);
  }
}
