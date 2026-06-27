"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { guardAutoApply } from "@/server/automation/auto-apply-policy";
import { runObserveLoopDryRun } from "@/server/automation/evidence-loop-dry-run";
import { getWorldModelServices } from "@/server/services";
import { getEvidenceLoopWorkerController } from "@/server/automation/local-worker";
import { runLlmEvaluationCommand } from "@/server/training/llm-evaluation-artifact";
import { runLocalLightweightTrainingPipeline } from "@/server/training/local-training-pipeline";
import { readModelArtifactImportInput } from "@/server/training/model-artifact-import";
import { runFetchTrainingDataCommand } from "@/server/training/training-data-fetch-runner";
import {
  parseDateTimeLocalValue,
  parseDateTimePatchValue,
  recommendedHypothesisSuccessPath
} from "@/lib/world-model-beliefs-ui";
import { worldModelActionReturnPath } from "@/lib/world-model-action-routing";
import { createReadableCodes, readableCode } from "@/lib/world-model-display";
import { readEvidenceLinksFromFormData } from "@/lib/world-model-evidence-ui";
import { getObservationRecommendedLinks } from "@/lib/world-model-observations-ui";
import { automationLoopActionNotice, automationLoopDryRunActionNotice } from "@/lib/world-model-sources-ui";
import type {
  AutomationWorkerConfigRecord,
  BeliefCategory,
  EvidenceLoopResult,
  HypothesisStance,
  ObservationRecord,
  ObservationSourceKind,
  RunSourceOptions,
  WorldModelServices
} from "@/server/services/types";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function number(formData: FormData, key: string, fallback = 0) {
  const value = Number(text(formData, key));
  return Number.isFinite(value) ? value : fallback;
}

