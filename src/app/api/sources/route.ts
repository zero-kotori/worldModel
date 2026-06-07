import { getWorldModelServices } from "@/server/services";
import { jsonError, jsonOk, readJson } from "@/app/api/_utils";
import type { CreateSourceInput } from "@/server/services/types";

export async function GET() {
  try {
    const services = getWorldModelServices();
    return jsonOk(await services.sources.listSources());
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const services = getWorldModelServices();
    return jsonOk(await services.sources.createSource(await readJson<CreateSourceInput>(request)), { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
