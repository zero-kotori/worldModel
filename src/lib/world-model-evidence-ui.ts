import type { ConfirmEvidenceInput, EvidenceDirection, EvidenceRecord } from "@/server/services/types";

type EvidenceLinkInput = ConfirmEvidenceInput["links"][number];
type EvidenceApplyCandidate = Pick<EvidenceRecord, "id" | "status"> & Partial<Pick<EvidenceRecord, "links">>;

function metadataString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function metadataNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

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

export function canApplyEvidenceUpdate(
  evidence: EvidenceApplyCandidate,
  activeUpdateEvidenceIds: ReadonlySet<string>,
  currentHypothesisIds?: ReadonlySet<string>
) {
  if (evidence.status !== "ACTIVE" || activeUpdateEvidenceIds.has(evidence.id)) return false;
  if (!currentHypothesisIds) return true;
  return (evidence.links ?? []).some((link) => currentHypothesisIds.has(link.hypothesisId));
}

export function canRejectEvidence(evidence: Pick<EvidenceRecord, "status">) {
  return evidence.status === "ACTIVE";
}

export function canEditEvidence(evidence: Pick<EvidenceRecord, "status">) {
  return evidence.status === "ACTIVE" || evidence.status === "REJECTED";
}

export function canDeleteEvidence(evidence: Pick<EvidenceRecord, "status">) {
  return evidence.status === "ACTIVE" || evidence.status === "REJECTED";
}

export function evidenceCandidateEvaluationSummary(evidence: Pick<EvidenceRecord, "metadata">) {
  const value = evidence.metadata.candidateEvaluation;
  if (!value || typeof value !== "object") return "";

  const candidate = value as Record<string, unknown>;
  const attemptedCount = metadataNonNegativeInteger(candidate.attemptedCount);
  const usableCount = metadataNonNegativeInteger(candidate.usableCount);
  if (attemptedCount === null || usableCount === null) return "";

  const estimator = metadataString(candidate.estimator) || "评分器";
  const abstainedCount = metadataNonNegativeInteger(candidate.abstainedCount) ?? 0;
  const rejectedCount = metadataNonNegativeInteger(candidate.rejectedCount) ?? 0;
  const parts = [`${estimator} 评估 ${attemptedCount} 个候选`, `${usableCount} 个可用`];
  if (abstainedCount > 0) parts.push(`${abstainedCount} 个弃权`);
  if (rejectedCount > 0) parts.push(`${rejectedCount} 个低相关`);

  const rationale = metadataString(candidate.latestRationale);
  return rationale ? `${parts.join("，")}；${rationale}` : parts.join("，");
}

export function evidenceQueryContextSummary(evidence: Pick<EvidenceRecord, "metadata">) {
  const query = metadataString(evidence.metadata.query);
  const beliefCode = metadataString(evidence.metadata.queryBeliefCode);
  const hypothesisCode = metadataString(evidence.metadata.queryHypothesisCode);
  const purpose = metadataString(evidence.metadata.queryPurpose);
  const priority = typeof evidence.metadata.queryPriority === "number" ? evidence.metadata.queryPriority : undefined;
  const priorityReason = metadataString(evidence.metadata.queryPriorityReason);
  const target = [hypothesisCode, beliefCode].filter(Boolean).join(" · ");
  const parts = [];
  if (target) {
    parts.push(`${purpose === "SETTLEMENT_REVIEW" ? "结算目标" : "搜证目标"} ${target}`);
  } else if (query) {
    parts.push(purpose === "SETTLEMENT_REVIEW" ? "自动结算搜证" : "自动搜证");
  }
  if (priority !== undefined && Number.isFinite(priority)) {
    parts.push(`优先级 ${priority.toFixed(2)}`);
  }
  if (priorityReason) {
    parts.push(priorityReason);
  }
  if (query) {
    parts.push(`查询：${query}`);
  }
  return parts.join("；");
}
