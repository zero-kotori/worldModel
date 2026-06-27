import type { BayesianUpdateEventRecord } from "@/server/services/types";

type UpdateDeltaTone = "increase" | "decrease" | "neutral";

export type UpdateDeltaSummary = {
  label: string;
  detail: string;
  tone: UpdateDeltaTone;
};

export type RollbackOption = {
  value: string;
  label: string;
};

function formatProbability(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatPointDelta(value: number) {
  const points = value * 100;
  const sign = points > 0 ? "+" : "";
  return `${sign}${points.toFixed(1)}pp`;
}

function updateDeltaTone(delta: number): UpdateDeltaTone {
  if (delta > 0.000001) return "increase";
  if (delta < -0.000001) return "decrease";
  return "neutral";
}

function largestSnapshotDelta(event: BayesianUpdateEventRecord) {
  const hypothesisIds = new Set([...Object.keys(event.priorSnapshot), ...Object.keys(event.posteriorSnapshot)]);
  let selected: { hypothesisId: string; prior: number; posterior: number; delta: number } | null = null;

  for (const hypothesisId of hypothesisIds) {
    const prior = event.priorSnapshot[hypothesisId] ?? 0;
    const posterior = event.posteriorSnapshot[hypothesisId] ?? prior;
    const delta = posterior - prior;
    if (!selected || Math.abs(delta) > Math.abs(selected.delta)) {
      selected = { hypothesisId, prior, posterior, delta };
    }
  }

  return selected;
}

export function summarizeUpdateDelta(
  event: BayesianUpdateEventRecord,
  hypothesisLabel: (hypothesisId: string) => string = (hypothesisId) => hypothesisId
): UpdateDeltaSummary {
  const delta = largestSnapshotDelta(event);
  if (!delta) {
    return {
      label: "0.0pp",
      detail: "无概率变化",
      tone: "neutral"
    };
  }

  const formattedDelta = formatPointDelta(delta.delta);
  const label = hypothesisLabel(delta.hypothesisId);
  if (event.status === "ROLLED_BACK") {
    return {
      label: "已回滚",
      detail: `原变化 ${label} ${formattedDelta}`,
      tone: "neutral"
    };
  }

  return {
    label: formattedDelta,
    detail: `${label} ${formatProbability(delta.prior)} -> ${formatProbability(delta.posterior)}`,
    tone: updateDeltaTone(delta.delta)
  };
}

export function canRollbackUpdate(event: Pick<BayesianUpdateEventRecord, "status">) {
  return event.status === "APPLIED";
}

export function createRollbackOptions(
  events: BayesianUpdateEventRecord[],
  eventLabel: (eventId: string) => string,
  evidenceLabel: (evidenceId: string) => string
): RollbackOption[] {
  return events.filter(canRollbackUpdate).map((event) => ({
    value: event.id,
    label: `${eventLabel(event.id)} · ${evidenceLabel(event.evidenceId)} · ${event.status}`
  }));
}

export function summarizeUpdateExplanation(
  event: Pick<BayesianUpdateEventRecord, "explanations">,
  hypothesisLabel: (hypothesisId: string) => string = (hypothesisId) => hypothesisId
) {
  const explanation = event.explanations.find((item) => item.trim());
  if (!explanation) return "";

  const match = explanation.match(/^([^:]+):\s*(.*)$/);
  if (!match) return explanation;

  const [, hypothesisId, rationale] = match;
  return `${hypothesisLabel(hypothesisId)}: ${rationale}`;
}
