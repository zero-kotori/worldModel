import type { EvidenceLoopResult, EvidenceLoopSkippedSource } from "@/server/services/types";

type EvidenceLoopResultStatus = Pick<EvidenceLoopResult, "failureCount" | "sourceRunCount" | "skippedSourceCount"> & {
  reprocessedObservationCount?: number;
  reviewCount?: number;
  lowImpactCount?: number;
  unmatchedCount?: number;
  skippedSources?: EvidenceLoopSkippedSource[];
  runs?: Array<{ errorMessage?: string }>;
};

export function evidenceLoopResultAttentionMessage(result: EvidenceLoopResultStatus) {
  const backoffMessage = evidenceLoopResultBackoffMessage(result);
  if (backoffMessage) return backoffMessage;
  if ((result.reviewCount ?? 0) > 0) {
    const count = result.reviewCount ?? 0;
    return `${count} 条候选观察等待确认。`;
  }
  if ((result.lowImpactCount ?? 0) > 0) {
    const count = result.lowImpactCount ?? 0;
    return `${count} 条低影响观察需要人工处理。`;
  }
  if ((result.unmatchedCount ?? 0) > 0) {
    const count = result.unmatchedCount ?? 0;
    return `${count} 条观察未匹配到现有假设，可能需要补充新假设。`;
  }
  return "";
}

export function evidenceLoopResultBackoffMessage(result: EvidenceLoopResultStatus) {
  if (result.sourceRunCount === 0 && result.skippedSourceCount > 0 && (result.reprocessedObservationCount ?? 0) === 0) {
    if (result.skippedSources?.some((source) => source.reason === "LOW_INCREMENT")) {
      return "所有可用来源都因缺少新观察被跳过。";
    }
    return "所有可用来源都因连续失败被跳过。";
  }
  const noRunnableMessage = result.runs
    ?.map((run) => run.errorMessage?.trim())
    .find((message): message is string => Boolean(message?.startsWith("没有可运行来源：") || message?.startsWith("没有可运行查询：")));
  if (noRunnableMessage) return noRunnableMessage;
  if (result.failureCount > 0) return "一个或多个来源运行失败。";
  return "";
}

export function evidenceLoopResultNeedsAttention(result: EvidenceLoopResultStatus) {
  return evidenceLoopResultAttentionMessage(result).length > 0;
}

export function evidenceLoopResultNeedsBackoff(result: EvidenceLoopResultStatus) {
  return evidenceLoopResultBackoffMessage(result).length > 0;
}
