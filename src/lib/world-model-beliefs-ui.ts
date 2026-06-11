type HypothesisTimeInput = {
  status: string;
  startsAt?: Date;
  expiresAt?: Date;
};

const EXPIRING_SOON_MS = 7 * 24 * 60 * 60 * 1000;

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
