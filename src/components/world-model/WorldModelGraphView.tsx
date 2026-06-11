"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import {
  applyNodeChanges,
  Background,
  ReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type ReactFlowInstance
} from "@xyflow/react";
import {
  connectEvidenceHypothesisAction,
  rollbackUpdateAction,
  updateBeliefAction,
  updateEvidenceAction,
  updateHypothesisAction
} from "@/app/admin/world-model/actions";
import type { WorldModelGraph, WorldModelGraphNode, WorldModelGraphNodeType } from "@/lib/world-model-graph";
import type { WorldModelGraphEditorData } from "@/lib/world-model-graph-editor";
import { createGraphInteractionOptions } from "@/lib/world-model-graph-ui";
import { categoryLabels, evidenceDirectionLabels, hypothesisStanceLabels, probabilityModeLabels } from "@/lib/world-model-navigation";

const nodeLayers: Record<WorldModelGraphNodeType, number> = {
  belief: 0,
  hypothesis: 1,
  evidence: 2,
  update: 3
};

const beliefStatusOptions = ["ACTIVE", "PAUSED", "ARCHIVED"];
const hypothesisStatusOptions = ["ACTIVE", "PAUSED", "RESOLVED_TRUE", "RESOLVED_FALSE", "ARCHIVED"];

type FlowData = {
  label: string;
  domainId: string;
  code: string;
  type: WorldModelGraphNodeType;
};

type PendingConnection = {
  sourceId: string;
  sourceCode: string;
  sourceType: WorldModelGraphNodeType;
  targetId: string;
  targetCode: string;
  targetType: WorldModelGraphNodeType;
};

type WorldModelGraphViewMode = "embedded" | "workspace";

function nodeColor(node: WorldModelGraphNode) {
  if (node.status === "REJECTED" || node.status === "ROLLED_BACK") return "#9aa4ad";
  if (node.type === "belief") return "#2f6f58";
  if (node.type === "hypothesis") {
    const probability = node.probability ?? 0.5;
    return probability >= 0.66 ? "#2f6f58" : probability <= 0.33 ? "#9b3b4a" : "#8a6d3b";
  }
  if (node.type === "evidence") return "#6b5b95";
  return "#3d5a80";
}

function edgeColor(edge: WorldModelGraph["edges"][number]) {
  if (edge.status === "REJECTED" || edge.status === "ROLLED_BACK") return "#9aa4ad";
  if (edge.direction === "SUPPORTS") return "#2f6f58";
  if (edge.direction === "OPPOSES") return "#9b3b4a";
  return "#7a8792";
}

function nodeLabel(node: WorldModelGraphNode) {
  const metric =
    node.type === "belief" && node.strength !== undefined
      ? `强度 ${(node.strength * 100).toFixed(1)}%`
      : node.type === "hypothesis" && node.probability !== undefined
        ? `概率 ${(node.probability * 100).toFixed(1)}%`
        : node.type === "evidence" && node.credibility !== undefined
          ? `可信度 ${node.credibility.toFixed(2)}`
          : node.status;
  return `${node.code} · ${node.label}${metric ? `\n${metric}` : ""}`;
}

function createFlowNodeIdMap(nodes: WorldModelGraph["nodes"]) {
  return new Map(nodes.map((node) => [node.id, node.code]));
}

function createFlowNodes(nodes: WorldModelGraph["nodes"], nodeIdMap: Map<string, string>): Node<FlowData>[] {
  const layerCounts = new Map<WorldModelGraphNodeType, number>();
  return nodes.map((node) => {
    const layer = nodeLayers[node.type];
    const index = layerCounts.get(node.type) ?? 0;
    layerCounts.set(node.type, index + 1);
    return {
      id: nodeIdMap.get(node.id) ?? node.code,
      data: { label: nodeLabel(node), domainId: node.id, code: node.code, type: node.type },
      position: { x: 40 + layer * 280, y: 40 + index * 116 },
      style: {
        width: 220,
        minHeight: 64,
        borderRadius: 8,
        border: `1px solid ${nodeColor(node)}`,
        background: "#ffffff",
        color: "#17202a",
        fontSize: 12,
        whiteSpace: "pre-line",
        boxShadow: "0 1px 2px rgba(23, 32, 42, 0.08)"
      }
    };
  });
}

