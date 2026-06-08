import type { ObservationRecord, ObservationStatus } from "@/server/services/types";

export const observationStatusLabels: Record<ObservationStatus, string> = {
  PENDING: "待处理",
  DUPLICATE: "重复候选",
  UNKNOWN: "未知证据",
  CONFIRMED: "已确认",
  REJECTED: "已拒绝"
};

export function groupObservationsForReview(observations: ObservationRecord[]) {
  return {
    unknown: observations.filter((observation) => observation.status === "UNKNOWN"),
    duplicates: observations.filter((observation) => observation.status === "DUPLICATE"),
    activePool: observations.filter((observation) => observation.status === "PENDING")
  };
}
