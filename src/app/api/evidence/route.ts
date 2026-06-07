import { getWorldModelServices } from "@/server/services";
import { jsonError, jsonOk } from "@/app/api/_utils";

export async function GET() {
  try {
    const services = getWorldModelServices();
    return jsonOk(await services.evidence.listEvidence());
  } catch (error) {
    return jsonError(error);
  }
}