function createFlowEdges(edges: WorldModelGraph["edges"], nodeIdMap: Map<string, string>): Edge[] {
  return edges.flatMap((edge, index) => {
    const source = nodeIdMap.get(edge.source);
    const target = nodeIdMap.get(edge.target);
    if (!source || !target) return [];
    return {
      id: `${edge.relation}:${source}:${target}:${index + 1}`,
      source,
      target,
      label: edge.label,
      animated: edge.status === "APPLIED",
      style: {
        stroke: edgeColor(edge),
        strokeWidth: edge.relevance ? Math.max(1.5, edge.relevance * 4) : 1.5
      },
      labelStyle: { fill: "#17202a", fontSize: 11 },
      labelBgStyle: { fill: "#f5f7f6", fillOpacity: 0.9 }
    };
  });
}

function layoutStorageKey(graph: WorldModelGraph) {
  return `world-model-graph-layout:${graph.nodes.map((node) => node.code).join("|")}`;
}

function mergeSavedPositions(nodes: Node<FlowData>[], storageKey: string) {
  if (typeof window === "undefined") return nodes;
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return nodes;
  try {
    const saved = JSON.parse(raw) as Record<string, { x: number; y: number }>;
    return nodes.map((node) => ({
      ...node,
      position: saved[node.id] ?? node.position
    }));
  } catch {
    return nodes;
  }
}

function savePositions(nodes: Node<FlowData>[], storageKey: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    storageKey,
    JSON.stringify(Object.fromEntries(nodes.map((node) => [node.id, node.position])))
  );
}

function Field({
  label,
  name,
  defaultValue,
  type = "text",
  step,
  min,
  max,
  required
}: {
  label: string;
  name: string;
  defaultValue?: string | number;
  type?: string;
  step?: string;
  min?: string;
  max?: string;
  required?: boolean;
}) {
  return (
    <label className="grid gap-1 text-xs text-ink/60">
      <span>{label}</span>
      <input
        className="min-h-9 rounded-md border border-line bg-white px-2 text-sm text-ink"
        name={name}
        type={type}
        step={step}
        min={min}
        max={max}
        defaultValue={defaultValue}
        required={required}
      />
    </label>
  );
}

