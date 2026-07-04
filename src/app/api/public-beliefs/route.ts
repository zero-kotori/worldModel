import { getWorldModelServices } from "@/server/services";
import { jsonError, jsonOk, readJson, verifyApiRequest } from "@/app/api/_utils";
import type { CreateBeliefInput } from "@/server/services/types";

export async function GET(request: Request) {
  try {
    verifyApiRequest(request);
    const services = getWorldModelServices();
    const beliefs = (await services.beliefs.listBeliefs())
      .filter((belief) => belief.origin === "EXTERNAL" && belief.status === "ACTIVE")
      .map((belief) => ({
        id: belief.id,
        title: belief.title,
        category: belief.category,
        description: belief.description,
        probabilityMode: belief.probabilityMode,
        origin: belief.origin,
        status: belief.status,
        createdAt: belief.createdAt.toISOString(),
        updatedAt: belief.updatedAt.toISOString(),
        hypotheses: belief.hypotheses
          .filter((hypothesis) => hypothesis.status === "ACTIVE")
          .map((hypothesis) => ({
            id: hypothesis.id,
            proposition: hypothesis.proposition,
            stance: hypothesis.stance,
            priorProbability: hypothesis.priorProbability,
            currentProbability: hypothesis.currentProbability,
            status: hypothesis.status,
            createdAt: hypothesis.createdAt.toISOString(),
            updatedAt: hypothesis.updatedAt.toISOString()
          }))
      }));
    return jsonOk({ beliefs });
  } catch (error) {
    return jsonError(error);
  }
}

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
