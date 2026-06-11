import type { EvidenceLoopResult } from "@/server/services/types";

type EvidenceLoopResultStatus = Pick<EvidenceLoopResult, "failureCount" | "sourceRunCount" | "skippedSourceCount">;

export function evidenceLoopResultAttentionMessage(result: EvidenceLoopResultStatus) {
  if (result.failureCount > 0) return "One or more source runs failed.";
  if (result.sourceRunCount === 0 && result.skippedSourceCount > 0) {
    return "All eligible sources were skipped after repeated failures.";
  }
  return "";
}

export function evidenceLoopResultNeedsAttention(result: EvidenceLoopResultStatus) {
  return evidenceLoopResultAttentionMessage(result).length > 0;
}
