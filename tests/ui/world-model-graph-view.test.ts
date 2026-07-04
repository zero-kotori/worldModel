import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { vi } from "vitest";
import { createWorldModelGraphEditorData } from "@/lib/world-model-graph-editor";
import type { WorldModelGraph, WorldModelGraphEdge, WorldModelGraphNode } from "@/lib/world-model-graph";
import type {
  BayesianUpdateEventRecord,
  BeliefRecord,
  EvidenceRecord,
  LikelihoodRunRecord,
  ObservationRecord,
  ObservationSourceRecord
} from "@/server/services/types";

vi.mock("@xyflow/react", async () => {
  const ReactModule = await import("react");
  return {
    Background: () => ReactModule.createElement("div", { "data-testid": "graph-background" }),
    PanOnScrollMode: { Vertical: "vertical" },
    ReactFlow: ({ children }: { children?: React.ReactNode }) =>
      ReactModule.createElement("div", { "data-testid": "react-flow" }, children),
    applyNodeChanges: () => []
  };
});

vi.mock("@/app/admin/world-model/actions", () => ({
  confirmGraphObservationAction: vi.fn(),
  connectEvidenceHypothesisAction: vi.fn(),
  connectObservationHypothesisAction: vi.fn(),
  connectSourceObservationAction: vi.fn(),
  disconnectEvidenceHypothesisAction: vi.fn(),
  rejectObservationAction: vi.fn(),
  updateBeliefAction: vi.fn(),
  rollbackUpdateAction: vi.fn(),
  updateEvidenceAction: vi.fn(),
  updateGraphObservationAction: vi.fn(),
  updateHypothesisAction: vi.fn(),
  updateSourceAction: vi.fn(),
  rejectEvidenceAction: vi.fn(),
  deleteEvidenceAction: vi.fn()
}));

function belief(): BeliefRecord {
  const createdAt = new Date("2026-06-11T07:00:00.000Z");
  return {
    id: "belief_ai_agents",
    title: "AI agents",
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
        beliefId: "belief_ai_agents",
        proposition: "AI agents improve delivery",
        notes: "",
        stance: "SUPPORTS",
        priorProbability: 0.4,
        currentProbability: 0.4,
        strength: 0.4,
        status: "ACTIVE",
        createdAt,
        updatedAt: createdAt
      }
    ]
  };
}

function rejectedEvidence(): EvidenceRecord {
  return {
    id: "evidence_rejected",
    observationId: "observation_rejected",
    title: "Rejected evidence",
    content: "Rejected evidence content",
    confirmedAt: new Date("2026-06-11T08:00:00.000Z"),
    confirmationMode: "MANUAL",
    credibility: 0.6,
    status: "REJECTED",
    metadata: {},
    links: []
  };
}

function rejectedEvidenceWithLink(): EvidenceRecord {
  return {
    ...rejectedEvidence(),
    links: [
      {
        id: "link_rejected",
        evidenceId: "evidence_rejected",
        hypothesisId: "hypothesis_support",
        direction: "SUPPORTS",
        relevance: 0.8,
        likelihoodRatio: 1.6,
        confidence: 0.7,
        rationale: "Rejected evidence can be reviewed and restored.",
        createdAt: new Date("2026-06-11T08:05:00.000Z")
      }
    ]
  };
}

function source(input: Partial<ObservationSourceRecord> = {}): ObservationSourceRecord {
  const createdAt = new Date("2026-06-11T06:00:00.000Z");
  return {
    id: "source_news",
    name: "News source",
    kind: "WEB_PAGE",
    url: "https://example.com/source",
    adapter: "web_page",
    credentialRef: "NEWS_KEY",
    credibility: 0.7,
    enabled: true,
    autoConfirm: true,
    autoConfirmThreshold: 0.82,
    createdAt,
    updatedAt: createdAt,
    ...input
  };
}

function observation(input: Partial<ObservationRecord> = {}): ObservationRecord {
  return {
    id: "observation_signal",
    sourceId: "source_news",
    title: "Source observation",
    content: "Observation content",
    observedAt: new Date("2026-06-11T09:00:00.000Z"),
    status: "PENDING",
    credibility: 0.7,
    metadata: {},
    ...input
  };
}

function minimalGraph(): WorldModelGraph {
  return {
    nodes: [
      {
        id: "belief_ai_agents",
        type: "belief",
        code: "B-001",
        label: "AI agents",
        status: "ACTIVE"
      }
    ],
    edges: []
  };
}

