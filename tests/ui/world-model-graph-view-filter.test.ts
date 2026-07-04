// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";
import { createWorldModelGraphEditorData } from "@/lib/world-model-graph-editor";
import type { WorldModelGraph } from "@/lib/world-model-graph";
import type {
  BayesianUpdateEventRecord,
  BeliefRecord,
  EvidenceRecord,
  ObservationRecord,
  ObservationSourceRecord
} from "@/server/services/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@xyflow/react", async () => {
  const ReactModule = await import("react");
  return {
    Background: () => ReactModule.createElement("div", { "data-testid": "graph-background" }),
    PanOnScrollMode: { Vertical: "vertical" },
    ReactFlow: ({
      children,
      nodes,
      edges,
      onNodeClick
    }: {
      children?: React.ReactNode;
      nodes: Array<{ id: string; data: { domainId: string; label: string } }>;
      edges: Array<{ id: string; data?: { edgeId: string; fullLabel: string } }>;
      onNodeClick?: (event: React.MouseEvent<HTMLButtonElement>, node: { id: string; data: { domainId: string; label: string } }) => void;
    }) =>
      ReactModule.createElement(
        "div",
        { "data-testid": "react-flow" },
        nodes.map((node) =>
          ReactModule.createElement(
            "button",
            {
              key: node.id,
              type: "button",
              "data-node-id": node.data.domainId,
              onClick: (event: React.MouseEvent<HTMLButtonElement>) => onNodeClick?.(event, node)
            },
            node.data.label
          )
        ),
        edges.map((edge) =>
          ReactModule.createElement(
            "div",
            { key: edge.id, "data-edge-id": edge.data?.edgeId ?? edge.id },
            edge.data?.fullLabel ?? edge.id
          )
        ),
        children
      ),
    applyNodeChanges: (_changes: unknown, nodes: unknown) => nodes
  };
});

vi.mock("@/app/admin/world-model/actions", () => ({
  confirmGraphObservationAction: vi.fn(),
  connectEvidenceHypothesisAction: vi.fn(),
  connectObservationHypothesisAction: vi.fn(),
  connectSourceObservationAction: vi.fn(),
  disconnectEvidenceHypothesisAction: vi.fn(),
  updateBeliefAction: vi.fn(),
  rollbackUpdateAction: vi.fn(),
  updateEvidenceAction: vi.fn(),
  updateGraphObservationAction: vi.fn(),
  updateHypothesisAction: vi.fn(),
  updateSourceAction: vi.fn(),
  rejectEvidenceAction: vi.fn(),
  deleteEvidenceAction: vi.fn()
}));

function source(input: Partial<ObservationSourceRecord> = {}): ObservationSourceRecord {
  const createdAt = new Date("2026-06-11T06:00:00.000Z");
  return {
    id: "source_news",
    name: "News source",
    kind: "WEB_PAGE",
    url: "https://example.com/source",
    adapter: "web_page",
    credentialRef: undefined,
    credibility: 0.7,
    enabled: true,
    autoConfirm: false,
    autoConfirmThreshold: 0.85,
    createdAt,
    updatedAt: createdAt,
    ...input
  };
}

function belief(): BeliefRecord {
  const createdAt = new Date("2026-06-11T07:00:00.000Z");
  return {
    id: "belief_ai_agents",
    title: "AI agents",
    category: "AI_TREND",
    description: "",
    probabilityMode: "INDEPENDENT",
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
        currentProbability: 0.55,
        strength: 0.55,
        status: "ACTIVE",
        createdAt,
        updatedAt: createdAt
      },
      {
        id: "hypothesis_risk",
        beliefId: "belief_ai_agents",
        proposition: "AI agents increase review overhead",
        notes: "",
        stance: "OPPOSES",
        priorProbability: 0.4,
        currentProbability: 0.35,
        strength: 0.35,
        status: "ACTIVE",
        createdAt: new Date("2026-06-11T07:01:00.000Z"),
        updatedAt: createdAt
      }
    ]
  };
}

function observation(input: Partial<ObservationRecord> = {}): ObservationRecord {
  return {
    id: "observation_signal",
    sourceId: "source_news",
    title: "Source observation",
    content: "Observation content",
    observedAt: new Date("2026-06-11T08:00:00.000Z"),
    status: "CONFIRMED",
    credibility: 0.75,
    metadata: {},
    ...input
  };
}

function evidence(): EvidenceRecord {
  return {
    id: "evidence_signal",
    observationId: "observation_signal",
    title: "Confirmed evidence",
    content: "Confirmed evidence content",
    confirmedAt: new Date("2026-06-11T08:05:00.000Z"),
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
        rationale: "Signal supports delivery.",
        createdAt: new Date("2026-06-11T08:06:00.000Z")
      }
    ]
  };
}

