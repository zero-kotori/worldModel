export const graphLayoutStorageKey = "world-model-graph-layout:v2";

type GraphLayoutPosition = {
  x: number;
  y: number;
};

type GraphLayoutNode = {
  id?: string;
  data: {
    domainId: string;
  };
  position: GraphLayoutPosition;
};

export type SavedGraphLayout = Record<string, GraphLayoutPosition>;

function isFinitePosition(value: unknown): value is GraphLayoutPosition {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GraphLayoutPosition>;
  return typeof candidate.x === "number" && Number.isFinite(candidate.x) && typeof candidate.y === "number" && Number.isFinite(candidate.y);
}

export function serializeGraphLayout(nodes: GraphLayoutNode[]): SavedGraphLayout {
  return Object.fromEntries(nodes.map((node) => [node.data.domainId, node.position]));
}

export function parseSavedGraphLayout(raw: string | null): SavedGraphLayout | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, GraphLayoutPosition] => isFinitePosition(entry[1])));
  } catch {
    return null;
  }
}

export function applySavedGraphLayout<T extends GraphLayoutNode>(nodes: T[], saved: SavedGraphLayout | null): T[] {
  if (!saved) return nodes;
  return nodes.map((node) => {
    const position = saved[node.data.domainId];
    return isFinitePosition(position) ? { ...node, position } : node;
  });
}