function Select({
  label,
  name,
  defaultValue,
  options
}: {
  label: string;
  name: string;
  defaultValue?: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="grid gap-1 text-xs text-ink/60">
      <span>{label}</span>
      <select className="min-h-9 rounded-md border border-line bg-white px-2 text-sm text-ink" name={name} defaultValue={defaultValue}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function TextArea({ label, name, defaultValue, required }: { label: string; name: string; defaultValue?: string; required?: boolean }) {
  return (
    <label className="grid gap-1 text-xs text-ink/60">
      <span>{label}</span>
      <textarea
        className="min-h-20 rounded-md border border-line bg-white px-2 py-2 text-sm text-ink"
        name={name}
        defaultValue={defaultValue}
        required={required}
      />
    </label>
  );
}

function GraphToolButton({
  label,
  disabled,
  onClick,
  children
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-8 items-center justify-center rounded-md border border-line text-ink/70 hover:border-moss hover:text-moss disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function connectionIntent(connection: PendingConnection) {
  if (connection.sourceType === "belief" && connection.targetType === "hypothesis") {
    return { kind: "moveHypothesis" as const, beliefId: connection.sourceId, hypothesisId: connection.targetId };
  }
  if (connection.sourceType === "hypothesis" && connection.targetType === "belief") {
    return { kind: "moveHypothesis" as const, beliefId: connection.targetId, hypothesisId: connection.sourceId };
  }
  if (connection.sourceType === "evidence" && connection.targetType === "hypothesis") {
    return { kind: "connectEvidence" as const, evidenceId: connection.sourceId, hypothesisId: connection.targetId };
  }
  if (connection.sourceType === "hypothesis" && connection.targetType === "evidence") {
    return { kind: "connectEvidence" as const, evidenceId: connection.targetId, hypothesisId: connection.sourceId };
  }
  return { kind: "invalid" as const };
}

function BeliefEditor({ editor, beliefId }: { editor: WorldModelGraphEditorData; beliefId: string }) {
  const belief = editor.beliefs.find((item) => item.id === beliefId);
  if (!belief) return null;
  return (
    <form action={updateBeliefAction} className="grid gap-3">
      <input type="hidden" name="beliefId" value={belief.id} />
      <Field label="信念表" name="title" defaultValue={belief.title} required />
      <Select
        label="分类"
        name="category"
        defaultValue={belief.category}
        options={Object.entries(categoryLabels).map(([value, label]) => ({ value, label }))}
      />
      <Select
        label="概率结构"
        name="probabilityMode"
        defaultValue={belief.probabilityMode}
        options={Object.entries(probabilityModeLabels).map(([value, label]) => ({ value, label }))}
      />
      <Select label="状态" name="status" defaultValue={belief.status} options={beliefStatusOptions.map((value) => ({ value, label: value }))} />
      <TextArea label="描述" name="description" defaultValue={belief.description} />
      <button className="min-h-9 rounded-md bg-moss px-3 text-sm font-semibold text-white">保存信念</button>
    </form>
  );
}

function HypothesisEditor({ editor, hypothesisId }: { editor: WorldModelGraphEditorData; hypothesisId: string }) {
  const hypothesis = editor.hypotheses.find((item) => item.id === hypothesisId);
  if (!hypothesis) return null;
  return (
    <form action={updateHypothesisAction} className="grid gap-3">
      <input type="hidden" name="hypothesisId" value={hypothesis.id} />
      <Select
        label="所属信念组"
        name="beliefId"
        defaultValue={hypothesis.beliefId}
        options={editor.beliefs.map((belief) => ({ value: belief.id, label: `${belief.code} · ${belief.title}` }))}
      />
      <Field label="假设" name="proposition" defaultValue={hypothesis.proposition} required />
      <Select
        label="类型"
        name="stance"
        defaultValue={hypothesis.stance}
        options={Object.entries(hypothesisStanceLabels).map(([value, label]) => ({ value, label }))}
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="先验概率" name="priorProbability" type="number" step="0.01" min="0" max="1" defaultValue={hypothesis.priorProbability} />
        <Field
          label="当前概率"
          name="currentProbability"
          type="number"
          step="0.01"
          min="0"
          max="1"
          defaultValue={hypothesis.currentProbability}
        />
      </div>
      <Select
        label="状态"
        name="status"
        defaultValue={hypothesis.status}
        options={hypothesisStatusOptions.map((value) => ({ value, label: value }))}
      />
      <TextArea label="备注" name="notes" defaultValue={hypothesis.notes} />
      <button className="min-h-9 rounded-md bg-moss px-3 text-sm font-semibold text-white">保存假设</button>
    </form>
  );
}

function EvidenceEditor({ editor, evidenceId }: { editor: WorldModelGraphEditorData; evidenceId: string }) {
  const evidence = editor.evidence.find((item) => item.id === evidenceId);
  if (!evidence) return null;
  return (
    <form action={updateEvidenceAction} className="grid gap-3">
      <input type="hidden" name="evidenceId" value={evidence.id} />
      {evidence.links.map((link) => (
        <div key={link.hypothesisId} className="hidden">
          <input type="hidden" name="linkHypothesisIds" value={link.hypothesisId} />
          <input type="hidden" name={`direction:${link.hypothesisId}`} value={link.direction} />
          <input type="hidden" name={`relevance:${link.hypothesisId}`} value={link.relevance} />
          <input type="hidden" name={`likelihoodRatio:${link.hypothesisId}`} value={link.likelihoodRatio} />
          <input type="hidden" name={`confidence:${link.hypothesisId}`} value={link.confidence} />
          <input type="hidden" name={`rationale:${link.hypothesisId}`} value={link.rationale} />
        </div>
      ))}
      <Field label="证据" name="title" defaultValue={evidence.title} required />
      <Field label="链接" name="url" type="url" defaultValue={evidence.url ?? ""} />
      <Field label="可信度" name="credibility" type="number" step="0.01" min="0" max="1" defaultValue={evidence.credibility} />
      <TextArea label="正文" name="content" defaultValue={evidence.content} required />
      <button className="min-h-9 rounded-md bg-moss px-3 text-sm font-semibold text-white">保存证据并重算</button>
    </form>
  );
}

function UpdateEditor({ editor, updateId }: { editor: WorldModelGraphEditorData; updateId: string }) {
  const update = editor.updates.find((item) => item.id === updateId);
  if (!update) return null;
  return (
    <form action={rollbackUpdateAction} className="grid gap-3">
      <input type="hidden" name="eventId" value={update.id} />
      <div className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink/70">
        {update.code} · {update.status}
      </div>
      <button className="min-h-9 rounded-md border border-line px-3 text-sm font-semibold text-ink">回滚更新</button>
    </form>
  );
}

function ConnectionEditor({ editor, connection }: { editor: WorldModelGraphEditorData; connection: PendingConnection }) {
  const intent = connectionIntent(connection);
  if (intent.kind === "moveHypothesis") {
    const hypothesis = editor.hypotheses.find((item) => item.id === intent.hypothesisId);
    const belief = editor.beliefs.find((item) => item.id === intent.beliefId);
    if (!hypothesis || !belief) return null;
    return (
      <form action={updateHypothesisAction} className="grid gap-3">
        <input type="hidden" name="hypothesisId" value={hypothesis.id} />
        <input type="hidden" name="beliefId" value={belief.id} />
        <input type="hidden" name="proposition" value={hypothesis.proposition} />
        <input type="hidden" name="notes" value={hypothesis.notes} />
        <input type="hidden" name="stance" value={hypothesis.stance} />
        <input type="hidden" name="priorProbability" value={hypothesis.priorProbability} />
        <input type="hidden" name="currentProbability" value={hypothesis.currentProbability} />
        <input type="hidden" name="status" value={hypothesis.status} />
        <div className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink/70">
          将 {hypothesis.code} 移入 {belief.code}
        </div>
        <button className="min-h-9 rounded-md bg-moss px-3 text-sm font-semibold text-white">保存所属信念组</button>
      </form>
    );
  }

  if (intent.kind === "connectEvidence") {
    const evidence = editor.evidence.find((item) => item.id === intent.evidenceId);
    const hypothesis = editor.hypotheses.find((item) => item.id === intent.hypothesisId);
    if (!evidence || !hypothesis) return null;
    return (
      <form action={connectEvidenceHypothesisAction} className="grid gap-3">
        <input type="hidden" name="evidenceId" value={evidence.id} />
        <input type="hidden" name="hypothesisId" value={hypothesis.id} />
        <div className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink/70">
          {evidence.code} 连接到 {hypothesis.code}
        </div>
        <Select
          label="方向"
          name="direction"
          defaultValue="SUPPORTS"
          options={Object.entries(evidenceDirectionLabels).map(([value, label]) => ({ value, label }))}
        />
        <Field label="相关性" name="relevance" type="number" step="0.01" min="0" max="1" defaultValue={0.7} />
        <Field label="似然比" name="likelihoodRatio" type="number" step="0.01" min="0.01" defaultValue={1.5} />
        <Field label="置信度" name="confidence" type="number" step="0.01" min="0" max="1" defaultValue={0.6} />
        <TextArea label="解释" name="rationale" defaultValue="从图谱连接创建的证据关联" required />
        <button className="min-h-9 rounded-md bg-moss px-3 text-sm font-semibold text-white">保存连接并重算</button>
      </form>
    );
  }

  return <div className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-berry">该连接没有可保存的业务含义。</div>;
}

function NodeEditor({
  editor,
  selectedNode
}: {
  editor: WorldModelGraphEditorData;
  selectedNode?: WorldModelGraphNode;
}) {
  if (!selectedNode) {
    return <div className="text-sm text-ink/55">选择一个节点后可编辑；从节点拖出连线可创建关系。</div>;
  }

  return (
    <div className="grid gap-3">
      <div>
        <div className="text-xs font-medium text-ink/50">{selectedNode.type.toUpperCase()}</div>
        <h3 className="text-sm font-semibold text-ink">
          {selectedNode.code} · {selectedNode.label}
        </h3>
      </div>
      {selectedNode.type === "belief" ? <BeliefEditor editor={editor} beliefId={selectedNode.id} /> : null}
      {selectedNode.type === "hypothesis" ? <HypothesisEditor editor={editor} hypothesisId={selectedNode.id} /> : null}
      {selectedNode.type === "evidence" ? <EvidenceEditor editor={editor} evidenceId={selectedNode.id} /> : null}
      {selectedNode.type === "update" ? <UpdateEditor editor={editor} updateId={selectedNode.id} /> : null}
    </div>
  );
}

export function WorldModelGraphView({
  graph,
  editor,
  mode = "embedded"
}: {
  graph: WorldModelGraph;
  editor?: WorldModelGraphEditorData;
  mode?: WorldModelGraphViewMode;
}) {
  const storageKey = useMemo(() => layoutStorageKey(graph), [graph]);
  const nodeIdMap = useMemo(() => createFlowNodeIdMap(graph.nodes), [graph.nodes]);
  const initialNodes = useMemo(() => createFlowNodes(graph.nodes, nodeIdMap), [graph.nodes, nodeIdMap]);
  const [nodes, setNodes] = useState<Node<FlowData>[]>(initialNodes);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<Node<FlowData>, Edge> | null>(null);
  const edges = useMemo(() => createFlowEdges(graph.edges, nodeIdMap), [graph.edges, nodeIdMap]);
  const nodeByCode = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const graphNodeById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [pendingConnection, setPendingConnection] = useState<PendingConnection | null>(null);
  const [embeddedPanActivated, setEmbeddedPanActivated] = useState(false);
  const interactionOptions = useMemo(
    () => createGraphInteractionOptions({ mode, panActivated: embeddedPanActivated }),
    [embeddedPanActivated, mode]
  );

  useEffect(() => {
    setNodes(mergeSavedPositions(initialNodes, storageKey));
  }, [initialNodes, storageKey]);

  const onNodesChange = useCallback(
    (changes: NodeChange<Node<FlowData>>[]) => {
      setNodes((current) => {
        const next = applyNodeChanges(changes, current);
        savePositions(next, storageKey);
        return next;
      });
    },
    [storageKey]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const source = connection.source ? nodeByCode.get(connection.source) : undefined;
      const target = connection.target ? nodeByCode.get(connection.target) : undefined;
      if (!source || !target) return;
      setPendingConnection({
        sourceId: source.data.domainId,
        sourceCode: source.data.code,
        sourceType: source.data.type,
        targetId: target.data.domainId,
        targetCode: target.data.code,
        targetType: target.data.type
      });
      setSelectedNodeId(null);
    },
    [nodeByCode]
  );

  if (graph.nodes.length === 0) {
    return <div className="rounded-md border border-dashed border-line bg-white px-4 py-6 text-sm text-ink/55">暂无图谱数据</div>;
  }

  const selectedNode = selectedNodeId ? graphNodeById.get(selectedNodeId) : undefined;
  const canvasHeightClass = mode === "workspace" ? "h-[calc(100vh-150px)] min-h-[640px]" : "h-[560px]";
  const asideHeightClass = mode === "workspace" ? "h-[calc(100vh-150px)] min-h-[640px] overflow-y-auto" : "";
  const rootClass = mode === "workspace" ? "grid gap-3 lg:grid-cols-[minmax(0,1fr)_380px]" : "grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px]";

  return (
    <div className={rootClass}>
      <div
        className={`${canvasHeightClass} overflow-hidden rounded-md border border-line bg-white`}
        data-graph-pan-active={mode === "workspace" || embeddedPanActivated}
        onPointerDownCapture={() => {
          if (mode === "embedded") setEmbeddedPanActivated(true);
        }}
        onMouseLeave={() => {
          if (mode === "embedded") setEmbeddedPanActivated(false);
        }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          minZoom={0.25}
          maxZoom={1.4}
          onInit={(instance) => setFlowInstance(instance)}
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) => {
            setSelectedNodeId(node.data.domainId);
            setPendingConnection(null);
          }}
          nodesDraggable
          nodesConnectable
          {...interactionOptions}
        >
          <Background gap={22} size={1} />
        </ReactFlow>
      </div>
      <aside className={`${asideHeightClass} rounded-md border border-line bg-white p-4`}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">图谱工作区</h2>
          <div className="flex items-center gap-1">
            <GraphToolButton label="放大" disabled={!flowInstance} onClick={() => void flowInstance?.zoomIn({ duration: 160 })}>
              <ZoomIn size={16} />
            </GraphToolButton>
            <GraphToolButton label="缩小" disabled={!flowInstance} onClick={() => void flowInstance?.zoomOut({ duration: 160 })}>
              <ZoomOut size={16} />
            </GraphToolButton>
            <GraphToolButton label="适应画布" disabled={!flowInstance} onClick={() => void flowInstance?.fitView({ duration: 160 })}>
              <Maximize2 size={16} />
            </GraphToolButton>
          </div>
        </div>
        {editor && pendingConnection ? <ConnectionEditor editor={editor} connection={pendingConnection} /> : null}
        {editor && !pendingConnection ? <NodeEditor editor={editor} selectedNode={selectedNode} /> : null}
        {!editor ? <div className="text-sm text-ink/55">当前图谱未提供可编辑数据。</div> : null}
      </aside>
    </div>
  );
}
