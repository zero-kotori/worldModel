import { getWorldModelServices } from "@/server/services";
import { guardAutoApply } from "@/server/automation/auto-apply-policy";
import { jsonError, jsonOk, readJson } from "@/app/api/_utils";
import type { EvidenceLoopOptions } from "@/server/services/types";

export async function POST(request: Request) {
  try {
    const body = await readJson<EvidenceLoopOptions>(request);
    const services = getWorldModelServices();
    const guarded = await guardAutoApply(services, body);
    const result = await services.automation.runEvidenceLoop(guarded.options);
    return jsonOk(guarded.notice ? { ...result, notice: guarded.notice } : result, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
