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
  WorldModelGraphView: ({
    graph,
    returnPath,
    initialSelection
  }: {
    graph: { nodes: Array<{ id: string; label: string }> };
    returnPath: string;
    initialSelection?: { nodeId?: string };
  }) =>
    React.createElement(
      "section",
      { "data-testid": "world-model-graph" },
      [
        React.createElement("div", { key: "return-path" }, `return:${returnPath}`),
        React.createElement("div", { key: "initial-selection" }, `selected:${initialSelection?.nodeId ?? ""}`),
        ...graph.nodes.map((node) => React.createElement("div", { key: node.id }, node.label))
      ]
    )
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

function belief(input: Partial<BeliefRecord> = {}): BeliefRecord {
  const createdAt = new Date("2026-06-11T07:00:00.000Z");
  return {
    id: "belief_focus",
    title: "Focused belief",
    category: "AI_TREND",
    description: "",
    probabilityMode: "INDEPENDENT",
    status: "ACTIVE",
    createdAt,
    updatedAt: createdAt,
    hypotheses: [
      {
        id: "hypothesis_focus",
        beliefId: "belief_focus",
        proposition: "Focused hypothesis",
        notes: "",
        stance: "SUPPORTS",
        priorProbability: 0.45,
        currentProbability: 0.55,
        strength: 0.55,
        status: "ACTIVE",
        createdAt,
        updatedAt: createdAt
      }
    ],
    ...input
  };
}

function source(input: Partial<ObservationSourceRecord> = {}): ObservationSourceRecord {
  const createdAt = new Date("2026-06-11T06:00:00.000Z");
  return {
    id: "source_focus",
    name: "Focused source",
    kind: "WEB_PAGE",
    adapter: "web_page",
    credibility: 0.75,
    enabled: true,
    autoConfirm: true,
    autoConfirmThreshold: 0.8,
    createdAt,
    updatedAt: createdAt,
    ...input
  };
}

