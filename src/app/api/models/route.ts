import { getWorldModelServices } from "@/server/services";
import { jsonError, jsonOk } from "@/app/api/_utils";

export async function GET() {
  try {
    const services = getWorldModelServices();
    return jsonOk(await services.models.listArtifacts());
  } catch (error) {
    return jsonError(error);
  }
}