function optionalNumber(formData: FormData, key: string) {
  const value = text(formData, key);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function bool(formData: FormData, key: string) {
  return formData.get(key) === "on" || formData.get(key) === "true";
}

function optionalDateTime(formData: FormData, key: string) {
  return parseDateTimeLocalValue(text(formData, key));
}

function patchDateTime(formData: FormData, key: string) {
  return parseDateTimePatchValue(text(formData, key));
}

function values(formData: FormData, key: string) {
  return formData
    .getAll(key)
    .map((value) => String(value).trim())
    .filter(Boolean);
}

function optionalValues(formData: FormData, key: string) {
  const parsed = values(formData, key);
  return parsed.length > 0 ? parsed : undefined;
}

function sourceCountsNotice(sourceCounts: Record<string, number>) {
  const summary = Object.entries(sourceCounts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([source, count]) => `${source} ${count}`)
    .join("，");
  return summary ? `；${summary}` : "";
}

function settlementStatus(value: string) {
  if (value === "RESOLVED_TRUE" || value === "RESOLVED_FALSE") return value;
  throw new Error("Invalid settlement outcome.");
}

function defaultWorkerConfig(id = "default"): Omit<AutomationWorkerConfigRecord, "createdAt" | "updatedAt"> {
  return {
    id,
    enabled: false,
    intervalMs: 900_000,
    failureBackoffMultiplier: 2,
    maxIntervalMs: 3_600_000,
    reviewOnly: false,
    maxQueries: 3,
    maxSources: 3,
    maxObservations: 20,
    candidateThreshold: 0.25,
    autoConfirmThreshold: 0.85,
    bootstrapDefaultSources: true,
    forceAutoApply: true
  };
}

function workerConfigFromForm(formData: FormData, enabled: boolean): Omit<AutomationWorkerConfigRecord, "createdAt" | "updatedAt"> {
  return {
    id: text(formData, "workerId") || "default",
    enabled,
    intervalMs: number(formData, "intervalSeconds", 900) * 1000,
    failureBackoffMultiplier: number(formData, "failureBackoffMultiplier", 2),
    maxIntervalMs: number(formData, "maxIntervalSeconds", 3600) * 1000,
    reviewOnly: bool(formData, "reviewOnly"),
    maxQueries: optionalNumber(formData, "maxQueries"),
    maxSources: optionalNumber(formData, "maxSources"),
    beliefIds: optionalValues(formData, "beliefIds"),
    sourceIds: optionalValues(formData, "sourceIds"),
    maxObservations: optionalNumber(formData, "maxObservations"),
    candidateThreshold: optionalNumber(formData, "candidateThreshold"),
    autoConfirmThreshold: optionalNumber(formData, "autoConfirmThreshold"),
    bootstrapDefaultSources: bool(formData, "bootstrapDefaultSources"),
    forceAutoApply: bool(formData, "forceAutoApply")
  };
}

function loopOptionsFromWorkerConfig(config: Omit<AutomationWorkerConfigRecord, "createdAt" | "updatedAt">) {
  return {
    reviewOnly: config.reviewOnly,
    maxQueries: config.maxQueries,
    maxSources: config.maxSources,
    beliefIds: config.beliefIds,
    sourceIds: config.sourceIds,
    maxObservations: config.maxObservations,
    candidateThreshold: config.candidateThreshold,
    autoConfirmThreshold: config.autoConfirmThreshold,
    bootstrapDefaultSources: config.bootstrapDefaultSources,
    forceAutoApply: config.forceAutoApply
  };
}

async function guardSourceAutoConfirmRun(services: WorldModelServices, sourceId: string, options: RunSourceOptions) {
  const source = (await services.sources.listSources()).find((item) => item.id === sourceId);
  if (!source?.autoConfirm) return { options, notice: "" };

  const guarded = await guardAutoApply(services, { ...options, sourceIds: [sourceId], forceAutoApply: true });
  if (!guarded.options.reviewOnly) return { options, notice: "" };

  return {
    options: {
      ...options,
      reviewOnly: true,
      forceAutoApply: false
    },
    notice: guarded.notice
  };
}

function hasRunSourceOptions(options: RunSourceOptions) {
  return Object.keys(options).length > 0;
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
  const [pathWithoutHash, hash] = path.split("#", 2);
  const separator = pathWithoutHash.includes("?") ? "&" : "?";
  redirect(`${pathWithoutHash}${separator}${searchParams.toString()}${hash ? `#${hash}` : ""}`);
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

async function runActionWithDynamicNotice(path: string, action: () => Promise<string>) {
  let success = "";
  try {
    success = await action();
    revalidateWorldModel();
  } catch (error) {
    redirectWithNotice(path, { error: actionErrorMessage(error) });
  }
  redirectWithNotice(path, { message: success });
}

async function runActionWithDynamicNoticeTarget(
  defaultPath: string,
  action: () => Promise<{ message: string; path?: string }>
) {
  let success = "";
  let targetPath = defaultPath;
  try {
    const result = await action();
    success = result.message;
    targetPath = result.path ?? defaultPath;
    revalidateWorldModel();
  } catch (error) {
    redirectWithNotice(defaultPath, { error: actionErrorMessage(error) });
  }
  redirectWithNotice(targetPath, { message: success });
}

async function runActionWithNoticeTarget(
  defaultPath: string,
  success: string,
  action: () => Promise<string | undefined>
) {
  let targetPath = defaultPath;
  try {
    targetPath = (await action()) ?? defaultPath;
    revalidateWorldModel();
  } catch (error) {
    redirectWithNotice(defaultPath, { error: actionErrorMessage(error) });
  }
  redirectWithNotice(targetPath, { message: success });
}

function revalidateWorldModel() {
  revalidatePath("/admin/world-model");
  revalidatePath("/admin/world-model/beliefs");
  revalidatePath("/admin/world-model/graph");
  revalidatePath("/admin/world-model/observations");
  revalidatePath("/admin/world-model/evidence");
  revalidatePath("/admin/world-model/sources");
  revalidatePath("/admin/world-model/models");
}

type EvidenceFocusRecord = {
  id: string;
  confirmedAt: Date;
};

function evidenceFocusPath(evidence: EvidenceFocusRecord, evidenceList: EvidenceFocusRecord[]) {
  const completeEvidenceList = evidenceList.some((item) => item.id === evidence.id) ? evidenceList : [...evidenceList, evidence];
  const evidenceCodes = createReadableCodes(completeEvidenceList, "E", (item) => item.confirmedAt);
  const code = readableCode(evidenceCodes, evidence.id, "E");
  const encodedCode = encodeURIComponent(code);
  return `/admin/world-model/evidence?evidence=${encodedCode}#${encodedCode}`;
}

function newestEvidence(evidenceList: EvidenceFocusRecord[]) {
  return [...evidenceList].sort((left, right) => right.confirmedAt.getTime() - left.confirmedAt.getTime())[0];
}

function newestObservationByIgnoredReason(observations: ObservationRecord[], reason: string) {
  return [...observations]
    .filter((observation) => observation.status === "UNKNOWN" && observation.metadata.ignoredReason === reason)
    .sort((left, right) => right.observedAt.getTime() - left.observedAt.getTime())[0];
}

function observationRecommendationPath(observation: ObservationRecord, observations: ObservationRecord[]) {
  const observationCodes = createReadableCodes(observations, "O", (item) => item.observedAt);
  const observationCode = readableCode(observationCodes, observation.id, "O");
  return `/admin/world-model/beliefs?sourceObservation=${encodeURIComponent(observationCode)}#recommendations`;
}

type AutomationFollowupResult = Pick<
  EvidenceLoopResult,
  "reviewCount" | "lowImpactCount" | "unmatchedCount" | "autoAppliedCount"
>;

async function automationFollowupPath(result: AutomationFollowupResult, services: WorldModelServices, defaultPath: string) {
  if (result.reviewCount > 0) return "/admin/world-model/observations#review-candidates";
  if (result.lowImpactCount > 0) return "/admin/world-model/observations#unknown-evidence";
  if (result.unmatchedCount > 0) {
    const observations = await services.observations.listObservations();
    const observation = newestObservationByIgnoredReason(observations, "UNMATCHED");
    return observation ? observationRecommendationPath(observation, observations) : "/admin/world-model/observations#unknown-evidence";
  }
  if (result.autoAppliedCount > 0) {
    const evidenceList = await services.evidence.listEvidence();
    const evidence = newestEvidence(evidenceList);
    return evidence ? evidenceFocusPath(evidence, evidenceList) : defaultPath;
  }
  return defaultPath;
}

export async function createBeliefAction(formData: FormData) {
  const sourceObservationId = text(formData, "sourceObservationId");
  await runActionWithNoticeTarget("/admin/world-model/beliefs", "信念表已创建", async () => {
    const services = getWorldModelServices();
    await services.beliefs.createBelief({
      title: text(formData, "title"),
      category: text(formData, "category") as BeliefCategory,
      description: text(formData, "description"),
      probabilityMode: text(formData, "probabilityMode") === "MUTUALLY_EXCLUSIVE" ? "MUTUALLY_EXCLUSIVE" : "INDEPENDENT",
      sourceObservationId: sourceObservationId || undefined,
      hypotheses: [
        {
          proposition: text(formData, "proposition1"),
          priorProbability: number(formData, "priorProbability1"),
          stance: text(formData, "stance1") as HypothesisStance,
          notes: "",
          evidenceSearchQuery: text(formData, "evidenceSearchQuery1")
        },
        {
          proposition: text(formData, "proposition2"),
          priorProbability: number(formData, "priorProbability2"),
          stance: text(formData, "stance2") as HypothesisStance,
          notes: "",
          evidenceSearchQuery: text(formData, "evidenceSearchQuery2")
        }
      ].filter((hypothesis) => hypothesis.proposition)
    });
    return recommendedHypothesisSuccessPath(sourceObservationId);
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
      notes: text(formData, "notes"),
      evidenceSearchQuery: text(formData, "evidenceSearchQuery"),
      startsAt: optionalDateTime(formData, "startsAt"),
      expiresAt: optionalDateTime(formData, "expiresAt"),
      expiryCondition: text(formData, "expiryCondition") || undefined
    });
  });
}

export async function createRecommendedHypothesisAction(formData: FormData) {
  await runActionWithNoticeTarget("/admin/world-model/beliefs", "推荐假设已添加", async () => {
    const services = getWorldModelServices();
      await services.beliefs.createHypothesis(text(formData, "beliefId"), {
        proposition: text(formData, "proposition"),
        priorProbability: number(formData, "priorProbability", 0.5),
        stance: text(formData, "stance") as HypothesisStance,
        notes: text(formData, "notes"),
        evidenceSearchQuery: text(formData, "evidenceSearchQuery"),
        sourceObservationId: text(formData, "sourceObservationId") || undefined
      });
    return recommendedHypothesisSuccessPath(text(formData, "sourceObservationId"));
  });
}

export async function updateBeliefAction(formData: FormData) {
  await runAction(worldModelActionReturnPath(formData, "/admin/world-model/beliefs"), "信念表已更新", async () => {
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
  await runAction(worldModelActionReturnPath(formData, "/admin/world-model/beliefs"), "假设已更新", async () => {
    const services = getWorldModelServices();
    const patch = {
      beliefId: text(formData, "beliefId"),
      proposition: text(formData, "proposition"),
      notes: text(formData, "notes"),
      evidenceSearchQuery: text(formData, "evidenceSearchQuery"),
      stance: text(formData, "stance") as HypothesisStance,
      priorProbability: number(formData, "priorProbability", 0.5),
      currentProbability: number(formData, "currentProbability", 0.5),
      status: text(formData, "status") as "ACTIVE" | "PAUSED" | "RESOLVED_TRUE" | "RESOLVED_FALSE" | "ARCHIVED"
    };
    const startsAt = patchDateTime(formData, "startsAt");
    const expiresAt = patchDateTime(formData, "expiresAt");
    await services.beliefs.updateHypothesis(text(formData, "hypothesisId"), {
      ...patch,
      ...(formData.has("startsAt") && startsAt !== undefined ? { startsAt } : {}),
      ...(formData.has("expiresAt") && expiresAt !== undefined ? { expiresAt } : {}),
      ...(formData.has("expiryCondition") ? { expiryCondition: text(formData, "expiryCondition") } : {}),
      ...(formData.has("resolvedOutcome") ? { resolvedOutcome: text(formData, "resolvedOutcome") } : {})
    });
  });
}

export async function settleObservationAction(formData: FormData) {
  await runAction(worldModelActionReturnPath(formData, "/admin/world-model/observations#review-candidates"), "假设已结算", async () => {
    const services = getWorldModelServices();
    await services.observations.settleObservation({
      observationId: text(formData, "observationId"),
      hypothesisId: text(formData, "hypothesisId"),
      outcome: settlementStatus(text(formData, "outcome")),
      resolvedOutcome: text(formData, "resolvedOutcome") || undefined
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

export async function updateGraphObservationAction(formData: FormData) {
  await runAction(worldModelActionReturnPath(formData, "/admin/world-model/graph"), "观察已更新", async () => {
    const services = getWorldModelServices();
    await services.observations.updateObservation(text(formData, "observationId"), {
      ...(formData.has("sourceId") ? { sourceId: text(formData, "sourceId") || null } : {}),
      title: text(formData, "title"),
      content: text(formData, "content"),
      url: text(formData, "url") || undefined,
      author: text(formData, "author") || undefined,
      credibility: number(formData, "credibility", 0.5)
    });
  });
}

export async function connectSourceObservationAction(formData: FormData) {
  await runAction(worldModelActionReturnPath(formData, "/admin/world-model/graph"), "观察来源已更新", async () => {
    const services = getWorldModelServices();
    await services.observations.updateObservation(text(formData, "observationId"), {
      sourceId: text(formData, "sourceId")
    });
  });
}

export async function rejectObservationAction(formData: FormData) {
  await runAction(worldModelActionReturnPath(formData, "/admin/world-model/observations"), "观察已拒绝", async () => {
    const services = getWorldModelServices();
    await services.observations.rejectObservation(text(formData, "observationId"));
  });
}

export async function rejectDuplicateObservationsAction(formData: FormData) {
  await runAction(worldModelActionReturnPath(formData, "/admin/world-model/observations#duplicate-candidates"), "重复候选已拒绝", async () => {
    const services = getWorldModelServices();
    const observationIds = [...new Set(values(formData, "observationIds"))];
    if (observationIds.length === 0) throw new Error("没有可拒绝的重复候选。");
    for (const observationId of observationIds) {
      await services.observations.rejectObservation(observationId);
    }
  });
}

export async function rejectLowImpactObservationsAction(formData: FormData) {
  await runAction(worldModelActionReturnPath(formData, "/admin/world-model/observations#unknown-evidence"), "低影响观察已拒绝", async () => {
    const services = getWorldModelServices();
    const observationIds = [...new Set(values(formData, "observationIds"))];
    if (observationIds.length === 0) throw new Error("没有可拒绝的低影响观察。");
    for (const observationId of observationIds) {
      await services.observations.rejectObservation(observationId);
    }
  });
}

export async function confirmRecommendedEvidenceAction(formData: FormData) {
  await runActionWithNoticeTarget("/admin/world-model/observations#review-candidates", "推荐证据已确认并应用更新", async () => {
    const services = getWorldModelServices();
    const observationId = text(formData, "observationId");
    const observation = (await services.observations.listObservations()).find((item) => item.id === observationId);
    if (!observation) throw new Error(`Observation not found: ${observationId}`);
    const links = getObservationRecommendedLinks(observation);
    if (links.length === 0) throw new Error("该观察没有可确认的推荐关联。");
    const result = await services.evidence.confirmAndApplyObservation({
      observationId,
      confirmationMode: "MANUAL",
      links
    });
    return evidenceFocusPath(result.evidence, await services.evidence.listEvidence());
  });
}

export async function confirmEvidenceAction(formData: FormData) {
  await runActionWithNoticeTarget("/admin/world-model/evidence", "证据已确认并应用更新", async () => {
    const services = getWorldModelServices();
    const result = await services.evidence.confirmAndApplyObservation({
      observationId: text(formData, "observationId"),
      confirmationMode: "MANUAL",
      links: readEvidenceLinksFromFormData(formData)
    });
    return evidenceFocusPath(result.evidence, await services.evidence.listEvidence());
  });
}

export async function confirmGraphObservationAction(formData: FormData) {
  await runActionWithNoticeTarget(worldModelActionReturnPath(formData, "/admin/world-model/graph"), "观察已确认为证据并应用更新", async () => {
    const services = getWorldModelServices();
    const result = await services.evidence.confirmAndApplyObservation({
      observationId: text(formData, "observationId"),
      confirmationMode: "MANUAL",
      links: readEvidenceLinksFromFormData(formData)
    });
    return evidenceFocusPath(result.evidence, await services.evidence.listEvidence());
  });
}

export async function createEvidenceFromObservationAction(formData: FormData) {
  await runActionWithNoticeTarget("/admin/world-model/evidence", "观察已录入为证据并应用更新", async () => {
    const services = getWorldModelServices();
    const observation = await services.observations.createObservation({
      title: text(formData, "title"),
      content: text(formData, "content"),
      url: text(formData, "url") || undefined,
      author: text(formData, "author") || undefined,
      credibility: number(formData, "credibility", 0.5)
    });
    const result = await services.evidence.confirmAndApplyObservation({
      observationId: observation.id,
      confirmationMode: "MANUAL",
      links: readEvidenceLinksFromFormData(formData)
    });
    return evidenceFocusPath(result.evidence, await services.evidence.listEvidence());
  });
}

export async function applyEvidenceUpdateAction(formData: FormData) {
  await runAction(worldModelActionReturnPath(formData, "/admin/world-model/evidence"), "证据更新已应用", async () => {
    const services = getWorldModelServices();
    await services.updates.applyEvidence(text(formData, "evidenceId"));
  });
}

export async function updateEvidenceAction(formData: FormData) {
  await runAction(worldModelActionReturnPath(formData, "/admin/world-model/evidence"), "证据已保存并重新应用", async () => {
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
  await runAction(worldModelActionReturnPath(formData, "/admin/world-model/evidence"), "图谱连接已保存并重新应用", async () => {
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

export async function disconnectEvidenceHypothesisAction(formData: FormData) {
  await runAction(worldModelActionReturnPath(formData, "/admin/world-model/evidence"), "图谱连接已断开并重新应用", async () => {
    const services = getWorldModelServices();
    await services.evidence.disconnectHypothesis(text(formData, "evidenceId"), {
      hypothesisId: text(formData, "hypothesisId")
    });
  });
}

export async function connectObservationHypothesisAction(formData: FormData) {
  await runActionWithNoticeTarget(worldModelActionReturnPath(formData, "/admin/world-model/graph"), "观察连接已确认为证据并应用更新", async () => {
    const services = getWorldModelServices();
    const links = readEvidenceLinksFromFormData(formData);
    const result = await services.evidence.confirmAndApplyObservation({
      observationId: text(formData, "observationId"),
      confirmationMode: "MANUAL",
      links:
        links.length > 0
          ? links
          : [
              {
                hypothesisId: text(formData, "hypothesisId"),
                direction: text(formData, "direction") as "SUPPORTS" | "OPPOSES" | "MIXED" | "NEUTRAL",
                relevance: number(formData, "relevance", 0.7),
                likelihoodRatio: number(formData, "likelihoodRatio", 1),
                confidence: number(formData, "confidence", 0.6),
                rationale: text(formData, "rationale") || "从图谱连接确认的观察关联"
              }
            ]
    });
    return evidenceFocusPath(result.evidence, await services.evidence.listEvidence());
  });
}

export async function rejectEvidenceAction(formData: FormData) {
  await runAction(worldModelActionReturnPath(formData, "/admin/world-model/evidence"), "证据已拒绝并回滚相关更新", async () => {
    const services = getWorldModelServices();
    await services.evidence.reject(text(formData, "evidenceId"));
  });
}

export async function deleteEvidenceAction(formData: FormData) {
  await runAction(worldModelActionReturnPath(formData, "/admin/world-model/evidence"), "证据已删除并保留回滚审计", async () => {
    const services = getWorldModelServices();
    await services.evidence.deleteEvidence(text(formData, "evidenceId"));
  });
}

export async function rollbackUpdateAction(formData: FormData) {
  await runAction(worldModelActionReturnPath(formData, "/admin/world-model/evidence"), "更新事件已回滚", async () => {
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

export async function updateSourceAction(formData: FormData) {
  await runAction(worldModelActionReturnPath(formData, "/admin/world-model/sources"), "来源已更新", async () => {
    const services = getWorldModelServices();
    await services.sources.updateSource(text(formData, "sourceId"), {
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

export async function applySourceCalibrationAction(formData: FormData) {
  await runAction(worldModelActionReturnPath(formData, "/admin/world-model/sources"), "来源校准建议已应用", async () => {
    const services = getWorldModelServices();
    const credibility = optionalNumber(formData, "suggestedCredibility") ?? number(formData, "credibility", 0.5);
    const autoConfirmThreshold =
      optionalNumber(formData, "suggestedAutoConfirmThreshold") ?? number(formData, "autoConfirmThreshold", 0.85);
    await services.sources.updateSource(text(formData, "sourceId"), {
      credibility,
      autoConfirmThreshold
    });
  });
}

export async function createSourcePresetAction(formData: FormData) {
  await runAction("/admin/world-model/sources", "推荐来源已添加", async () => {
    const services = getWorldModelServices();
    await services.sources.createPreset(text(formData, "presetId"));
  });
}

export async function createMissingSourcePresetsAction() {
  await runAction("/admin/world-model/sources", "推荐来源已补齐", async () => {
    const services = getWorldModelServices();
    await services.sources.createMissingPresets();
  });
}

export async function runSourceDryRunAction(formData: FormData) {
  await runAction(worldModelActionReturnPath(formData, "/admin/world-model/sources"), "Dry-run 已记录", async () => {
    const services = getWorldModelServices();
    await services.sources.runDryRun(text(formData, "sourceId"), [
      { title: text(formData, "sampleTitle"), content: text(formData, "sampleContent"), url: text(formData, "sampleUrl") }
    ]);
  });
}

export async function runSourceAction(formData: FormData) {
  const defaultPath = worldModelActionReturnPath(formData, "/admin/world-model/sources");
  await runActionWithDynamicNoticeTarget(defaultPath, async () => {
    const services = getWorldModelServices();
    const sourceId = text(formData, "sourceId");
    const beliefIds = optionalValues(formData, "beliefIds");
    const guarded = await guardSourceAutoConfirmRun(services, sourceId, beliefIds ? { beliefIds } : {});
    const run = hasRunSourceOptions(guarded.options)
      ? await services.sources.runSource(sourceId, guarded.options)
      : await services.sources.runSource(sourceId);
    if (run.status === "FAILED") {
      throw new Error(run.errorMessage ?? "来源采集失败");
    }
    return {
      message: guarded.notice ? `来源采集已运行；${guarded.notice}` : "来源采集已运行",
      path: await automationFollowupPath(run, services, defaultPath)
    };
  });
}

export async function runSourceReviewOnlyAction(formData: FormData) {
  const defaultPath = worldModelActionReturnPath(formData, "/admin/world-model/sources");
  await runActionWithDynamicNoticeTarget(defaultPath, async () => {
    const services = getWorldModelServices();
    const beliefIds = optionalValues(formData, "beliefIds");
    const run = await services.sources.runSource(text(formData, "sourceId"), {
      reviewOnly: true,
      ...(beliefIds ? { beliefIds } : {})
    });
    if (run.status === "FAILED") {
      throw new Error(run.errorMessage ?? "来源采集失败");
    }
    return {
      message: "来源待审采集已运行",
      path: await automationFollowupPath(run, services, defaultPath)
    };
  });
}

export async function runEvidenceLoopAction(formData: FormData) {
  const defaultPath = worldModelActionReturnPath(formData, "/admin/world-model/sources");
  await runActionWithDynamicNoticeTarget(defaultPath, async () => {
    const services = getWorldModelServices();
    const guarded = await guardAutoApply(services, {
      reviewOnly: bool(formData, "reviewOnly"),
      beliefIds: optionalValues(formData, "beliefIds"),
      sourceIds: optionalValues(formData, "sourceIds"),
      maxQueries: optionalNumber(formData, "maxQueries"),
      maxSources: optionalNumber(formData, "maxSources"),
      maxObservations: optionalNumber(formData, "maxObservations"),
      candidateThreshold: optionalNumber(formData, "candidateThreshold"),
      autoConfirmThreshold: optionalNumber(formData, "autoConfirmThreshold"),
      bootstrapDefaultSources: bool(formData, "bootstrapDefaultSources"),
      forceAutoApply: bool(formData, "forceAutoApply")
    });
    const result = await services.automation.runEvidenceLoop(guarded.options);
    const message = automationLoopActionNotice(result);
    return {
      message: guarded.notice ? `${message}；${guarded.notice}` : message,
      path: await automationFollowupPath(result, services, defaultPath)
    };
  });
}

export async function runEvidenceLoopDryRunAction(formData: FormData) {
  await runActionWithDynamicNotice(worldModelActionReturnPath(formData, "/admin/world-model/sources"), async () => {
    const services = getWorldModelServices();
    const sourceIds = optionalValues(formData, "sourceIds");
    const bootstrapDefaultSources = bool(formData, "bootstrapDefaultSources");
    if (bootstrapDefaultSources && !sourceIds) {
      await services.sources.createMissingPresets();
    }
    const result = await runObserveLoopDryRun(
      await services.sources.listSources(),
      {
        runDryRun: services.sources.runDryRun,
        listBeliefs: () => services.beliefs.listBeliefs()
      },
      {
        beliefIds: optionalValues(formData, "beliefIds"),
        sourceIds,
        maxQueries: optionalNumber(formData, "maxQueries"),
        maxSources: optionalNumber(formData, "maxSources"),
        maxObservations: optionalNumber(formData, "maxObservations"),
        bootstrapDefaultSources
      }
    );
    return automationLoopDryRunActionNotice(result);
  });
}

export async function startEvidenceLoopWorkerAction(formData: FormData) {
  await runActionWithDynamicNotice(worldModelActionReturnPath(formData, "/admin/world-model/sources"), async () => {
    const services = getWorldModelServices();
    const guarded = await guardAutoApply(services, workerConfigFromForm(formData, true));
    const config = await services.automation.saveWorkerConfig(guarded.options);
    await getEvidenceLoopWorkerController().start(
      {
        workerId: config.id,
        intervalMs: config.intervalMs,
        failureBackoffMultiplier: config.failureBackoffMultiplier,
        maxIntervalMs: config.maxIntervalMs,
        runImmediately: true,
        loopOptions: loopOptionsFromWorkerConfig(config)
      },
      services
    );
    const message = "本地守护进程已启动，已立即运行一次并将按周期继续运行";
    return guarded.notice ? `${message}；${guarded.notice}` : message;
  });
}

export async function stopEvidenceLoopWorkerAction(formData: FormData) {
  await runAction(worldModelActionReturnPath(formData, "/admin/world-model/sources"), "本地守护进程已停止", async () => {
    const services = getWorldModelServices();
    const workerId = text(formData, "workerId") || "default";
    const existing = (await services.automation.listWorkerConfigs()).find((config) => config.id === workerId);
    await services.automation.saveWorkerConfig({
      ...(existing ?? defaultWorkerConfig(workerId)),
      enabled: false
    });
    await getEvidenceLoopWorkerController().stop(workerId, services);
  });
}

export async function importModelArtifactAction(formData: FormData) {
  await runAction("/admin/world-model/models", "模型产物已导入", async () => {
    const services = getWorldModelServices();
    const sampleCount = optionalNumber(formData, "sampleCount");
    await services.models.importArtifact(
      await readModelArtifactImportInput(text(formData, "path"), {
        name: text(formData, "name"),
        kind: text(formData, "kind") as "LIGHTWEIGHT" | "LLM" | "DEEP_ADAPTER",
        version: text(formData, "version"),
        enabled: bool(formData, "enabled"),
        fallbackMetrics: { importedBy: "admin-form", ...(sampleCount !== undefined ? { sampleCount } : {}) }
      })
    );
  });
}

export async function runLlmEvaluationAction(formData: FormData) {
  await runActionWithDynamicNotice("/admin/world-model/models", async () => {
    const outputDir = text(formData, "outputDir");
    const result = await runLlmEvaluationCommand({
      ...(outputDir ? { outputDir } : {}),
      outputPath: "model-artifacts/llm-evaluation.json",
      limit: optionalNumber(formData, "limit"),
      env: process.env
    });
    return `LLM 评估已完成：样本 ${result.summary.sampleCount}，已评分 ${result.summary.scoredCount}，需复核 ${result.summary.reviewRequiredCount}`;
  });
}

export async function fetchTrainingDataAction(formData: FormData) {
  await runActionWithDynamicNotice("/admin/world-model/models", async () => {
    const outputDir = text(formData, "outputDir");
    const result = await runFetchTrainingDataCommand({
      limit: optionalNumber(formData, "limit"),
      ...(outputDir ? { outputDir } : {})
    });
    return `真实训练样本已抓取：样本 ${result.sampleCount}${sourceCountsNotice(result.sourceCounts)}`;
  });
}

export async function trainLightweightModelAction(formData: FormData) {
  await runActionWithDynamicNotice(worldModelActionReturnPath(formData, "/admin/world-model/models"), async () => {
    const outputDir = text(formData, "outputDir");
    const result = await runLocalLightweightTrainingPipeline(
      getWorldModelServices(),
      outputDir ? { outputDir } : {}
    );
    return `轻量模型训练已完成：样本 ${result.preparedSampleCount}，已导入 ${result.artifact.name}`;
  });
}
