import { getWorldModelServices } from "@/server/services";
import { jsonError, jsonOk, readJson } from "@/app/api/_utils";
import type { ImportArtifactInput } from "@/server/services/types";

export async function POST(request: Request) {
  try {
    const services = getWorldModelServices();
    return jsonOk(await services.models.importArtifact(await readJson<ImportArtifactInput>(request)), { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
