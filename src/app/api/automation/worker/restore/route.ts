import { getEvidenceLoopWorkerController } from "@/server/automation/local-worker";
import { getWorldModelServices } from "@/server/services";
import { jsonError, jsonOk, verifyApiRequest } from "@/app/api/_utils";

export async function POST(request: Request) {
  try {
    verifyApiRequest(request);
    const services = getWorldModelServices();
    const runtime = await getEvidenceLoopWorkerController().restoreEnabled(services);
    return jsonOk({ runtime });
  } catch (error) {
    return jsonError(error);
  }
}
