import { applySavedGraphLayout, serializeGraphLayout } from "@/lib/world-model-graph-layout";

type LayoutNode = {
  id: string;
  data: {
    domainId: string;
  };
  position: {
    x: number;
    y: number;
  };
};

describe("world model graph layout persistence", () => {
  it("stores and restores positions by stable domain ids instead of readable node codes", () => {
    const saved = serializeGraphLayout([
      { id: "H-001", data: { domainId: "hypothesis_agent_adoption" }, position: { x: 120, y: 240 } },
      { id: "E-001", data: { domainId: "evidence_agent_rollout" }, position: { x: 520, y: 240 } }
    ] satisfies LayoutNode[]);

    const restored = applySavedGraphLayout(
      [
        { id: "H-003", data: { domainId: "hypothesis_agent_adoption" }, position: { x: 40, y: 40 } },
        { id: "E-004", data: { domainId: "evidence_agent_rollout" }, position: { x: 640, y: 40 } },
        { id: "B-002", data: { domainId: "belief_new_context" }, position: { x: 0, y: 0 } }
      ] satisfies LayoutNode[],
      saved
    );

    expect(restored.map((node) => ({ id: node.id, position: node.position }))).toEqual([
      { id: "H-003", position: { x: 120, y: 240 } },
      { id: "E-004", position: { x: 520, y: 240 } },
      { id: "B-002", position: { x: 0, y: 0 } }
    ]);
  });

  it("ignores malformed saved positions without breaking the graph", () => {
    const nodes = [{ id: "H-001", data: { domainId: "hypothesis_agent_adoption" }, position: { x: 40, y: 40 } }] satisfies LayoutNode[];

    expect(applySavedGraphLayout(nodes, { hypothesis_agent_adoption: { x: Number.NaN, y: 120 } })).toEqual(nodes);
    expect(applySavedGraphLayout(nodes, null)).toEqual(nodes);
  });
});
