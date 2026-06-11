import type { ConfirmEvidenceInput, EvidenceDirection } from "@/server/services/types";

type EvidenceLinkInput = ConfirmEvidenceInput["links"][number];

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function values(formData: FormData, key: string) {
  return formData
    .getAll(key)
    .map((value) => String(value).trim())
    .filter(Boolean);
}

function number(formData: FormData, key: string, fallback = 0) {
  const value = Number(text(formData, key));
  return Number.isFinite(value) ? value : fallback;
}

function direction(formData: FormData, key: string, fallback: EvidenceDirection = "SUPPORTS"): EvidenceDirection {
  const value = text(formData, key);
  if (value === "SUPPORTS" || value === "OPPOSES" || value === "MIXED" || value === "NEUTRAL") return value;
  return fallback;
}

function sharedLikelihoodRatio(formData: FormData) {
  const linkDirection = direction(formData, "direction");
  const fallback = linkDirection === "OPPOSES" ? 0.67 : 1.5;
  const raw = number(formData, "likelihoodRatio", fallback);
  return linkDirection === "OPPOSES" && raw > 1 ? 1 / raw : raw;
}

function perHypothesisLinks(formData: FormData): EvidenceLinkInput[] {
  return values(formData, "linkHypothesisIds").map((hypothesisId) => ({
    hypothesisId,
    direction: direction(formData, `direction:${hypothesisId}`),
    relevance: number(formData, `relevance:${hypothesisId}`, 0.7),
    likelihoodRatio: number(formData, `likelihoodRatio:${hypothesisId}`, 1),
    confidence: number(formData, `confidence:${hypothesisId}`, 0.6),
    rationale: text(formData, `rationale:${hypothesisId}`) || "证据关联重新评估"
  }));
}

function sharedLinks(formData: FormData): EvidenceLinkInput[] {
  return values(formData, "hypothesisIds").map((hypothesisId) => ({
    hypothesisId,
    direction: direction(formData, "direction"),
    relevance: number(formData, "relevance", 0.7),
    likelihoodRatio: sharedLikelihoodRatio(formData),
    confidence: number(formData, "confidence", 0.6),
    rationale: text(formData, "rationale")
  }));
}

export function readEvidenceLinksFromFormData(formData: FormData): EvidenceLinkInput[] {
  const links = perHypothesisLinks(formData);
  return links.length > 0 ? links : sharedLinks(formData);
}
