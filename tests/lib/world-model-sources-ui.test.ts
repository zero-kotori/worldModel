import { getLatestSourceRun, runErrorSummary, runQuerySummary, sourceHealthLabel, summarizeAutomationHealth } from "@/lib/world-model-sources-ui";
import type { AutomationHeartbeatRecord, ObservationRunRecord, ObservationSourceRecord } from "@/server/services/types";

function source(id: string, enabled = true): ObservationSourceRecord {
  return {
    id,
    name: id,
    kind: "WEB_PAGE",
    adapter: "web_page",
    credibility: 0.7,
    enabled,
    autoConfirm: false,
    autoConfirmThreshold: 0.8,
    createdAt: new Date("2026-06-11T00:00:00.000Z"),
    updatedAt: new Date("2026-06-11T00:00:00.000Z")
  };
}

function run(input: Partial<ObservationRunRecord> & Pick<ObservationRunRecord, "id" | "sourceId" | "status" | "startedAt">): ObservationRunRecord {
  return {
    finishedAt: input.startedAt,
    itemCount: 0,
    deduplicatedCount: 0,
    candidateCount: 0,
    autoAppliedCount: 0,
    reviewCount: 0,
    queryCount: 0,
    querySummary: [],
    ...input
  };
}

function heartbeat(input: Partial<AutomationHeartbeatRecord> & Pick<AutomationHeartbeatRecord, "id" | "status" | "heartbeatAt">): AutomationHeartbeatRecord {
  return {
    intervalMs: 900_000,
    consecutiveFailureCount: 0,
    lastError: "",
    createdAt: new Date("2026-06-11T00:00:00.000Z"),
    updatedAt: input.heartbeatAt,
    ...input
  };
}

