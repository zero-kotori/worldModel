import {
  automationLoopActionNotice,
  automationLoopDryRunActionNotice,
  automationLoopSuccessMessage,
  automationAttentionItems,
  getLatestSourceRun,
  lowQualityEvidenceSources,
  runErrorSummary,
  runFollowupActions,
  runQuerySummary,
  sourceEvidenceQualityAutoApplyRisk,
  sourceHealthLabel,
  summarizeSourceEvidenceQuality,
  llmEvaluationAutoApplyRisk,
  summarizeAutomationHealth
} from "@/lib/world-model-sources-ui";
import type {
  AutomationHeartbeatRecord,
  BayesianUpdateEventRecord,
  BeliefRecord,
  EvidenceRecord,
  ObservationRecord,
  ObservationRunRecord,
  ObservationSourceRecord
} from "@/server/services/types";

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
    reprocessedObservationCount: 0,
    deduplicatedCount: 0,
    candidateCount: 0,
    autoAppliedCount: 0,
    reviewCount: 0,
    lowImpactCount: 0,
    unmatchedCount: 0,
    queryCount: 0,
    querySummary: [],
    ...input
  };
}

function heartbeat(input: Partial<AutomationHeartbeatRecord> & Pick<AutomationHeartbeatRecord, "id" | "status" | "heartbeatAt">): AutomationHeartbeatRecord {
  return {
    intervalMs: 900_000,
    consecutiveFailureCount: 0,
    lastNotice: "",
    lastError: "",
    createdAt: new Date("2026-06-11T00:00:00.000Z"),
    updatedAt: input.heartbeatAt,
    ...input
  };
}

function observation(input: Partial<ObservationRecord> & Pick<ObservationRecord, "id" | "title" | "status">): ObservationRecord {
  return {
    content: `${input.title} content`,
    observedAt: new Date("2026-06-11T00:00:00.000Z"),
    credibility: 0.7,
    metadata: {},
    ...input
  };
}

function evidence(input: Partial<EvidenceRecord> & Pick<EvidenceRecord, "id" | "observationId">): EvidenceRecord {
  const createdAt = new Date("2026-06-11T08:00:00.000Z");
  return {
    title: input.id,
    content: `${input.id} content`,
    confirmedAt: createdAt,
    confirmationMode: "AUTO",
    credibility: 0.8,
    status: "ACTIVE",
    metadata: {},
    links: [],
    ...input
  };
}

function update(input: Partial<BayesianUpdateEventRecord> & Pick<BayesianUpdateEventRecord, "id" | "evidenceId">): BayesianUpdateEventRecord {
  return {
    beliefId: "belief_signal",
    priorSnapshot: { hypothesis_signal: 0.35 },
    posteriorSnapshot: { hypothesis_signal: 0.58 },
    mode: "APPLIED",
    status: "APPLIED",
    confidence: 0.8,
    explanations: [],
    createdAt: new Date("2026-06-11T09:00:00.000Z"),
    ...input
  };
}

