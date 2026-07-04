import { summarizeDashboardActions, summarizeResolvedHypothesisCalibration } from "@/lib/world-model-dashboard-ui";
import type { BayesianUpdateEventRecord, BeliefRecord, EvidenceRecord, ObservationRecord } from "@/server/services/types";

function observation(id: string, status: ObservationRecord["status"], metadata: Record<string, unknown> = {}): ObservationRecord {
  return {
    id,
    title: id,
    content: id,
    observedAt: new Date("2026-06-11T08:00:00.000Z"),
    status,
    credibility: 0.7,
    metadata
  };
}

function update(input: Partial<BayesianUpdateEventRecord> = {}): BayesianUpdateEventRecord {
  return {
    id: "update_signal",
    beliefId: "belief_signal",
    evidenceId: "evidence_signal",
    priorSnapshot: { hypothesis_signal: 0.35 },
    posteriorSnapshot: { hypothesis_signal: 0.62 },
    mode: "APPLIED",
    status: "APPLIED",
    confidence: 0.7,
    explanations: [],
    createdAt: new Date("2026-06-11T09:00:00.000Z"),
    ...input
  };
}

function belief(): BeliefRecord {
  const createdAt = new Date("2026-06-11T07:00:00.000Z");
  return {
    id: "belief_signal",
    title: "Signal belief",
    category: "AI_TREND",
    description: "",
    probabilityMode: "INDEPENDENT",
    origin: "INTERNAL",
    status: "ACTIVE",
    createdAt,
    updatedAt: createdAt,
    hypotheses: [
      {
        id: "hypothesis_signal",
        beliefId: "belief_signal",
        proposition: "Signal hypothesis",
        notes: "",
        stance: "SUPPORTS",
        priorProbability: 0.35,
        currentProbability: 0.62,
        strength: 0.62,
        status: "ACTIVE",
        createdAt,
        updatedAt: createdAt
      }
    ]
  };
}

function evidence(input: Partial<EvidenceRecord> = {}): EvidenceRecord {
  const createdAt = new Date("2026-06-11T08:00:00.000Z");
  return {
    id: "evidence_signal",
    observationId: "observation_signal",
    title: "Signal evidence",
    content: "Evidence with a large impact.",
    confirmedAt: createdAt,
    confirmationMode: "AUTO",
    credibility: 0.8,
    status: "ACTIVE",
    metadata: {},
    links: [
      {
        id: "link_signal",
        evidenceId: "evidence_signal",
        hypothesisId: "hypothesis_signal",
        direction: "SUPPORTS",
        relevance: 0.9,
        likelihoodRatio: 2.4,
        confidence: 0.8,
        rationale: "Strong evidence.",
        createdAt
      }
    ],
    ...input
  };
}