describe("world model sources UI", () => {
  it("finds the latest run for one source", () => {
    const latest = run({
      id: "latest",
      sourceId: "source_1",
      status: "FAILED",
      startedAt: new Date("2026-06-11T02:00:00.000Z")
    });

    expect(
      getLatestSourceRun("source_1", [
        run({ id: "other", sourceId: "source_2", status: "SUCCESS", startedAt: new Date("2026-06-11T03:00:00.000Z") }),
        run({ id: "old", sourceId: "source_1", status: "SUCCESS", startedAt: new Date("2026-06-11T01:00:00.000Z") }),
        latest
      ])
    ).toBe(latest);
  });

  it("labels source health from enabled state and latest run", () => {
    expect(sourceHealthLabel(source("disabled", false), undefined)).toBe("已停用");
    expect(sourceHealthLabel(source("never"), undefined)).toBe("未运行");
    expect(
      sourceHealthLabel(
        source("failed"),
        run({
          id: "failed-run",
          sourceId: "failed",
          status: "FAILED",
          startedAt: new Date("2026-06-11T00:00:00.000Z"),
          errorMessage: "fetch failed"
        })
      )
    ).toBe("失败");
    expect(
      sourceHealthLabel(
        source("ok"),
        run({ id: "ok-run", sourceId: "ok", status: "REVIEW_ONLY", startedAt: new Date("2026-06-11T00:00:00.000Z") })
      )
    ).toBe("待审");
  });

  it("truncates long run error messages for table display", () => {
    const message = runErrorSummary(
      run({
        id: "failed-run",
        sourceId: "source_1",
        status: "FAILED",
        startedAt: new Date("2026-06-11T00:00:00.000Z"),
        errorMessage: "x".repeat(180)
      })
    );

    expect(message).toHaveLength(121);
    expect(message.endsWith("...")).toBe(true);
  });

  it("summarizes run query details for table display", () => {
    expect(runQuerySummary(run({ id: "no-query", sourceId: "source_1", status: "SUCCESS", startedAt: new Date() }))).toBe("");

    expect(
      runQuerySummary(
        run({
          id: "query-run",
          sourceId: "source_1",
          status: "SUCCESS",
          startedAt: new Date(),
          queryCount: 2,
          querySummary: [
            {
              beliefId: "belief_1",
              hypothesisId: "hypothesis_1",
              category: "CAREER",
              query: "Remote AI product roles grow with market demand"
            },
            {
              beliefId: "belief_2",
              hypothesisId: "hypothesis_2",
              category: "AI_TREND",
              query: "AI agents accelerate engineering teams"
            }
          ]
        })
      )
    ).toBe("Remote AI product roles grow with market demand +1");

    expect(
      runQuerySummary(
        run({
          id: "long-query-run",
          sourceId: "source_1",
          status: "SUCCESS",
          startedAt: new Date(),
          queryCount: 1,
          querySummary: [
            {
              beliefId: "belief_1",
              hypothesisId: "hypothesis_1",
              category: "AI_TREND",
              query: "x".repeat(120)
            }
          ]
        })
      )
    ).toHaveLength(81);
  });

  it("summarizes idle automation health without run records", () => {
    expect(summarizeAutomationHealth([], [])).toEqual({
      label: "未运行",
      tone: "idle",
      consecutiveFailureCount: 0,
      latestRunAt: undefined,
      lastSuccessAt: undefined,
      latestError: "",
      latestCounts: {
        itemCount: 0,
        candidateCount: 0,
        autoAppliedCount: 0,
        reviewCount: 0
      },
      worker: {
        id: undefined,
        status: undefined,
        label: "未注册",
        tone: "idle",
        latestHeartbeatAt: undefined,
        nextRunAt: undefined,
        intervalMs: undefined,
        consecutiveFailureCount: 0,
        lastError: ""
      },
      diagnostics: [],
      nextActions: []
    });
  });

  it("summarizes consecutive automation failures with the latest success", () => {
    const health = summarizeAutomationHealth([
      run({ id: "success", sourceId: "source_1", status: "SUCCESS", startedAt: new Date("2026-06-11T01:00:00.000Z") }),
      run({
        id: "failed-1",
        sourceId: "source_1",
        status: "FAILED",
        startedAt: new Date("2026-06-11T02:00:00.000Z"),
        errorMessage: "network timeout while collecting evidence"
      }),
      run({
        id: "failed-2",
        sourceId: "source_2",
        status: "FAILED",
        startedAt: new Date("2026-06-11T03:00:00.000Z"),
        itemCount: 3,
        candidateCount: 1,
        autoAppliedCount: 0,
        reviewCount: 1,
        errorMessage: "source endpoint unavailable"
      })
    ]);

    expect(health).toMatchObject({
      label: "连续失败",
      tone: "failing",
      consecutiveFailureCount: 2,
      latestRunAt: new Date("2026-06-11T03:00:00.000Z"),
      lastSuccessAt: new Date("2026-06-11T01:00:00.000Z"),
      latestError: "source endpoint unavailable",
      latestCounts: {
        itemCount: 3,
        candidateCount: 1,
        autoAppliedCount: 0,
        reviewCount: 1
      }
    });
  });

  it("summarizes the latest automation worker heartbeat separately from run history", () => {
    const latestHeartbeat = heartbeat({
      id: "default",
      status: "RUNNING",
      heartbeatAt: new Date("2026-06-11T04:00:00.000Z"),
      nextRunAt: new Date("2026-06-11T04:15:00.000Z"),
      intervalMs: 900_000
    });

    const health = summarizeAutomationHealth(
      [],
      [
        heartbeat({ id: "old", status: "IDLE", heartbeatAt: new Date("2026-06-11T02:00:00.000Z") }),
        latestHeartbeat
      ],
      new Date("2026-06-11T04:10:00.000Z")
    );

    expect(health.worker).toEqual({
      id: "default",
      status: "RUNNING",
      label: "运行中",
      tone: "healthy",
      latestHeartbeatAt: latestHeartbeat.heartbeatAt,
      nextRunAt: latestHeartbeat.nextRunAt,
      intervalMs: 900_000,
      consecutiveFailureCount: 0,
      lastError: ""
    });
  });

  it("marks a running automation worker as stale when the heartbeat is overdue", () => {
    const health = summarizeAutomationHealth(
      [],
      [
        heartbeat({
          id: "default",
          status: "RUNNING",
          heartbeatAt: new Date("2026-06-11T04:00:00.000Z"),
          nextRunAt: new Date("2026-06-11T04:15:00.000Z"),
          intervalMs: 900_000
        })
      ],
      new Date("2026-06-11T05:00:00.000Z")
    );

    expect(health.worker).toMatchObject({
      id: "default",
      status: "RUNNING",
      label: "心跳过期",
      tone: "failing",
      latestHeartbeatAt: new Date("2026-06-11T04:00:00.000Z"),
      nextRunAt: new Date("2026-06-11T04:15:00.000Z")
    });
  });

  it("prefers a non-idle automation worker over a newer idle smoke worker", () => {
    const health = summarizeAutomationHealth(
      [],
      [
        heartbeat({
          id: "default",
          status: "RUNNING",
          heartbeatAt: new Date("2026-06-11T04:00:00.000Z"),
          nextRunAt: new Date("2026-06-11T04:15:00.000Z"),
          intervalMs: 900_000
        }),
        heartbeat({
          id: "smoke",
          status: "IDLE",
          heartbeatAt: new Date("2026-06-11T04:05:00.000Z"),
          intervalMs: 0
        })
      ],
      new Date("2026-06-11T04:10:00.000Z")
    );

    expect(health.worker).toMatchObject({
      id: "default",
      status: "RUNNING",
      label: "运行中",
      tone: "healthy"
    });
  });

  it("prefers active worker runtime over stale heartbeat status", () => {
    const health = summarizeAutomationHealth(
      [],
      [
        heartbeat({
          id: "default",
          status: "IDLE",
          heartbeatAt: new Date("2026-06-11T04:00:00.000Z"),
          intervalMs: 900_000
        })
      ],
      {
        referenceTime: new Date("2026-06-11T05:00:00.000Z"),
        workerRuntime: [
          {
            workerId: "default",
            running: true,
            nextRunAt: new Date("2026-06-11T05:15:00.000Z"),
            consecutiveFailureCount: 0
          }
        ]
      }
    );

    expect(health.worker).toMatchObject({
      id: "default",
      status: "RUNNING",
      label: "运行中",
      tone: "healthy",
      nextRunAt: new Date("2026-06-11T05:15:00.000Z"),
      consecutiveFailureCount: 0
    });
  });

  it("returns actionable diagnostics for stalled automation loops", () => {
    const noSourceHealth = summarizeAutomationHealth([], [], { sourceCount: 0, enabledSourceCount: 0 });
    expect(noSourceHealth.diagnostics).toContainEqual({
      level: "warning",
      title: "缺少采集来源",
      detail: "添加或补齐推荐来源后，闭环才能自动搜集观察。"
    });
    expect(noSourceHealth.nextActions).toContainEqual({
      label: "添加推荐来源",
      href: "/admin/world-model/sources#recommended-sources"
    });

    const noBeliefHealth = summarizeAutomationHealth([], [], {
      sourceCount: 1,
      enabledSourceCount: 1,
      activeBeliefCount: 0,
      activeHypothesisCount: 0
    });
    expect(noBeliefHealth.diagnostics).toContainEqual({
      level: "warning",
      title: "缺少活跃信念",
      detail: "创建至少一个活跃信念表后，闭环才能生成检索任务。"
    });
    expect(noBeliefHealth.nextActions).toContainEqual({
      label: "创建信念表",
      href: "/admin/world-model/beliefs"
    });

    const noHypothesisHealth = summarizeAutomationHealth([], [], {
      sourceCount: 1,
      enabledSourceCount: 1,
      activeBeliefCount: 1,
      activeHypothesisCount: 0
    });
    expect(noHypothesisHealth.diagnostics).toContainEqual({
      level: "warning",
      title: "缺少活跃假设",
      detail: "为活跃信念表添加假设后，闭环才能评估证据并更新概率。"
    });
    expect(noHypothesisHealth.nextActions).toContainEqual({
      label: "补充假设",
      href: "/admin/world-model/beliefs"
    });

    const fetchFailedHealth = summarizeAutomationHealth([
      run({
        id: "failed-run",
        sourceId: "source_1",
        status: "FAILED",
        startedAt: new Date("2026-06-11T03:00:00.000Z"),
        queryCount: 3,
        errorMessage: "fetch failed"
      })
    ]);
    expect(fetchFailedHealth.diagnostics).toContainEqual({
      level: "error",
      title: "来源抓取失败",
      detail: "检查最近失败来源的 URL、网络可达性或适配器配置。"
    });

    const reviewOnlyHealth = summarizeAutomationHealth([
      run({
        id: "review-only-run",
        sourceId: "source_1",
        status: "REVIEW_ONLY",
        startedAt: new Date("2026-06-11T03:00:00.000Z"),
        candidateCount: 4,
        autoAppliedCount: 0,
        reviewCount: 4
      })
    ]);
    expect(reviewOnlyHealth.diagnostics).toContainEqual({
      level: "info",
      title: "候选等待确认",
      detail: "关闭仅生成待审或降低自动应用阈值后，可信候选才能自动更新信念。"
    });
    expect(reviewOnlyHealth.nextActions).toContainEqual({
      label: "处理待审候选",
      href: "/admin/world-model/observations"
    });

    const emptyCollectionHealth = summarizeAutomationHealth([
      run({
        id: "empty-query-run",
        sourceId: "source_1",
        status: "SUCCESS",
        startedAt: new Date("2026-06-11T04:00:00.000Z"),
        queryCount: 2,
        itemCount: 0,
        candidateCount: 0
      })
    ]);
    expect(emptyCollectionHealth.diagnostics).toContainEqual({
      level: "info",
      title: "未采集观察",
      detail: "最近运行生成了检索任务，但来源没有返回可入库观察。"
    });
    expect(emptyCollectionHealth.diagnostics.map((diagnostic) => diagnostic.title)).not.toContain("未识别候选证据");
    expect(emptyCollectionHealth.nextActions).toContainEqual({
      label: "调整采集来源",
      href: "/admin/world-model/sources#source-list"
    });
  });
});
