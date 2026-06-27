import { PanOnScrollMode } from "@xyflow/react";
import type { WorldModelGraphEdge, WorldModelGraphNode } from "@/lib/world-model-graph";

const baseGraphInteractionOptions = {
  zoomOnScroll: false,
  zoomOnDoubleClick: false,
  zoomOnPinch: false,
  panOnScrollMode: PanOnScrollMode.Vertical
} as const;

const LARGE_GRAPH_NODE_THRESHOLD = 18;
const DENSE_GRAPH_EDGE_LABEL_THRESHOLD = 18;

type CompactGraphEdgeInput = Pick<WorldModelGraphEdge, "relation" | "label" | "direction" | "likelihoodRatio" | "status">;

const compactDirectionLabels: Record<string, string> = {
  SUPPORTS: "支持",
  OPPOSES: "反对",
  MIXED: "混合",
  NEUTRAL: "中性"
};

function compactDirection(direction: string | undefined) {
  return direction ? (compactDirectionLabels[direction] ?? direction) : "";
}

function compactLikelihoodRatio(likelihoodRatio: number | undefined) {
  return typeof likelihoodRatio === "number" ? `LR ${likelihoodRatio.toFixed(2)}` : "";
}

function compactUpdateLabel(label: string) {
  return label.startsWith("更新信念 · ") ? label.replace("更新信念 · ", "更新 · ") : label;
}

const denseHiddenRelations = new Set(["COLLECTED", "OWNS", "CONFIRMED_AS", "PRODUCED"]);

export function createCompactGraphEdgeDisplay(edge: CompactGraphEdgeInput, options: { dense?: boolean } = {}) {
  const fullLabel = edge.label;

  if (options.dense && denseHiddenRelations.has(edge.relation)) {
    return { label: undefined, fullLabel };
  }

  if (edge.relation === "OWNS") {
    return { label: "包含", fullLabel };
  }
  if (edge.relation === "COLLECTED") {
    return { label: "采集观察", fullLabel };
  }
  if (edge.relation === "CONFIRMED_AS") {
    return { label: "确认为证据", fullLabel };
  }
  if (edge.relation === "PRODUCED") {
    return { label: "产生更新", fullLabel };
  }
  if (edge.relation === "UPDATED") {
    return { label: compactUpdateLabel(edge.label), fullLabel };
  }
  if (options.dense && (edge.relation === "CANDIDATE" || edge.relation === "INFLUENCES")) {
    return { label: undefined, fullLabel };
  }

  const direction = compactDirection(edge.direction);
  const likelihoodRatio = compactLikelihoodRatio(edge.likelihoodRatio);
  const rejectedPrefix = edge.status === "REJECTED" ? ["已拒绝"] : [];
  const prefix = edge.relation === "CANDIDATE" ? ["候选"] : [];
  const label = [...rejectedPrefix, ...prefix, direction, likelihoodRatio].filter(Boolean).join(" · ");

  return { label: label || edge.label, fullLabel };
}

export function isDenseGraphEdgeLabelSet(edgeCount: number) {
  return edgeCount > DENSE_GRAPH_EDGE_LABEL_THRESHOLD;
}

export function createGraphNodeVisualStyle<T extends object>(style: T, selected: boolean) {
  if (!selected) return style;

  const existingShadow = (style as { boxShadow?: unknown }).boxShadow;
  const shadowPrefix = typeof existingShadow === "string" && existingShadow.trim() ? `${existingShadow}, ` : "";
  return {
    ...style,
    outline: "2px solid #17202a",
    outlineOffset: "2px",
    boxShadow: `${shadowPrefix}0 0 0 3px rgba(47, 111, 88, 0.18), 0 6px 14px rgba(23, 32, 42, 0.16)`
  };
}

export function createGraphInteractionOptions({
  mode,
  panActivated
}: {
  mode: "embedded" | "workspace";
  panActivated: boolean;
}) {
  return {
    ...baseGraphInteractionOptions,
    preventScrolling: mode === "workspace" || panActivated,
    panOnScroll: mode === "workspace" || panActivated
  } as const;
}

export function createGraphViewportOptions({ mode, nodeCount }: { mode: "embedded" | "workspace"; nodeCount: number }) {
  if (nodeCount > LARGE_GRAPH_NODE_THRESHOLD) {
    return {
      fitView: false,
      defaultViewport: {
        x: 0,
        y: 0,
        zoom: mode === "workspace" ? 0.82 : 0.72
      }
    } as const;
  }

  return {
    fitView: true,
    fitViewOptions: {
      padding: 0.18,
      maxZoom: 1
    }
  } as const;
}

export function createGraphInitialSelection(
  nodes: Array<Pick<WorldModelGraphNode, "id" | "code"> & Partial<Pick<WorldModelGraphNode, "type" | "status">>>,
  selection?: { nodeId?: string },
  edges: Array<Pick<WorldModelGraphEdge, "source" | "target" | "relation"> & Partial<Pick<WorldModelGraphEdge, "id">>> = []
) {
  if (selection?.nodeId && nodes.some((node) => node.id === selection.nodeId)) {
    return { nodeId: selection.nodeId };
  }

  const candidateObservationIds = new Set(
    edges.filter((edge) => edge.relation === "CANDIDATE").map((edge) => edge.source)
  );
  const defaultNode =
    nodes.find(
      (node) =>
        node.type === "observation" &&
        (node.status === "PENDING" || node.status === "UNKNOWN") &&
        candidateObservationIds.has(node.id)
    ) ??
    nodes.find((node) => node.type === "observation" && node.status === "PENDING") ??
    nodes.find((node) => node.type === "observation" && node.status === "UNKNOWN") ??
    nodes.find((node) => node.type === "evidence" && node.status === "ACTIVE") ??
    nodes.find((node) => node.type === "update" && node.status === "APPLIED") ??
    nodes.find((node) => node.type === "hypothesis" && node.status === "ACTIVE") ??
    nodes.find((node) => node.type === "belief" && node.status === "ACTIVE") ??
    nodes[0];

  return { nodeId: defaultNode?.id ?? null };
}

export const graphInteractionOptions = createGraphInteractionOptions({
  mode: "workspace",
  panActivated: true
});
