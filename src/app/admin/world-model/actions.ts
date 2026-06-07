"use server";

import { revalidatePath } from "next/cache";
import { getWorldModelServices } from "@/server/services";
import type { BeliefCategory, ObservationSourceKind } from "@/server/services/types";

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

function revalidateWorldModel() {
  revalidatePath("/admin/world-model");
  revalidatePath("/admin/world-model/beliefs");
  revalidatePath("/admin/world-model/observations");
  revalidatePath("/admin/world-model/evidence");
  revalidatePath("/admin/world-model/sources");
  revalidatePath("/admin/world-model/models");
}

export async function createBeliefAction(formData: FormData) {
  const services = getWorldModelServices();
  await services.beliefs.createBelief({
    title: text(formData, "title"),
    category: text(formData, "category") as BeliefCategory,
    description: text(formData, "description"),
    probabilityMode: text(formData, "probabilityMode") === "MUTUALLY_EXCLUSIVE" ? "MUTUALLY_EXCLUSIVE" : "INDEPENDENT",
    hypotheses: [
      { proposition: text(formData, "proposition1"), priorProbability: number(formData, "priorProbability1"), notes: "" },
      { proposition: text(formData, "proposition2"), priorProbability: number(formData, "priorProbability2"), notes: "" }
    ].filter((hypothesis) => hypothesis.proposition)
  });
  revalidateWorldModel();
}

export async function createObservationAction(formData: FormData) {
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
  revalidateWorldModel();
}

export async function confirmEvidenceAction(formData: FormData) {
  const services = getWorldModelServices();
  const hypothesisIds = text(formData, "hypothesisIds")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  await services.evidence.confirmObservation({
    observationId: text(formData, "observationId"),
    confirmationMode: "MANUAL",
    links: hypothesisIds.map((hypothesisId) => ({
      hypothesisId,
      direction: text(formData, "direction") as "SUPPORTS" | "OPPOSES" | "MIXED" | "NEUTRAL",
      relevance: number(formData, "relevance", 0.7),
      likelihoodRatio: number(formData, "likelihoodRatio", 1),
      confidence: number(formData, "confidence", 0.6),
      rationale: text(formData, "rationale")
    }))
  });
  revalidateWorldModel();
}

export async function applyEvidenceUpdateAction(formData: FormData) {
  const services = getWorldModelServices();
  const preview = await services.updates.createPreview(text(formData, "evidenceId"));
  await services.updates.applyPreview(preview);
  revalidateWorldModel();
}

export async function rollbackUpdateAction(formData: FormData) {
  const services = getWorldModelServices();
  await services.updates.rollback(text(formData, "eventId"));
  revalidateWorldModel();
}

export async function createSourceAction(formData: FormData) {
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
  revalidateWorldModel();
}

export async function runSourceDryRunAction(formData: FormData) {
  const services = getWorldModelServices();
  await services.sources.runDryRun(text(formData, "sourceId"), [
    { title: text(formData, "sampleTitle"), content: text(formData, "sampleContent"), url: text(formData, "sampleUrl") }
  ]);
  revalidateWorldModel();
}

export async function importModelArtifactAction(formData: FormData) {
  const services = getWorldModelServices();
  await services.models.importArtifact({
    name: text(formData, "name"),
    kind: text(formData, "kind") as "LIGHTWEIGHT" | "LLM" | "DEEP_ADAPTER",
    version: text(formData, "version"),
    path: text(formData, "path"),
    metrics: { importedBy: "admin-form" },
    enabled: bool(formData, "enabled")
  });
  revalidateWorldModel();
}
