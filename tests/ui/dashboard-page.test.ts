import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { vi } from "vitest";
import type {
  BayesianUpdateEventRecord,
  BeliefRecord,
  EvidenceRecord,
  ObservationRecord,
  ObservationSourceRecord
} from "@/server/services/types";

const loadWorldModelData = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("@/app/admin/world-model/data", () => ({
  loadWorldModelData
}));

vi.mock("@/components/world-model/WorldModelGraphView", () => ({
  WorldModelGraphView: () => React.createElement("section", { "data-testid": "world-model-graph" }, "graph")
}));

function emptyWorldModelData() {
  return {
    error: undefined,
    beliefs: [],
    observations: [],
    evidence: [],
    sources: [],
    runs: [],
    heartbeats: [],
    workerConfigs: [],
    workerRuntime: [],
    models: [],
    updates: [],
    likelihoodRuns: []
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

function observation(input: Partial<ObservationRecord> = {}): ObservationRecord {
  return {
    id: "observation_unmatched",
    title: "Unmatched signal",
    content: "A new signal did not match existing hypotheses.",
    observedAt: new Date("2026-06-11T08:00:00.000Z"),
    status: "UNKNOWN",
    credibility: 0.7,
    metadata: { ignoredReason: "UNMATCHED" },
    ...input
  };
}

function source(input: Partial<ObservationSourceRecord> = {}): ObservationSourceRecord {
  const createdAt = new Date("2026-06-11T06:00:00.000Z");
  return {
    id: "source_signal",
    name: "Risky source",
    kind: "SEARCH",
    adapter: "search",
    credibility: 0.7,
    enabled: true,
    autoConfirm: true,
    autoConfirmThreshold: 0.72,
    createdAt,
    updatedAt: createdAt,
    ...input
  };
}

function update(): BayesianUpdateEventRecord {
  return {
    id: "update_signal",
    beliefId: "belief_signal",
    evidenceId: "evidence_signal",
    priorSnapshot: { hypothesis_signal: 0.35 },
    posteriorSnapshot: { hypothesis_signal: 0.62 },
    mode: "APPLIED",
    status: "APPLIED",
    confidence: 0.8,
    explanations: [],
    createdAt: new Date("2026-06-11T09:00:00.000Z")
  };
}

describe("world model dashboard page", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    loadWorldModelData.mockReset();
  });

  it("renders a review action for large probability updates", async () => {
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      beliefs: [belief()],
      evidence: [evidence()],
      updates: [update()]
    });
    const { default: DashboardPage } = await import("@/app/admin/world-model/page");

    const html = renderToStaticMarkup(await DashboardPage());

    expect(html).toContain("复盘大幅更新");
    expect(html).toContain("U-001 · E-001 使假设概率变化 +27.0pp");
    expect(html).toContain('href="/admin/world-model/graph?update=U-001"');
  });

  it("renders source-quality review for rolled-back evidence with readable source labels", async () => {
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      beliefs: [belief()],
      sources: [source()],
      observations: [
        observation({
          id: "observation_signal",
          sourceId: "source_signal",
          status: "CONFIRMED",
          metadata: {}
        })
      ],
      evidence: [evidence()],
      updates: [
        {
          ...update(),
          status: "ROLLED_BACK" as const,
          rolledBackAt: new Date("2026-06-11T10:00:00.000Z")
        }
      ]
    });
    const { default: DashboardPage } = await import("@/app/admin/world-model/page");

    const html = renderToStaticMarkup(await DashboardPage());

    expect(html).toContain("复查问题来源");
    expect(html).toContain("S-001 · Risky source 产出的 E-001 已产生回滚更新 U-001");
    expect(html).toContain('href="/admin/world-model/sources#source-list"');
  });

  it("renders source evidence quality diagnostics as overview actions", async () => {
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      beliefs: [belief()],
      sources: [source()],
      observations: [
        observation({
          id: "observation_active",
          sourceId: "source_signal",
          status: "CONFIRMED",
          metadata: {}
        }),
        observation({
          id: "observation_rejected",
          sourceId: "source_signal",
          status: "CONFIRMED",
          metadata: {}
        })
      ],
      evidence: [
        evidence({ id: "evidence_active", observationId: "observation_active" }),
        evidence({ id: "evidence_rejected", observationId: "observation_rejected", status: "REJECTED" })
      ]
    });
    const { default: DashboardPage } = await import("@/app/admin/world-model/page");

    const html = renderToStaticMarkup(await DashboardPage());

    expect(html).toContain("调整采集来源");
    expect(html).toContain("Risky source 的证据质量偏低：1/2 条证据出现拒绝或回滚");
    expect(html).toContain("建议将来源可信度从 0.70 降到 0.65，并将自动确认阈值从 0.72 提高到 0.90。");
    expect(html).toContain('href="/admin/world-model/sources#source-list"');
  });

  it("renders a graph review action when one hypothesis has active support and opposing evidence", async () => {
    const createdAt = new Date("2026-06-11T08:00:00.000Z");
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
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
              createdAt
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
              createdAt
            }
          ]
        })
      ]
    });
    const { default: DashboardPage } = await import("@/app/admin/world-model/page");

    const html = renderToStaticMarkup(await DashboardPage());

    expect(html).toContain("复盘冲突证据");
    expect(html).toContain("H-001 · Signal hypothesis 同时存在 1 条支持证据和 1 条反对证据");
    expect(html).toContain('href="/admin/world-model/graph?hypothesis=H-001"');
  });

  it("renders calibration feedback for settled hypotheses", async () => {
    const settledBelief = belief();
    settledBelief.hypotheses = [
      {
        ...settledBelief.hypotheses[0],
        id: "hypothesis_hit",
        proposition: "Likely event happened",
        currentProbability: 0.8,
        status: "RESOLVED_TRUE",
        resolvedOutcome: "The event happened."
      },
      {
        ...settledBelief.hypotheses[0],
        id: "hypothesis_miss",
        proposition: "Unlikely event did not happen",
        currentProbability: 0.7,
        status: "RESOLVED_FALSE",
        resolvedOutcome: "The event did not happen."
      }
    ];
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      beliefs: [settledBelief]
    });
    const { default: DashboardPage } = await import("@/app/admin/world-model/page");

    const html = renderToStaticMarkup(await DashboardPage());

    expect(html).toContain("结算校准");
    expect(html).toContain("已结算假设");
    expect(html).toContain("2");
    expect(html).toContain("Brier 0.265");
    expect(html).toContain("H-002 · Unlikely event did not happen");
    expect(html).toContain("The event did not happen.");
    expect(html).toContain(
      'class="rounded-md border border-line bg-white p-3 hover:border-moss" href="/admin/world-model/graph?hypothesis=H-002"'
    );
  });

  it("renders a graph review action for high-error settled hypotheses", async () => {
    const settledBelief = belief();
    settledBelief.hypotheses = [
      {
        ...settledBelief.hypotheses[0],
        id: "hypothesis_hit",
        proposition: "Likely event happened",
        currentProbability: 0.8,
        status: "RESOLVED_TRUE",
        resolvedOutcome: "The event happened."
      },
      {
        ...settledBelief.hypotheses[0],
        id: "hypothesis_miss",
        proposition: "Unlikely event did not happen",
        currentProbability: 0.7,
        status: "RESOLVED_FALSE",
        resolvedOutcome: "The event did not happen."
      }
    ];
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      beliefs: [settledBelief]
    });
    const { default: DashboardPage } = await import("@/app/admin/world-model/page");

    const html = renderToStaticMarkup(await DashboardPage());

    expect(html).toContain("复盘校准偏差");
    expect(html).toContain("H-002 · Unlikely event did not happen 结算为未发生，结算概率 70.0%，误差 70.0pp");
    expect(html).toContain('href="/admin/world-model/graph?hypothesis=H-002"');
    expect(html).toContain("补充校准假设");
    expect(html).toContain("B-001 存在高误差结算样本 H-002 · Unlikely event did not happen");
    expect(html).toContain('href="/admin/world-model/beliefs?belief=B-001#recommendations"');
  });

  it("counts only active evidence in the confirmed evidence metric", async () => {
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      evidence: [
        evidence({ id: "evidence_active", status: "ACTIVE" }),
        evidence({ id: "evidence_rejected", status: "REJECTED" }),
        evidence({ id: "evidence_superseded", status: "SUPERSEDED" })
      ]
    });
    const { default: DashboardPage } = await import("@/app/admin/world-model/page");

    const html = renderToStaticMarkup(await DashboardPage());

    expect(html).toMatch(/已确认证据<\/div><div[^>]*>1<\/div>/);
  });

  it("links unmatched overview actions to the concrete source observation recommendations", async () => {
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      observations: [
        observation({
          id: "observation_old",
          observedAt: new Date("2026-06-11T08:00:00.000Z")
        }),
        observation({
          id: "observation_new",
          title: "Newest unmatched signal",
          observedAt: new Date("2026-06-11T09:00:00.000Z")
        })
      ]
    });
    const { default: DashboardPage } = await import("@/app/admin/world-model/page");

    const html = renderToStaticMarkup(await DashboardPage());

    expect(html).toContain("基于观察补充假设");
    expect(html).toContain('href="/admin/world-model/beliefs?sourceObservation=O-002#recommendations"');
  });

  it("offers a one-click default worker start when automation prerequisites are ready but the worker is not running", async () => {
    const readyBelief = belief();
    readyBelief.hypotheses = [
      readyBelief.hypotheses[0],
      {
        ...readyBelief.hypotheses[0],
        id: "hypothesis_counter",
        proposition: "Counter hypothesis",
        stance: "OPPOSES"
      }
    ];
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      beliefs: [readyBelief],
      sources: [source()]
    });
    const { default: DashboardPage } = await import("@/app/admin/world-model/page");

    const html = renderToStaticMarkup(await DashboardPage());

    expect(html).toContain("启动默认守护进程");
    expect(html).toContain('name="returnPath" value="/admin/world-model"');
    expect(html).toContain('name="workerId" value="default"');
    expect(html).toContain('name="intervalSeconds" value="900"');
    expect(html).toContain('name="bootstrapDefaultSources" value="true"');
    expect(html).toContain('name="forceAutoApply" value="true"');
  });
});
