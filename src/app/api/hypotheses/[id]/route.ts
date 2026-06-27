import { getWorldModelServices } from "@/server/services";
import { jsonError, jsonOk, readJson } from "@/app/api/_utils";
import type { UpdateHypothesisInput } from "@/server/services/types";

type RouteContext = { params: Promise<{ id: string }> };
type JsonUpdateHypothesisInput = Omit<UpdateHypothesisInput, "startsAt" | "expiresAt"> & {
  startsAt?: string | Date | null;
  expiresAt?: string | Date | null;
};

function optionalDate(value: JsonUpdateHypothesisInput["startsAt"]) {
  if (value === undefined || value === null || value instanceof Date) return value;
  return new Date(value);
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await readJson<JsonUpdateHypothesisInput>(request);
    const { startsAt, expiresAt, ...fields } = body;
    const input: UpdateHypothesisInput = {
      ...fields,
      ...(startsAt !== undefined ? { startsAt: optionalDate(startsAt) } : {}),
      ...(expiresAt !== undefined ? { expiresAt: optionalDate(expiresAt) } : {})
    };
    const services = getWorldModelServices();
    return jsonOk(await services.beliefs.updateHypothesis(id, input));
  } catch (error) {
    return jsonError(error);
  }
}
