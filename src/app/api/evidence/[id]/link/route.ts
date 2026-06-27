import { getWorldModelServices } from "@/server/services";
import { jsonError, jsonOk, readJson } from "@/app/api/_utils";
import type { ConnectEvidenceHypothesisInput, DisconnectEvidenceHypothesisInput } from "@/server/services/types";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await readJson<ConnectEvidenceHypothesisInput>(request);
    const services = getWorldModelServices();
    return jsonOk(await services.evidence.connectHypothesis(id, body), { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await readJson<DisconnectEvidenceHypothesisInput>(request);
    const services = getWorldModelServices();
    return jsonOk(await services.evidence.disconnectHypothesis(id, body));
  } catch (error) {
    return jsonError(error);
  }
}