describe("world model dashboard UI", () => {
  it("summarizes settled hypotheses into calibration metrics", () => {
    const sourceBelief = belief();
    sourceBelief.hypotheses = [
      {
        ...sourceBelief.hypotheses[0],
        id: "hypothesis_hit",
        proposition: "Likely event happened",
        currentProbability: 0.8,
        status: "RESOLVED_TRUE",
        resolvedOutcome: "The event happened."
      },
      {
        ...sourceBelief.hypotheses[0],
        id: "hypothesis_miss",
        proposition: "Unlikely event did not happen",
        currentProbability: 0.7,
        status: "RESOLVED_FALSE",
        resolvedOutcome: "The event did not happen."
      },
      {
        ...sourceBelief.hypotheses[0],
        id: "hypothesis_active",
        proposition: "Still active",
        currentProbability: 0.99,
        status: "ACTIVE"
      }
    ];

    const summary = summarizeResolvedHypothesisCalibration([sourceBelief], {
      beliefLabel: () => "B-001",
      hypothesisLabel: (id) => (id === "hypothesis_miss" ? "H-002 · Unlikely event did not happen" : "H-001 · Likely event happened")
    });

    expect(summary.resolvedCount).toBe(2);
    expect(summary.trueCount).toBe(1);
    expect(summary.falseCount).toBe(1);
    expect(summary.brierScore).toBeCloseTo(0.265, 8);
    expect(summary.tone).toBe("warning");
    expect(summary.examples[0]).toMatchObject({
      hypothesisLabel: "H-002 · Unlikely event did not happen",
      outcomeLabel: "未发生",
      predictedProbability: 0.7,
      error: 0.7,
      resolvedOutcome: "The event did not happen."
    });
  });

  it("prioritizes actionable blockers for the overview page without duplicate links", () => {
    const actions = summarizeDashboardActions({
      observations: [
        observation("review", "PENDING", {
          recommendedLinks: [
            {
              hypothesisId: "hypothesis_1",
              direction: "SUPPORTS",
              relevance: 0.9,
              likelihoodRatio: 2,
              confidence: 0.8,
              rationale: "Relevant evidence."
            }
          ]
        }),
        observation("pending", "PENDING"),
        observation("unknown", "UNKNOWN"),
        observation("duplicate", "DUPLICATE")
      ],
      reviewDueHypothesisCount: 2,
      automation: {
        diagnostics: [
          {
            level: "warning",
            title: "LLM 主评分器未配置",
            detail: "LLM API 是 v1 主评分器；缺少配置时，候选识别和似然评分会退化为 fallback 或待审。"
          },
          {
            level: "info",
            title: "观察等待处理",
            detail: "4 条观察尚未确认为证据，处理后才能继续更新对应假设和信念。"
          }
        ],
        nextActions: [
          { label: "检查模型配置", href: "/admin/world-model/models" },
          { label: "处理观察积压", href: "/admin/world-model/observations" }
        ]
      }
    });

    expect(actions.map((action) => action.label)).toEqual([
      "处理待审候选",
      "复核假设时效",
      "检查模型配置",
      "处理重复候选",
      "处理观察积压"
    ]);
    expect(actions.find((action) => action.label === "处理待审候选")?.detail).toContain("1 条候选");
    expect(actions.find((action) => action.label === "处理待审候选")?.href).toBe(
      "/admin/world-model/observations#review-candidates"
    );
    expect(actions.find((action) => action.label === "处理重复候选")?.href).toBe(
      "/admin/world-model/observations#duplicate-candidates"
    );
    expect(actions.find((action) => action.label === "处理观察积压")?.detail).toContain("2 条观察");
  });

  it("turns one-sided hypothesis coverage diagnostics into a dashboard action", () => {
    const actions = summarizeDashboardActions({
      observations: [],
      reviewDueHypothesisCount: 0,
      automation: {
        diagnostics: [
          {
            level: "warning",
            title: "假设覆盖单向",
            detail: "1 个活跃信念只有支持或反证单边假设，自动闭环可能放大确认偏误；先补充缺失方向假设。"
          }
        ],
        nextActions: [{ label: "补齐假设覆盖", href: "/admin/world-model/beliefs#recommendations" }]
      }
    });

    expect(actions).toContainEqual({
      label: "补齐假设覆盖",
      detail: "1 个活跃信念只有支持或反证单边假设，自动闭环可能放大确认偏误；先补充缺失方向假设。",
      href: "/admin/world-model/beliefs#recommendations",
      level: "warning"
    });
  });

  it("routes unmatched unknown observations toward hypothesis creation on the overview page", () => {
    const actions = summarizeDashboardActions({
      observations: [
        observation("unmatched", "UNKNOWN", { ignoredReason: "UNMATCHED" }),
        observation("pending", "PENDING"),
        observation("duplicate", "DUPLICATE")
      ],
      reviewDueHypothesisCount: 0,
      automation: {
        diagnostics: [],
        nextActions: []
      }
    });

    expect(actions.map((action) => action.label)).toEqual(["基于观察补充假设", "处理重复候选", "处理观察积压"]);
    expect(actions.find((action) => action.label === "基于观察补充假设")).toMatchObject({
      detail: "1 条未匹配观察可以转化为新假设，补充后会重新进入证据待审。",
      href: "/admin/world-model/beliefs",
      level: "warning"
    });
    expect(actions.find((action) => action.label === "处理重复候选")?.href).toBe(
      "/admin/world-model/observations#duplicate-candidates"
    );
    expect(actions.find((action) => action.label === "处理观察积压")?.detail).toContain("1 条观察");
  });

  it("routes duplicate candidates toward duplicate review instead of burying them in the observation backlog", () => {
    const actions = summarizeDashboardActions({
      observations: [
        observation("pending", "PENDING"),
        observation("duplicate-1", "DUPLICATE"),
        observation("duplicate-2", "DUPLICATE")
      ],
      reviewDueHypothesisCount: 0,
      automation: {
        diagnostics: [],
        nextActions: []
      }
    });

    expect(actions.map((action) => action.label)).toEqual(["处理重复候选", "处理观察积压"]);
    expect(actions.find((action) => action.label === "处理重复候选")).toMatchObject({
      detail: "2 条重复候选需要核对原始观察后拒绝或重新采集来源。",
      href: "/admin/world-model/observations#duplicate-candidates",
      level: "info"
    });
    expect(actions.find((action) => action.label === "处理观察积压")?.detail).toBe("1 条观察尚未确认为证据或拒绝。");
  });

  it("focuses unmatched overview actions on the concrete source observation when a readable code is available", () => {
    const actions = summarizeDashboardActions({
      observations: [
        {
          ...observation("older_unmatched", "UNKNOWN", { ignoredReason: "UNMATCHED" }),
          observedAt: new Date("2026-06-11T08:00:00.000Z")
        },
        {
          ...observation("newer_unmatched", "UNKNOWN", { ignoredReason: "UNMATCHED" }),
          observedAt: new Date("2026-06-11T09:00:00.000Z")
        }
      ],
      observationCode: (observationId) => (observationId === "newer_unmatched" ? "O-009" : "O-001"),
      reviewDueHypothesisCount: 0,
      automation: {
        diagnostics: [],
        nextActions: []
      }
    });

    expect(actions.find((action) => action.label === "基于观察补充假设")).toMatchObject({
      href: "/admin/world-model/beliefs?sourceObservation=O-009#recommendations"
    });
  });

  it("routes LLM-abstained unmatched observations toward scoring diagnostics before hypothesis creation", () => {
    const actions = summarizeDashboardActions({
      observations: [
        observation("llm-abstained", "UNKNOWN", {
          ignoredReason: "UNMATCHED",
          candidateEvaluation: {
            estimator: "llm",
            attemptedCount: 2,
            usableCount: 0,
            abstainedCount: 2,
            rejectedCount: 0,
            latestRationale: "LLM API request failed with status 401."
          }
        }),
        observation("plain-unmatched", "UNKNOWN", { ignoredReason: "UNMATCHED" })
      ],
      reviewDueHypothesisCount: 0,
      automation: {
        diagnostics: [],
        nextActions: []
      }
    });

    expect(actions.map((action) => action.label)).toEqual(["查看评分诊断", "基于观察补充假设"]);
    expect(actions.find((action) => action.label === "查看评分诊断")).toMatchObject({
      detail: "1 条未匹配观察已尝试 LLM 评分但没有可用输出，先检查模型配置、API 状态或评分诊断。",
      href: "/admin/world-model/observations#unknown-evidence",
      level: "warning"
    });
    expect(actions.find((action) => action.label === "基于观察补充假设")?.detail).toContain("1 条未匹配观察");
  });

  it("routes LLM evaluation diagnostics toward the models page", () => {
    const actions = summarizeDashboardActions({
      observations: [],
      reviewDueHypothesisCount: 0,
      automation: {
        diagnostics: [
          {
            level: "warning",
            title: "LLM 主评分器未评估",
            detail: "LLM API 已配置为 v1 主评分器，但没有最近评估结果；运行真实样本评估后再依赖自动应用。"
          }
        ],
        nextActions: [{ label: "查看模型评估", href: "/admin/world-model/models" }]
      }
    });

    expect(actions).toEqual([
      {
        label: "查看模型评估",
        detail: "LLM API 已配置为 v1 主评分器，但没有最近评估结果；运行真实样本评估后再依赖自动应用。",
        href: "/admin/world-model/models",
        level: "warning"
      }
    ]);
  });

  it("routes review-only automation stalls toward auto-apply controls", () => {
    const actions = summarizeDashboardActions({
      observations: [],
      reviewDueHypothesisCount: 0,
      automation: {
        diagnostics: [
          {
            level: "info",
            title: "候选等待确认",
            detail: "关闭仅生成待审或降低自动应用阈值后，可信候选才能自动更新信念。"
          }
        ],
        nextActions: [{ label: "启用自动应用", href: "/admin/world-model/sources#evidence-loop" }]
      }
    });

    expect(actions).toContainEqual({
      label: "启用自动应用",
      detail: "关闭仅生成待审或降低自动应用阈值后，可信候选才能自动更新信念。",
      href: "/admin/world-model/sources#evidence-loop",
      level: "info"
    });
  });

  it("routes LLM evaluation quality diagnostics toward the models page", () => {
    const actions = summarizeDashboardActions({
      observations: [],
      reviewDueHypothesisCount: 0,
      automation: {
        diagnostics: [
          {
            level: "warning",
            title: "LLM 与 fallback 分歧偏高",
            detail: "最近一次 LLM 评估中 36.0% 样本与 fallback 方向分歧，自动应用前应抽样复核评分理由。"
          }
        ],
        nextActions: [{ label: "查看模型评估", href: "/admin/world-model/models" }]
      }
    });

    expect(actions).toEqual([
      {
        label: "查看模型评估",
        detail: "最近一次 LLM 评估中 36.0% 样本与 fallback 方向分歧，自动应用前应抽样复核评分理由。",
        href: "/admin/world-model/models",
        level: "warning"
      }
    ]);
  });

  it.each([
    [
      "LLM 评估结果陈旧",
      "最近一次 LLM 评估已超过 14 天，自动应用前应重新运行真实样本评估。"
    ],
    [
      "LLM 评估时间缺失",
      "最近一次 LLM 评估缺少生成时间，自动应用前应重新运行真实样本评估。"
    ],
    [
      "LLM 评估未覆盖本地证据",
      "最近一次 LLM 评估没有本地确认证据或已结算假设样本，自动应用前应纳入当前信念/假设/证据链路。"
    ],
    [
      "LLM 评估未覆盖真实平台样本",
      "最近一次 LLM 评估没有 GitHub、Hugging Face Hub 或 Manifold 样本，自动应用前应纳入真实平台样本。"
    ],
    [
      "LLM 评估方向准确率偏低",
      "最近一次 LLM 评估方向准确率偏低：中性 60.0%；建议抽样复核提示词、样本标签和自动应用阈值。"
    ]
  ])("routes %s diagnostics toward the models page with the concrete reason", (title, detail) => {
    const actions = summarizeDashboardActions({
      observations: [],
      reviewDueHypothesisCount: 0,
      automation: {
        diagnostics: [
          {
            level: "warning",
            title,
            detail
          }
        ],
        nextActions: [{ label: "查看模型评估", href: "/admin/world-model/models" }]
      }
    });

    expect(actions).toEqual([
      {
        label: "查看模型评估",
        detail,
        href: "/admin/world-model/models",
        level: "warning"
      }
    ]);
  });

  it("routes low-impact unknown observations toward manual review on the overview page", () => {
    const actions = summarizeDashboardActions({
      observations: [
        observation("low-impact", "UNKNOWN", {
          ignoredReason: "LOW_IMPACT",
          recommendedLinks: [
            {
              hypothesisId: "hypothesis_1",
              direction: "SUPPORTS",
              relevance: 0.5,
              likelihoodRatio: 1.1,
              confidence: 0.6,
              rationale: "Small but reviewable update."
            }
          ]
        }),
        observation("pending", "PENDING")
      ],
      reviewDueHypothesisCount: 0,
      automation: {
        diagnostics: [],
        nextActions: []
      }
    });

    expect(actions.map((action) => action.label)).toEqual(["查看低影响观察", "处理观察积压"]);
    expect(actions.find((action) => action.label === "查看低影响观察")).toMatchObject({
      detail: "1 条观察相关但预期概率变化较小，可以人工确认或拒绝。",
      href: "/admin/world-model/observations#unknown-evidence",
      level: "info"
    });
    expect(actions.find((action) => action.label === "处理观察积压")?.detail).toContain("1 条观察");
  });

  it("keeps duplicate-only automation diagnostics actionable on the overview page", () => {
    const actions = summarizeDashboardActions({
      observations: [],
      reviewDueHypothesisCount: 0,
      automation: {
        diagnostics: [
          {
            level: "info",
            title: "观察已全部去重",
            detail: "3 条采集观察已被判定为重复，说明来源暂时没有提供新信息。"
          }
        ],
        nextActions: [{ label: "调整采集来源", href: "/admin/world-model/sources#source-list" }]
      }
    });

    expect(actions).toEqual([
      {
        label: "调整采集来源",
        detail: "3 条采集观察已被判定为重复，说明来源暂时没有提供新信息。",
        href: "/admin/world-model/sources#source-list",
        level: "info"
      }
    ]);
  });

  it("keeps stale-source automation diagnostics actionable on the overview page", () => {
    const actions = summarizeDashboardActions({
      observations: [],
      reviewDueHypothesisCount: 0,
      automation: {
        diagnostics: [
          {
            level: "warning",
            title: "来源缺少增量",
            detail: "Stale source 已连续 3 次只产生重复观察；调整查询、来源 URL 或停用低增量来源。"
          }
        ],
        nextActions: [{ label: "调整采集来源", href: "/admin/world-model/sources#source-list" }]
      }
    });

    expect(actions).toEqual([
      {
        label: "调整采集来源",
        detail: "Stale source 已连续 3 次只产生重复观察；调整查询、来源 URL 或停用低增量来源。",
        href: "/admin/world-model/sources#source-list",
        level: "warning"
      }
    ]);
  });

  it("keeps source evidence quality diagnostics actionable on the overview page", () => {
    const actions = summarizeDashboardActions({
      observations: [],
      reviewDueHypothesisCount: 0,
      automation: {
        diagnostics: [
          {
            level: "warning",
            title: "来源证据质量偏低",
            detail:
              "Risky source 的证据质量偏低：2/3 条证据出现拒绝或回滚（66.7%，回滚 1，拒绝 1）；建议提高自动确认阈值或暂时停用。"
          }
        ],
        nextActions: [{ label: "调整采集来源", href: "/admin/world-model/sources#source-list" }]
      }
    });

    expect(actions).toEqual([
      {
        label: "调整采集来源",
        detail:
          "Risky source 的证据质量偏低：2/3 条证据出现拒绝或回滚（66.7%，回滚 1，拒绝 1）；建议提高自动确认阈值或暂时停用。",
        href: "/admin/world-model/sources#source-list",
        level: "warning"
      }
    ]);
  });

  it("surfaces large and rolled-back updates as review actions on the overview page", () => {
    const actions = summarizeDashboardActions({
      observations: [],
      reviewDueHypothesisCount: 0,
      updates: [
        update({
          id: "update_small",
          priorSnapshot: { hypothesis_small: 0.5 },
          posteriorSnapshot: { hypothesis_small: 0.54 }
        }),
        update({
          id: "update_rolled_back",
          evidenceId: "evidence_bad",
          priorSnapshot: { hypothesis_bad: 0.75 },
          posteriorSnapshot: { hypothesis_bad: 0.48 },
          status: "ROLLED_BACK",
          rolledBackAt: new Date("2026-06-11T10:00:00.000Z")
        }),
        update({
          id: "update_large",
          evidenceId: "evidence_signal",
          priorSnapshot: { hypothesis_signal: 0.35 },
          posteriorSnapshot: { hypothesis_signal: 0.62 }
        })
      ],
      updateLabel: (id) => (id === "update_large" ? "U-002" : id === "update_rolled_back" ? "U-001" : id),
      evidenceLabel: (id) => (id === "evidence_signal" ? "E-002" : id === "evidence_bad" ? "E-001" : id),
      automation: {
        diagnostics: [],
        nextActions: []
      }
    } as Parameters<typeof summarizeDashboardActions>[0]);

    expect(actions).toEqual([
      {
        label: "复盘大幅更新",
        detail: "U-002 · E-002 使假设概率变化 +27.0pp，建议核查证据关联和似然判断。",
        href: "/admin/world-model/graph?update=U-002",
        level: "warning"
      },
      {
        label: "核查回滚证据",
        detail: "U-001 · E-001 已回滚，确认该证据关系或来源质量是否需要修正。",
        href: "/admin/world-model/evidence?update=U-001#update-events",
        level: "warning"
      }
    ]);
  });

  it("surfaces source-quality review when rolled-back evidence came from a source", () => {
    const actions = summarizeDashboardActions({
      observations: [{ ...observation("observation_bad", "CONFIRMED"), sourceId: "source_risky" }],
      evidence: [
        evidence({
          id: "evidence_bad",
          observationId: "observation_bad"
        })
      ],
      reviewDueHypothesisCount: 0,
      updates: [
        update({
          id: "update_rolled_back",
          evidenceId: "evidence_bad",
          priorSnapshot: { hypothesis_bad: 0.75 },
          posteriorSnapshot: { hypothesis_bad: 0.48 },
          status: "ROLLED_BACK",
          rolledBackAt: new Date("2026-06-11T10:00:00.000Z")
        })
      ],
      updateLabel: () => "U-001",
      evidenceLabel: () => "E-001",
      sourceLabel: () => "S-001 · Risky source",
      automation: {
        diagnostics: [],
        nextActions: []
      }
    } as Parameters<typeof summarizeDashboardActions>[0]);

    expect(actions).toContainEqual({
      label: "复查问题来源",
      detail: "S-001 · Risky source 产出的 E-001 已产生回滚更新 U-001；建议复查来源可信度、自动确认阈值或暂时停用。",
      href: "/admin/world-model/sources#source-list",
      level: "warning"
    });
  });

  it("surfaces moderate probability updates that are still worth reviewing", () => {
    const actions = summarizeDashboardActions({
      observations: [],
      reviewDueHypothesisCount: 0,
      updates: [
        update({
          id: "update_moderate",
          evidenceId: "evidence_moderate",
          priorSnapshot: { hypothesis_moderate: 0.4 },
          posteriorSnapshot: { hypothesis_moderate: 0.478 }
        })
      ],
      updateLabel: () => "U-007",
      evidenceLabel: () => "E-003",
      automation: {
        diagnostics: [],
        nextActions: []
      }
    });

    expect(actions).toContainEqual({
      label: "复盘大幅更新",
      detail: "U-007 · E-003 使假设概率变化 +7.8pp，建议核查证据关联和似然判断。",
      href: "/admin/world-model/graph?update=U-007",
      level: "warning"
    });
  });

  it("surfaces active support and opposing evidence on the same hypothesis as a graph review action", () => {
    const actions = summarizeDashboardActions({
      observations: [],
      beliefs: [belief()],
      evidence: [
        evidence({
          id: "evidence_support",
          links: [
            {
              id: "link_support",
              evidenceId: "evidence_support",
              hypothesisId: "hypothesis_signal",
              direction: "SUPPORTS",
              relevance: 0.9,
              likelihoodRatio: 2.4,
              confidence: 0.8,
              rationale: "Supports the hypothesis.",
              createdAt: new Date("2026-06-11T08:00:00.000Z")
            }
          ]
        }),
        evidence({
          id: "evidence_oppose",
          links: [
            {
              id: "link_oppose",
              evidenceId: "evidence_oppose",
              hypothesisId: "hypothesis_signal",
              direction: "OPPOSES",
              relevance: 0.7,
              likelihoodRatio: 0.5,
              confidence: 0.75,
              rationale: "Weakens the hypothesis.",
              createdAt: new Date("2026-06-11T08:30:00.000Z")
            }
          ]
        })
      ],
      hypothesisCode: (id) => (id === "hypothesis_signal" ? "H-001" : id),
      hypothesisLabel: (id) => (id === "hypothesis_signal" ? "H-001 · Signal hypothesis" : id),
      beliefLabel: (id) => (id === "belief_signal" ? "B-001" : id),
      reviewDueHypothesisCount: 0,
      automation: {
        diagnostics: [],
        nextActions: []
      }
    });

    expect(actions).toContainEqual({
      label: "复盘冲突证据",
      detail: "H-001 · Signal hypothesis 同时存在 1 条支持证据和 1 条反对证据，建议在图谱中复盘关联、相关性和似然权重。",
      href: "/admin/world-model/graph?hypothesis=H-001",
      level: "warning"
    });
  });

  it("surfaces high-error settled hypotheses as calibration review actions", () => {
    const sourceBelief = belief();
    sourceBelief.hypotheses = [
      {
        ...sourceBelief.hypotheses[0],
        id: "hypothesis_overconfident",
        proposition: "Overconfident hypothesis failed",
        currentProbability: 0.72,
        status: "RESOLVED_FALSE",
        resolvedOutcome: "The expected outcome did not happen."
      }
    ];

    const actions = summarizeDashboardActions({
      observations: [],
      beliefs: [sourceBelief],
      hypothesisCode: (id) => (id === "hypothesis_overconfident" ? "H-009" : id),
      hypothesisLabel: (id) => (id === "hypothesis_overconfident" ? "H-009 · Overconfident hypothesis failed" : id),
      beliefLabel: (id) => (id === sourceBelief.id ? "B-001" : id),
      reviewDueHypothesisCount: 0,
      automation: {
        diagnostics: [],
        nextActions: []
      }
    });

    expect(actions).toContainEqual({
      label: "复盘校准偏差",
      detail:
        "H-009 · Overconfident hypothesis failed 结算为未发生，结算概率 72.0%，误差 72.0pp；建议复盘证据关联、补充反证或调整同类假设。",
      href: "/admin/world-model/graph?hypothesis=H-009",
      level: "warning"
    });
    expect(actions).toContainEqual({
      label: "补充校准假设",
      detail:
        "B-001 存在高误差结算样本 H-009 · Overconfident hypothesis failed，进入推荐区补充可验证的修复假设。",
      href: "/admin/world-model/beliefs?belief=B-001#recommendations",
      level: "warning"
    });
  });

  it("surfaces uncertain hypotheses without active evidence as collection actions on the overview page", () => {
    const sourceBelief = belief();
    sourceBelief.hypotheses = [
      {
        ...sourceBelief.hypotheses[0],
        id: "hypothesis_uncertain",
        proposition: "Uncertain hypothesis needs evidence",
        currentProbability: 0.52,
        priorProbability: 0.52
      },
      {
        ...sourceBelief.hypotheses[0],
        id: "hypothesis_settled",
        proposition: "Settled hypothesis",
        currentProbability: 0.95,
        priorProbability: 0.95
      },
      {
        ...sourceBelief.hypotheses[0],
        id: "hypothesis_covered",
        proposition: "Covered uncertain hypothesis",
        currentProbability: 0.5,
        priorProbability: 0.5
      }
    ];

    const actions = summarizeDashboardActions({
      observations: [],
      beliefs: [sourceBelief],
      evidence: [
        evidence({
          id: "evidence_covered",
          links: [
            {
              id: "link_covered",
              evidenceId: "evidence_covered",
              hypothesisId: "hypothesis_covered",
              direction: "SUPPORTS",
              relevance: 0.8,
              likelihoodRatio: 1.8,
              confidence: 0.7,
              rationale: "Already covered.",
              createdAt: new Date("2026-06-11T08:00:00.000Z")
            }
          ]
        })
      ],
      hypothesisCode: (id) => (id === "hypothesis_uncertain" ? "H-002" : id),
      hypothesisLabel: (id) => (id === "hypothesis_uncertain" ? "H-002 · Uncertain hypothesis needs evidence" : id),
      beliefLabel: (id) => (id === sourceBelief.id ? "B-001" : id),
      reviewDueHypothesisCount: 0,
      automation: {
        diagnostics: [],
        nextActions: []
      }
    });

    expect(actions).toContainEqual({
      label: "优先采集薄证据假设",
      detail: "H-002 · Uncertain hypothesis needs evidence 当前概率 52.0%，暂无活跃证据；建议运行自动闭环优先采集观察。",
      href: "/admin/world-model/sources?belief=B-001#evidence-loop",
      level: "warning"
    });
    expect(actions.map((action) => action.detail).join("\n")).not.toContain("Covered uncertain hypothesis");
    expect(actions.map((action) => action.detail).join("\n")).not.toContain("Settled hypothesis");
  });

  it("surfaces high-confidence one-sided evidence as a counter-evidence collection action", () => {
    const sourceBelief = belief();
    sourceBelief.hypotheses = [
      {
        ...sourceBelief.hypotheses[0],
        id: "hypothesis_overconfident",
        proposition: "Overconfident hypothesis needs counter evidence",
        currentProbability: 0.91,
        priorProbability: 0.91
      }
    ];

    const actions = summarizeDashboardActions({
      observations: [],
      beliefs: [sourceBelief],
      evidence: [
        evidence({
          id: "evidence_support_1",
          links: [
            {
              id: "link_support_1",
              evidenceId: "evidence_support_1",
              hypothesisId: "hypothesis_overconfident",
              direction: "SUPPORTS",
              relevance: 0.9,
              likelihoodRatio: 2.2,
              confidence: 0.82,
              rationale: "Supports the hypothesis.",
              createdAt: new Date("2026-06-11T08:00:00.000Z")
            }
          ]
        }),
        evidence({
          id: "evidence_support_2",
          links: [
            {
              id: "link_support_2",
              evidenceId: "evidence_support_2",
              hypothesisId: "hypothesis_overconfident",
              direction: "SUPPORTS",
              relevance: 0.8,
              likelihoodRatio: 1.8,
              confidence: 0.76,
              rationale: "Also supports the hypothesis.",
              createdAt: new Date("2026-06-11T09:00:00.000Z")
            }
          ]
        })
      ],
      hypothesisCode: (id) => (id === "hypothesis_overconfident" ? "H-004" : id),
      hypothesisLabel: (id) => (id === "hypothesis_overconfident" ? "H-004 · Overconfident hypothesis needs counter evidence" : id),
      beliefLabel: (id) => (id === sourceBelief.id ? "B-001" : id),
      reviewDueHypothesisCount: 0,
      automation: {
        diagnostics: [],
        nextActions: []
      }
    });

    expect(actions).toContainEqual({
      label: "主动寻找反证",
      detail:
        "H-004 · Overconfident hypothesis needs counter evidence 当前概率 91.0%，已有 2 条支持证据但没有反向证据；建议优先采集能削弱它的观察。",
      href: "/admin/world-model/sources?belief=B-001#evidence-loop",
      level: "warning"
    });
  });

  it("surfaces stale evidence as a refresh collection action", () => {
    const sourceBelief = belief();
    sourceBelief.hypotheses = [
      {
        ...sourceBelief.hypotheses[0],
        id: "hypothesis_stale",
        proposition: "Stale hypothesis needs a refresh",
        currentProbability: 0.64,
        priorProbability: 0.64
      }
    ];
    const staleConfirmedAt = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000 - 60_000);

    const actions = summarizeDashboardActions({
      observations: [],
      beliefs: [sourceBelief],
      evidence: [
        evidence({
          id: "evidence_stale",
          confirmedAt: staleConfirmedAt,
          links: [
            {
              id: "link_stale",
              evidenceId: "evidence_stale",
              hypothesisId: "hypothesis_stale",
              direction: "SUPPORTS",
              relevance: 0.7,
              likelihoodRatio: 1.4,
              confidence: 0.68,
              rationale: "Old but still active evidence.",
              createdAt: staleConfirmedAt
            }
          ]
        })
      ],
      hypothesisCode: (id) => (id === "hypothesis_stale" ? "H-008" : id),
      hypothesisLabel: (id) => (id === "hypothesis_stale" ? "H-008 · Stale hypothesis needs a refresh" : id),
      beliefLabel: (id) => (id === sourceBelief.id ? "B-001" : id),
      reviewDueHypothesisCount: 0,
      automation: {
        diagnostics: [],
        nextActions: []
      }
    });

    expect(actions).toContainEqual({
      label: "复查旧证据",
      detail: "H-008 · Stale hypothesis needs a refresh 最近活跃证据已 45 天未更新；建议重新采集观察，避免旧信息锁定判断。",
      href: "/admin/world-model/sources?belief=B-001#evidence-loop",
      level: "warning"
    });
  });

  it("surfaces extreme probability backed by weak evidence as a fragile certainty action", () => {
    const sourceBelief = belief();
    sourceBelief.hypotheses = [
      {
        ...sourceBelief.hypotheses[0],
        id: "hypothesis_fragile",
        proposition: "Fragile conclusion needs stronger evidence",
        currentProbability: 0.08,
        priorProbability: 0.08
      }
    ];

    const actions = summarizeDashboardActions({
      observations: [],
      beliefs: [sourceBelief],
      evidence: [
        evidence({
          id: "evidence_weak",
          links: [
            {
              id: "link_weak",
              evidenceId: "evidence_weak",
              hypothesisId: "hypothesis_fragile",
              direction: "OPPOSES",
              relevance: 0.42,
              likelihoodRatio: 0.7,
              confidence: 0.45,
              rationale: "Weak evidence moved the hypothesis toward rejection.",
              createdAt: new Date("2026-06-11T08:00:00.000Z")
            }
          ]
        })
      ],
      hypothesisCode: (id) => (id === "hypothesis_fragile" ? "H-010" : id),
      hypothesisLabel: (id) => (id === "hypothesis_fragile" ? "H-010 · Fragile conclusion needs stronger evidence" : id),
      beliefLabel: (id) => (id === sourceBelief.id ? "B-001" : id),
      reviewDueHypothesisCount: 0,
      automation: {
        diagnostics: [],
        nextActions: []
      }
    });

    expect(actions).toContainEqual({
      label: "补强脆弱判断",
      detail:
        "H-010 · Fragile conclusion needs stronger evidence 当前概率 8.0%，但证据质量偏弱（1 条活跃证据，平均相关性 0.42，平均置信度 0.45）；建议运行自动闭环补充高质量证据或反证。",
      href: "/admin/world-model/sources?belief=B-001#evidence-loop",
      level: "warning"
    });
  });

  it("keeps large update review visible ahead of lower-context warning actions", () => {
    const actions = summarizeDashboardActions({
      observations: [
        observation("review", "PENDING", {
          recommendedLinks: [
            {
              hypothesisId: "hypothesis_1",
              direction: "SUPPORTS",
              relevance: 0.8,
              likelihoodRatio: 1.8,
              confidence: 0.7,
              rationale: "Reviewable evidence."
            }
          ]
        }),
        observation("unmatched", "UNKNOWN", { ignoredReason: "UNMATCHED" })
      ],
      reviewDueHypothesisCount: 2,
      updates: [update()],
      updateLabel: () => "U-001",
      evidenceLabel: () => "E-001",
      automation: {
        diagnostics: [
          {
            level: "warning",
            title: "LLM 主评分器未配置",
            detail: "LLM API 是 v1 主评分器；缺少配置时，候选识别和似然评分会退化为 fallback 或待审。"
          },
          {
            level: "warning",
            title: "来源缺少增量",
            detail: "Stale source 已连续 3 次只产生重复观察；调整查询、来源 URL 或停用低增量来源。"
          }
        ],
        nextActions: [
          { label: "检查模型配置", href: "/admin/world-model/models" },
          { label: "调整采集来源", href: "/admin/world-model/sources#source-list" }
        ]
      }
    });

    expect(actions.slice(0, 3).map((action) => action.label)).toEqual(["复盘大幅更新", "处理待审候选", "基于观察补充假设"]);
  });

  it("keeps worker startup visible in the overview action slice when automation is otherwise ready", () => {
    const actions = summarizeDashboardActions({
      observations: [
        observation("review", "PENDING", {
          recommendedLinks: [
            {
              hypothesisId: "hypothesis_1",
              direction: "SUPPORTS",
              relevance: 0.8,
              likelihoodRatio: 1.8,
              confidence: 0.7,
              rationale: "Reviewable evidence."
            }
          ]
        }),
        observation("unmatched", "UNKNOWN", { ignoredReason: "UNMATCHED" }),
        observation("duplicate", "DUPLICATE"),
        observation("pending", "PENDING")
      ],
      reviewDueHypothesisCount: 1,
      updates: [
        update(),
        update({
          id: "update_rolled_back",
          evidenceId: "evidence_rolled_back",
          status: "ROLLED_BACK",
          rolledBackAt: new Date("2026-06-11T10:00:00.000Z")
        })
      ],
      updateLabel: (id) => (id === "update_rolled_back" ? "U-002" : "U-001"),
      evidenceLabel: (id) => (id === "evidence_rolled_back" ? "E-002" : "E-001"),
      automation: {
        diagnostics: [
          {
            level: "warning",
            title: "守护进程未开启",
            detail: "基础条件已满足，但本地守护进程没有运行；启动后才能按周期自动搜集观察和证据。"
          }
        ],
        nextActions: [{ label: "启动守护进程", href: "/admin/world-model/sources#automation-worker" }]
      }
    });

    expect(actions.map((action) => action.label)).toContain("启动守护进程");
    expect(actions.slice(0, 6).map((action) => action.label)).toContain("启动守护进程");
  });

  it("surfaces healthy worker notices as overview actions", () => {
    const actions = summarizeDashboardActions({
      observations: [],
      reviewDueHypothesisCount: 0,
      automation: {
        diagnostics: [],
        nextActions: [],
        worker: {
          label: "运行中",
          tone: "healthy",
          consecutiveFailureCount: 0,
          lastNotice: "LLM 评估风险：LLM 评估复核率偏高，已切换为待审模式。1 条候选观察等待确认。",
          lastError: ""
        }
      } as Parameters<typeof summarizeDashboardActions>[0]["automation"] & {
        worker: {
          label: string;
          tone: "healthy";
          consecutiveFailureCount: number;
          lastNotice: string;
          lastError: string;
        };
      }
    });

    expect(actions).toContainEqual({
      label: "查看守护进程提示",
      detail: "LLM 评估风险：LLM 评估复核率偏高，已切换为待审模式。1 条候选观察等待确认。",
      href: "/admin/world-model/sources#automation-worker",
      level: "info"
    });
  });
});
