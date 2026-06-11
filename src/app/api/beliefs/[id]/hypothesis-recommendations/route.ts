import { getWorldModelServices } from "@/server/services";
import { jsonError, jsonOk, verifyApiRequest } from "@/app/api/_utils";

type RouteContext = { params: Promise<{ id: string }> };

function parseLimit(url: string) {
  const value = Number(new URL(url).searchParams.get("limit"));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    verifyApiRequest(request);
    const { id } = await context.params;
    const services = getWorldModelServices();
    return jsonOk(await services.beliefs.recommendHypotheses(id, { limit: parseLimit(request.url) }));
  } catch (error) {
    return jsonError(error);
  }
}
