type HypothesisTimeInput = {
  status: string;
  startsAt?: Date;
  expiresAt?: Date;
};

type EvidenceImpactInput = {
  id: string;
  confirmedAt: Date;
  status: string;
  links: Array<{
    hypothesisId: string;
    direction: "SUPPORTS" | "OPPOSES" | "MIXED" | "NEUTRAL";
    likelihoodRatio: number;
  }>;
};
type HypothesisStanceInput = {
  status: string;
  stance: "SUPPORTS" | "OPPOSES" | string;
};

const EXPIRING_SOON_MS = 7 * 24 * 60 * 60 * 1000;
const evidenceDirectionText = {
  SUPPORTS: "支持假设",
  OPPOSES: "反对假设",
  MIXED: "混合影响",
  NEUTRAL: "中性"
} as const;

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function displayDateTime(value: Date) {
  return `${value.getFullYear()}/${value.getMonth() + 1}/${value.getDate()} ${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

export function hypothesisTimeStatus(hypothesis: HypothesisTimeInput, referenceTime = new Date()) {
  if (hypothesis.status !== "ACTIVE") {
    return { label: "非活跃", tone: "idle" as const, detail: hypothesis.status };
  }

  const referenceMs = referenceTime.getTime();
  if (hypothesis.startsAt && hypothesis.startsAt.getTime() > referenceMs) {
    return { label: "未开始", tone: "idle" as const, detail: `${displayDateTime(hypothesis.startsAt)} 后开始` };
  }
  if (hypothesis.expiresAt && hypothesis.expiresAt.getTime() <= referenceMs) {
    return { label: "已过期", tone: "expired" as const, detail: `${displayDateTime(hypothesis.expiresAt)} 已过期` };
  }
  if (hypothesis.expiresAt && hypothesis.expiresAt.getTime() - referenceMs <= EXPIRING_SOON_MS) {
    return { label: "即将过期", tone: "warning" as const, detail: `${displayDateTime(hypothesis.expiresAt)} 到期` };
  }
  if (hypothesis.expiresAt) {
    return { label: "当前有效", tone: "healthy" as const, detail: `${displayDateTime(hypothesis.expiresAt)} 到期` };
  }
  return { label: "当前有效", tone: "healthy" as const, detail: "" };
}

export function isHypothesisCurrentlyEffective(hypothesis: HypothesisTimeInput, referenceTime = new Date()) {
  if (hypothesis.status !== "ACTIVE") return false;
  const referenceMs = referenceTime.getTime();
  if (hypothesis.startsAt && hypothesis.startsAt.getTime() > referenceMs) return false;
  if (hypothesis.expiresAt && hypothesis.expiresAt.getTime() <= referenceMs) return false;
  return true;
}

export function isHypothesisReviewDue(hypothesis: HypothesisTimeInput, referenceTime = new Date()) {
  if (hypothesis.status !== "ACTIVE" || !hypothesis.expiresAt) return false;
  const expiresMs = hypothesis.expiresAt.getTime();
  const referenceMs = referenceTime.getTime();
  return expiresMs <= referenceMs || expiresMs - referenceMs <= EXPIRING_SOON_MS;
}

export function summarizeHypothesisTimeCoverage(hypotheses: HypothesisTimeInput[], referenceTime = new Date()) {
  const coverage = {
    activeCount: 0,
    effectiveCount: 0,
    expiringSoonCount: 0,
    expiredCount: 0,
    upcomingCount: 0,
    inactiveCount: 0,
    reviewDueCount: 0
  };
  const referenceMs = referenceTime.getTime();

  for (const hypothesis of hypotheses) {
    if (hypothesis.status !== "ACTIVE") {
      coverage.inactiveCount += 1;
      continue;
    }
    coverage.activeCount += 1;

    if (!isHypothesisCurrentlyEffective(hypothesis, referenceTime)) {
      if (hypothesis.startsAt && hypothesis.startsAt.getTime() > referenceMs) {
        coverage.upcomingCount += 1;
      } else {
        coverage.expiredCount += 1;
      }
      continue;
    }

    coverage.effectiveCount += 1;
    if (hypothesis.expiresAt && hypothesis.expiresAt.getTime() - referenceMs <= EXPIRING_SOON_MS) {
      coverage.expiringSoonCount += 1;
    }
  }

  coverage.reviewDueCount = hypotheses.filter((hypothesis) => isHypothesisReviewDue(hypothesis, referenceTime)).length;
  return coverage;
}

export function summarizeHypothesisStanceCoverage(hypotheses: HypothesisStanceInput[]) {
  const active = hypotheses.filter((hypothesis) => hypothesis.status === "ACTIVE");
  const hasSupport = active.some((hypothesis) => hypothesis.stance === "SUPPORTS");
  const hasOppose = active.some((hypothesis) => hypothesis.stance === "OPPOSES");

  if (hasSupport && hasOppose) {
    return {
      label: "支持/反证均衡",
      detail: "当前有效假设同时覆盖支持和反证方向。",
      tone: "healthy" as const
    };
  }

  if (hasSupport && !hasOppose) {
    return {
      label: "缺少反证假设",
      detail: "当前有效假设只有支持方向，建议补充可证伪或替代解释。",
      tone: "warning" as const
    };
  }

  if (!hasSupport && hasOppose) {
    return {
      label: "缺少支持假设",
      detail: "当前有效假设只有反证方向，建议补充正向解释或可验证支持假设。",
      tone: "warning" as const
    };
  }

  return {
    label: "缺少有效假设",
    detail: "当前没有可用于支持/反证覆盖判断的活跃假设。",
    tone: "idle" as const
  };
}

export function datetimeLocalValue(value?: Date) {
  if (!value) return "";
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

export function parseDateTimeLocalValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function parseDateTimePatchValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function recommendedHypothesisSuccessPath(sourceObservationId: string | undefined) {
  return sourceObservationId?.trim() ? "/admin/world-model/observations#review-candidates" : "/admin/world-model/beliefs";
}

function evidenceImpactTone(directions: Set<string>) {
  if (directions.has("SUPPORTS") && directions.has("OPPOSES")) return "mixed" as const;
  if (directions.has("MIXED")) return "mixed" as const;
  if (directions.has("SUPPORTS")) return "support" as const;
  if (directions.has("OPPOSES")) return "oppose" as const;
  return "neutral" as const;
}

export function summarizeHypothesisEvidenceImpact(
  hypothesisId: string,
  evidence: EvidenceImpactInput[],
  evidenceLabel: (evidenceId: string) => string = (evidenceId) => evidenceId
) {
  const linked = evidence
    .filter((item) => item.status === "ACTIVE")
    .flatMap((item) =>
      item.links
        .filter((link) => link.hypothesisId === hypothesisId)
        .map((link) => ({
          evidence: item,
          link
        }))
    )
    .sort((a, b) => b.evidence.confirmedAt.getTime() - a.evidence.confirmedAt.getTime());

  if (linked.length === 0) {
    return {
      label: "无证据",
      detail: "尚未确认影响这个假设的证据。",
      tone: "neutral" as const
    };
  }

  const latest = linked[0];
  const directions = new Set(linked.map((item) => item.link.direction));
  return {
    label: `${linked.length} 条证据`,
    detail: `最近 ${evidenceLabel(latest.evidence.id)} · ${evidenceDirectionText[latest.link.direction]} · LR ${latest.link.likelihoodRatio.toFixed(2)}`,
    tone: evidenceImpactTone(directions)
  };
}
