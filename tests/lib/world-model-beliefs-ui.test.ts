import {
  datetimeLocalValue,
  hypothesisTimeStatus,
  isHypothesisCurrentlyEffective,
  isHypothesisReviewDue,
  parseDateTimeLocalValue,
  parseDateTimePatchValue,
  summarizeHypothesisTimeCoverage
} from "@/lib/world-model-beliefs-ui";

describe("world model beliefs UI", () => {
  const referenceTime = new Date(2026, 5, 11, 9, 30, 0);

  it("summarizes hypothesis time windows for belief table display", () => {
    expect(hypothesisTimeStatus({ status: "PAUSED" }, referenceTime)).toEqual({
      label: "非活跃",
      tone: "idle",
      detail: "PAUSED"
    });

    expect(hypothesisTimeStatus({ status: "ACTIVE", startsAt: new Date(2026, 5, 12, 9, 30, 0) }, referenceTime)).toEqual({
      label: "未开始",
      tone: "idle",
      detail: "2026/6/12 09:30 后开始"
    });

    expect(hypothesisTimeStatus({ status: "ACTIVE", expiresAt: new Date(2026, 5, 10, 9, 30, 0) }, referenceTime)).toEqual({
      label: "已过期",
      tone: "expired",
      detail: "2026/6/10 09:30 已过期"
    });

    expect(hypothesisTimeStatus({ status: "ACTIVE", expiresAt: new Date(2026, 5, 14, 9, 30, 0) }, referenceTime)).toEqual({
      label: "即将过期",
      tone: "warning",
      detail: "2026/6/14 09:30 到期"
    });

    expect(hypothesisTimeStatus({ status: "ACTIVE", expiresAt: new Date(2026, 6, 20, 9, 30, 0) }, referenceTime)).toEqual({
      label: "当前有效",
      tone: "healthy",
      detail: "2026/7/20 09:30 到期"
    });
  });

  it("formats and parses datetime-local values", () => {
    const date = new Date(2026, 5, 11, 5, 6, 7);

    expect(datetimeLocalValue(date)).toBe("2026-06-11T05:06");
    expect(datetimeLocalValue(undefined)).toBe("");

    const parsed = parseDateTimeLocalValue("2026-06-11T05:06");
    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(5);
    expect(parsed?.getDate()).toBe(11);
    expect(parsed?.getHours()).toBe(5);
    expect(parsed?.getMinutes()).toBe(6);
    expect(parseDateTimeLocalValue("")).toBeUndefined();
    expect(parseDateTimeLocalValue("not-a-date")).toBeUndefined();
  });

  it("parses blank datetime patch values as explicit clears", () => {
    const parsed = parseDateTimePatchValue("2026-06-11T05:06");

    expect(parsed).toBeInstanceOf(Date);
    expect(parseDateTimePatchValue("")).toBeNull();
    expect(parseDateTimePatchValue("not-a-date")).toBeUndefined();
  });

  it("summarizes hypothesis time coverage for dashboard maintenance counts", () => {
    const coverage = summarizeHypothesisTimeCoverage(
      [
        { status: "ACTIVE" },
        { status: "ACTIVE", expiresAt: new Date(2026, 5, 13, 9, 30, 0) },
        { status: "ACTIVE", expiresAt: new Date(2026, 5, 10, 9, 30, 0) },
        { status: "ACTIVE", startsAt: new Date(2026, 5, 12, 9, 30, 0) },
        { status: "PAUSED" }
      ],
      referenceTime
    );

    expect(coverage).toEqual({
      activeCount: 4,
      effectiveCount: 2,
      expiringSoonCount: 1,
      expiredCount: 1,
      upcomingCount: 1,
      inactiveCount: 1,
      reviewDueCount: 2
    });
  });

  it("checks whether an active hypothesis is currently effective", () => {
    expect(isHypothesisCurrentlyEffective({ status: "ACTIVE" }, referenceTime)).toBe(true);
    expect(isHypothesisCurrentlyEffective({ status: "ACTIVE", expiresAt: new Date(2026, 5, 10, 9, 30, 0) }, referenceTime)).toBe(false);
    expect(isHypothesisCurrentlyEffective({ status: "ACTIVE", startsAt: new Date(2026, 5, 12, 9, 30, 0) }, referenceTime)).toBe(false);
    expect(isHypothesisCurrentlyEffective({ status: "PAUSED" }, referenceTime)).toBe(false);
  });

  it("checks whether a hypothesis needs time-window review", () => {
    expect(isHypothesisReviewDue({ status: "ACTIVE", expiresAt: new Date(2026, 5, 10, 9, 30, 0) }, referenceTime)).toBe(true);
    expect(isHypothesisReviewDue({ status: "ACTIVE", expiresAt: new Date(2026, 5, 13, 9, 30, 0) }, referenceTime)).toBe(true);
    expect(isHypothesisReviewDue({ status: "ACTIVE", expiresAt: new Date(2026, 6, 20, 9, 30, 0) }, referenceTime)).toBe(false);
    expect(isHypothesisReviewDue({ status: "ACTIVE", startsAt: new Date(2026, 5, 12, 9, 30, 0) }, referenceTime)).toBe(false);
    expect(isHypothesisReviewDue({ status: "PAUSED", expiresAt: new Date(2026, 5, 10, 9, 30, 0) }, referenceTime)).toBe(false);
  });
});
