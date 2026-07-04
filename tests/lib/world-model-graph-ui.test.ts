import {
  createCompactGraphEdgeDisplay,
  createGraphInitialSelection,
  createGraphInteractionOptions,
  createGraphNodeVisualStyle,
  createGraphViewportOptions,
  graphInteractionOptions
} from "@/lib/world-model-graph-ui";

describe("world model graph interaction", () => {
  it("uses wheel input for vertical movement and ctrl-wheel for zooming the graph", () => {
    expect(graphInteractionOptions).toMatchObject({
      zoomOnScroll: false,
      zoomActivationKeyCode: "Control",
      zoomOnDoubleClick: false,
      zoomOnPinch: true,
      panOnScroll: true,
      panOnScrollMode: "vertical"
    });
  });

  it("does not capture wheel input in embedded graphs until the canvas is activated", () => {
    expect(createGraphInteractionOptions({ mode: "embedded", panActivated: false })).toMatchObject({
      zoomOnScroll: false,
      zoomActivationKeyCode: "Control",
      zoomOnPinch: true,
      preventScrolling: false,
      panOnScroll: false,
      panOnScrollMode: "vertical"
    });
    expect(createGraphInteractionOptions({ mode: "embedded", panActivated: true })).toMatchObject({
      zoomOnScroll: false,
      zoomActivationKeyCode: "Control",
      zoomOnPinch: true,
      preventScrolling: true,
      panOnScroll: true,
      panOnScrollMode: "vertical"
    });
  });

  it("keeps workspace graphs ready for wheel panning without a separate activation click", () => {
    expect(createGraphInteractionOptions({ mode: "workspace", panActivated: false })).toMatchObject({
      zoomOnScroll: false,
      zoomActivationKeyCode: "Control",
      zoomOnPinch: true,
      preventScrolling: true,
      panOnScroll: true,
      panOnScrollMode: "vertical"
    });
  });

  it("opens large embedded graphs as a readable overview instead of cropping the right-side lanes", () => {
    expect(createGraphViewportOptions({ mode: "embedded", nodeCount: 28 })).toEqual({
      fitView: false,
      defaultViewport: { x: 0, y: 0, zoom: 0.72 }
    });
  });

  it("keeps large workspace graphs readable while showing more relationship lanes", () => {
    expect(createGraphViewportOptions({ mode: "workspace", nodeCount: 28 })).toEqual({
      fitView: false,
      defaultViewport: { x: 0, y: 0, zoom: 0.82 }
    });
  });

  it("still fits small graphs into the available canvas", () => {
    expect(createGraphViewportOptions({ mode: "workspace", nodeCount: 8 })).toEqual({
      fitView: true,
      fitViewOptions: { padding: 0.18, maxZoom: 1 }
    });
  });

  it("uses compact edge labels on the canvas while retaining the full relationship label", () => {
    expect(
      createCompactGraphEdgeDisplay({
        relation: "COLLECTED",
        label: "采集观察"
      })
    ).toEqual({
      label: "采集观察",
      fullLabel: "采集观察"
    });

    expect(
      createCompactGraphEdgeDisplay({
        relation: "CONFIRMED_AS",
        label: "确认为证据"
      })
    ).toEqual({
      label: "确认为证据",
      fullLabel: "确认为证据"
    });

    expect(
      createCompactGraphEdgeDisplay({
        relation: "SETTLED",
        label: "结算为未发生",
        status: "SETTLED"
      })
    ).toEqual({
      label: "结算为未发生",
      fullLabel: "结算为未发生"
    });

    expect(
      createCompactGraphEdgeDisplay({
        relation: "CANDIDATE",
        direction: "SUPPORTS",
        likelihoodRatio: 1.8,
        label: "SUPPORTS · 候选相关性 0.80 · LR 1.80"
      })
    ).toEqual({
      label: "候选 · 支持 · LR 1.80",
      fullLabel: "SUPPORTS · 候选相关性 0.80 · LR 1.80"
    });

    expect(
      createCompactGraphEdgeDisplay({
        relation: "INFLUENCES",
        direction: "OPPOSES",
        likelihoodRatio: 0.7,
        status: "REJECTED",
        label: "已拒绝 · OPPOSES · 相关性 0.50 · LR 0.70"
      })
    ).toEqual({
      label: "已拒绝 · 反对 · LR 0.70",
      fullLabel: "已拒绝 · OPPOSES · 相关性 0.50 · LR 0.70"
    });

    expect(
      createCompactGraphEdgeDisplay({
        relation: "UPDATED",
        label: "更新信念 · H-001 +13.0pp"
      })
    ).toEqual({
      label: "更新 · H-001 +13.0pp",
      fullLabel: "更新信念 · H-001 +13.0pp"
    });
  });

  it("hides noisy evidence labels on dense graphs while keeping update labels visible", () => {
    expect(
      createCompactGraphEdgeDisplay(
        {
          relation: "COLLECTED",
          label: "采集观察"
        },
        { dense: true }
      )
    ).toEqual({
      label: undefined,
      fullLabel: "采集观察"
    });

    expect(
      createCompactGraphEdgeDisplay(
        {
          relation: "OWNS",
          label: "包含"
        },
        { dense: true }
      )
    ).toEqual({
      label: undefined,
      fullLabel: "包含"
    });

    expect(
      createCompactGraphEdgeDisplay(
        {
          relation: "CONFIRMED_AS",
          label: "确认为证据"
        },
        { dense: true }
      )
    ).toEqual({
      label: undefined,
      fullLabel: "确认为证据"
    });

    expect(
      createCompactGraphEdgeDisplay(
        {
          relation: "PRODUCED",
          label: "产生更新"
        },
        { dense: true }
      )
    ).toEqual({
      label: undefined,
      fullLabel: "产生更新"
    });

    expect(
      createCompactGraphEdgeDisplay(
        {
          relation: "CANDIDATE",
          direction: "SUPPORTS",
          likelihoodRatio: 2.5,
          label: "SUPPORTS · 候选相关性 0.80 · LR 2.50"
        },
        { dense: true }
      )
    ).toEqual({
      label: undefined,
      fullLabel: "SUPPORTS · 候选相关性 0.80 · LR 2.50"
    });

    expect(
      createCompactGraphEdgeDisplay(
        {
          relation: "INFLUENCES",
          direction: "OPPOSES",
          likelihoodRatio: 0.3,
          label: "OPPOSES · 相关性 0.70 · LR 0.30"
        },
        { dense: true }
      )
    ).toEqual({
      label: undefined,
      fullLabel: "OPPOSES · 相关性 0.70 · LR 0.30"
    });

    expect(
      createCompactGraphEdgeDisplay(
        {
          relation: "UPDATED",
          label: "更新信念 · H-001 +13.0pp"
        },
        { dense: true }
      )
    ).toEqual({
      label: "更新 · H-001 +13.0pp",
      fullLabel: "更新信念 · H-001 +13.0pp"
    });
  });

  it("keeps a valid focused graph node selected for the details panel", () => {
    expect(
      createGraphInitialSelection(
        [
          { id: "belief_1", code: "B-001" },
          { id: "update_1", code: "U-001" }
        ],
        { nodeId: "update_1" }
      )
    ).toEqual({ nodeId: "update_1" });
  });

  it("ignores missing focused nodes instead of selecting stale route state", () => {
    expect(createGraphInitialSelection([{ id: "belief_1", code: "B-001" }], { nodeId: "update_missing" })).toEqual({
      nodeId: "belief_1"
    });
    expect(createGraphInitialSelection([{ id: "belief_1", code: "B-001", type: "belief" }])).toEqual({ nodeId: "belief_1" });
  });

  it("defaults the graph details panel to actionable observations before passive belief nodes", () => {
    expect(
      createGraphInitialSelection(
        [
          { id: "belief_1", code: "B-001", type: "belief", status: "ACTIVE" },
          { id: "evidence_1", code: "E-001", type: "evidence", status: "ACTIVE" },
          { id: "observation_1", code: "O-001", type: "observation", status: "UNKNOWN" },
          { id: "observation_2", code: "O-002", type: "observation", status: "PENDING" }
        ],
        undefined,
        [{ source: "observation_1", target: "hypothesis_1", relation: "CANDIDATE" }]
      )
    ).toEqual({ nodeId: "observation_1" });
  });

  it("falls back to pending observations when no candidate observation can be confirmed", () => {
    expect(
      createGraphInitialSelection([
        { id: "belief_1", code: "B-001", type: "belief", status: "ACTIVE" },
        { id: "observation_1", code: "O-001", type: "observation", status: "PENDING" }
      ])
    ).toEqual({ nodeId: "observation_1" });
  });

  it("highlights selected graph nodes without changing their semantic border color", () => {
    const base = {
      width: 220,
      border: "1px solid #2f6f58",
      boxShadow: "0 1px 2px rgba(23, 32, 42, 0.08)"
    };

    expect(createGraphNodeVisualStyle(base, false)).toEqual(base);
    expect(createGraphNodeVisualStyle(base, true)).toMatchObject({
      width: 220,
      border: "1px solid #2f6f58",
      outline: "2px solid #17202a",
      outlineOffset: "2px"
    });
  });
});
