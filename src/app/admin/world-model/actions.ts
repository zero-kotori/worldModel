"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { getWorldModelServices } from "@/server/services";
import { getObservationRecommendedLinks } from "@/lib/world-model-observations-ui";
import type { BeliefCategory, HypothesisStance, ObservationSourceKind } from "@/server/services/types";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function number(formData: FormData, key: string, fallback = 0) {
  const value = Number(text(formData, key));
  return Number.isFinite(value) ? value : fallback;
}

function bool(formData: FormData, key: string) {
  return formData.get(key) === "on" || formData.get(key) === "true";
}

function values(formData: FormData, key: string) {
  return formData
    .getAll(key)
    .map((value) => String(value).trim())
    .filter(Boolean);
}

function actionErrorMessage(error: unknown) {
  if (error instanceof ZodError) {
    const paths = new Set(error.issues.map((issue) => issue.path.join(".")));
    if (paths.has("observationId") || paths.has("links")) {
      return "请选择一条观察，并至少勾选一个关联假设。";
    }
    return error.issues.map((issue) => `${issue.path.join(".") || "输入"}：${issue.message}`).join("；");
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

function redirectWithNotice(path: string, params: Record<string, string>) {
  const searchParams = new URLSearchParams(params);
  redirect(`${path}?${searchParams.toString()}`);
}

async function runAction(path: string, success: string, action: () => Promise<void>) {
  try {
    await action();
    revalidateWorldModel();
  } catch (error) {
    redirectWithNotice(path, { error: actionErrorMessage(error) });
  }
  redirectWithNotice(path, { message: success });
}

function linkLikelihoodRatio(formData: FormData) {
  const direction = text(formData, "direction");
  const fallback = direction === "OPPOSES" ? 0.67 : 1.5;
  const raw = number(formData, "likelihoodRatio", fallback);
  return direction === "OPPOSES" && raw > 1 ? 1 / raw : raw;
}

function revalidateWorldModel() {
  revalidatePath("/admin/world-model");
  revalidatePath("/admin/world-model/beliefs");
  revalidatePath("/admin/world-model/observations");
  revalidatePath("/admin/world-model/evidence");
  revalidatePath("/admin/world-model/sources");
  revalidatePath("/admin/world-model/models");
}

export async function createBeliefAction(formData: FormData) {
  await runAction("/admin/world-model/beliefs", "信念表已创建", async () => {
    const services = getWorldModelServices();
    await services.beliefs.createBelief({
      title: text(formData, "title"),
      category: text(formData, "category") as BeliefCategory,
      description: text(formData, "description"),
      probabilityMode: text(formData, "probabilityMode") === "MUTUALLY_EXCLUSIVE" ? "MUTUALLY_EXCLUSIVE" : "INDEPENDENT",
      hypotheses: [
        {
          proposition: text(formData, "proposition1"),
          priorProbability: number(formData, "priorProbability1"),
          stance: text(formData, "stance1") as HypothesisStance,
          notes: ""
        },
        {
          proposition: text(formData, "proposition2"),
          priorProbability: number(formData, "priorProbability2"),
          stance: text(formData, "stance2") as HypothesisStance,
          notes: ""
        }
      ].filter((hypothesis) => hypothesis.proposition)
    });
  });
}

export async function createHypothesisAction(formData: FormData) {
  const beliefId = text(formData, "beliefId");
  await runAction(`/admin/world-model/beliefs`, "假设已添加", async () => {
    const services = getWorldModelServices();
    await services.beliefs.createHypothesis(beliefId, {
      proposition: text(formData, "proposition"),
      priorProbability: number(formData, "priorProbability", 0.5),
      stance: text(formData, "stance") as HypothesisStance,
      notes: text(formData, "notes")
    });
  });
}

export async function updateBeliefAction(formData: FormData) {
  await runAction("/admin/world-model/beliefs", "信念表已更新", async () => {
    const services = getWorldModelServices();
    await services.beliefs.updateBelief(text(formData, "beliefId"), {
      title: text(formData, "title"),
      category: text(formData, "category") as BeliefCategory,
      description: text(formData, "description"),
      probabilityMode: text(formData, "probabilityMode") === "MUTUALLY_EXCLUSIVE" ? "MUTUALLY_EXCLUSIVE" : "INDEPENDENT",
      status: text(formData, "status") as "ACTIVE" | "PAUSED" | "ARCHIVED"
    });
  });
}

export async function updateHypothesisAction(formData: FormData) {
  await runAction("/admin/world-model/beliefs", "假设已更新", async () => {
    const services = getWorldModelServices();
    await services.beliefs.updateHypothesis(text(formData, "hypothesisId"), {
      beliefId: text(formData, "beliefId"),
      proposition: text(formData, "proposition"),
      notes: text(formData, "notes"),
      stance: text(formData, "stance") as HypothesisStance,
      priorProbability: number(formData, "priorProbability", 0.5),
      currentProbability: number(formData, "currentProbability", 0.5),
      status: text(formData, "status") as "ACTIVE" | "PAUSED" | "RESOLVED_TRUE" | "RESOLVED_FALSE" | "ARCHIVED"
    });
  });
}

export async function createObservationAction(formData: FormData) {
  await runAction("/admin/world-model/observations", "观察已录入", async () => {
    const services = getWorldModelServices();
    await services.observations.createObservation({
      title: text(formData, "title"),
      content: text(formData, "content"),
      url: text(formData, "url") || undefined,
      author: text(formData, "author") || undefined,
      credibility: number(formData, "credibility", 0.5),
      normalizedHash: text(formData, "normalizedHash") || undefined,
      semanticKey: text(formData, "semanticKey") || undefined
    });
  });
}

export async function rejectObservationAction(formData: FormData) {
  await runAction("/admin/world-model/observations", "观察已拒绝", async () => {
    const services = getWorldModelServices();
    await services.observations.rejectObservation(text(formData, "observationId"));
  });
}

export async function confirmRecommendedEvidenceAction(formData: FormData) {
  await runAction("/admin/world-model/observations", "推荐证据已确认并应用更新", async () => {
    const services = getWorldModelServices();
    const observationId = text(formData, "observationId");
    const observation = (await services.observations.listObservations()).find((item) => item.id === observationId);
    if (!observation) throw new Error(`Observation not found: ${observationId}`);
    const links = getObservationRecommendedLinks(observation);
    if (links.length === 0) throw new Error("该观察没有可确认的推荐关联。");
    await services.evidence.confirmAndApplyObservation({
      observationId,
      confirmationMode: "MANUAL",
      links
    });
  });
}

export async function confirmEvidenceAction(formData: FormData) {
  await runAction("/admin/world-model/evidence", "证据已确认并应用更新", async () => {
    const services = getWorldModelServices();
    const hypothesisIds = values(formData, "hypothesisIds");
    await services.evidence.confirmAndApplyObservation({
      observationId: text(formData, "observationId"),
      confirmationMode: "MANUAL",
      links: hypothesisIds.map((hypothesisId) => ({
        hypothesisId,
        direction: text(formData, "direction") as "SUPPORTS" | "OPPOSES" | "MIXED" | "NEUTRAL",
        relevance: number(formData, "relevance", 0.7),
        likelihoodRatio: linkLikelihoodRatio(formData),
        confidence: number(formData, "confidence", 0.6),
        rationale: text(formData, "rationale")
      }))
    });
  });
}

export async function createEvidenceFromObservationAction(formData: FormData) {
  await runAction("/admin/world-model/evidence", "观察已录入为证据并应用更新", async () => {
    const services = getWorldModelServices();
    const observation = await services.observations.createObservation({
      title: text(formData, "title"),
      content: text(formData, "content"),
      url: text(formData, "url") || undefined,
      author: text(formData, "author") || undefined,
      credibility: number(formData, "credibility", 0.5)
    });
    const hypothesisIds = values(formData, "hypothesisIds");
    await services.evidence.confirmAndApplyObservation({
      observationId: observation.id,
      confirmationMode: "MANUAL",
      links: hypothesisIds.map((hypothesisId) => ({
        hypothesisId,
        direction: text(formData, "direction") as "SUPPORTS" | "OPPOSES" | "MIXED" | "NEUTRAL",
        relevance: number(formData, "relevance", 0.7),
        likelihoodRatio: linkLikelihoodRatio(formData),
        confidence: number(formData, "confidence", 0.6),
        rationale: text(formData, "rationale")
      }))
    });
  });
}

export async function applyEvidenceUpdateAction(formData: FormData) {
  await runAction("/admin/world-model/evidence", "证据更新已应用", async () => {
    const services = getWorldModelServices();
    const preview = await services.updates.createPreview(text(formData, "evidenceId"));
    await services.updates.applyPreview(preview);
  });
}

export async function updateEvidenceAction(formData: FormData) {
  await runAction("/admin/world-model/evidence", "证据已保存并重新应用", async () => {
    const services = getWorldModelServices();
    const hypothesisIds = values(formData, "linkHypothesisIds");
    await services.evidence.updateAndReapply(text(formData, "evidenceId"), {
      title: text(formData, "title"),
      content: text(formData, "content"),
      url: text(formData, "url") || undefined,
      credibility: number(formData, "credibility", 0.5),
      links: hypothesisIds.map((hypothesisId) => ({
        hypothesisId,
        direction: text(formData, `direction:${hypothesisId}`) as "SUPPORTS" | "OPPOSES" | "MIXED" | "NEUTRAL",
        relevance: number(formData, `relevance:${hypothesisId}`, 0.7),
        likelihoodRatio: number(formData, `likelihoodRatio:${hypothesisId}`, 1),
        confidence: number(formData, `confidence:${hypothesisId}`, 0.6),
        rationale: text(formData, `rationale:${hypothesisId}`) || "证据编辑后重新评估"
      }))
    });
  });
}

export async function connectEvidenceHypothesisAction(formData: FormData) {
  await runAction("/admin/world-model/evidence", "图谱连接已保存并重新应用", async () => {
    const services = getWorldModelServices();
    await services.evidence.connectHypothesis(text(formData, "evidenceId"), {
      hypothesisId: text(formData, "hypothesisId"),
      direction: text(formData, "direction") as "SUPPORTS" | "OPPOSES" | "MIXED" | "NEUTRAL",
      relevance: number(formData, "relevance", 0.7),
      likelihoodRatio: number(formData, "likelihoodRatio", 1),
      confidence: number(formData, "confidence", 0.6),
      rationale: text(formData, "rationale") || "从图谱连接创建的证据关联"
    });
  });
}

export async function rejectEvidenceAction(formData: FormData) {
  await runAction("/admin/world-model/evidence", "证据已拒绝并回滚相关更新", async () => {
    const services = getWorldModelServices();
    await services.evidence.reject(text(formData, "evidenceId"));
  });
}

export async function rollbackUpdateAction(formData: FormData) {
  await runAction("/admin/world-model/evidence", "更新事件已回滚", async () => {
    const services = getWorldModelServices();
    await services.updates.rollback(text(formData, "eventId"));
  });
}

export async function createSourceAction(formData: FormData) {
  await runAction("/admin/world-model/sources", "来源已创建", async () => {
    const services = getWorldModelServices();
    await services.sources.createSource({
      name: text(formData, "name"),
      kind: text(formData, "kind") as ObservationSourceKind,
      url: text(formData, "url") || undefined,
      adapter: text(formData, "adapter"),
      credentialRef: text(formData, "credentialRef") || undefined,
      credibility: number(formData, "credibility", 0.5),
      enabled: bool(formData, "enabled"),
      autoConfirm: bool(formData, "autoConfirm"),
      autoConfirmThreshold: number(formData, "autoConfirmThreshold", 0.85)
    });
  });
}

export async function runSourceDryRunAction(formData: FormData) {
  await runAction("/admin/world-model/sources", "Dry-run 已记录", async () => {
    const services = getWorldModelServices();
    await services.sources.runDryRun(text(formData, "sourceId"), [
      { title: text(formData, "sampleTitle"), content: text(formData, "sampleContent"), url: text(formData, "sampleUrl") }
    ]);
  });
}

export async function runSourceAction(formData: FormData) {
  await runAction("/admin/world-model/sources", "来源采集已运行", async () => {
    const services = getWorldModelServices();
    const run = await services.sources.runSource(text(formData, "sourceId"));
    if (run.status === "FAILED") {
      throw new Error(run.errorMessage ?? "来源采集失败");
    }
  });
}

export async function runSourceReviewOnlyAction(formData: FormData) {
  await runAction("/admin/world-model/sources", "来源待审采集已运行", async () => {
    const services = getWorldModelServices();
    const run = await services.sources.runSource(text(formData, "sourceId"), { reviewOnly: true });
    if (run.status === "FAILED") {
      throw new Error(run.errorMessage ?? "来源采集失败");
    }
  });
}

export async function runEvidenceLoopAction(formData: FormData) {
  await runAction("/admin/world-model/sources", "自动证据闭环已运行", async () => {
    const services = getWorldModelServices();
    await services.automation.runEvidenceLoop({
      reviewOnly: bool(formData, "reviewOnly"),
      maxObservations: number(formData, "maxObservations") || undefined,
      autoConfirmThreshold: number(formData, "autoConfirmThreshold") || undefined
    });
  });
}

export async function importModelArtifactAction(formData: FormData) {
  await runAction("/admin/world-model/models", "模型产物已导入", async () => {
    const services = getWorldModelServices();
    await services.models.importArtifact({
      name: text(formData, "name"),
      kind: text(formData, "kind") as "LIGHTWEIGHT" | "LLM" | "DEEP_ADAPTER",
      version: text(formData, "version"),
      path: text(formData, "path"),
      metrics: { importedBy: "admin-form" },
      enabled: bool(formData, "enabled")
    });
  });
}