describe("world model graph page", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    loadWorldModelData.mockReset();
  });

  it("focuses the graph workspace by a human-readable belief code", async () => {
    const createdAt = new Date("2026-06-11T07:00:00.000Z");
    const focusedBelief = belief();
    const otherBelief = belief({
      id: "belief_other",
      title: "Other belief",
      createdAt: new Date("2026-06-11T07:01:00.000Z"),
      hypotheses: [
        {
          ...focusedBelief.hypotheses[0],
          id: "hypothesis_other",
          beliefId: "belief_other",
          proposition: "Other hypothesis",
          createdAt: new Date("2026-06-11T07:02:00.000Z"),
          updatedAt: new Date("2026-06-11T07:02:00.000Z")
        }
      ]
    });
    const observation: ObservationRecord = {
      id: "observation_focus",
      title: "Focused observation",
      content: "Observation connected to the focused hypothesis.",
      observedAt: new Date("2026-06-11T08:00:00.000Z"),
      status: "PENDING",
      credibility: 0.75,
      metadata: {
        recommendedLinks: [
          {
            hypothesisId: "hypothesis_focus",
            direction: "SUPPORTS",
            relevance: 0.8,
            likelihoodRatio: 1.8
          }
        ]
      }
    };
    const evidence: EvidenceRecord = {
      id: "evidence_cross",
      observationId: "observation_focus",
      title: "Cross belief evidence",
      content: "Evidence connected to multiple beliefs.",
      confirmedAt: new Date("2026-06-11T08:10:00.000Z"),
      confirmationMode: "AUTO",
      credibility: 0.8,
      status: "ACTIVE",
      metadata: {},
      links: [
        {
          id: "link_focus",
          evidenceId: "evidence_cross",
          hypothesisId: "hypothesis_focus",
          direction: "SUPPORTS",
          relevance: 0.85,
          likelihoodRatio: 2.1,
          confidence: 0.7,
          rationale: "Focused link.",
          createdAt
        },
        {
          id: "link_other",
          evidenceId: "evidence_cross",
          hypothesisId: "hypothesis_other",
          direction: "OPPOSES",
          relevance: 0.4,
          likelihoodRatio: 0.8,
          confidence: 0.5,
          rationale: "Other link.",
          createdAt
        }
      ]
    };
    const update: BayesianUpdateEventRecord = {
      id: "update_focus",
      beliefId: "belief_focus",
      evidenceId: "evidence_cross",
      priorSnapshot: { hypothesis_focus: 0.45 },
      posteriorSnapshot: { hypothesis_focus: 0.55 },
      mode: "APPLIED",
      status: "APPLIED",
      confidence: 0.7,
      explanations: [],
      createdAt
    };
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      beliefs: [focusedBelief, otherBelief],
      observations: [observation],
      evidence: [evidence],
      updates: [update]
    });
    const { default: GraphPage } = await import("@/app/admin/world-model/graph/page");

    const html = renderToStaticMarkup(await GraphPage({ searchParams: Promise.resolve({ belief: "B-001" }) }));
    const graphHtml = html.slice(html.indexOf('<section data-testid="world-model-graph"'));

    expect(html).toContain("证据影响图谱 · Focused belief");
    expect(graphHtml).toContain("Focused hypothesis");
    expect(graphHtml).toContain("Cross belief evidence");
    expect(graphHtml).not.toContain("Other belief");
    expect(graphHtml).not.toContain("Other hypothesis");
    expect(html).toContain('href="/admin/world-model/graph"');
    expect(html).toContain('href="/admin/world-model/graph?belief=B-001"');
    expect(html).toContain("return:/admin/world-model/graph?belief=B-001");
    expect(html).toContain("selected:belief_focus");
  });

  it("focuses and selects a source by a human-readable source code", async () => {
    const createdAt = new Date("2026-06-11T07:00:00.000Z");
    const focusedBelief = belief();
    const focusedSource = source();
    const otherSource = source({
      id: "source_other",
      name: "Other source",
      createdAt: new Date("2026-06-11T06:01:00.000Z"),
      updatedAt: new Date("2026-06-11T06:01:00.000Z")
    });
    const focusedObservation: ObservationRecord = {
      id: "observation_focus",
      sourceId: "source_focus",
      title: "Focused source observation",
      content: "Observation collected from the focused source.",
      observedAt: new Date("2026-06-11T08:00:00.000Z"),
      status: "CONFIRMED",
      credibility: 0.75,
      metadata: {}
    };
    const otherObservation: ObservationRecord = {
      ...focusedObservation,
      id: "observation_other",
      sourceId: "source_other",
      title: "Other source observation"
    };
    const focusedEvidence: EvidenceRecord = {
      id: "evidence_focus",
      observationId: "observation_focus",
      title: "Focused source evidence",
      content: "Evidence confirmed from the focused source.",
      confirmedAt: new Date("2026-06-11T08:10:00.000Z"),
      confirmationMode: "AUTO",
      credibility: 0.8,
      status: "ACTIVE",
      metadata: {},
      links: [
        {
          id: "link_focus",
          evidenceId: "evidence_focus",
          hypothesisId: "hypothesis_focus",
          direction: "SUPPORTS",
          relevance: 0.85,
          likelihoodRatio: 2.1,
          confidence: 0.7,
          rationale: "Focused link.",
          createdAt
        }
      ]
    };
    const otherEvidence: EvidenceRecord = {
      ...focusedEvidence,
      id: "evidence_other",
      observationId: "observation_other",
      title: "Other source evidence"
    };
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      sources: [focusedSource, otherSource],
      beliefs: [focusedBelief],
      observations: [focusedObservation, otherObservation],
      evidence: [focusedEvidence, otherEvidence]
    });
    const { default: GraphPage } = await import("@/app/admin/world-model/graph/page");

    const html = renderToStaticMarkup(await GraphPage({ searchParams: Promise.resolve({ source: "S-001" }) }));
    const graphHtml = html.slice(html.indexOf('<section data-testid="world-model-graph"'));

    expect(html).toContain("证据影响图谱 · S-001 · Focused source");
    expect(graphHtml).toContain("Focused source");
    expect(graphHtml).toContain("Focused source observation");
    expect(graphHtml).toContain("Focused source evidence");
    expect(graphHtml).not.toContain("Other source");
    expect(graphHtml).not.toContain("Other source evidence");
    expect(html).toContain('href="/admin/world-model/graph?source=S-001"');
    expect(html).toContain("return:/admin/world-model/graph?source=S-001");
    expect(html).toContain("selected:source_focus");
  });

  it("focuses the graph workspace by a human-readable update code", async () => {
    const createdAt = new Date("2026-06-11T07:00:00.000Z");
    const focusedBelief = belief();
    const otherBelief = belief({
      id: "belief_other",
      title: "Other belief",
      createdAt: new Date("2026-06-11T07:01:00.000Z"),
      hypotheses: [
        {
          ...focusedBelief.hypotheses[0],
          id: "hypothesis_other",
          beliefId: "belief_other",
          proposition: "Other hypothesis",
          createdAt: new Date("2026-06-11T07:02:00.000Z"),
          updatedAt: new Date("2026-06-11T07:02:00.000Z")
        }
      ]
    });
    const evidence: EvidenceRecord = {
      id: "evidence_shared",
      observationId: "observation_shared",
      title: "Shared evidence",
      content: "Evidence connected to multiple beliefs.",
      confirmedAt: new Date("2026-06-11T08:10:00.000Z"),
      confirmationMode: "AUTO",
      credibility: 0.8,
      status: "ACTIVE",
      metadata: {},
      links: [
        {
          id: "link_focus",
          evidenceId: "evidence_shared",
          hypothesisId: "hypothesis_focus",
          direction: "SUPPORTS",
          relevance: 0.85,
          likelihoodRatio: 2.1,
          confidence: 0.7,
          rationale: "Focused link.",
          createdAt
        },
        {
          id: "link_other",
          evidenceId: "evidence_shared",
          hypothesisId: "hypothesis_other",
          direction: "OPPOSES",
          relevance: 0.4,
          likelihoodRatio: 0.8,
          confidence: 0.5,
          rationale: "Other link.",
          createdAt
        }
      ]
    };
    const update: BayesianUpdateEventRecord = {
      id: "update_focus",
      beliefId: "belief_focus",
      evidenceId: "evidence_shared",
      priorSnapshot: { hypothesis_focus: 0.45 },
      posteriorSnapshot: { hypothesis_focus: 0.55 },
      mode: "APPLIED",
      status: "APPLIED",
      confidence: 0.7,
      explanations: [],
      createdAt: new Date("2026-06-11T09:00:00.000Z")
    };
    const otherUpdate: BayesianUpdateEventRecord = {
      ...update,
      id: "update_other",
      beliefId: "belief_other",
      priorSnapshot: { hypothesis_other: 0.35 },
      posteriorSnapshot: { hypothesis_other: 0.2 },
      createdAt: new Date("2026-06-11T09:01:00.000Z")
    };
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      beliefs: [focusedBelief, otherBelief],
      evidence: [evidence],
      updates: [update, otherUpdate]
    });
    const { default: GraphPage } = await import("@/app/admin/world-model/graph/page");

    const html = renderToStaticMarkup(await GraphPage({ searchParams: Promise.resolve({ update: "U-001" }) }));
    const graphHtml = html.slice(html.indexOf('<section data-testid="world-model-graph"'));

    expect(html).toContain("证据影响图谱 · U-001");
    expect(graphHtml).toContain("Focused hypothesis");
    expect(graphHtml).toContain("Shared evidence");
    expect(graphHtml).toContain("APPLIED");
    expect(graphHtml).not.toContain("Other belief");
    expect(graphHtml).not.toContain("Other hypothesis");
    expect(html).toContain("return:/admin/world-model/graph?update=U-001");
    expect(html).toContain("selected:update_focus");
  });

  it("focuses and selects evidence by a human-readable evidence code", async () => {
    const focusedBelief = belief();
    const evidence: EvidenceRecord = {
      id: "evidence_focus",
      observationId: "observation_focus",
      title: "Focused evidence",
      content: "Evidence selected from a review link.",
      confirmedAt: new Date("2026-06-11T08:10:00.000Z"),
      confirmationMode: "AUTO",
      credibility: 0.8,
      status: "ACTIVE",
      metadata: {},
      links: [
        {
          id: "link_focus",
          evidenceId: "evidence_focus",
          hypothesisId: "hypothesis_focus",
          direction: "SUPPORTS",
          relevance: 0.85,
          likelihoodRatio: 2.1,
          confidence: 0.7,
          rationale: "Focused link.",
          createdAt: new Date("2026-06-11T07:00:00.000Z")
        }
      ]
    };
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      beliefs: [focusedBelief],
      evidence: [evidence]
    });
    const { default: GraphPage } = await import("@/app/admin/world-model/graph/page");

    const html = renderToStaticMarkup(await GraphPage({ searchParams: Promise.resolve({ evidence: "E-001" }) }));
    const graphHtml = html.slice(html.indexOf('<section data-testid="world-model-graph"'));

    expect(html).toContain("证据影响图谱 · E-001");
    expect(graphHtml).toContain("Focused evidence");
    expect(html).toContain("return:/admin/world-model/graph?evidence=E-001");
    expect(html).toContain("selected:evidence_focus");
  });

  it("focuses and selects a hypothesis by a human-readable hypothesis code", async () => {
    const createdAt = new Date("2026-06-11T07:00:00.000Z");
    const focusedBelief = belief({
      hypotheses: [
        {
          id: "hypothesis_focus",
          beliefId: "belief_focus",
          proposition: "Focused hypothesis",
          notes: "",
          stance: "SUPPORTS",
          priorProbability: 0.45,
          currentProbability: 0.55,
          strength: 0.55,
          status: "ACTIVE",
          createdAt,
          updatedAt: createdAt
        },
        {
          id: "hypothesis_sibling",
          beliefId: "belief_focus",
          proposition: "Sibling hypothesis",
          notes: "",
          stance: "OPPOSES",
          priorProbability: 0.35,
          currentProbability: 0.35,
          strength: 0.35,
          status: "ACTIVE",
          createdAt: new Date("2026-06-11T07:01:00.000Z"),
          updatedAt: new Date("2026-06-11T07:01:00.000Z")
        }
      ]
    });
    const evidence: EvidenceRecord = {
      id: "evidence_shared",
      observationId: "observation_shared",
      title: "Shared evidence",
      content: "Evidence linked to two hypotheses.",
      confirmedAt: new Date("2026-06-11T08:10:00.000Z"),
      confirmationMode: "AUTO",
      credibility: 0.8,
      status: "ACTIVE",
      metadata: {},
      links: [
        {
          id: "link_focus",
          evidenceId: "evidence_shared",
          hypothesisId: "hypothesis_focus",
          direction: "SUPPORTS",
          relevance: 0.85,
          likelihoodRatio: 2.1,
          confidence: 0.7,
          rationale: "Focused link.",
          createdAt
        },
        {
          id: "link_sibling",
          evidenceId: "evidence_shared",
          hypothesisId: "hypothesis_sibling",
          direction: "OPPOSES",
          relevance: 0.4,
          likelihoodRatio: 0.8,
          confidence: 0.5,
          rationale: "Sibling link.",
          createdAt
        }
      ]
    };
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      beliefs: [focusedBelief],
      evidence: [evidence]
    });
    const { default: GraphPage } = await import("@/app/admin/world-model/graph/page");

    const html = renderToStaticMarkup(await GraphPage({ searchParams: Promise.resolve({ hypothesis: "H-001" }) }));
    const graphHtml = html.slice(html.indexOf('<section data-testid="world-model-graph"'));

    expect(html).toContain("证据影响图谱 · H-001");
    expect(graphHtml).toContain("Focused hypothesis");
    expect(graphHtml).toContain("Shared evidence");
    expect(graphHtml).not.toContain("Sibling hypothesis");
    expect(html).toContain("return:/admin/world-model/graph?hypothesis=H-001");
    expect(html).toContain("selected:hypothesis_focus");
    expect(html).toMatch(/class="[^"]*border-moss bg-moss text-white[^"]*" href="\/admin\/world-model\/graph\?belief=B-001"/);
    expect(html).not.toMatch(/class="[^"]*border-moss bg-moss text-white[^"]*" href="\/admin\/world-model\/graph">全部图谱/);
  });

  it("shows operation messages returned from graph workspace actions", async () => {
    loadWorldModelData.mockResolvedValue(emptyWorldModelData());
    const { default: GraphPage } = await import("@/app/admin/world-model/graph/page");

    const html = renderToStaticMarkup(
      await GraphPage({
        searchParams: Promise.resolve({
          message: "图谱连接已保存并重新应用",
          error: "请选择一条观察，并至少勾选一个关联假设。"
        })
      })
    );

    expect(html).toContain("图谱连接已保存并重新应用");
    expect(html).toContain("请选择一条观察，并至少勾选一个关联假设。");
    expect(html).toContain("操作结果");
    expect(html).toContain("操作失败");
    expect(html).toContain('role="status"');
  });
});
