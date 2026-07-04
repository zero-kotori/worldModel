import { getWorldModelServices } from "@/server/services";
import { jsonError, jsonOk, readJson } from "@/app/api/_utils";
import type { CreateBeliefInput } from "@/server/services/types";

export async function POST(request: Request) {
  try {
    const input = await readJson<CreateBeliefInput>(request);
    const services = getWorldModelServices();
    const belief = await services.beliefs.createBelief({ ...input, origin: "EXTERNAL" });
    return jsonOk({ id: belief.id }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