function update(): BayesianUpdateEventRecord {
  return {
    id: "update_signal",
    beliefId: "belief_ai_agents",
    evidenceId: "evidence_signal",
    priorSnapshot: { hypothesis_support: 0.4 },
    posteriorSnapshot: { hypothesis_support: 0.55 },
    mode: "APPLIED",
    status: "APPLIED",
    confidence: 0.7,
    explanations: [],
    createdAt: new Date("2026-06-11T08:10:00.000Z")
  };
}

function graph(): WorldModelGraph {
  return {
    nodes: [
      { id: "source_news", type: "source", code: "S-001", label: "News source", status: "ENABLED" },
      { id: "source_other", type: "source", code: "S-002", label: "Other source", status: "ENABLED" },
      { id: "belief_ai_agents", type: "belief", code: "B-001", label: "AI agents", status: "ACTIVE" },
      { id: "hypothesis_support", type: "hypothesis", code: "H-001", label: "AI agents improve delivery", status: "ACTIVE" },
      { id: "hypothesis_risk", type: "hypothesis", code: "H-002", label: "AI agents increase review overhead", status: "ACTIVE" },
      { id: "observation_signal", type: "observation", code: "O-001", label: "Source observation", status: "CONFIRMED" },
      { id: "observation_other", type: "observation", code: "O-002", label: "Other observation", status: "PENDING" },
      { id: "evidence_signal", type: "evidence", code: "E-001", label: "Confirmed evidence", status: "ACTIVE" },
      { id: "update_signal", type: "update", code: "U-001", label: "APPLIED", status: "APPLIED" }
    ],
    edges: [
      { id: "source:source_news:observation:observation_signal", source: "source_news", target: "observation_signal", relation: "COLLECTED", label: "采集观察" },
      { id: "source:source_other:observation:observation_other", source: "source_other", target: "observation_other", relation: "COLLECTED", label: "采集观察" },
      { id: "belief:belief_ai_agents:hypothesis:hypothesis_support", source: "belief_ai_agents", target: "hypothesis_support", relation: "OWNS", label: "包含" },
      { id: "belief:belief_ai_agents:hypothesis:hypothesis_risk", source: "belief_ai_agents", target: "hypothesis_risk", relation: "OWNS", label: "包含" },
      { id: "observation:observation_signal:evidence:evidence_signal", source: "observation_signal", target: "evidence_signal", relation: "CONFIRMED_AS", label: "确认为证据" },
      { id: "evidence:evidence_signal:hypothesis:hypothesis_support", source: "evidence_signal", target: "hypothesis_support", relation: "INFLUENCES", label: "影响假设" },
      { id: "evidence:evidence_signal:update:update_signal", source: "evidence_signal", target: "update_signal", relation: "PRODUCED", label: "产生更新" },
      { id: "update:update_signal:belief:belief_ai_agents", source: "update_signal", target: "belief_ai_agents", relation: "UPDATED", label: "更新信念" }
    ]
  };
}

function click(element: Element) {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("world model graph local filtering", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("filters the canvas to nodes related to the selected hypothesis and can show all again", async () => {
    const { WorldModelGraphView } = await import("@/components/world-model/WorldModelGraphView");
    const baseBelief = belief();
    const graphEditor = createWorldModelGraphEditorData({
      sources: [source(), source({ id: "source_other", name: "Other source", createdAt: new Date("2026-06-11T06:01:00.000Z") })],
      beliefs: [baseBelief],
      observations: [observation(), observation({ id: "observation_other", sourceId: "source_other", title: "Other observation" })],
      evidence: [evidence()],
      updates: [update()]
    });

    await act(async () => {
      root.render(React.createElement(WorldModelGraphView, { graph: graph(), editor: graphEditor }));
    });

    expect(container.textContent).toContain("H-002");
    expect(container.textContent).toContain("Other source");

    const hypothesisNode = container.querySelector('[data-node-id="hypothesis_support"]');
    expect(hypothesisNode).toBeTruthy();
    await act(async () => {
      click(hypothesisNode as Element);
    });

    const filterButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "只看相关");
    expect(filterButton).toBeTruthy();
    await act(async () => {
      click(filterButton as Element);
    });

    expect(container.textContent).toContain("B-001");
    expect(container.textContent).toContain("H-001");
    expect(container.textContent).toContain("O-001");
    expect(container.textContent).toContain("E-001");
    expect(container.textContent).toContain("U-001");
    expect(container.textContent).toContain("News source");
    expect(container.textContent).not.toContain("H-002");
    expect(container.textContent).not.toContain("Other source");

    const clearButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "显示全部");
    expect(clearButton).toBeTruthy();
    await act(async () => {
      click(clearButton as Element);
    });

    expect(container.textContent).toContain("H-002");
    expect(container.textContent).toContain("Other source");
  });
});
