import { getWorldModelServices } from "@/server/services";
import { jsonError, jsonOk, verifyApiRequest } from "@/app/api/_utils";

export async function GET(request: Request) {
  try {
    verifyApiRequest(request);
    const services = getWorldModelServices();
    return jsonOk(await services.likelihood.listRuns());
  } catch (error) {
    return jsonError(error);
  }
}