function belief(input: Partial<BeliefRecord> = {}): BeliefRecord {
  const createdAt = new Date("2026-06-11T07:00:00.000Z");
  return {
    id: "belief_signal",
    title: "AI agents improve delivery",
    category: "AI_TREND",
    description: "",
    probabilityMode: "INDEPENDENT",
    origin: "INTERNAL",
    status: "ACTIVE",
    createdAt,
    updatedAt: createdAt,
    hypotheses: [
      {
        id: "hypothesis_support",
        beliefId: "belief_signal",
        proposition: "AI agents improve delivery speed",
        notes: "",
        stance: "SUPPORTS",
        priorProbability: 0.45,
        currentProbability: 0.45,
        strength: 0.45,
        status: "ACTIVE",
        createdAt,
        updatedAt: createdAt
      }
    ],
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
    expect(
      sourceHealthLabel(
        source("duplicate-only"),
        run({
          id: "duplicate-only-run",
          sourceId: "duplicate-only",
          status: "SUCCESS",
          startedAt: new Date("2026-06-11T00:00:00.000Z"),
          itemCount: 2,
          deduplicatedCount: 2
        })
      )
    ).toBe("无新信息");
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

    expect(
      runQuerySummary(
        run({
          id: "priority-query-run",
          sourceId: "source_1",
          status: "SUCCESS",
          startedAt: new Date(),
          queryCount: 1,
          querySummary: [
            {
              beliefId: "belief_1",
              hypothesisId: "hypothesis_1",
              category: "CAREER",
              query: "Remote AI product roles grow with market demand",
              priorityReason: "high uncertainty; no active evidence",
              priority: 1,
              uncertainty: 1,
              evidenceCount: 0
            }
          ]
        })
      )
    ).toBe("Remote AI product roles grow with market demand · high uncertainty; no active evidence");
  });

  it("summarizes rejected and rolled-back evidence as source quality risk without double-counting evidence", () => {
    const summary = summarizeSourceEvidenceQuality("source_risky", {
      observations: [
        observation({ id: "observation_active", title: "Active signal", status: "CONFIRMED", sourceId: "source_risky" }),
        observation({ id: "observation_rejected", title: "Rejected signal", status: "CONFIRMED", sourceId: "source_risky" }),
        observation({ id: "observation_rolled", title: "Rolled signal", status: "CONFIRMED", sourceId: "source_risky" }),
        observation({ id: "observation_other", title: "Other source signal", status: "CONFIRMED", sourceId: "source_other" })
      ],
      evidence: [
        evidence({ id: "evidence_active", observationId: "observation_active" }),
        evidence({ id: "evidence_rejected", observationId: "observation_rejected", status: "REJECTED" }),
        evidence({ id: "evidence_rolled", observationId: "observation_rolled", status: "REJECTED" }),
        evidence({ id: "evidence_other", observationId: "observation_other", status: "REJECTED" })
      ],
      updates: [
        update({ id: "update_rolled", evidenceId: "evidence_rolled", status: "ROLLED_BACK" }),
        update({ id: "update_other", evidenceId: "evidence_other", status: "ROLLED_BACK" })
      ]
    });

    expect(summary).toMatchObject({
      tone: "warning",
      evidenceCount: 3,
      problemEvidenceCount: 2,
      rejectedEvidenceCount: 2,
      rolledBackUpdateCount: 1,
      detail: "证据质量警告：2/3 条证据出现拒绝或回滚（66.7%，回滚 1，拒绝 2）；建议提高自动确认阈值或暂时停用。"
    });
  });

  it("promotes low source evidence quality into automation diagnostics and actions", () => {
    const health = summarizeAutomationHealth([], [], {
      sourceCount: 1,
      enabledSourceCount: 1,
      activeBeliefCount: 1,
      activeHypothesisCount: 1,
      effectiveHypothesisCount: 1,
      sources: [source("source_risky")],
      observations: [
        observation({ id: "observation_active", title: "Active signal", status: "CONFIRMED", sourceId: "source_risky" }),
        observation({ id: "observation_rejected", title: "Rejected signal", status: "CONFIRMED", sourceId: "source_risky" }),
        observation({ id: "observation_rolled", title: "Rolled signal", status: "CONFIRMED", sourceId: "source_risky" })
      ],
      evidence: [
        evidence({ id: "evidence_active", observationId: "observation_active" }),
        evidence({ id: "evidence_rejected", observationId: "observation_rejected", status: "REJECTED" }),
        evidence({ id: "evidence_rolled", observationId: "observation_rolled" })
      ],
      updates: [update({ id: "update_rolled", evidenceId: "evidence_rolled", status: "ROLLED_BACK" })]
    });

    expect(health.diagnostics).toContainEqual({
      level: "warning",
      title: "来源证据质量偏低",
      detail:
        "source_risky 的证据质量偏低：2/3 条证据出现拒绝或回滚（66.7%，回滚 1，拒绝 1）；建议将来源可信度从 0.70 降到 0.53，并将自动确认阈值从 0.80 提高到 0.92。"
    });
    expect(health.nextActions).toContainEqual({
      label: "调整采集来源",
      href: "/admin/world-model/sources#source-list"
    });
  });

  it("recommends source calibration from rejected and rolled-back evidence", () => {
    const riskySource = {
      ...source("source_risky"),
      credibility: 0.8,
      autoConfirmThreshold: 0.82
    };
    const lowQualitySources = lowQualityEvidenceSources(
      [riskySource],
      [
        observation({ id: "observation_active", title: "Active signal", status: "CONFIRMED", sourceId: "source_risky" }),
        observation({ id: "observation_rejected", title: "Rejected signal", status: "CONFIRMED", sourceId: "source_risky" }),
        observation({ id: "observation_rolled", title: "Rolled signal", status: "CONFIRMED", sourceId: "source_risky" })
      ],
      [
        evidence({ id: "evidence_active", observationId: "observation_active" }),
        evidence({ id: "evidence_rejected", observationId: "observation_rejected", status: "REJECTED" }),
        evidence({ id: "evidence_rolled", observationId: "observation_rolled" })
      ],
      [update({ id: "update_rolled", evidenceId: "evidence_rolled", status: "ROLLED_BACK" })]
    );

    expect(lowQualitySources[0]).toMatchObject({
      source: expect.objectContaining({ id: "source_risky" }),
      adjustment: {
        suggestedCredibility: 0.53,
        suggestedAutoConfirmThreshold: 0.92,
        actionable: true,
        detail: "建议将来源可信度从 0.80 降到 0.53，并将自动确认阈值从 0.82 提高到 0.92。"
      }
    });
  });

  it("does not keep lowering source calibration after the suggested target is applied", () => {
    const calibratedSource = {
      ...source("source_risky"),
      credibility: 0.53,
      autoConfirmThreshold: 0.92
    };
    const lowQualitySources = lowQualityEvidenceSources(
      [calibratedSource],
      [
        observation({ id: "observation_active", title: "Active signal", status: "CONFIRMED", sourceId: "source_risky" }),
        observation({ id: "observation_rejected", title: "Rejected signal", status: "CONFIRMED", sourceId: "source_risky" }),
        observation({ id: "observation_rolled", title: "Rolled signal", status: "CONFIRMED", sourceId: "source_risky" })
      ],
      [
        evidence({ id: "evidence_active", observationId: "observation_active" }),
        evidence({ id: "evidence_rejected", observationId: "observation_rejected", status: "REJECTED" }),
        evidence({ id: "evidence_rolled", observationId: "observation_rolled" })
      ],
      [update({ id: "update_rolled", evidenceId: "evidence_rolled", status: "ROLLED_BACK" })]
    );

    expect(lowQualitySources[0]).toMatchObject({
      source: expect.objectContaining({ id: "source_risky" }),
      adjustment: {
        suggestedCredibility: 0.53,
        suggestedAutoConfirmThreshold: 0.92,
        actionable: false,
        detail: "来源已达到当前证据质量建议：可信度不高于 0.53，自动确认阈值不低于 0.92。"
      }
    });
  });

  it("only blocks source auto-apply when evidence quality risk is material and scoped", () => {
    const sources = [source("source_risky"), source("source_healthy")];
    const observations = [
      observation({ id: "observation_active", title: "Active signal", status: "CONFIRMED", sourceId: "source_risky" }),
      observation({ id: "observation_rejected", title: "Rejected signal", status: "CONFIRMED", sourceId: "source_risky" }),
      observation({ id: "observation_rolled", title: "Rolled signal", status: "CONFIRMED", sourceId: "source_risky" }),
      observation({ id: "observation_healthy", title: "Healthy signal", status: "CONFIRMED", sourceId: "source_healthy" })
    ];
    const evidenceRecords = [
      evidence({ id: "evidence_active", observationId: "observation_active" }),
      evidence({ id: "evidence_rejected", observationId: "observation_rejected", status: "REJECTED" }),
      evidence({ id: "evidence_rolled", observationId: "observation_rolled" }),
      evidence({ id: "evidence_healthy", observationId: "observation_healthy" })
    ];
    const updates = [update({ id: "update_rolled", evidenceId: "evidence_rolled", status: "ROLLED_BACK" })];

    expect(
      sourceEvidenceQualityAutoApplyRisk({
        sources,
        observations,
        evidence: evidenceRecords,
        updates,
        sourceIds: ["source_risky"]
      })
    ).toMatchObject({
      source: expect.objectContaining({ id: "source_risky" }),
      quality: expect.objectContaining({
        evidenceCount: 3,
        problemEvidenceCount: 2,
        problemRate: 2 / 3
      })
    });

    expect(
      sourceEvidenceQualityAutoApplyRisk({
        sources,
        observations,
        evidence: evidenceRecords,
        updates,
        sourceIds: ["source_healthy"]
      })
    ).toBeNull();
  });

  it("summarizes evidence loop results for action notices", () => {
    expect(
      automationLoopSuccessMessage({
        mode: "auto-apply",
        queryCount: 2,
        sourceRunCount: 3,
        skippedSourceCount: 1,
        skippedSources: [],
        itemCount: 8,
        reprocessedObservationCount: 0,
        deduplicatedCount: 1,
        candidateCount: 4,
        autoAppliedCount: 2,
        reviewCount: 1,
        lowImpactCount: 1,
        unmatchedCount: 1,
        failureCount: 0,
        queries: [],
        runs: []
      })
    ).toBe(
      "自动证据闭环已运行：自动应用模式，查询 2，来源 3，采集 8，去重 1，候选 4，自动应用 2，待审 1，低影响 1，未匹配 1，跳过来源 1，失败 0"
    );

    expect(
      automationLoopSuccessMessage({
        mode: "review-only",
        queryCount: 1,
        sourceRunCount: 1,
        skippedSourceCount: 0,
        skippedSources: [],
        itemCount: 2,
        reprocessedObservationCount: 0,
        deduplicatedCount: 0,
        candidateCount: 2,
        autoAppliedCount: 0,
        reviewCount: 2,
        lowImpactCount: 0,
        unmatchedCount: 0,
        failureCount: 0,
        queries: [],
        runs: []
      })
    ).toBe("自动证据闭环已运行：待审模式，查询 1，来源 1，采集 2，候选 2，自动应用 0，待审 2，低影响 0，未匹配 0，失败 0");

    expect(
      automationLoopSuccessMessage({
        mode: "auto-apply",
        queryCount: 3,
        sourceRunCount: 1,
        skippedSourceCount: 4,
        skippedSources: [
          {
            sourceId: "source_failed",
            sourceName: "Failed source",
            reason: "CONSECUTIVE_FAILURES",
            consecutiveFailureCount: 3,
            latestError: "fetch failed",
            retryAfterAt: new Date(2026, 5, 11, 12, 15)
          },
          {
            sourceId: "source_stale_1",
            sourceName: "Stale source 1",
            reason: "LOW_INCREMENT",
            consecutiveDuplicateOnlyCount: 3,
            retryAfterAt: new Date(2026, 5, 12, 9, 30)
          },
          {
            sourceId: "source_stale_2",
            sourceName: "Stale source 2",
            reason: "LOW_INCREMENT",
            consecutiveDuplicateOnlyCount: 4
          },
          {
            sourceId: "source_stale_3",
            sourceName: "Stale source 3",
            reason: "LOW_INCREMENT",
            consecutiveDuplicateOnlyCount: 5
          }
        ],
        itemCount: 1,
        reprocessedObservationCount: 0,
        deduplicatedCount: 0,
        candidateCount: 1,
        autoAppliedCount: 1,
        reviewCount: 0,
        lowImpactCount: 0,
        unmatchedCount: 0,
        failureCount: 0,
        queries: [],
        runs: []
      })
    ).toBe(
      "自动证据闭环已运行：自动应用模式，查询 3，来源 1，采集 1，候选 1，自动应用 1，待审 0，低影响 0，未匹配 0，跳过来源 4（连续失败 1：Failed source · 预计重试 2026-06-11 12:15，低增量 3：Stale source 1、Stale source 2 等 3 个 · 预计重试 2026-06-12 09:30），失败 0"
    );

    expect(
      automationLoopSuccessMessage({
        mode: "auto-apply",
        queryCount: 0,
        sourceRunCount: 0,
        skippedSourceCount: 0,
        skippedSources: [],
        itemCount: 0,
        reprocessedObservationCount: 2,
        deduplicatedCount: 0,
        candidateCount: 2,
        autoAppliedCount: 1,
        reviewCount: 1,
        lowImpactCount: 0,
        unmatchedCount: 0,
        failureCount: 0,
        queries: [],
        runs: []
      })
    ).toBe("自动证据闭环已运行：自动应用模式，查询 0，来源 0，采集 0，重试旧观察 2，候选 2，自动应用 1，待审 1，低影响 0，未匹配 0，失败 0");
  });

  it("adds remaining manual follow-up work to evidence loop action notices", () => {
    const notice = automationLoopActionNotice({
      mode: "review-only",
      queryCount: 1,
      sourceRunCount: 1,
      skippedSourceCount: 0,
      skippedSources: [],
      itemCount: 6,
      reprocessedObservationCount: 0,
      deduplicatedCount: 0,
      candidateCount: 5,
      autoAppliedCount: 0,
      reviewCount: 2,
      lowImpactCount: 1,
      unmatchedCount: 3,
      failureCount: 0,
      queries: [],
      runs: []
    });

    expect(notice).toContain("自动证据闭环已运行：待审模式");
    expect(notice).toContain("仍需处理：2 条待审候选需要确认");
    expect(notice).toContain("1 条低影响观察需要人工确认、调整关系或拒绝");
    expect(notice).toContain("3 条未匹配观察需要补充假设");
  });

  it("adds the latest failure reason to evidence loop action notices", () => {
    const notice = automationLoopActionNotice({
      mode: "review-only",
      queryCount: 1,
      sourceRunCount: 0,
      skippedSourceCount: 0,
      skippedSources: [],
      itemCount: 0,
      reprocessedObservationCount: 0,
      deduplicatedCount: 0,
      candidateCount: 0,
      autoAppliedCount: 0,
      reviewCount: 0,
      lowImpactCount: 0,
      unmatchedCount: 0,
      failureCount: 1,
      queries: [],
      runs: [
        run({
          id: "run-no-source",
          sourceId: undefined,
          status: "FAILED",
          startedAt: new Date("2026-06-11T09:00:00.000Z"),
          errorMessage: "没有可运行来源：当前没有配置非手动且启用的采集来源。"
        })
      ]
    });

    expect(notice).toContain("失败 1");
    expect(notice).toContain("失败原因：没有可运行来源：当前没有配置非手动且启用的采集来源。");
  });

  it("explains empty evidence loop collection results", () => {
    const notice = automationLoopActionNotice({
      mode: "review-only",
      queryCount: 2,
      sourceRunCount: 2,
      skippedSourceCount: 0,
      skippedSources: [],
      itemCount: 0,
      reprocessedObservationCount: 0,
      deduplicatedCount: 0,
      candidateCount: 0,
      autoAppliedCount: 0,
      reviewCount: 0,
      lowImpactCount: 0,
      unmatchedCount: 0,
      failureCount: 0,
      queries: [],
      runs: []
    });

    expect(notice).toContain("未采集到观察：所选来源没有返回可用结果");
    expect(notice).toContain("建议放宽限定来源");
  });

  it("summarizes dry-run query counts in action notices", () => {
    expect(
      automationLoopDryRunActionNotice({
        runs: [
          run({
            id: "dry_run_1",
            sourceId: "source_1",
            status: "DRY_RUN",
            startedAt: new Date("2026-06-18T01:00:00.000Z"),
            itemCount: 3,
            deduplicatedCount: 1,
            queryCount: 2
          }),
          run({
            id: "dry_run_2",
            sourceId: "source_2",
            status: "DRY_RUN",
            startedAt: new Date("2026-06-18T01:01:00.000Z"),
            itemCount: 4,
            deduplicatedCount: 0,
            queryCount: 1
          })
        ]
      })
    ).toBe("闭环预检已运行：来源 2，查询 3，采集 7，去重 1，失败 0");
  });

  it("returns follow-up actions for source run results that need attention", () => {
    expect(
      runFollowupActions(
        run({
          id: "attention-run",
          sourceId: "source_1",
          status: "SUCCESS",
          startedAt: new Date("2026-06-11T05:00:00.000Z"),
          reviewCount: 2,
          lowImpactCount: 1,
          unmatchedCount: 3
        })
      )
    ).toEqual([
      { label: "处理待审", href: "/admin/world-model/observations#review-candidates" },
      { label: "查看低影响", href: "/admin/world-model/observations#unknown-evidence" },
      { label: "补充假设", href: "/admin/world-model/beliefs" }
    ]);

    expect(
      runFollowupActions(
        run({
          id: "failed-run",
          sourceId: "source_1",
          status: "FAILED",
          startedAt: new Date("2026-06-11T05:05:00.000Z"),
          errorMessage: "fetch failed"
        })
      )
    ).toEqual([{ label: "检查来源", href: "/admin/world-model/sources#source-list" }]);

    expect(
      runFollowupActions(
        run({
          id: "duplicate-only-run",
          sourceId: "source_1",
          status: "SUCCESS",
          startedAt: new Date("2026-06-11T05:07:00.000Z"),
          itemCount: 2,
          deduplicatedCount: 2,
          candidateCount: 0,
          reviewCount: 0,
          lowImpactCount: 0,
          unmatchedCount: 0
        })
      )
    ).toEqual([{ label: "调整来源", href: "/admin/world-model/sources#source-list" }]);

    expect(
      runFollowupActions(
        run({
          id: "clean-run",
          sourceId: "source_1",
          status: "SUCCESS",
          startedAt: new Date("2026-06-11T05:10:00.000Z")
        })
      )
    ).toEqual([]);
  });

  it("links unmatched run follow-up to the newest source observation recommendation", () => {
    expect(
      runFollowupActions(
        run({
          id: "unmatched-run",
          sourceId: "source_1",
          status: "SUCCESS",
          startedAt: new Date("2026-06-11T05:15:00.000Z"),
          unmatchedCount: 2
        }),
        {
          observations: [
            observation({
              id: "old_unmatched",
              title: "Old unmatched observation",
              status: "UNKNOWN",
              observedAt: new Date("2026-06-11T05:00:00.000Z"),
              metadata: { ignoredReason: "UNMATCHED" }
            }),
            observation({
              id: "new_unmatched",
              title: "New unmatched observation",
              status: "UNKNOWN",
              observedAt: new Date("2026-06-11T05:10:00.000Z"),
              metadata: { ignoredReason: "UNMATCHED" }
            })
          ],
          observationCode: (item) => (item.id === "new_unmatched" ? "O-002" : "O-001")
        }
      )
    ).toContainEqual({
      label: "补充假设",
      href: "/admin/world-model/beliefs?sourceObservation=O-002#recommendations"
    });
  });

  it("summarizes concrete observation follow-up samples for automation status", () => {
    const items = automationAttentionItems(
      [
        observation({
          id: "observation_review",
          title: "High-confidence review candidate",
          status: "PENDING",
          credibility: 0.8,
          metadata: {
            recommendedLinks: [
              {
                hypothesisId: "hypothesis_1",
                direction: "SUPPORTS",
                relevance: 0.9,
                likelihoodRatio: 2.2,
                confidence: 0.8,
                rationale: "Strong directional evidence."
              }
            ]
          }
        }),
        observation({
          id: "observation_low",
          title: "Related but low impact",
          status: "UNKNOWN",
          metadata: { ignoredReason: "LOW_IMPACT" }
        }),
        observation({
          id: "observation_unmatched",
          title: "Needs a new hypothesis",
          status: "UNKNOWN",
          metadata: { ignoredReason: "UNMATCHED" }
        }),
        observation({
          id: "observation_duplicate",
          title: "Duplicate source candidate",
          status: "DUPLICATE",
          duplicateOfId: "observation_review"
        }),
        observation({
          id: "observation_pending",
          title: "Plain pending observation",
          status: "PENDING"
        })
      ],
      {
        limit: 3,
        observationCode: (item) =>
          ({
            observation_review: "O-001",
            observation_low: "O-002",
            observation_unmatched: "O-003",
            observation_duplicate: "O-004",
            observation_pending: "O-005"
          })[item.id] ?? item.id
      }
    );

    expect(items).toEqual([
      {
        key: "observation_review",
        label: "待审候选",
        code: "O-001",
        title: "High-confidence review candidate",
        detail: "1 个推荐关联 · 高优先级",
        href: "/admin/world-model/observations#review-candidates"
      },
      {
        key: "observation_duplicate",
        label: "重复候选",
        code: "O-004",
        title: "Duplicate source candidate",
        detail: "可能重复于 O-001，需要核对后拒绝或调整来源。",
        href: "/admin/world-model/observations#duplicate-candidates"
      },
      {
        key: "observation_low",
        label: "低影响观察",
        code: "O-002",
        title: "Related but low impact",
        detail: "相关但预期概率变化较小，可人工确认、调整关系或拒绝。",
        href: "/admin/world-model/observations#unknown-evidence"
      }
    ]);
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
        reprocessedObservationCount: 0,
        candidateCount: 0,
        autoAppliedCount: 0,
        reviewCount: 0,
        lowImpactCount: 0,
        unmatchedCount: 0
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
        lastNotice: "",
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
        reviewCount: 1,
        unmatchedCount: 0
      }
    });
  });

  it("surfaces reprocessed observation counts in automation health", () => {
    const health = summarizeAutomationHealth([
      run({
        id: "reprocessed-run",
        status: "SUCCESS",
        startedAt: new Date("2026-06-11T06:00:00.000Z"),
        itemCount: 0,
        reprocessedObservationCount: 2,
        candidateCount: 2,
        autoAppliedCount: 1,
        reviewCount: 1
      })
    ]);

    expect(health.latestCounts).toMatchObject({
      itemCount: 0,
      reprocessedObservationCount: 2,
      candidateCount: 2,
      autoAppliedCount: 1,
      reviewCount: 1
    });
  });

  it("diagnoses sources that automatic evidence loops will skip after repeated failures", () => {
    const health = summarizeAutomationHealth(
      [
        run({
          id: "failed-1",
          sourceId: "flaky-source",
          status: "FAILED",
          startedAt: new Date(2026, 5, 11, 1),
          errorMessage: "Source endpoint unavailable"
        }),
        run({
          id: "failed-2",
          sourceId: "flaky-source",
          status: "FAILED",
          startedAt: new Date(2026, 5, 11, 2),
          errorMessage: "Source endpoint unavailable"
        }),
        run({
          id: "failed-3",
          sourceId: "flaky-source",
          status: "FAILED",
          startedAt: new Date(2026, 5, 11, 3),
          errorMessage: "Source endpoint unavailable"
        })
      ],
      [],
      {
        referenceTime: new Date(2026, 5, 11, 4),
        sources: [{ ...source("flaky-source"), name: "Flaky source" }],
        sourceCount: 1,
        enabledSourceCount: 1,
        activeBeliefCount: 1,
        activeHypothesisCount: 1
      }
    );

    expect(health.diagnostics).toEqual(
      expect.arrayContaining([
        {
          level: "warning",
          title: "来源已自动降噪",
          detail: "Flaky source 已连续失败至少 3 次，自动闭环会暂时跳过；预计重试 2026-06-11 09:00，手动运行来源可验证恢复。"
        }
      ])
    );
    expect(health.nextActions).toContainEqual({
      label: "检查来源配置",
      href: "/admin/world-model/sources#source-list"
    });
  });

  it("does not diagnose repeated source failures after the retry cooldown has elapsed", () => {
    const health = summarizeAutomationHealth(
      [
        run({
          id: "failed-1",
          sourceId: "flaky-source",
          status: "FAILED",
          startedAt: new Date(2026, 5, 11, 1),
          errorMessage: "Source endpoint unavailable"
        }),
        run({
          id: "failed-2",
          sourceId: "flaky-source",
          status: "FAILED",
          startedAt: new Date(2026, 5, 11, 2),
          errorMessage: "Source endpoint unavailable"
        }),
        run({
          id: "failed-3",
          sourceId: "flaky-source",
          status: "FAILED",
          startedAt: new Date(2026, 5, 11, 3),
          errorMessage: "Source endpoint unavailable"
        })
      ],
      [],
      {
        referenceTime: new Date(2026, 5, 11, 10),
        sources: [{ ...source("flaky-source"), name: "Flaky source" }],
        sourceCount: 1,
        enabledSourceCount: 1,
        activeBeliefCount: 1,
        activeHypothesisCount: 1
      }
    );

    expect(health.diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "来源已自动降噪"
        })
      ])
    );
  });

  it("diagnoses sources that repeatedly return only duplicate observations", () => {
    const health = summarizeAutomationHealth(
      [
        run({
          id: "duplicate-1",
          sourceId: "stale-source",
          status: "SUCCESS",
          startedAt: new Date(2026, 5, 11, 1),
          queryCount: 2,
          itemCount: 2,
          deduplicatedCount: 2
        }),
        run({
          id: "duplicate-2",
          sourceId: "stale-source",
          status: "SUCCESS",
          startedAt: new Date(2026, 5, 11, 2),
          queryCount: 2,
          itemCount: 3,
          deduplicatedCount: 3
        }),
        run({
          id: "duplicate-3",
          sourceId: "stale-source",
          status: "SUCCESS",
          startedAt: new Date(2026, 5, 11, 3),
          queryCount: 2,
          itemCount: 1,
          deduplicatedCount: 1
        })
      ],
      [],
      {
        referenceTime: new Date(2026, 5, 11, 4),
        sources: [{ ...source("stale-source"), name: "Stale source" }],
        sourceCount: 1,
        enabledSourceCount: 1,
        activeBeliefCount: 1,
        activeHypothesisCount: 1,
        effectiveHypothesisCount: 1
      }
    );

    expect(health.diagnostics).toEqual(
      expect.arrayContaining([
        {
          level: "warning",
          title: "来源缺少增量",
          detail: "Stale source 已连续 3 次只产生重复观察；预计重试 2026-06-12 03:00，调整查询、来源 URL 或停用低增量来源。"
        }
      ])
    );
    expect(health.nextActions).toContainEqual({
      label: "调整采集来源",
      href: "/admin/world-model/sources#source-list"
    });
  });

  it("does not diagnose duplicate-only sources after the staleness cooldown has elapsed", () => {
    const health = summarizeAutomationHealth(
      [
        run({
          id: "duplicate-1",
          sourceId: "stale-source",
          status: "SUCCESS",
          startedAt: new Date(2026, 5, 11, 1),
          queryCount: 2,
          itemCount: 2,
          deduplicatedCount: 2
        }),
        run({
          id: "duplicate-2",
          sourceId: "stale-source",
          status: "SUCCESS",
          startedAt: new Date(2026, 5, 11, 2),
          queryCount: 2,
          itemCount: 3,
          deduplicatedCount: 3
        }),
        run({
          id: "duplicate-3",
          sourceId: "stale-source",
          status: "SUCCESS",
          startedAt: new Date(2026, 5, 11, 3),
          queryCount: 2,
          itemCount: 1,
          deduplicatedCount: 1
        })
      ],
      [],
      {
        referenceTime: new Date(2026, 5, 12, 4),
        sources: [{ ...source("stale-source"), name: "Stale source" }],
        sourceCount: 1,
        enabledSourceCount: 1,
        activeBeliefCount: 1,
        activeHypothesisCount: 1,
        effectiveHypothesisCount: 1
      }
    );

    expect(health.diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "来源缺少增量"
        })
      ])
    );
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
      lastNotice: "",
      lastError: ""
    });
  });

  it("treats healthy worker heartbeat attention as a notice instead of an error", () => {
    const health = summarizeAutomationHealth(
      [],
      [
        heartbeat({
          id: "default",
          status: "RUNNING",
          heartbeatAt: new Date("2026-06-11T04:00:00.000Z"),
          nextRunAt: new Date("2026-06-11T04:15:00.000Z"),
          intervalMs: 900_000,
          lastNotice: "2 条候选观察等待确认。"
        })
      ],
      new Date("2026-06-11T04:10:00.000Z")
    );

    expect(health.worker).toMatchObject({
      status: "RUNNING",
      tone: "healthy",
      lastNotice: "2 条候选观察等待确认。",
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

  it("warns when automation prerequisites are ready but the worker is not running", () => {
    const unregistered = summarizeAutomationHealth([], [], {
      sourceCount: 2,
      enabledSourceCount: 2,
      activeBeliefCount: 1,
      activeHypothesisCount: 2,
      effectiveHypothesisCount: 2
    });

    expect(unregistered.diagnostics).toContainEqual({
      level: "warning",
      title: "守护进程未开启",
      detail: "基础条件已满足，但本地守护进程没有运行；启动后才能按周期自动搜集观察和证据。"
    });
    expect(unregistered.nextActions).toContainEqual({
      label: "启动守护进程",
      href: "/admin/world-model/sources#automation-worker"
    });

    const stopped = summarizeAutomationHealth(
      [],
      [
        heartbeat({
          id: "default",
          status: "IDLE",
          heartbeatAt: new Date("2026-06-11T04:00:00.000Z")
        })
      ],
      {
        sourceCount: 2,
        enabledSourceCount: 2,
        activeBeliefCount: 1,
        activeHypothesisCount: 2,
        effectiveHypothesisCount: 2
      }
    );

    expect(stopped.diagnostics).toContainEqual({
      level: "warning",
      title: "守护进程未开启",
      detail: "基础条件已满足，但本地守护进程没有运行；启动后才能按周期自动搜集观察和证据。"
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

    const noEffectiveHypothesisHealth = summarizeAutomationHealth([], [], {
      sourceCount: 1,
      enabledSourceCount: 1,
      activeBeliefCount: 1,
      activeHypothesisCount: 2,
      effectiveHypothesisCount: 0
    });
    expect(noEffectiveHypothesisHealth.diagnostics).toContainEqual({
      level: "warning",
      title: "没有当前有效假设",
      detail: "活跃假设尚未开始或已经过期，续期、归档或补充当前可检验假设后，闭环才能生成有效检索任务。"
    });
    expect(noEffectiveHypothesisHealth.nextActions).toContainEqual({
      label: "调整信念假设",
      href: "/admin/world-model/beliefs"
    });

    const oneSidedHypothesisHealth = summarizeAutomationHealth([], [], {
      sourceCount: 1,
      enabledSourceCount: 1,
      activeBeliefCount: 1,
      activeHypothesisCount: 1,
      effectiveHypothesisCount: 1,
      beliefs: [belief()]
    });
    expect(oneSidedHypothesisHealth.diagnostics).toContainEqual({
      level: "warning",
      title: "假设覆盖单向",
      detail: "1 个活跃信念只有支持或反证单边假设，自动闭环可能放大确认偏误；先补充缺失方向假设。"
    });
    expect(oneSidedHypothesisHealth.nextActions).toContainEqual({
      label: "补齐假设覆盖",
      href: "/admin/world-model/beliefs#recommendations"
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
      href: "/admin/world-model/observations#review-candidates"
    });
    expect(reviewOnlyHealth.nextActions).toContainEqual({
      label: "启用自动应用",
      href: "/admin/world-model/sources#evidence-loop"
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

    const duplicateOnlyHealth = summarizeAutomationHealth([
      run({
        id: "duplicate-only-run",
        sourceId: "source_1",
        status: "SUCCESS",
        startedAt: new Date("2026-06-11T04:05:00.000Z"),
        queryCount: 2,
        itemCount: 3,
        deduplicatedCount: 3,
        candidateCount: 0,
        reviewCount: 0,
        lowImpactCount: 0,
        unmatchedCount: 0
      })
    ]);
    expect(duplicateOnlyHealth.diagnostics).toContainEqual({
      level: "info",
      title: "观察已全部去重",
      detail: "3 条采集观察已被判定为重复，说明来源暂时没有提供新信息。"
    });
    expect(duplicateOnlyHealth.diagnostics.map((diagnostic) => diagnostic.title)).not.toContain("未识别候选证据");
    expect(duplicateOnlyHealth.nextActions).toContainEqual({
      label: "调整采集来源",
      href: "/admin/world-model/sources#source-list"
    });

    const unmatchedHealth = summarizeAutomationHealth([
      run({
        id: "unmatched-run",
        sourceId: "source_1",
        status: "SUCCESS",
        startedAt: new Date("2026-06-11T04:15:00.000Z"),
        queryCount: 1,
        itemCount: 3,
        candidateCount: 0,
        reviewCount: 0,
        lowImpactCount: 0,
        unmatchedCount: 3
      })
    ]);
    expect(unmatchedHealth.latestCounts.unmatchedCount).toBe(3);
    expect(unmatchedHealth.diagnostics).toContainEqual({
      level: "info",
      title: "未识别候选证据",
      detail: "3 条观察没有匹配到当前假设，收窄假设表述、调整来源或降低候选识别阈值。"
    });
    expect(unmatchedHealth.nextActions).toContainEqual({
      label: "基于观察补充假设",
      href: "/admin/world-model/beliefs"
    });
    const focusedUnmatchedHealth = summarizeAutomationHealth(
      [
        run({
          id: "focused-unmatched-run",
          sourceId: "source_1",
          status: "SUCCESS",
          startedAt: new Date("2026-06-11T04:16:00.000Z"),
          queryCount: 1,
          itemCount: 1,
          candidateCount: 0,
          reviewCount: 0,
          lowImpactCount: 0,
          unmatchedCount: 1
        })
      ],
      [],
      {
        latestUnmatchedObservationCode: "O-007"
      }
    );
    expect(focusedUnmatchedHealth.nextActions).toContainEqual({
      label: "基于观察补充假设",
      href: "/admin/world-model/beliefs?sourceObservation=O-007#recommendations"
    });

    const mixedUnmatchedHealth = summarizeAutomationHealth([
      run({
        id: "mixed-unmatched-run",
        sourceId: "source_1",
        status: "SUCCESS",
        startedAt: new Date("2026-06-11T04:20:00.000Z"),
        queryCount: 1,
        itemCount: 4,
        candidateCount: 1,
        reviewCount: 1,
        lowImpactCount: 0,
        unmatchedCount: 2
      })
    ]);
    expect(mixedUnmatchedHealth.diagnostics).toContainEqual({
      level: "info",
      title: "未识别候选证据",
      detail: "2 条观察没有匹配到当前假设，收窄假设表述、调整来源或降低候选识别阈值。"
    });
    expect(mixedUnmatchedHealth.nextActions).toContainEqual({
      label: "基于观察补充假设",
      href: "/admin/world-model/beliefs"
    });

    const lowImpactHealth = summarizeAutomationHealth(
      [
        run({
          id: "low-impact-run",
          sourceId: "source_1",
          status: "SUCCESS",
          startedAt: new Date("2026-06-11T04:30:00.000Z"),
          queryCount: 1,
          itemCount: 2,
          candidateCount: 0,
          reviewCount: 0,
          lowImpactCount: 2
        })
      ]
    );
    expect(lowImpactHealth.latestCounts.lowImpactCount).toBe(2);
    expect(lowImpactHealth.diagnostics).toContainEqual({
      level: "info",
      title: "低影响观察已过滤",
      detail: "2 条观察相关但预期概率变化过小，已保留在未知证据队列。"
    });
    expect(lowImpactHealth.diagnostics.map((diagnostic) => diagnostic.title)).not.toContain("未识别候选证据");
    expect(lowImpactHealth.nextActions).toContainEqual({
      label: "查看低影响观察",
      href: "/admin/world-model/observations#unknown-evidence"
    });

    const mixedLowImpactHealth = summarizeAutomationHealth([
      run({
        id: "mixed-low-impact-run",
        sourceId: "source_1",
        status: "SUCCESS",
        startedAt: new Date("2026-06-11T04:35:00.000Z"),
        queryCount: 1,
        itemCount: 4,
        candidateCount: 2,
        autoAppliedCount: 1,
        reviewCount: 1,
        lowImpactCount: 1,
        unmatchedCount: 0
      })
    ]);
    expect(mixedLowImpactHealth.diagnostics).toContainEqual({
      level: "info",
      title: "低影响观察已过滤",
      detail: "1 条观察相关但预期概率变化过小，已保留在未知证据队列。"
    });
    expect(mixedLowImpactHealth.nextActions).toContainEqual({
      label: "查看低影响观察",
      href: "/admin/world-model/observations#unknown-evidence"
    });

    const openObservationHealth = summarizeAutomationHealth([], [], {
      sourceCount: 1,
      enabledSourceCount: 1,
      activeBeliefCount: 1,
      activeHypothesisCount: 1,
      effectiveHypothesisCount: 1,
      openObservationCount: 3,
      duplicateObservationCount: 2
    });
    expect(openObservationHealth.diagnostics).toContainEqual({
      level: "info",
      title: "重复候选等待处理",
      detail: "2 条采集观察被判定为重复候选，核对后拒绝或保留为来源调整线索。"
    });
    expect(openObservationHealth.nextActions).toContainEqual({
      label: "处理重复候选",
      href: "/admin/world-model/observations#duplicate-candidates"
    });
    expect(openObservationHealth.diagnostics).toContainEqual({
      level: "info",
      title: "观察等待处理",
      detail: "3 条观察尚未确认为证据，处理后才能继续更新对应假设和信念。"
    });
    expect(openObservationHealth.nextActions).toContainEqual({
      label: "处理观察积压",
      href: "/admin/world-model/observations#pending-observations"
    });

    const missingLlmHealth = summarizeAutomationHealth([], [], {
      sourceCount: 1,
      enabledSourceCount: 1,
      activeBeliefCount: 1,
      activeHypothesisCount: 1,
      effectiveHypothesisCount: 1,
      llmScorerReady: false
    });
    expect(missingLlmHealth.diagnostics).toContainEqual({
      level: "warning",
      title: "LLM 主评分器未配置",
      detail: "LLM API 是 v1 主评分器；缺少配置时，候选识别和似然评分会退化为 fallback 或待审。"
    });
    expect(missingLlmHealth.nextActions).toContainEqual({
      label: "检查模型配置",
      href: "/admin/world-model/models"
    });
  });

  it("warns when a configured LLM scorer has not been evaluated", () => {
    const health = summarizeAutomationHealth([], [], {
      sourceCount: 1,
      enabledSourceCount: 1,
      activeBeliefCount: 1,
      activeHypothesisCount: 1,
      effectiveHypothesisCount: 1,
      llmScorerReady: true,
      llmEvaluation: null
    });

    expect(health.diagnostics).toContainEqual({
      level: "warning",
      title: "LLM 主评分器未评估",
      detail: "LLM API 已配置为 v1 主评分器，但没有最近评估结果；运行真实样本评估后再依赖自动应用。"
    });
    expect(health.nextActions).toContainEqual({
      label: "查看模型评估",
      href: "/admin/world-model/models"
    });
  });

  it("warns when the latest LLM evaluation has too few real samples", () => {
    const health = summarizeAutomationHealth([], [], {
      sourceCount: 1,
      enabledSourceCount: 1,
      activeBeliefCount: 1,
      activeHypothesisCount: 1,
      effectiveHypothesisCount: 1,
      llmScorerReady: true,
      llmEvaluation: {
        generatedAt: new Date(),
        samplesPath: "model-artifacts/training-samples.jsonl",
        summary: {
          modelName: "deepseek:deepseek-v4-flash",
          sampleCount: 8,
          scoredCount: 8,
          sourceCounts: { fever: 8 },
          directionAccuracy: {
            SUPPORTS: { total: 4, scored: 4, correct: 4, accuracy: 1 },
            OPPOSES: { total: 2, scored: 2, correct: 1, accuracy: 0.5 },
            NEUTRAL: { total: 2, scored: 2, correct: 1, accuracy: 0.5 }
          },
          likelihoodRatio: { min: 0.4, max: 10, mean: 2.4 },
          lowConfidenceCount: 0,
          lowConfidenceRate: 0,
          reviewRequiredCount: 0,
          reviewRequiredRate: 0,
          fallbackComparedCount: 8,
          fallbackDivergenceCount: 1,
          fallbackDivergenceRate: 0.125
        }
      }
    });

    expect(health.diagnostics).toContainEqual({
      level: "warning",
      title: "LLM 评估样本不足",
      detail: "最近一次 LLM 评估只有 8 条真实样本，自动应用前应扩大评估样本。"
    });
    expect(health.nextActions).toContainEqual({
      label: "查看模型评估",
      href: "/admin/world-model/models"
    });
  });

  it("warns when the latest LLM evaluation does not cover local confirmed evidence", () => {
    const llmEvaluation = {
      generatedAt: new Date(),
      samplesPath: "model-artifacts/training-samples.jsonl",
      summary: {
        modelName: "deepseek:deepseek-v4-flash",
        sampleCount: 30,
        scoredCount: 30,
        sourceCounts: { fever: 20, climate_fever: 10 },
        directionAccuracy: {
          SUPPORTS: { total: 10, scored: 10, correct: 9, accuracy: 0.9 },
          OPPOSES: { total: 10, scored: 10, correct: 9, accuracy: 0.9 },
          NEUTRAL: { total: 10, scored: 10, correct: 8, accuracy: 0.8 }
        },
        likelihoodRatio: { min: 0.4, max: 10, mean: 2.4 },
        lowConfidenceCount: 0,
        lowConfidenceRate: 0,
        reviewRequiredCount: 0,
        reviewRequiredRate: 0,
        fallbackComparedCount: 30,
        fallbackDivergenceCount: 2,
        fallbackDivergenceRate: 0.067
      }
    };
    const health = summarizeAutomationHealth([], [], {
      sourceCount: 1,
      enabledSourceCount: 1,
      activeBeliefCount: 1,
      activeHypothesisCount: 1,
      effectiveHypothesisCount: 1,
      llmScorerReady: true,
      llmEvaluation
    });

    expect(health.diagnostics).toContainEqual({
      level: "warning",
      title: "LLM 评估未覆盖本地证据",
      detail: "最近一次 LLM 评估没有本地确认证据或已结算假设样本，自动应用前应纳入当前信念/假设/证据链路。"
    });
    expect(health.nextActions).toContainEqual({
      label: "查看模型评估",
      href: "/admin/world-model/models"
    });
    expect(llmEvaluationAutoApplyRisk(llmEvaluation)).toBeNull();
  });

  it("warns when the latest LLM evaluation does not cover real platform samples", () => {
    const llmEvaluation = {
      generatedAt: new Date(),
      samplesPath: "model-artifacts/training-samples.jsonl",
      summary: {
        modelName: "deepseek:deepseek-v4-flash",
        sampleCount: 30,
        scoredCount: 30,
        sourceCounts: { fever: 28, local_confirmed: 2 },
        directionAccuracy: {
          SUPPORTS: { total: 10, scored: 10, correct: 9, accuracy: 0.9 },
          OPPOSES: { total: 10, scored: 10, correct: 9, accuracy: 0.9 },
          NEUTRAL: { total: 10, scored: 10, correct: 8, accuracy: 0.8 }
        },
        likelihoodRatio: { min: 0.4, max: 10, mean: 2.4 },
        lowConfidenceCount: 0,
        lowConfidenceRate: 0,
        reviewRequiredCount: 0,
        reviewRequiredRate: 0,
        fallbackComparedCount: 30,
        fallbackDivergenceCount: 2,
        fallbackDivergenceRate: 0.067
      }
    };
    const health = summarizeAutomationHealth([], [], {
      sourceCount: 1,
      enabledSourceCount: 1,
      activeBeliefCount: 1,
      activeHypothesisCount: 1,
      effectiveHypothesisCount: 1,
      llmScorerReady: true,
      llmEvaluation
    });

    expect(health.diagnostics).toContainEqual({
      level: "warning",
      title: "LLM 评估未覆盖真实平台样本",
      detail: "最近一次 LLM 评估没有 GitHub、Hugging Face Hub 或 Manifold 样本，自动应用前应纳入真实平台样本。"
    });
    expect(health.nextActions).toContainEqual({
      label: "查看模型评估",
      href: "/admin/world-model/models"
    });
    expect(llmEvaluationAutoApplyRisk(llmEvaluation)).toBeNull();
  });

  it("accepts GitHub samples as real platform evaluation coverage", () => {
    const llmEvaluation = {
      generatedAt: new Date(),
      samplesPath: "model-artifacts/training-samples.jsonl",
      summary: {
        modelName: "deepseek:deepseek-v4-flash",
        sampleCount: 30,
        scoredCount: 30,
        sourceCounts: { fever: 27, github: 1, local_confirmed: 2 },
        directionAccuracy: {
          SUPPORTS: { total: 10, scored: 10, correct: 9, accuracy: 0.9 },
          OPPOSES: { total: 10, scored: 10, correct: 9, accuracy: 0.9 },
          NEUTRAL: { total: 10, scored: 10, correct: 8, accuracy: 0.8 }
        },
        likelihoodRatio: { min: 0.4, max: 10, mean: 2.4 },
        lowConfidenceCount: 0,
        lowConfidenceRate: 0,
        reviewRequiredCount: 0,
        reviewRequiredRate: 0,
        fallbackComparedCount: 30,
        fallbackDivergenceCount: 2,
        fallbackDivergenceRate: 0.067
      }
    };
    const health = summarizeAutomationHealth([], [], {
      sourceCount: 1,
      enabledSourceCount: 1,
      activeBeliefCount: 1,
      activeHypothesisCount: 1,
      effectiveHypothesisCount: 1,
      llmScorerReady: true,
      llmEvaluation
    });

    expect(health.diagnostics.map((diagnostic) => diagnostic.title)).not.toContain("LLM 评估未覆盖真实平台样本");
    expect(llmEvaluationAutoApplyRisk(llmEvaluation, new Date("2026-06-20T01:00:00.000Z"))).toBeNull();
  });

  it("accepts Manifold prediction market samples as real platform evaluation coverage", () => {
    const llmEvaluation = {
      generatedAt: new Date(),
      samplesPath: "model-artifacts/training-samples.jsonl",
      summary: {
        modelName: "deepseek:deepseek-v4-flash",
        sampleCount: 30,
        scoredCount: 30,
        sourceCounts: { fever: 27, manifold: 1, local_confirmed: 2 },
        directionAccuracy: {
          SUPPORTS: { total: 10, scored: 10, correct: 9, accuracy: 0.9 },
          OPPOSES: { total: 10, scored: 10, correct: 9, accuracy: 0.9 },
          NEUTRAL: { total: 10, scored: 10, correct: 8, accuracy: 0.8 }
        },
        likelihoodRatio: { min: 0.4, max: 10, mean: 2.4 },
        lowConfidenceCount: 0,
        lowConfidenceRate: 0,
        reviewRequiredCount: 0,
        reviewRequiredRate: 0,
        fallbackComparedCount: 30,
        fallbackDivergenceCount: 2,
        fallbackDivergenceRate: 0.067
      }
    };
    const health = summarizeAutomationHealth([], [], {
      sourceCount: 1,
      enabledSourceCount: 1,
      activeBeliefCount: 1,
      activeHypothesisCount: 1,
      effectiveHypothesisCount: 1,
      llmScorerReady: true,
      llmEvaluation
    });

    expect(health.diagnostics.map((diagnostic) => diagnostic.title)).not.toContain("LLM 评估未覆盖真实平台样本");
    expect(llmEvaluationAutoApplyRisk(llmEvaluation, new Date("2026-06-20T01:00:00.000Z"))).toBeNull();
  });

  it("accepts local resolved hypothesis samples as local evaluation coverage", () => {
    const llmEvaluation = {
      generatedAt: new Date(),
      samplesPath: "model-artifacts/training-samples.jsonl",
      summary: {
        modelName: "deepseek:deepseek-v4-flash",
        sampleCount: 30,
        scoredCount: 30,
        sourceCounts: { fever: 29, local_resolved: 1 },
        directionAccuracy: {
          SUPPORTS: { total: 10, scored: 10, correct: 9, accuracy: 0.9 },
          OPPOSES: { total: 10, scored: 10, correct: 9, accuracy: 0.9 },
          NEUTRAL: { total: 10, scored: 10, correct: 8, accuracy: 0.8 }
        },
        likelihoodRatio: { min: 0.4, max: 10, mean: 2.4 },
        lowConfidenceCount: 0,
        lowConfidenceRate: 0,
        reviewRequiredCount: 0,
        reviewRequiredRate: 0,
        fallbackComparedCount: 30,
        fallbackDivergenceCount: 2,
        fallbackDivergenceRate: 0.067
      }
    };
    const health = summarizeAutomationHealth([], [], {
      sourceCount: 1,
      enabledSourceCount: 1,
      activeBeliefCount: 1,
      activeHypothesisCount: 1,
      effectiveHypothesisCount: 1,
      llmScorerReady: true,
      llmEvaluation
    });

    expect(health.diagnostics.map((diagnostic) => diagnostic.title)).not.toContain("LLM 评估未覆盖本地证据");
    expect(llmEvaluationAutoApplyRisk(llmEvaluation, new Date("2026-06-20T01:00:00.000Z"))).toBeNull();
  });

  it("blocks auto-apply when the latest LLM evaluation is stale", () => {
    const llmEvaluation = {
      generatedAt: new Date("2026-05-30T01:00:00.000Z"),
      samplesPath: "model-artifacts/training-samples.jsonl",
      summary: {
        modelName: "deepseek:deepseek-v4-flash",
        sampleCount: 30,
        scoredCount: 30,
        sourceCounts: { fever: 29, local_resolved: 1 },
        directionAccuracy: {
          SUPPORTS: { total: 10, scored: 10, correct: 9, accuracy: 0.9 },
          OPPOSES: { total: 10, scored: 10, correct: 9, accuracy: 0.9 },
          NEUTRAL: { total: 10, scored: 10, correct: 8, accuracy: 0.8 }
        },
        likelihoodRatio: { min: 0.4, max: 10, mean: 2.4 },
        lowConfidenceCount: 0,
        lowConfidenceRate: 0,
        reviewRequiredCount: 0,
        reviewRequiredRate: 0,
        fallbackComparedCount: 30,
        fallbackDivergenceCount: 2,
        fallbackDivergenceRate: 0.067
      }
    };
    const referenceTime = new Date("2026-06-20T01:00:00.000Z");
    const health = summarizeAutomationHealth([], [], {
      referenceTime,
      sourceCount: 1,
      enabledSourceCount: 1,
      activeBeliefCount: 1,
      activeHypothesisCount: 1,
      effectiveHypothesisCount: 1,
      llmScorerReady: true,
      llmEvaluation
    });

    expect(health.diagnostics).toContainEqual({
      level: "warning",
      title: "LLM 评估结果陈旧",
      detail: "最近一次 LLM 评估已超过 14 天，自动应用前应重新运行真实样本评估。"
    });
    expect(health.nextActions).toContainEqual({
      label: "查看模型评估",
      href: "/admin/world-model/models"
    });
    expect(llmEvaluationAutoApplyRisk(llmEvaluation, referenceTime)?.title).toBe("LLM 评估结果陈旧");
  });

  it("blocks auto-apply when the latest LLM evaluation has no generated time", () => {
    const llmEvaluation = {
      samplesPath: "model-artifacts/training-samples.jsonl",
      summary: {
        modelName: "deepseek:deepseek-v4-flash",
        sampleCount: 30,
        scoredCount: 30,
        sourceCounts: { fever: 29, local_resolved: 1 },
        directionAccuracy: {
          SUPPORTS: { total: 10, scored: 10, correct: 9, accuracy: 0.9 },
          OPPOSES: { total: 10, scored: 10, correct: 9, accuracy: 0.9 },
          NEUTRAL: { total: 10, scored: 10, correct: 8, accuracy: 0.8 }
        },
        likelihoodRatio: { min: 0.4, max: 10, mean: 2.4 },
        lowConfidenceCount: 0,
        lowConfidenceRate: 0,
        reviewRequiredCount: 0,
        reviewRequiredRate: 0,
        fallbackComparedCount: 30,
        fallbackDivergenceCount: 2,
        fallbackDivergenceRate: 0.067
      }
    };
    const health = summarizeAutomationHealth([], [], {
      sourceCount: 1,
      enabledSourceCount: 1,
      activeBeliefCount: 1,
      activeHypothesisCount: 1,
      effectiveHypothesisCount: 1,
      llmScorerReady: true,
      llmEvaluation
    });

    expect(health.diagnostics).toContainEqual({
      level: "warning",
      title: "LLM 评估时间缺失",
      detail: "最近一次 LLM 评估缺少生成时间，自动应用前应重新运行真实样本评估。"
    });
    expect(health.nextActions).toContainEqual({
      label: "查看模型评估",
      href: "/admin/world-model/models"
    });
    expect(llmEvaluationAutoApplyRisk(llmEvaluation)?.title).toBe("LLM 评估时间缺失");
  });

  it("warns when the latest LLM evaluation needs too much human review", () => {
    const health = summarizeAutomationHealth([], [], {
      sourceCount: 1,
      enabledSourceCount: 1,
      activeBeliefCount: 1,
      activeHypothesisCount: 1,
      effectiveHypothesisCount: 1,
      llmScorerReady: true,
      llmEvaluation: {
        generatedAt: new Date(),
        samplesPath: "model-artifacts/training-samples.jsonl",
        summary: {
          modelName: "deepseek:deepseek-v4-flash",
          sampleCount: 50,
          scoredCount: 50,
          sourceCounts: { fever: 50 },
          directionAccuracy: {
            SUPPORTS: { total: 20, scored: 20, correct: 16, accuracy: 0.8 },
            OPPOSES: { total: 15, scored: 15, correct: 12, accuracy: 0.8 },
            NEUTRAL: { total: 15, scored: 15, correct: 12, accuracy: 0.8 }
          },
          likelihoodRatio: { min: 0.4, max: 10, mean: 2.4 },
          lowConfidenceCount: 4,
          lowConfidenceRate: 0.08,
          reviewRequiredCount: 23,
          reviewRequiredRate: 0.46,
          fallbackComparedCount: 50,
          fallbackDivergenceCount: 4,
          fallbackDivergenceRate: 0.08
        }
      }
    });

    expect(health.diagnostics).toContainEqual({
      level: "warning",
      title: "LLM 评估复核率偏高",
      detail: "最近一次 LLM 评估中 46.0% 样本需要人工复核，自动应用前应调低阈值或保持待审模式。"
    });
    expect(health.nextActions).toContainEqual({
      label: "查看模型评估",
      href: "/admin/world-model/models"
    });
  });

  it("warns when the latest LLM evaluation diverges from the fallback scorer", () => {
    const health = summarizeAutomationHealth([], [], {
      sourceCount: 1,
      enabledSourceCount: 1,
      activeBeliefCount: 1,
      activeHypothesisCount: 1,
      effectiveHypothesisCount: 1,
      llmScorerReady: true,
      llmEvaluation: {
        generatedAt: new Date(),
        samplesPath: "model-artifacts/training-samples.jsonl",
        summary: {
          modelName: "deepseek:deepseek-v4-flash",
          sampleCount: 50,
          scoredCount: 50,
          sourceCounts: { fever: 50 },
          directionAccuracy: {
            SUPPORTS: { total: 20, scored: 20, correct: 17, accuracy: 0.85 },
            OPPOSES: { total: 15, scored: 15, correct: 12, accuracy: 0.8 },
            NEUTRAL: { total: 15, scored: 15, correct: 13, accuracy: 0.87 }
          },
          likelihoodRatio: { min: 0.4, max: 10, mean: 2.4 },
          lowConfidenceCount: 2,
          lowConfidenceRate: 0.04,
          reviewRequiredCount: 4,
          reviewRequiredRate: 0.08,
          fallbackComparedCount: 50,
          fallbackDivergenceCount: 18,
          fallbackDivergenceRate: 0.36
        }
      }
    });

    expect(health.diagnostics).toContainEqual({
      level: "warning",
      title: "LLM 与 fallback 分歧偏高",
      detail: "最近一次 LLM 评估中 36.0% 样本与 fallback 方向分歧，自动应用前应抽样复核评分理由。"
    });
    expect(health.nextActions).toContainEqual({
      label: "查看模型评估",
      href: "/admin/world-model/models"
    });
  });

  it("blocks auto-apply when the latest LLM evaluation has low per-direction accuracy", () => {
    const llmEvaluation = {
      generatedAt: new Date(),
      samplesPath: "model-artifacts/training-samples.jsonl",
      summary: {
        modelName: "deepseek:deepseek-v4-flash",
        sampleCount: 30,
        scoredCount: 30,
        sourceCounts: { fever: 29, local_confirmed: 1 },
        directionAccuracy: {
          SUPPORTS: { total: 10, scored: 10, correct: 9, accuracy: 0.9 },
          OPPOSES: { total: 10, scored: 10, correct: 7, accuracy: 0.7 },
          NEUTRAL: { total: 10, scored: 10, correct: 6, accuracy: 0.6 }
        },
        likelihoodRatio: { min: 0.05, max: 20, mean: 7.08 },
        lowConfidenceCount: 0,
        lowConfidenceRate: 0,
        reviewRequiredCount: 8,
        reviewRequiredRate: 0.267,
        fallbackComparedCount: 30,
        fallbackDivergenceCount: 14,
        fallbackDivergenceRate: 0.467
      }
    };
    const health = summarizeAutomationHealth([], [], {
      sourceCount: 1,
      enabledSourceCount: 1,
      activeBeliefCount: 1,
      activeHypothesisCount: 1,
      effectiveHypothesisCount: 1,
      llmScorerReady: true,
      llmEvaluation
    });

    expect(health.diagnostics).toContainEqual({
      level: "warning",
      title: "LLM 评估方向准确率偏低",
      detail: "最近一次 LLM 评估方向准确率偏低：中性 60.0%；建议抽样复核提示词、样本标签和自动应用阈值。"
    });
    expect(health.nextActions).toContainEqual({
      label: "查看模型评估",
      href: "/admin/world-model/models"
    });
    expect(llmEvaluationAutoApplyRisk(llmEvaluation)?.title).toBe("LLM 评估方向准确率偏低");
  });

  it("blocks auto-apply when the latest LLM evaluation misses a scored direction", () => {
    const llmEvaluation = {
      generatedAt: new Date(),
      samplesPath: "model-artifacts/training-samples.jsonl",
      summary: {
        modelName: "deepseek:deepseek-v4-flash",
        sampleCount: 30,
        scoredCount: 30,
        sourceCounts: { fever: 29, local_confirmed: 1 },
        directionAccuracy: {
          SUPPORTS: { total: 15, scored: 15, correct: 14, accuracy: 0.933 },
          OPPOSES: { total: 15, scored: 15, correct: 13, accuracy: 0.867 },
          NEUTRAL: { total: 0, scored: 0, correct: 0, accuracy: null }
        },
        likelihoodRatio: { min: 0.4, max: 8, mean: 2.2 },
        lowConfidenceCount: 0,
        lowConfidenceRate: 0,
        reviewRequiredCount: 2,
        reviewRequiredRate: 0.067,
        fallbackComparedCount: 30,
        fallbackDivergenceCount: 2,
        fallbackDivergenceRate: 0.067
      }
    };
    const health = summarizeAutomationHealth([], [], {
      sourceCount: 1,
      enabledSourceCount: 1,
      activeBeliefCount: 1,
      activeHypothesisCount: 1,
      effectiveHypothesisCount: 1,
      llmScorerReady: true,
      llmEvaluation
    });

    expect(health.diagnostics).toContainEqual({
      level: "warning",
      title: "LLM 评估方向覆盖不足",
      detail: "最近一次 LLM 评估缺少已评分方向：中性；自动应用前应补齐支持、反对和中性样本。"
    });
    expect(llmEvaluationAutoApplyRisk(llmEvaluation)?.title).toBe("LLM 评估方向覆盖不足");
  });

  it("blocks auto-apply when the LLM disagrees too often with the lightweight fallback", () => {
    const risk = llmEvaluationAutoApplyRisk(
      {
        generatedAt: new Date(),
        samplesPath: "model-artifacts/training-samples.jsonl",
        summary: {
          modelName: "deepseek:deepseek-v4-flash",
          sampleCount: 30,
          scoredCount: 30,
          sourceCounts: { fever: 29, local_confirmed: 1 },
          directionAccuracy: {
            SUPPORTS: { total: 10, scored: 10, correct: 10, accuracy: 1 },
            OPPOSES: { total: 10, scored: 10, correct: 9, accuracy: 0.9 },
            NEUTRAL: { total: 10, scored: 10, correct: 8, accuracy: 0.8 }
          },
          likelihoodRatio: { min: 0.1, max: 20, mean: 5.55 },
          lowConfidenceCount: 0,
          lowConfidenceRate: 0,
          reviewRequiredCount: 0,
          reviewRequiredRate: 0,
          fallbackComparedCount: 30,
          fallbackDivergenceCount: 10,
          fallbackDivergenceRate: 0.333
        }
      }
    );

    expect(risk?.title).toBe("LLM 与 fallback 分歧偏高");
  });

  it("allows auto-apply readiness when LLM evaluation rates are exactly at configured thresholds", () => {
    const risk = llmEvaluationAutoApplyRisk({
      generatedAt: new Date(),
      samplesPath: "model-artifacts/training-samples.jsonl",
      summary: {
        modelName: "deepseek:deepseek-v4-flash",
        sampleCount: 30,
        scoredCount: 30,
        sourceCounts: { fever: 29, local_confirmed: 1 },
        directionAccuracy: {
          SUPPORTS: { total: 10, scored: 10, correct: 10, accuracy: 1 },
          OPPOSES: { total: 10, scored: 10, correct: 7, accuracy: 0.7 },
          NEUTRAL: { total: 10, scored: 10, correct: 7, accuracy: 0.7 }
        },
        likelihoodRatio: { min: 0.05, max: 20, mean: 5.55 },
        lowConfidenceCount: 0,
        lowConfidenceRate: 0,
        reviewRequiredCount: 9,
        reviewRequiredRate: 0.3,
        fallbackComparedCount: 20,
        fallbackDivergenceCount: 6,
        fallbackDivergenceRate: 0.3
      }
    });

    expect(risk).toBeNull();
  });

  it("blocks auto-apply when the LLM evaluation needs too much human review", () => {
    expect(
      llmEvaluationAutoApplyRisk({
        generatedAt: new Date(),
        samplesPath: "model-artifacts/training-samples.jsonl",
        summary: {
          modelName: "deepseek:deepseek-v4-flash",
          sampleCount: 50,
          scoredCount: 50,
          sourceCounts: { fever: 49, local_confirmed: 1 },
          directionAccuracy: {
            SUPPORTS: { total: 20, scored: 20, correct: 16, accuracy: 0.8 },
            OPPOSES: { total: 15, scored: 15, correct: 12, accuracy: 0.8 },
            NEUTRAL: { total: 15, scored: 15, correct: 12, accuracy: 0.8 }
          },
          likelihoodRatio: { min: 0.4, max: 10, mean: 2.4 },
          lowConfidenceCount: 4,
          lowConfidenceRate: 0.08,
          reviewRequiredCount: 23,
          reviewRequiredRate: 0.46,
          fallbackComparedCount: 50,
          fallbackDivergenceCount: 4,
          fallbackDivergenceRate: 0.08
        }
      })?.title
    ).toBe("LLM 评估复核率偏高");
  });
});
