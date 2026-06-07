import { getWorldModelServices } from "@/server/services";
import { jsonError, jsonOk, readJson } from "@/app/api/_utils";
import type { ConfirmEvidenceInput } from "@/server/services/types";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await readJson<Omit<ConfirmEvidenceInput, "observationId">>(request);
    const services = getWorldModelServices();
    return jsonOk(await services.evidence.confirmObservation({ ...body, observationId: id }), { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
