import {
  canApplyEvidenceUpdate,
  canDeleteEvidence,
  canEditEvidence,
  canRejectEvidence,
  evidenceCandidateEvaluationSummary,
  evidenceQueryContextSummary,
  readEvidenceLinksFromFormData
} from "@/lib/world-model-evidence-ui";
import type { EvidenceRecord } from "@/server/services/types";

function evidence(input: Partial<EvidenceRecord>): EvidenceRecord {
  return {
    id: "evidence_1",
    observationId: "observation_1",
    title: "Evidence",
    content: "Evidence content",
    confirmedAt: new Date("2026-06-11T08:00:00.000Z"),
    confirmationMode: "MANUAL",
    credibility: 0.8,
    status: "ACTIVE",
    metadata: {},
    links: [],
    ...input
  };
}

describe("world model evidence UI", () => {
  it("reads per-hypothesis evidence link fields before shared defaults", () => {
    const formData = new FormData();
    formData.append("hypothesisIds", "hypothesis_shared");
    formData.append("direction", "SUPPORTS");
    formData.append("relevance", "0.1");
    formData.append("likelihoodRatio", "1.2");
    formData.append("confidence", "0.2");
    formData.append("rationale", "Shared rationale");
    formData.append("linkHypothesisIds", "hypothesis_a");
    formData.append("direction:hypothesis_a", "SUPPORTS");
    formData.append("relevance:hypothesis_a", "0.91");
    formData.append("likelihoodRatio:hypothesis_a", "2.4");
    formData.append("confidence:hypothesis_a", "0.82");
    formData.append("rationale:hypothesis_a", "Supports the first hypothesis");
    formData.append("linkHypothesisIds", "hypothesis_b");
    formData.append("direction:hypothesis_b", "OPPOSES");
    formData.append("relevance:hypothesis_b", "0.63");
    formData.append("likelihoodRatio:hypothesis_b", "0.48");
    formData.append("confidence:hypothesis_b", "0.74");
    formData.append("rationale:hypothesis_b", "Weakens the second hypothesis");

    expect(readEvidenceLinksFromFormData(formData)).toEqual([
      {
        hypothesisId: "hypothesis_a",
        direction: "SUPPORTS",
        relevance: 0.91,
        likelihoodRatio: 2.4,
        confidence: 0.82,
        rationale: "Supports the first hypothesis"
      },
      {
        hypothesisId: "hypothesis_b",
        direction: "OPPOSES",
        relevance: 0.63,
        likelihoodRatio: 0.48,
        confidence: 0.74,
        rationale: "Weakens the second hypothesis"
      }
    ]);
  });

  it("keeps the existing shared link behavior for manual confirmation forms", () => {
    const formData = new FormData();
    formData.append("hypothesisIds", "hypothesis_a");
    formData.append("hypothesisIds", "hypothesis_b");
    formData.append("direction", "OPPOSES");
    formData.append("relevance", "0.7");
    formData.append("likelihoodRatio", "2");
    formData.append("confidence", "0.6");
    formData.append("rationale", "Shared opposing evidence");

    expect(readEvidenceLinksFromFormData(formData)).toEqual([
      {
        hypothesisId: "hypothesis_a",
        direction: "OPPOSES",
        relevance: 0.7,
        likelihoodRatio: 0.5,
        confidence: 0.6,
        rationale: "Shared opposing evidence"
      },
      {
        hypothesisId: "hypothesis_b",
        direction: "OPPOSES",
        relevance: 0.7,
        likelihoodRatio: 0.5,
        confidence: 0.6,
        rationale: "Shared opposing evidence"
      }
    ]);
  });

  it("allows applying only active evidence without an active update", () => {
    const activeUpdateEvidenceIds = new Set(["evidence_applied"]);

    expect(canApplyEvidenceUpdate(evidence({ id: "evidence_active", status: "ACTIVE" }), activeUpdateEvidenceIds)).toBe(true);
    expect(canApplyEvidenceUpdate(evidence({ id: "evidence_applied", status: "ACTIVE" }), activeUpdateEvidenceIds)).toBe(false);
    expect(canApplyEvidenceUpdate(evidence({ id: "evidence_rejected", status: "REJECTED" }), activeUpdateEvidenceIds)).toBe(false);
    expect(canApplyEvidenceUpdate(evidence({ id: "evidence_superseded", status: "SUPERSEDED" }), activeUpdateEvidenceIds)).toBe(false);
  });

  it("requires a current hypothesis link when current hypothesis ids are provided", () => {
    const activeUpdateEvidenceIds = new Set<string>();
    const currentHypothesisIds = new Set(["hypothesis_current"]);

    expect(
      canApplyEvidenceUpdate(
        evidence({
          id: "evidence_valid",
          links: [
            {
              id: "link_valid",
              evidenceId: "evidence_valid",
              hypothesisId: "hypothesis_current",
              direction: "SUPPORTS",
              relevance: 0.8,
              likelihoodRatio: 1.5,
              confidence: 0.7,
              rationale: "Current link.",
              createdAt: new Date("2026-06-11T08:05:00.000Z")
            }
          ]
        }),
        activeUpdateEvidenceIds,
        currentHypothesisIds
      )
    ).toBe(true);
    expect(canApplyEvidenceUpdate(evidence({ id: "evidence_empty", links: [] }), activeUpdateEvidenceIds, currentHypothesisIds)).toBe(false);
    expect(
      canApplyEvidenceUpdate(
        evidence({
          id: "evidence_stale",
          links: [
            {
              id: "link_stale",
              evidenceId: "evidence_stale",
              hypothesisId: "hypothesis_deleted",
              direction: "SUPPORTS",
              relevance: 0.8,
              likelihoodRatio: 1.5,
              confidence: 0.7,
              rationale: "Deleted link.",
              createdAt: new Date("2026-06-11T08:06:00.000Z")
            }
          ]
        }),
        activeUpdateEvidenceIds,
        currentHypothesisIds
      )
    ).toBe(false);
  });

  it("summarizes candidate evaluation metadata retained on confirmed evidence", () => {
    expect(
      evidenceCandidateEvaluationSummary(
        evidence({
          metadata: {
            candidateEvaluation: {
              estimator: "llm",
              attemptedCount: 3,
              usableCount: 2,
              abstainedCount: 1,
              rejectedCount: 0,
              latestRationale: "One candidate was automatically applied."
            }
          }
        })
      )
    ).toBe("llm 评估 3 个候选，2 个可用，1 个弃权；One candidate was automatically applied.");

    expect(evidenceCandidateEvaluationSummary(evidence({ metadata: {} }))).toBe("");
  });

  it("summarizes auto-search query context retained on confirmed evidence", () => {
    expect(
      evidenceQueryContextSummary(
        evidence({
          metadata: {
            query: "AI agents engineering teams adoption",
            queryBeliefCode: "B-001",
            queryHypothesisCode: "H-001",
            queryPriority: 0.74,
            queryPriorityReason: "high uncertainty; no active evidence"
          }
        })
      )
    ).toBe("搜证目标 H-001 · B-001；优先级 0.74；high uncertainty; no active evidence；查询：AI agents engineering teams adoption");

    expect(
      evidenceQueryContextSummary(
        evidence({
          metadata: {
            query: "Governance pilot final outcome",
            queryPurpose: "SETTLEMENT_REVIEW",
            queryBeliefCode: "B-001",
            queryHypothesisCode: "H-001",
            queryPriority: 1,
            queryPriorityReason: "settlement review due"
          }
        })
      )
    ).toBe("结算目标 H-001 · B-001；优先级 1.00；settlement review due；查询：Governance pilot final outcome");

    expect(evidenceQueryContextSummary(evidence({ metadata: {} }))).toBe("");
  });

  it("allows rejecting only active evidence records", () => {
    expect(canRejectEvidence(evidence({ status: "ACTIVE" }))).toBe(true);
    expect(canRejectEvidence(evidence({ status: "REJECTED" }))).toBe(false);
    expect(canRejectEvidence(evidence({ status: "SUPERSEDED" }))).toBe(false);
  });

  it("allows editing active and rejected evidence records", () => {
    expect(canEditEvidence(evidence({ status: "ACTIVE" }))).toBe(true);
    expect(canEditEvidence(evidence({ status: "REJECTED" }))).toBe(true);
    expect(canEditEvidence(evidence({ status: "SUPERSEDED" }))).toBe(false);
  });

  it("allows deleting active and rejected evidence records", () => {
    expect(canDeleteEvidence(evidence({ status: "ACTIVE" }))).toBe(true);
    expect(canDeleteEvidence(evidence({ status: "REJECTED" }))).toBe(true);
    expect(canDeleteEvidence(evidence({ status: "SUPERSEDED" }))).toBe(false);
  });
});