describe("world model graph view", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
  });

  it("gives embedded overview graphs a viewport-responsive canvas height", async () => {
    const { WorldModelGraphView } = await import("@/components/world-model/WorldModelGraphView");

    const html = renderToStaticMarkup(React.createElement(WorldModelGraphView, { graph: minimalGraph() }));

    expect(html).toContain("h-[clamp(640px,calc(100vh-120px),860px)]");
    expect(html).not.toContain("h-[560px]");
  });

  it("keeps workspace graph pages on the dedicated full-height canvas", async () => {
    const { WorldModelGraphView } = await import("@/components/world-model/WorldModelGraphView");

    const html = renderToStaticMarkup(React.createElement(WorldModelGraphView, { graph: minimalGraph(), mode: "workspace" }));

    expect(html).toContain("h-[calc(100vh-150px)] min-h-[640px]");
    expect(html).not.toContain("h-[clamp(640px,calc(100vh-120px),860px)]");
  });

  it("renders readable likelihood run codes in update details instead of raw run ids", async () => {
    const { UpdateEditor } = await import("@/components/world-model/WorldModelGraphView");
    const evidence = rejectedEvidenceWithLink();
    const likelihoodRun: LikelihoodRunRecord = {
      id: "likelihood_run_3d6953b9-93f3-4121-8cb5-b53cb30af9d7",
      evidenceId: evidence.id,
      hypothesisId: "hypothesis_support",
      ensembleLikelihoodRatio: 1.6,
      ensembleConfidence: 0.7,
      estimatorOutputs: [],
      modelVersion: "llm-v1",
      createdAt: new Date("2026-06-11T08:10:00.000Z")
    };
    const update: BayesianUpdateEventRecord = {
      id: "update_rejected",
      beliefId: "belief_ai_agents",
      evidenceId: evidence.id,
      likelihoodRunId: likelihoodRun.id,
      priorSnapshot: { hypothesis_support: 0.4 },
      posteriorSnapshot: { hypothesis_support: 0.55 },
      mode: "APPLIED",
      status: "APPLIED",
      confidence: 0.7,
      explanations: ["hypothesis_support: Rejected evidence can still show audit history."],
      createdAt: new Date("2026-06-11T08:15:00.000Z")
    };
    const editor = createWorldModelGraphEditorData({
      beliefs: [belief()],
      evidence: [evidence],
      updates: [update],
      likelihoodRuns: [likelihoodRun]
    });

    const html = renderToStaticMarkup(
      React.createElement(UpdateEditor, {
        editor,
        updateId: update.id,
        returnPath: "/admin/world-model/graph?update=U-001"
      })
    );

    expect(html).toContain("似然运行 L-001");
    expect(html).not.toContain(likelihoodRun.id);
  });

  it("renders all readable likelihood run codes for multi-link update details", async () => {
    const { UpdateEditor } = await import("@/components/world-model/WorldModelGraphView");
    const evidence = rejectedEvidenceWithLink();
    const likelihoodRuns: LikelihoodRunRecord[] = [
      {
        id: "likelihood_run_first_3d6953b9-93f3-4121-8cb5-b53cb30af9d7",
        evidenceId: evidence.id,
        hypothesisId: "hypothesis_support",
        ensembleLikelihoodRatio: 1.6,
        ensembleConfidence: 0.7,
        estimatorOutputs: [],
        modelVersion: "llm-v1",
        createdAt: new Date("2026-06-11T08:10:00.000Z")
      },
      {
        id: "likelihood_run_second_3d6953b9-93f3-4121-8cb5-b53cb30af9d7",
        evidenceId: evidence.id,
        hypothesisId: "hypothesis_support",
        ensembleLikelihoodRatio: 1.3,
        ensembleConfidence: 0.65,
        estimatorOutputs: [],
        modelVersion: "llm-v1",
        createdAt: new Date("2026-06-11T08:11:00.000Z")
      }
    ];
    const update: BayesianUpdateEventRecord = {
      id: "update_rejected",
      beliefId: "belief_ai_agents",
      evidenceId: evidence.id,
      likelihoodRunId: likelihoodRuns[0].id,
      likelihoodRunIds: likelihoodRuns.map((run) => run.id),
      priorSnapshot: { hypothesis_support: 0.4 },
      posteriorSnapshot: { hypothesis_support: 0.55 },
      mode: "APPLIED",
      status: "APPLIED",
      confidence: 0.7,
      explanations: ["hypothesis_support: Multi-link update can show all audit runs."],
      createdAt: new Date("2026-06-11T08:15:00.000Z")
    };
    const editor = createWorldModelGraphEditorData({
      beliefs: [belief()],
      evidence: [evidence],
      updates: [update],
      likelihoodRuns
    });

    const html = renderToStaticMarkup(
      React.createElement(UpdateEditor, {
        editor,
        updateId: update.id,
        returnPath: "/admin/world-model/graph?update=U-001"
      })
    );

    expect(html).toContain("似然运行 L-001、L-002");
    expect(html).not.toContain(likelihoodRuns[0].id);
    expect(html).not.toContain(likelihoodRuns[1].id);
  });

  it("renders a delete action for rejected evidence in the graph evidence editor", async () => {
    const { EvidenceEditor } = await import("@/components/world-model/WorldModelGraphView");
    const evidence = rejectedEvidence();
    const editor = createWorldModelGraphEditorData({
      beliefs: [belief()],
      evidence: [evidence],
      updates: []
    });

    const html = renderToStaticMarkup(
      React.createElement(EvidenceEditor, {
        editor,
        evidenceId: evidence.id,
        returnPath: "/admin/world-model/graph?evidence=E-001"
      })
    );

    expect(html).toContain("删除证据");
    expect(html).not.toContain("拒绝证据并回滚");
    expect(html).toContain('name="returnPath" value="/admin/world-model/graph?evidence=E-001"');
  });

  it("renders a delete action for active evidence in the graph evidence editor", async () => {
    const { EvidenceEditor } = await import("@/components/world-model/WorldModelGraphView");
    const evidence: EvidenceRecord = {
      ...rejectedEvidenceWithLink(),
      id: "evidence_active",
      observationId: "observation_active",
      title: "Active evidence",
      status: "ACTIVE"
    };
    const editor = createWorldModelGraphEditorData({
      beliefs: [belief()],
      evidence: [evidence],
      updates: []
    });

    const html = renderToStaticMarkup(
      React.createElement(EvidenceEditor, {
        editor,
        evidenceId: evidence.id,
        returnPath: "/admin/world-model/graph?evidence=E-001"
      })
    );

    expect(html).toContain("删除证据");
    expect(html).toContain("拒绝证据并回滚");
  });

  it("links from the graph evidence editor to the evidence page edit area", async () => {
    const { EvidenceEditor } = await import("@/components/world-model/WorldModelGraphView");
    const evidence: EvidenceRecord = {
      ...rejectedEvidenceWithLink(),
      id: "evidence_active",
      observationId: "observation_active",
      title: "Active evidence",
      status: "ACTIVE"
    };
    const editor = createWorldModelGraphEditorData({
      beliefs: [belief()],
      evidence: [evidence],
      updates: []
    });

    const html = renderToStaticMarkup(
      React.createElement(EvidenceEditor, {
        editor,
        evidenceId: evidence.id,
        returnPath: "/admin/world-model/graph?evidence=E-001"
      })
    );

    expect(html).toContain("打开证据编辑区");
    expect(html).toContain('href="/admin/world-model/evidence?evidence=E-001#E-001"');
  });

  it("renders hypothesis settlement outcome in the graph hypothesis editor", async () => {
    const { HypothesisEditor } = await import("@/components/world-model/WorldModelGraphView");
    const settledBelief = belief();
    settledBelief.hypotheses = [
      {
        ...settledBelief.hypotheses[0],
        status: "RESOLVED_FALSE",
        currentProbability: 0.74,
        resolvedOutcome: "The rollout did not improve delivery throughput."
      }
    ];
    const editor = createWorldModelGraphEditorData({
      beliefs: [settledBelief],
      evidence: [],
      updates: []
    });

    const html = renderToStaticMarkup(
      React.createElement(HypothesisEditor, {
        editor,
        hypothesisId: "hypothesis_support",
        returnPath: "/admin/world-model/graph?hypothesis=H-001"
      })
    );

    expect(html).toContain('name="resolvedOutcome"');
    expect(html).toContain("The rollout did not improve delivery throughput.");
  });

  it("allows precise hypothesis probabilities when saving status changes", async () => {
    const { HypothesisEditor } = await import("@/components/world-model/WorldModelGraphView");
    const preciseBelief = belief();
    preciseBelief.hypotheses = [
      {
        ...preciseBelief.hypotheses[0],
        priorProbability: 0.6,
        currentProbability: 0.8076923076923077
      }
    ];
    const editor = createWorldModelGraphEditorData({
      beliefs: [preciseBelief],
      evidence: [],
      updates: []
    });

    const html = renderToStaticMarkup(
      React.createElement(HypothesisEditor, {
        editor,
        hypothesisId: "hypothesis_support",
        returnPath: "/admin/world-model/graph?hypothesis=H-001"
      })
    );

    expect(html).toMatch(/<input[^>]*step="any"[^>]*name="priorProbability"/);
    expect(html).toMatch(/<input[^>]*step="any"[^>]*name="currentProbability"/);
    expect(html).toContain('value="0.8076923076923077"');
  });

  it("renders editable source configuration in the graph source editor", async () => {
    const { SourceEditor } = await import("@/components/world-model/WorldModelGraphView");
    const editor = createWorldModelGraphEditorData({
      sources: [source()],
      beliefs: [belief()],
      evidence: [],
      updates: []
    });

    const html = renderToStaticMarkup(
      React.createElement(SourceEditor, {
        editor,
        sourceId: "source_news",
        returnPath: "/admin/world-model/graph?source=S-001"
      })
    );

    expect(html).toContain('name="sourceId" value="source_news"');
    expect(html).toContain('name="returnPath" value="/admin/world-model/graph?source=S-001"');
    expect(html).toContain("News source");
    expect(html).toContain('name="autoConfirm"');
    expect(html).toContain("保存来源");
  });

  it("renders editable source assignment in the graph observation editor", async () => {
    const { ObservationEditor } = await import("@/components/world-model/WorldModelGraphView");
    const editor = createWorldModelGraphEditorData({
      sources: [
        source(),
        source({
          id: "source_other",
          name: "Other source",
          createdAt: new Date("2026-06-11T07:01:00.000Z"),
          updatedAt: new Date("2026-06-11T07:01:00.000Z")
        })
      ],
      beliefs: [belief()],
      observations: [observation()],
      evidence: [],
      updates: []
    });

    const html = renderToStaticMarkup(
      React.createElement(ObservationEditor, {
        editor,
        observationId: "observation_signal",
        returnPath: "/admin/world-model/graph?source=S-001"
      })
    );

    expect(html).toContain('name="sourceId"');
    expect(html).toContain('<option value="source_news" selected="">S-001 · News source</option>');
    expect(html).toContain('<option value="source_other">S-002 · Other source</option>');
    expect(html).toContain("保存观察");
    expect(html).toContain("拒绝观察");
    expect(html).toContain('name="observationId" value="observation_signal"');
    expect(html).toContain('name="returnPath" value="/admin/world-model/graph?source=S-001"');
    expect(html).not.toContain("作者/来源");
    expect(html).not.toContain('name="author"');
  });

  it("does not render graph observation rejection for confirmed observations", async () => {
    const { ObservationEditor } = await import("@/components/world-model/WorldModelGraphView");
    const editor = createWorldModelGraphEditorData({
      sources: [source()],
      beliefs: [belief()],
      observations: [observation({ status: "CONFIRMED" })],
      evidence: [],
      updates: []
    });

    const html = renderToStaticMarkup(
      React.createElement(ObservationEditor, {
        editor,
        observationId: "observation_signal",
        returnPath: "/admin/world-model/graph?source=S-001"
      })
    );

    expect(html).not.toContain("拒绝观察");
  });

  it("renders a source-observation graph connection as source assignment", async () => {
    const { ConnectionEditor } = await import("@/components/world-model/WorldModelGraphView");
    const editor = createWorldModelGraphEditorData({
      sources: [source()],
      beliefs: [belief()],
      observations: [observation({ sourceId: undefined })],
      evidence: [],
      updates: []
    });

    const html = renderToStaticMarkup(
      React.createElement(ConnectionEditor, {
        editor,
        connection: {
          sourceId: "source_news",
          sourceCode: "S-001",
          sourceType: "source",
          targetId: "observation_signal",
          targetCode: "O-001",
          targetType: "observation"
        },
        returnPath: "/admin/world-model/graph?source=S-001"
      })
    );

    expect(html).toContain('name="sourceId" value="source_news"');
    expect(html).toContain('name="observationId" value="observation_signal"');
    expect(html).toContain("将 O-001 归属到 S-001");
    expect(html).toContain("保存观察来源");
  });

  it("renders a collected graph edge as editable source assignment", async () => {
    const { GraphEdgeEditor } = await import("@/components/world-model/WorldModelGraphView");
    const editor = createWorldModelGraphEditorData({
      sources: [source()],
      beliefs: [belief()],
      observations: [observation({ sourceId: "source_news" })],
      evidence: [],
      updates: []
    });
    const edge: WorldModelGraphEdge = {
      id: "source:source_news:observation:observation_signal",
      source: "source_news",
      target: "observation_signal",
      relation: "COLLECTED",
      label: "采集观察",
      status: "PENDING"
    };
    const nodeById = new Map<string, WorldModelGraphNode>([
      ["source_news", { id: "source_news", type: "source", code: "S-001", label: "News source" }],
      ["observation_signal", { id: "observation_signal", type: "observation", code: "O-001", label: "Source observation" }]
    ]);

    const html = renderToStaticMarkup(
      React.createElement(GraphEdgeEditor, {
        editor,
        edge,
        nodeById,
        returnPath: "/admin/world-model/graph?source=S-001"
      })
    );

    expect(html).toContain('name="sourceId" value="source_news"');
    expect(html).toContain('name="observationId" value="observation_signal"');
    expect(html).toContain("将 O-001 归属到 S-001");
    expect(html).toContain("保存观察来源");
  });

  it("renders a confirmed-as graph edge through the evidence editor", async () => {
    const { GraphEdgeEditor } = await import("@/components/world-model/WorldModelGraphView");
    const evidence: EvidenceRecord = {
      id: "evidence_signal",
      observationId: "observation_signal",
      title: "Confirmed evidence",
      content: "Confirmed evidence content",
      confirmedAt: new Date("2026-06-11T09:10:00.000Z"),
      confirmationMode: "MANUAL",
      credibility: 0.8,
      status: "ACTIVE",
      metadata: {},
      links: [
        {
          id: "link_signal",
          evidenceId: "evidence_signal",
          hypothesisId: "hypothesis_support",
          direction: "SUPPORTS",
          relevance: 0.8,
          likelihoodRatio: 1.8,
          confidence: 0.7,
          rationale: "Confirmed edge evidence.",
          createdAt: new Date("2026-06-11T09:11:00.000Z")
        }
      ]
    };
    const editor = createWorldModelGraphEditorData({
      sources: [source()],
      beliefs: [belief()],
      observations: [observation({ status: "CONFIRMED" })],
      evidence: [evidence],
      updates: []
    });
    const edge: WorldModelGraphEdge = {
      id: "observation:observation_signal:evidence:evidence_signal",
      source: "observation_signal",
      target: "evidence_signal",
      relation: "CONFIRMED_AS",
      label: "确认为证据",
      status: "ACTIVE"
    };
    const nodeById = new Map<string, WorldModelGraphNode>([
      ["observation_signal", { id: "observation_signal", type: "observation", code: "O-001", label: "Source observation" }],
      ["evidence_signal", { id: "evidence_signal", type: "evidence", code: "E-001", label: "Confirmed evidence" }]
    ]);

    const html = renderToStaticMarkup(
      React.createElement(GraphEdgeEditor, {
        editor,
        edge,
        nodeById,
        returnPath: "/admin/world-model/graph?evidence=E-001"
      })
    );

    expect(html).toContain('name="evidenceId" value="evidence_signal"');
    expect(html).toContain('name="returnPath" value="/admin/world-model/graph?evidence=E-001"');
    expect(html).toContain("Confirmed evidence");
    expect(html).toContain("保存证据并重算");
  });

  it("renders rejected evidence links so graph edits can restore the evidence", async () => {
    const { EvidenceEditor } = await import("@/components/world-model/WorldModelGraphView");
    const evidence = rejectedEvidenceWithLink();
    const editor = createWorldModelGraphEditorData({
      beliefs: [belief()],
      evidence: [evidence],
      updates: []
    });

    const html = renderToStaticMarkup(
      React.createElement(EvidenceEditor, {
        editor,
        evidenceId: evidence.id,
        returnPath: "/admin/world-model/graph?evidence=E-001"
      })
    );

    expect(html).toContain('name="linkHypothesisIds"');
    expect(html).toContain('value="hypothesis_support"');
    expect(html).toContain("Rejected evidence can be reviewed and restored.");
    expect(html).toContain("保存证据并重算");
  });

  it("renders a graph edge disconnect action that submits only the target relation", async () => {
    const { GraphEdgeEditor } = await import("@/components/world-model/WorldModelGraphView");
    const createdAt = new Date("2026-06-11T07:00:00.000Z");
    const baseBelief = belief();
    const multiHypothesisBelief: BeliefRecord = {
      ...baseBelief,
      hypotheses: [
        ...baseBelief.hypotheses,
        {
          id: "hypothesis_risk",
          beliefId: "belief_ai_agents",
          proposition: "AI agents increase review overhead",
          notes: "",
          stance: "OPPOSES",
          priorProbability: 0.4,
          currentProbability: 0.4,
          strength: 0.4,
          status: "ACTIVE",
          createdAt,
          updatedAt: createdAt
        }
      ]
    };
    const evidence: EvidenceRecord = {
      id: "evidence_signal",
      observationId: "observation_signal",
      title: "Multi-link evidence",
      content: "The same evidence affects two hypotheses differently.",
      confirmedAt: new Date("2026-06-11T09:10:00.000Z"),
      confirmationMode: "MANUAL",
      credibility: 0.8,
      status: "ACTIVE",
      metadata: {},
      links: [
        {
          id: "link_support",
          evidenceId: "evidence_signal",
          hypothesisId: "hypothesis_support",
          direction: "SUPPORTS",
          relevance: 0.8,
          likelihoodRatio: 1.8,
          confidence: 0.7,
          rationale: "Delivery support link.",
          createdAt: new Date("2026-06-11T09:11:00.000Z")
        },
        {
          id: "link_risk",
          evidenceId: "evidence_signal",
          hypothesisId: "hypothesis_risk",
          direction: "OPPOSES",
          relevance: 0.65,
          likelihoodRatio: 0.7,
          confidence: 0.6,
          rationale: "Review overhead link.",
          createdAt: new Date("2026-06-11T09:12:00.000Z")
        }
      ]
    };
    const editor = createWorldModelGraphEditorData({
      beliefs: [multiHypothesisBelief],
      evidence: [evidence],
      updates: []
    });
    const edge: WorldModelGraphEdge = {
      id: "evidence:evidence_signal:hypothesis:hypothesis_support",
      source: "evidence_signal",
      target: "hypothesis_support",
      relation: "INFLUENCES",
      label: "影响假设",
      status: "APPLIED"
    };
    const nodeById = new Map<string, WorldModelGraphNode>([
      ["evidence_signal", { id: "evidence_signal", type: "evidence", code: "E-001", label: "Multi-link evidence" }],
      ["hypothesis_support", { id: "hypothesis_support", type: "hypothesis", code: "H-001", label: "AI agents improve delivery" }]
    ]);

    const html = renderToStaticMarkup(
      React.createElement(GraphEdgeEditor, {
        editor,
        edge,
        nodeById,
        returnPath: "/admin/world-model/graph?evidence=E-001"
      })
    );
    const disconnectForm = html.match(/<form[^>]*data-evidence-edge-disconnect="true"[\s\S]*?<\/form>/)?.[0] ?? "";

    expect(html).toContain("保存关系并重算");
    expect(disconnectForm).toContain("断开关系并重算");
    expect(disconnectForm).toContain('name="evidenceId" value="evidence_signal"');
    expect(disconnectForm).toContain('name="hypothesisId" value="hypothesis_support"');
    expect(disconnectForm).not.toContain('name="linkHypothesisIds"');
    expect(disconnectForm).not.toContain("hypothesis_risk");
  });

  it("does not render an observation confirmation action when a graph connection targets an inactive hypothesis", async () => {
    const { ConnectionEditor } = await import("@/components/world-model/WorldModelGraphView");
    const pausedBelief = belief();
    pausedBelief.hypotheses = [
      {
        ...pausedBelief.hypotheses[0],
        id: "hypothesis_paused",
        proposition: "Paused hypothesis",
        status: "PAUSED"
      }
    ];
    const editor = createWorldModelGraphEditorData({
      beliefs: [pausedBelief],
      observations: [
        {
          id: "observation_signal",
          title: "Signal",
          content: "Signal content",
          observedAt: new Date("2026-06-11T09:00:00.000Z"),
          status: "PENDING",
          credibility: 0.7,
          metadata: {}
        }
      ],
      evidence: [],
      updates: []
    });

    const html = renderToStaticMarkup(
      React.createElement(ConnectionEditor, {
        editor,
        connection: {
          sourceId: "observation_signal",
          sourceCode: "O-001",
          sourceType: "observation",
          targetId: "hypothesis_paused",
          targetCode: "H-001",
          targetType: "hypothesis"
        },
        returnPath: "/admin/world-model/graph"
      })
    );

    expect(html).toContain("没有当前有效假设可确认");
    expect(html).not.toContain("确认为证据并更新");
  });
});
