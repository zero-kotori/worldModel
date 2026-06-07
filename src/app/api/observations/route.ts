import { getWorldModelServices } from "@/server/services";
import { jsonError, jsonOk, readJson } from "@/app/api/_utils";
import type { CreateObservationInput } from "@/server/services/types";

export async function GET() {
  try {
    const services = getWorldModelServices();
    return jsonOk(await services.observations.listObservations());
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const services = getWorldModelServices();
    return jsonOk(await services.observations.createObservation(await readJson<CreateObservationInput>(request)), {
      status: 201
    });
  } catch (error) {
    return jsonError(error);
  }
}
