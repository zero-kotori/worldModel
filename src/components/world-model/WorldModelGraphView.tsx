"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Filter, Maximize2, X, ZoomIn, ZoomOut } from "lucide-react";
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
  confirmGraphObservationAction,
  connectEvidenceHypothesisAction,
  connectObservationHypothesisAction,
  connectSourceObservationAction,
  deleteEvidenceAction,
  disconnectEvidenceHypothesisAction,
  rejectEvidenceAction,
  rejectObservationAction,
  rollbackUpdateAction,
  updateBeliefAction,
  updateEvidenceAction,
  updateGraphObservationAction,
  updateHypothesisAction,
  updateSourceAction
} from "@/app/admin/world-model/actions";
import type { WorldModelGraph, WorldModelGraphNode, WorldModelGraphNodeType } from "@/lib/world-model-graph";
import {
  createEvidenceAuditRows,
  createEvidenceEdgeEditorRows,
  createEvidenceLinkEditorRows,
  createObservationConnectionEditorRows,
  createUpdateAuditRows,
  type WorldModelGraphEditorData
} from "@/lib/world-model-graph-editor";
import { datetimeLocalValue } from "@/lib/world-model-beliefs-ui";
import { applySavedGraphLayout, graphLayoutStorageKey, parseSavedGraphLayout, serializeGraphLayout } from "@/lib/world-model-graph-layout";
import {
  createCompactGraphEdgeDisplay,
  createGraphInitialSelection,
  createGraphInteractionOptions,
  createGraphNodeVisualStyle,
  createGraphViewportOptions,
  isDenseGraphEdgeLabelSet
} from "@/lib/world-model-graph-ui";
import { categoryLabels, evidenceDirectionLabels, hypothesisStanceLabels, probabilityModeLabels } from "@/lib/world-model-navigation";
import { canRollbackUpdate } from "@/lib/world-model-updates-ui";
import { canDeleteEvidence, canEditEvidence, canRejectEvidence } from "@/lib/world-model-evidence-ui";

const nodeLayers: Record<WorldModelGraphNodeType, number> = {
  source: 0,
  belief: 1,
  hypothesis: 2,
  observation: 3,
  evidence: 4,
  update: 5
};

const beliefStatusOptions = ["ACTIVE", "PAUSED", "ARCHIVED"];
const hypothesisStatusOptions = ["ACTIVE", "PAUSED", "RESOLVED_TRUE", "RESOLVED_FALSE", "ARCHIVED"];
const sourceKindOptions = ["RSS", "WEB_PAGE", "SEARCH", "GITHUB", "HUGGING_FACE", "GDELT", "PREDICTION_MARKET", "SOCIAL"].map(
  (value) => ({ value, label: value })
);

type FlowData = {
  label: string;
  domainId: string;
  code: string;
  type: WorldModelGraphNodeType;
};

type FlowEdgeData = {
  edgeId: string;
  fullLabel: string;
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
type WorldModelGraphInitialSelection = {
  nodeId?: string;
};
type GraphEdgeLookup = {
  nodeIds: Set<string>;
  nodeById: Map<string, WorldModelGraphNode>;
  bySource: Map<string, WorldModelGraph["edges"]>;
  byTarget: Map<string, WorldModelGraph["edges"]>;
};

function ReturnPathField({ returnPath }: { returnPath?: string }) {
  return returnPath ? <input type="hidden" name="returnPath" value={returnPath} /> : null;
}

function evidenceLibraryHref(evidence: { code: string }) {
  const evidenceCode = encodeURIComponent(evidence.code);
  return `/admin/world-model/evidence?evidence=${evidenceCode}#${evidenceCode}`;
}

function nodeColor(node: WorldModelGraphNode) {
  if (node.status === "REJECTED" || node.status === "ROLLED_BACK") return "#9aa4ad";
  if (node.type === "source") return node.status === "DISABLED" ? "#9aa4ad" : "#3d5a80";
  if (node.type === "belief") return "#2f6f58";
  if (node.type === "hypothesis") {
    const probability = node.probability ?? 0.5;
    return probability >= 0.66 ? "#2f6f58" : probability <= 0.33 ? "#9b3b4a" : "#8a6d3b";
  }
  if (node.type === "observation") return "#b7791f";
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
        : (node.type === "source" || node.type === "observation" || node.type === "evidence") && node.credibility !== undefined
          ? `可信度 ${node.credibility.toFixed(2)}`
          : node.status;
  return `${node.code} · ${node.label}${metric ? `\n${metric}` : ""}`;
}

function formatProbability(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatPointDelta(value: number) {
  const points = value * 100;
  const sign = points > 0 ? "+" : "";
  return `${sign}${points.toFixed(1)}pp`;
}

function deltaToneClass(delta: number) {
  if (delta > 0.000001) return "text-moss";
  if (delta < -0.000001) return "text-berry";
  return "text-ink/55";
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

function createFlowEdges(edges: WorldModelGraph["edges"], nodeIdMap: Map<string, string>): Edge<FlowEdgeData>[] {
  const dense = isDenseGraphEdgeLabelSet(edges.length);
  return edges.flatMap((edge, index) => {
    const source = nodeIdMap.get(edge.source);
    const target = nodeIdMap.get(edge.target);
    if (!source || !target) return [];
    const display = createCompactGraphEdgeDisplay(edge, { dense });
    return {
      id: `${edge.relation}:${source}:${target}:${index + 1}`,
      source,
      target,
      label: display.label,
      data: { edgeId: edge.id, fullLabel: display.fullLabel },
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

function mergeSavedPositions(nodes: Node<FlowData>[]) {
  if (typeof window === "undefined") return nodes;
  return applySavedGraphLayout(nodes, parseSavedGraphLayout(window.localStorage.getItem(graphLayoutStorageKey)));
}

function savePositions(nodes: Node<FlowData>[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(graphLayoutStorageKey, JSON.stringify(serializeGraphLayout(nodes)));
}

function createGraphEdgeLookup(graph: WorldModelGraph): GraphEdgeLookup {
  const bySource = new Map<string, WorldModelGraph["edges"]>();
  const byTarget = new Map<string, WorldModelGraph["edges"]>();

  for (const edge of graph.edges) {
    bySource.set(edge.source, [...(bySource.get(edge.source) ?? []), edge]);
    byTarget.set(edge.target, [...(byTarget.get(edge.target) ?? []), edge]);
  }

  return {
    nodeIds: new Set(graph.nodes.map((node) => node.id)),
    nodeById: new Map(graph.nodes.map((node) => [node.id, node])),
    bySource,
    byTarget
  };
}

function addExistingNode(lookup: GraphEdgeLookup, selectedIds: Set<string>, nodeId: string) {
  if (lookup.nodeIds.has(nodeId)) selectedIds.add(nodeId);
}

function outgoingEdges(lookup: GraphEdgeLookup, nodeId: string, relation: WorldModelGraph["edges"][number]["relation"]) {
  return (lookup.bySource.get(nodeId) ?? []).filter((edge) => edge.relation === relation);
}

function incomingEdges(lookup: GraphEdgeLookup, nodeId: string, relation: WorldModelGraph["edges"][number]["relation"]) {
  return (lookup.byTarget.get(nodeId) ?? []).filter((edge) => edge.relation === relation);
}

function addHypothesisContext(selectedIds: Set<string>, lookup: GraphEdgeLookup, hypothesisId: string) {
  addExistingNode(lookup, selectedIds, hypothesisId);
  for (const edge of incomingEdges(lookup, hypothesisId, "OWNS")) {
    addExistingNode(lookup, selectedIds, edge.source);
  }
}

function addObservationCore(selectedIds: Set<string>, lookup: GraphEdgeLookup, observationId: string) {
  addExistingNode(lookup, selectedIds, observationId);
  for (const edge of incomingEdges(lookup, observationId, "COLLECTED")) {
    addExistingNode(lookup, selectedIds, edge.source);
  }
}

function addUpdateContext(selectedIds: Set<string>, lookup: GraphEdgeLookup, updateId: string) {
  addExistingNode(lookup, selectedIds, updateId);
  for (const edge of outgoingEdges(lookup, updateId, "UPDATED")) {
    addExistingNode(lookup, selectedIds, edge.target);
  }
  for (const edge of incomingEdges(lookup, updateId, "PRODUCED")) {
    addEvidenceContext(selectedIds, lookup, edge.source, false);
  }
}

function addEvidenceContext(selectedIds: Set<string>, lookup: GraphEdgeLookup, evidenceId: string, includeUpdates = true) {
  addExistingNode(lookup, selectedIds, evidenceId);
  for (const edge of incomingEdges(lookup, evidenceId, "CONFIRMED_AS")) {
    addObservationCore(selectedIds, lookup, edge.source);
  }
  for (const edge of outgoingEdges(lookup, evidenceId, "INFLUENCES")) {
    addHypothesisContext(selectedIds, lookup, edge.target);
  }
  if (includeUpdates) {
    for (const edge of outgoingEdges(lookup, evidenceId, "PRODUCED")) {
      addUpdateContext(selectedIds, lookup, edge.target);
    }
  }
}

function addObservationContext(selectedIds: Set<string>, lookup: GraphEdgeLookup, observationId: string) {
  addObservationCore(selectedIds, lookup, observationId);
  for (const relation of ["CANDIDATE", "SETTLED"] as const) {
    for (const edge of outgoingEdges(lookup, observationId, relation)) {
      addHypothesisContext(selectedIds, lookup, edge.target);
    }
  }
  for (const edge of outgoingEdges(lookup, observationId, "CONFIRMED_AS")) {
    addEvidenceContext(selectedIds, lookup, edge.target);
  }
}

function addSourceContext(selectedIds: Set<string>, lookup: GraphEdgeLookup, sourceId: string) {
  addExistingNode(lookup, selectedIds, sourceId);
  for (const edge of outgoingEdges(lookup, sourceId, "COLLECTED")) {
    addObservationContext(selectedIds, lookup, edge.target);
  }
}

function createRelatedNodeIds(graph: WorldModelGraph, selectedNodeId: string) {
  const lookup = createGraphEdgeLookup(graph);
  const selectedNode = lookup.nodeById.get(selectedNodeId);
  if (!selectedNode) return new Set(graph.nodes.map((node) => node.id));

  const selectedIds = new Set<string>();
  addExistingNode(lookup, selectedIds, selectedNode.id);

  if (selectedNode.type === "belief") {
    for (const edge of outgoingEdges(lookup, selectedNode.id, "OWNS")) {
      addExistingNode(lookup, selectedIds, edge.target);
    }
    return selectedIds;
  }

  if (selectedNode.type === "hypothesis") {
    addHypothesisContext(selectedIds, lookup, selectedNode.id);
    for (const relation of ["CANDIDATE", "SETTLED"] as const) {
      for (const edge of incomingEdges(lookup, selectedNode.id, relation)) {
        addObservationCore(selectedIds, lookup, edge.source);
      }
    }
    for (const edge of incomingEdges(lookup, selectedNode.id, "INFLUENCES")) {
      addEvidenceContext(selectedIds, lookup, edge.source);
    }
    return selectedIds;
  }

  if (selectedNode.type === "observation") {
    addObservationContext(selectedIds, lookup, selectedNode.id);
    return selectedIds;
  }

  if (selectedNode.type === "evidence") {
    addEvidenceContext(selectedIds, lookup, selectedNode.id);
    return selectedIds;
  }

  if (selectedNode.type === "source") {
    addSourceContext(selectedIds, lookup, selectedNode.id);
    return selectedIds;
  }

  addUpdateContext(selectedIds, lookup, selectedNode.id);
  return selectedIds;
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
    <label className="grid min-w-0 gap-1 text-xs text-ink/60">
      <span>{label}</span>
      <input
        className="min-h-9 w-full min-w-0 rounded-md border border-line bg-white px-2 text-sm text-ink"
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
    <label className="grid min-w-0 gap-1 text-xs text-ink/60">
      <span>{label}</span>
      <select className="min-h-9 w-full min-w-0 rounded-md border border-line bg-white px-2 text-sm text-ink" name={name} defaultValue={defaultValue}>
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
    <label className="grid min-w-0 gap-1 text-xs text-ink/60">
      <span>{label}</span>
      <textarea
        className="min-h-20 w-full min-w-0 rounded-md border border-line bg-white px-2 py-2 text-sm text-ink"
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
  if (connection.sourceType === "observation" && connection.targetType === "hypothesis") {
    return { kind: "confirmObservation" as const, observationId: connection.sourceId, hypothesisId: connection.targetId };
  }
  if (connection.sourceType === "hypothesis" && connection.targetType === "observation") {
    return { kind: "confirmObservation" as const, observationId: connection.targetId, hypothesisId: connection.sourceId };
  }
  if (connection.sourceType === "source" && connection.targetType === "observation") {
    return { kind: "assignSource" as const, sourceId: connection.sourceId, observationId: connection.targetId };
  }
  if (connection.sourceType === "observation" && connection.targetType === "source") {
    return { kind: "assignSource" as const, sourceId: connection.targetId, observationId: connection.sourceId };
  }
  return { kind: "invalid" as const };
}

function BeliefEditor({ editor, beliefId, returnPath }: { editor: WorldModelGraphEditorData; beliefId: string; returnPath?: string }) {
  const belief = editor.beliefs.find((item) => item.id === beliefId);
  if (!belief) return null;
  return (
    <form action={updateBeliefAction} className="grid gap-3">
      <ReturnPathField returnPath={returnPath} />
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

export function SourceEditor({ editor, sourceId, returnPath }: { editor: WorldModelGraphEditorData; sourceId: string; returnPath?: string }) {
  const source = editor.sources.find((item) => item.id === sourceId);
  if (!source) return null;
  return (
    <form action={updateSourceAction} className="grid gap-3">
      <ReturnPathField returnPath={returnPath} />
      <input type="hidden" name="sourceId" value={source.id} />
      <Field label="名称" name="name" defaultValue={source.name} required />
      <Select label="类型" name="kind" defaultValue={source.kind} options={sourceKindOptions} />
      <Field label="URL" name="url" type="url" defaultValue={source.url ?? ""} />
      <Field label="Adapter" name="adapter" defaultValue={source.adapter} required />
      <Field label="凭据引用名" name="credentialRef" defaultValue={source.credentialRef ?? ""} />
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="可信度" name="credibility" type="number" step="0.01" min="0" max="1" defaultValue={source.credibility} />
        <Field
          label="自动确认阈值"
          name="autoConfirmThreshold"
          type="number"
          step="0.01"
          min="0"
          max="1"
          defaultValue={source.autoConfirmThreshold}
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-ink/70">
        <input name="enabled" type="checkbox" defaultChecked={source.enabled} /> 启用
      </label>
      <label className="flex items-center gap-2 text-sm text-ink/70">
        <input name="autoConfirm" type="checkbox" defaultChecked={source.autoConfirm} /> 自动确认
      </label>
      <button className="min-h-9 rounded-md bg-moss px-3 text-sm font-semibold text-white">保存来源</button>
    </form>
  );
}

export function HypothesisEditor({
  editor,
  hypothesisId,
  returnPath
}: {
  editor: WorldModelGraphEditorData;
  hypothesisId: string;
  returnPath?: string;
}) {
  const hypothesis = editor.hypotheses.find((item) => item.id === hypothesisId);
  if (!hypothesis) return null;
  return (
    <form action={updateHypothesisAction} className="grid gap-3">
      <ReturnPathField returnPath={returnPath} />
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
        <Field label="先验概率" name="priorProbability" type="number" step="any" min="0" max="1" defaultValue={hypothesis.priorProbability} />
        <Field
          label="当前概率"
          name="currentProbability"
          type="number"
          step="any"
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
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="开始时间" name="startsAt" type="datetime-local" defaultValue={datetimeLocalValue(hypothesis.startsAt)} />
        <Field label="到期时间" name="expiresAt" type="datetime-local" defaultValue={datetimeLocalValue(hypothesis.expiresAt)} />
      </div>
      <Field label="过期条件" name="expiryCondition" defaultValue={hypothesis.expiryCondition ?? ""} />
      <Field label="搜证查询" name="evidenceSearchQuery" defaultValue={hypothesis.evidenceSearchQuery ?? ""} />
      <TextArea label="结算结果" name="resolvedOutcome" defaultValue={hypothesis.resolvedOutcome ?? ""} />
      <TextArea label="备注" name="notes" defaultValue={hypothesis.notes} />
      <button className="min-h-9 rounded-md bg-moss px-3 text-sm font-semibold text-white">保存假设</button>
    </form>
  );
}

export function EvidenceEditor({ editor, evidenceId, returnPath }: { editor: WorldModelGraphEditorData; evidenceId: string; returnPath?: string }) {
  const evidence = editor.evidence.find((item) => item.id === evidenceId);
  if (!evidence) return null;
  if (!canEditEvidence(evidence)) {
    const auditRows = createEvidenceAuditRows(editor, evidenceId);
    return (
      <div className="grid gap-3">
        <Link
          href={evidenceLibraryHref(evidence)}
          className="inline-flex min-h-9 w-fit items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink hover:border-moss hover:text-moss"
        >
          <Maximize2 size={16} /> 打开证据编辑区
        </Link>
        <div className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink/65">
          {evidence.status} · 可信度 {evidence.credibility.toFixed(2)}
        </div>
        <div className="grid gap-2 text-sm">
          <div className="font-semibold text-ink">{evidence.title}</div>
          {evidence.url ? <a className="break-all text-xs text-moss" href={evidence.url}>{evidence.url}</a> : null}
          <div className="rounded-md border border-line bg-panel px-3 py-2 text-xs text-ink/65">{evidence.content}</div>
        </div>
        <div className="grid gap-2">
          <div className="text-xs font-medium text-ink/65">证据-假设关联</div>
          {auditRows.length === 0 ? (
            <div className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink/55">暂无关联记录</div>
          ) : (
            auditRows.map((row) => (
              <div key={row.hypothesisId} className="grid gap-1 rounded-md border border-line bg-panel p-3 text-xs text-ink/65">
                <div>
                  <span className="font-mono">{row.hypothesisCode}</span>
                  <span className="ml-2">{row.beliefCode} · {row.beliefTitle} · {row.proposition}</span>
                </div>
                <div>
                  {row.direction} · 相关性 {row.relevance.toFixed(2)} · LR {row.likelihoodRatio.toFixed(2)} · 置信度{" "}
                  {row.confidence.toFixed(2)}
                </div>
                <div>{row.rationale}</div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }
  const linkRows = createEvidenceLinkEditorRows(editor, evidenceId);
  return (
    <div className="grid gap-4">
      <Link
        href={evidenceLibraryHref(evidence)}
        className="inline-flex min-h-9 w-fit items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink hover:border-moss hover:text-moss"
      >
        <Maximize2 size={16} /> 打开证据编辑区
      </Link>
      <form action={updateEvidenceAction} className="grid gap-3">
        <ReturnPathField returnPath={returnPath} />
        <input type="hidden" name="evidenceId" value={evidence.id} />
        <Field label="证据" name="title" defaultValue={evidence.title} required />
        <Field label="链接" name="url" type="url" defaultValue={evidence.url ?? ""} />
        <Field label="可信度" name="credibility" type="number" step="0.01" min="0" max="1" defaultValue={evidence.credibility} />
        <TextArea label="正文" name="content" defaultValue={evidence.content} required />
        <div className="grid gap-3 border-t border-line pt-3">
          <div className="text-xs font-medium text-ink/65">证据-假设关联</div>
          {linkRows.map((row) => (
            <div key={row.hypothesisId} className="grid gap-2 rounded-md border border-line bg-panel p-3">
              <label className="flex items-start gap-2 text-sm text-ink/75">
                <input name="linkHypothesisIds" value={row.hypothesisId} type="checkbox" defaultChecked={row.checked} className="mt-1" />
                <span>
                  <span className="font-mono text-xs">{row.hypothesisCode}</span>
                  <span className="ml-2">{row.beliefCode} · {row.beliefTitle} · {row.proposition}</span>
                </span>
              </label>
              <Select
                label="方向"
                name={`direction:${row.hypothesisId}`}
                defaultValue={row.direction}
                options={Object.entries(evidenceDirectionLabels).map(([value, label]) => ({ value, label }))}
              />
              <div className="grid gap-2 sm:grid-cols-3">
                <Field label="相关性" name={`relevance:${row.hypothesisId}`} type="number" step="0.01" min="0" max="1" defaultValue={row.relevance} />
                <Field label="似然比" name={`likelihoodRatio:${row.hypothesisId}`} type="number" step="0.01" min="0.01" defaultValue={row.likelihoodRatio} />
                <Field label="置信度" name={`confidence:${row.hypothesisId}`} type="number" step="0.01" min="0" max="1" defaultValue={row.confidence} />
              </div>
              <TextArea label="解释" name={`rationale:${row.hypothesisId}`} defaultValue={row.rationale} />
            </div>
          ))}
        </div>
        <button className="min-h-9 rounded-md bg-moss px-3 text-sm font-semibold text-white">保存证据并重算</button>
      </form>
      {canRejectEvidence(evidence) ? (
        <form action={rejectEvidenceAction} className="border-t border-line pt-4">
          <ReturnPathField returnPath={returnPath} />
          <input type="hidden" name="evidenceId" value={evidence.id} />
          <button className="min-h-9 w-full rounded-md border border-berry px-3 text-sm font-semibold text-berry">拒绝证据并回滚</button>
        </form>
      ) : null}
      {canDeleteEvidence(evidence) ? (
        <form action={deleteEvidenceAction} className="border-t border-line pt-4">
          <ReturnPathField returnPath={returnPath} />
          <input type="hidden" name="evidenceId" value={evidence.id} />
          <button className="min-h-9 w-full rounded-md border border-berry px-3 text-sm font-semibold text-berry">删除证据</button>
        </form>
      ) : null}
    </div>
  );
}

export function ObservationEditor({ editor, observationId, returnPath }: { editor: WorldModelGraphEditorData; observationId: string; returnPath?: string }) {
  const observation = editor.observations.find((item) => item.id === observationId);
  if (!observation) return null;
  const canConfirm = observation.status === "PENDING" || observation.status === "UNKNOWN";
  const sourceOptions = [
    { value: "", label: "未归属来源" },
    ...editor.sources.map((source) => ({ value: source.id, label: `${source.code} · ${source.name}` }))
  ];
  return (
    <div className="grid gap-4">
      <form action={updateGraphObservationAction} className="grid gap-3">
        <ReturnPathField returnPath={returnPath} />
        <input type="hidden" name="observationId" value={observation.id} />
        <div className="rounded-md border border-line bg-panel px-3 py-2 text-xs text-ink/55">
          {observation.status} · 可信度 {observation.credibility.toFixed(2)}
        </div>
        <Select label="来源" name="sourceId" defaultValue={observation.sourceId ?? ""} options={sourceOptions} />
        <Field label="观察" name="title" defaultValue={observation.title} required />
        <Field label="链接" name="url" type="url" defaultValue={observation.url ?? ""} />
        <Field label="可信度" name="credibility" type="number" step="0.01" min="0" max="1" defaultValue={observation.credibility} />
        <TextArea label="正文" name="content" defaultValue={observation.content} required />
        <button className="min-h-9 rounded-md border border-line px-3 text-sm font-semibold text-ink">保存观察</button>
      </form>
      {canConfirm ? (
        <form action={rejectObservationAction} className="grid gap-3 border-t border-line pt-4">
          <ReturnPathField returnPath={returnPath} />
          <input type="hidden" name="observationId" value={observation.id} />
          <button className="min-h-9 rounded-md border border-berry px-3 text-sm font-semibold text-berry">拒绝观察</button>
        </form>
      ) : null}
      <form action={confirmGraphObservationAction} className="grid gap-3 border-t border-line pt-4">
        <ReturnPathField returnPath={returnPath} />
        <input type="hidden" name="observationId" value={observation.id} />
        <div className="text-xs font-medium text-ink/65">观察-假设候选关联</div>
        {observation.links.length === 0 ? (
          <div className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink/55">暂无候选关联</div>
        ) : (
          observation.links.map((row) => (
            <div key={row.hypothesisId} className="grid gap-2 rounded-md border border-line bg-panel p-3">
              <label className="flex items-start gap-2 text-sm text-ink/75">
                <input name="linkHypothesisIds" value={row.hypothesisId} type="checkbox" defaultChecked={row.checked} className="mt-1" />
                <span>
                  <span className="font-mono text-xs">{row.hypothesisCode}</span>
                  <span className="ml-2">{row.beliefCode} · {row.beliefTitle} · {row.proposition}</span>
                </span>
              </label>
              <Select
                label="方向"
                name={`direction:${row.hypothesisId}`}
                defaultValue={row.direction}
                options={Object.entries(evidenceDirectionLabels).map(([value, label]) => ({ value, label }))}
              />
              <div className="grid gap-2 sm:grid-cols-3">
                <Field label="相关性" name={`relevance:${row.hypothesisId}`} type="number" step="0.01" min="0" max="1" defaultValue={row.relevance} />
                <Field label="似然比" name={`likelihoodRatio:${row.hypothesisId}`} type="number" step="0.01" min="0.01" defaultValue={row.likelihoodRatio} />
                <Field label="置信度" name={`confidence:${row.hypothesisId}`} type="number" step="0.01" min="0" max="1" defaultValue={row.confidence} />
              </div>
              <TextArea label="解释" name={`rationale:${row.hypothesisId}`} defaultValue={row.rationale} />
            </div>
          ))
        )}
        <button
          disabled={!canConfirm || observation.links.length === 0}
          className="min-h-9 rounded-md bg-moss px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          确认为证据并更新
        </button>
      </form>
    </div>
  );
}

export function UpdateEditor({ editor, updateId, returnPath }: { editor: WorldModelGraphEditorData; updateId: string; returnPath?: string }) {
  const update = editor.updates.find((item) => item.id === updateId);
  if (!update) return null;
  const audit = createUpdateAuditRows(editor, updateId);

  return (
    <div className="grid gap-3">
      <div className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink/70">
        {update.code} · {update.status}
      </div>
      {audit ? (
        <div className="grid gap-3">
          <div className="grid gap-2 rounded-md border border-line bg-panel p-3 text-xs text-ink/65">
            <div>
              <span className="font-mono">{audit.evidenceCode}</span>
              <span className="ml-2">{audit.evidenceTitle}</span>
              {audit.evidenceStatus ? <span className="ml-2">{audit.evidenceStatus}</span> : null}
            </div>
            <div>
              <span className="font-mono">{audit.beliefCode}</span>
              <span className="ml-2">{audit.beliefTitle}</span>
            </div>
            <div>
              更新置信度 {audit.confidence.toFixed(2)}
              {audit.likelihoodRunCodes && audit.likelihoodRunCodes.length > 0
                ? ` · 似然运行 ${audit.likelihoodRunCodes.join("、")}`
                : audit.likelihoodRunCode
                  ? ` · 似然运行 ${audit.likelihoodRunCode}`
                  : ""}
            </div>
          </div>
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-panel text-ink/50">
                <tr>
                  <th className="px-2 py-2">假设</th>
                  <th className="px-2 py-2">概率</th>
                  <th className="px-2 py-2">变化</th>
                  <th className="px-2 py-2">证据关系</th>
                </tr>
              </thead>
              <tbody>
                {audit.rows.map((row) => (
                  <tr key={row.hypothesisId} className="border-t border-line align-top">
                    <td className="px-2 py-2">
                      <div className="font-mono">{row.hypothesisCode}</div>
                      <div className="mt-1 text-ink/70">{row.proposition}</div>
                    </td>
                    <td className="px-2 py-2">
                      {formatProbability(row.prior)} {"->"} {formatProbability(row.posterior)}
                    </td>
                    <td className={`px-2 py-2 font-semibold ${deltaToneClass(row.delta)}`}>{formatPointDelta(row.delta)}</td>
                    <td className="px-2 py-2 text-ink/65">
                      {row.direction ? (
                        <div>
                          {row.direction} · 相关性 {row.relevance?.toFixed(2) ?? "-"} · LR {row.likelihoodRatio?.toFixed(2) ?? "-"} · 置信度{" "}
                          {row.linkConfidence?.toFixed(2) ?? "-"}
                        </div>
                      ) : (
                        <div>无当前证据关系</div>
                      )}
                      {row.rationale ? <div className="mt-1">{row.rationale}</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {audit.explanations.length > 0 ? (
            <div className="grid gap-1 rounded-md border border-line bg-panel p-3 text-xs text-ink/65">
              {audit.explanations.map((explanation) => (
                <div key={explanation}>{explanation}</div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {canRollbackUpdate(update) ? (
        <form action={rollbackUpdateAction} className="grid gap-3">
          <ReturnPathField returnPath={returnPath} />
          <input type="hidden" name="eventId" value={update.id} />
          <button className="min-h-9 rounded-md border border-line px-3 text-sm font-semibold text-ink">回滚更新</button>
        </form>
      ) : (
        <div className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink/55">已回滚事件不能重复回滚。</div>
      )}
    </div>
  );
}

function HiddenEvidenceLinkFields({ row }: { row: ReturnType<typeof createEvidenceEdgeEditorRows>[number] }) {
  return (
    <div className="hidden">
      <input type="hidden" name="linkHypothesisIds" value={row.hypothesisId} />
      <input type="hidden" name={`direction:${row.hypothesisId}`} value={row.direction} />
      <input type="hidden" name={`relevance:${row.hypothesisId}`} value={row.relevance} />
      <input type="hidden" name={`likelihoodRatio:${row.hypothesisId}`} value={row.likelihoodRatio} />
      <input type="hidden" name={`confidence:${row.hypothesisId}`} value={row.confidence} />
      <input type="hidden" name={`rationale:${row.hypothesisId}`} value={row.rationale} />
    </div>
  );
}

function EvidenceEdgeEditor({
  editor,
  edge,
  returnPath
}: {
  editor: WorldModelGraphEditorData;
  edge: WorldModelGraph["edges"][number];
  returnPath?: string;
}) {
  const evidence = editor.evidence.find((item) => item.id === edge.source);
  if (!evidence) return <div className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink/55">证据已不存在</div>;

  if (!canEditEvidence(evidence)) {
    const auditRows = createEvidenceAuditRows(editor, evidence.id).filter((row) => row.hypothesisId === edge.target);
    return (
      <div className="grid gap-2">
        <div className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink/65">
          {evidence.code} · {evidence.status} · 可信度 {evidence.credibility.toFixed(2)}
        </div>
        {auditRows.map((row) => (
          <div key={row.hypothesisId} className="grid gap-1 rounded-md border border-line bg-panel p-3 text-xs text-ink/65">
            <div>
              {row.hypothesisCode} · {row.beliefCode} · {row.proposition}
            </div>
            <div>
              {row.direction} · 相关性 {row.relevance.toFixed(2)} · LR {row.likelihoodRatio.toFixed(2)} · 置信度 {row.confidence.toFixed(2)}
            </div>
            <div>{row.rationale}</div>
          </div>
        ))}
      </div>
    );
  }

  const rows = createEvidenceEdgeEditorRows(editor, evidence.id, edge.target);
  const selectedRow = rows.find((row) => row.selected);
  if (!selectedRow) return <div className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink/55">关系已不存在</div>;

  const siblingRows = rows.filter((row) => !row.selected);

  return (
    <div className="grid gap-3">
      <form action={updateEvidenceAction} className="grid gap-3">
        <ReturnPathField returnPath={returnPath} />
        <input type="hidden" name="evidenceId" value={evidence.id} />
        <input type="hidden" name="title" value={evidence.title} />
        <input type="hidden" name="url" value={evidence.url ?? ""} />
        <input type="hidden" name="credibility" value={evidence.credibility} />
        <input type="hidden" name="content" value={evidence.content} />
        {siblingRows.map((row) => (
          <HiddenEvidenceLinkFields key={row.hypothesisId} row={row} />
        ))}
        <input type="hidden" name="linkHypothesisIds" value={selectedRow.hypothesisId} />
        <div className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink/70">
          {evidence.code} · {selectedRow.hypothesisCode} · {selectedRow.proposition}
        </div>
        <Select
          label="方向"
          name={`direction:${selectedRow.hypothesisId}`}
          defaultValue={selectedRow.direction}
          options={Object.entries(evidenceDirectionLabels).map(([value, label]) => ({ value, label }))}
        />
        <div className="grid gap-2 sm:grid-cols-3">
          <Field
            label="相关性"
            name={`relevance:${selectedRow.hypothesisId}`}
            type="number"
            step="0.01"
            min="0"
            max="1"
            defaultValue={selectedRow.relevance}
          />
          <Field
            label="似然比"
            name={`likelihoodRatio:${selectedRow.hypothesisId}`}
            type="number"
            step="0.01"
            min="0.01"
            defaultValue={selectedRow.likelihoodRatio}
          />
          <Field
            label="置信度"
            name={`confidence:${selectedRow.hypothesisId}`}
            type="number"
            step="0.01"
            min="0"
            max="1"
            defaultValue={selectedRow.confidence}
          />
        </div>
        <TextArea label="解释" name={`rationale:${selectedRow.hypothesisId}`} defaultValue={selectedRow.rationale} />
        <button className="min-h-9 rounded-md bg-moss px-3 text-sm font-semibold text-white">保存关系并重算</button>
      </form>
      <form action={disconnectEvidenceHypothesisAction} className="border-t border-line pt-3" data-evidence-edge-disconnect="true">
        <ReturnPathField returnPath={returnPath} />
        <input type="hidden" name="evidenceId" value={evidence.id} />
        <input type="hidden" name="hypothesisId" value={selectedRow.hypothesisId} />
        <button className="min-h-9 w-full rounded-md border border-berry px-3 text-sm font-semibold text-berry">断开关系并重算</button>
      </form>
    </div>
  );
}

function CandidateEdgeEditor({
  editor,
  edge,
  returnPath
}: {
  editor: WorldModelGraphEditorData;
  edge: WorldModelGraph["edges"][number];
  returnPath?: string;
}) {
  const observation = editor.observations.find((item) => item.id === edge.source);
  const hypothesis = editor.hypotheses.find((item) => item.id === edge.target);
  if (!observation || !hypothesis) {
    return <div className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink/55">候选关系已不存在</div>;
  }
  const linkRows = createObservationConnectionEditorRows(editor, observation.id, hypothesis.id);
  if (linkRows.length === 0) {
    return <div className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink/55">没有当前有效假设可确认</div>;
  }
  return (
    <form action={connectObservationHypothesisAction} className="grid gap-3">
      <ReturnPathField returnPath={returnPath} />
      <input type="hidden" name="observationId" value={observation.id} />
      <div className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink/70">
        {observation.code} · {hypothesis.code}
      </div>
      {linkRows.map((row) => (
        <div key={row.hypothesisId} className="grid gap-2 rounded-md border border-line bg-panel p-3">
          <label className="flex items-start gap-2 text-sm text-ink/75">
            <input name="linkHypothesisIds" value={row.hypothesisId} type="checkbox" defaultChecked={row.checked} className="mt-1" />
            <span>
              <span className="font-mono text-xs">{row.hypothesisCode}</span>
              <span className="ml-2">{row.beliefCode} · {row.beliefTitle} · {row.proposition}</span>
            </span>
          </label>
          <Select
            label="方向"
            name={`direction:${row.hypothesisId}`}
            defaultValue={row.direction}
            options={Object.entries(evidenceDirectionLabels).map(([value, label]) => ({ value, label }))}
          />
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="相关性" name={`relevance:${row.hypothesisId}`} type="number" step="0.01" min="0" max="1" defaultValue={row.relevance} />
            <Field label="似然比" name={`likelihoodRatio:${row.hypothesisId}`} type="number" step="0.01" min="0.01" defaultValue={row.likelihoodRatio} />
            <Field label="置信度" name={`confidence:${row.hypothesisId}`} type="number" step="0.01" min="0" max="1" defaultValue={row.confidence} />
          </div>
          <TextArea label="解释" name={`rationale:${row.hypothesisId}`} defaultValue={row.rationale} required />
        </div>
      ))}
      <button className="min-h-9 rounded-md bg-moss px-3 text-sm font-semibold text-white">确认为证据并更新</button>
    </form>
  );
}

function SourceObservationAssignmentEditor({
  editor,
  sourceId,
  observationId,
  returnPath
}: {
  editor: WorldModelGraphEditorData;
  sourceId: string;
  observationId: string;
  returnPath?: string;
}) {
  const source = editor.sources.find((item) => item.id === sourceId);
  const observation = editor.observations.find((item) => item.id === observationId);
  if (!source || !observation) return null;
  return (
    <form action={connectSourceObservationAction} className="grid gap-3">
      <ReturnPathField returnPath={returnPath} />
      <input type="hidden" name="sourceId" value={source.id} />
      <input type="hidden" name="observationId" value={observation.id} />
      <div className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink/70">
        将 {observation.code} 归属到 {source.code}
      </div>
      <button className="min-h-9 rounded-md bg-moss px-3 text-sm font-semibold text-white">保存观察来源</button>
    </form>
  );
}

export function GraphEdgeEditor({
  editor,
  edge,
  nodeById,
  returnPath
}: {
  editor: WorldModelGraphEditorData;
  edge: WorldModelGraph["edges"][number];
  nodeById: Map<string, WorldModelGraphNode>;
  returnPath?: string;
}) {
  const source = nodeById.get(edge.source);
  const target = nodeById.get(edge.target);
  return (
    <div className="grid gap-3">
      <div>
        <div className="text-xs font-medium text-ink/50">{edge.relation}</div>
        <h3 className="text-sm font-semibold text-ink">
          {source?.code ?? edge.source} {"->"} {target?.code ?? edge.target}
        </h3>
      </div>
      <div className="rounded-md border border-line bg-panel px-3 py-2 text-xs text-ink/65">{edge.label}</div>
      {edge.relation === "COLLECTED" ? (
        <SourceObservationAssignmentEditor editor={editor} sourceId={edge.source} observationId={edge.target} returnPath={returnPath} />
      ) : null}
      {edge.relation === "CONFIRMED_AS" ? <EvidenceEditor editor={editor} evidenceId={edge.target} returnPath={returnPath} /> : null}
      {edge.relation === "INFLUENCES" ? <EvidenceEdgeEditor editor={editor} edge={edge} returnPath={returnPath} /> : null}
      {edge.relation === "CANDIDATE" ? <CandidateEdgeEditor editor={editor} edge={edge} returnPath={returnPath} /> : null}
      {edge.relation === "UPDATED" ? <UpdateEditor editor={editor} updateId={edge.source} returnPath={returnPath} /> : null}
      {edge.relation === "PRODUCED" ? <UpdateEditor editor={editor} updateId={edge.target} returnPath={returnPath} /> : null}
      {edge.relation === "OWNS" ? (
        <div className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink/55">选择信念或假设节点可编辑结构字段。</div>
      ) : null}
    </div>
  );
}

export function ConnectionEditor({
  editor,
  connection,
  returnPath
}: {
  editor: WorldModelGraphEditorData;
  connection: PendingConnection;
  returnPath?: string;
}) {
  const intent = connectionIntent(connection);
  if (intent.kind === "moveHypothesis") {
    const hypothesis = editor.hypotheses.find((item) => item.id === intent.hypothesisId);
    const belief = editor.beliefs.find((item) => item.id === intent.beliefId);
    if (!hypothesis || !belief) return null;
    return (
      <form action={updateHypothesisAction} className="grid gap-3">
        <ReturnPathField returnPath={returnPath} />
        <input type="hidden" name="hypothesisId" value={hypothesis.id} />
        <input type="hidden" name="beliefId" value={belief.id} />
        <input type="hidden" name="proposition" value={hypothesis.proposition} />
        <input type="hidden" name="notes" value={hypothesis.notes} />
        <input type="hidden" name="evidenceSearchQuery" value={hypothesis.evidenceSearchQuery ?? ""} />
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
        <ReturnPathField returnPath={returnPath} />
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

  if (intent.kind === "assignSource") {
    return (
      <SourceObservationAssignmentEditor
        editor={editor}
        sourceId={intent.sourceId}
        observationId={intent.observationId}
        returnPath={returnPath}
      />
    );
  }

  if (intent.kind === "confirmObservation") {
    const observation = editor.observations.find((item) => item.id === intent.observationId);
    const hypothesis = editor.hypotheses.find((item) => item.id === intent.hypothesisId);
    if (!observation || !hypothesis) return null;
    const linkRows = createObservationConnectionEditorRows(editor, observation.id, hypothesis.id);
    if (linkRows.length === 0) {
      return <div className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink/55">没有当前有效假设可确认</div>;
    }
    return (
      <form action={connectObservationHypothesisAction} className="grid gap-3">
        <ReturnPathField returnPath={returnPath} />
        <input type="hidden" name="observationId" value={observation.id} />
        <div className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink/70">
          {observation.code} 连接到 {hypothesis.code}
        </div>
        <div className="grid gap-3 border-t border-line pt-3">
          <div className="text-xs font-medium text-ink/65">观察-假设候选关联</div>
          {linkRows.map((row) => (
            <div key={row.hypothesisId} className="grid gap-2 rounded-md border border-line bg-panel p-3">
              <label className="flex items-start gap-2 text-sm text-ink/75">
                <input name="linkHypothesisIds" value={row.hypothesisId} type="checkbox" defaultChecked={row.checked} className="mt-1" />
                <span>
                  <span className="font-mono text-xs">{row.hypothesisCode}</span>
                  <span className="ml-2">{row.beliefCode} · {row.beliefTitle} · {row.proposition}</span>
                </span>
              </label>
              <Select
                label="方向"
                name={`direction:${row.hypothesisId}`}
                defaultValue={row.direction}
                options={Object.entries(evidenceDirectionLabels).map(([value, label]) => ({ value, label }))}
              />
              <div className="grid gap-2 sm:grid-cols-3">
                <Field label="相关性" name={`relevance:${row.hypothesisId}`} type="number" step="0.01" min="0" max="1" defaultValue={row.relevance} />
                <Field label="似然比" name={`likelihoodRatio:${row.hypothesisId}`} type="number" step="0.01" min="0.01" defaultValue={row.likelihoodRatio} />
                <Field label="置信度" name={`confidence:${row.hypothesisId}`} type="number" step="0.01" min="0" max="1" defaultValue={row.confidence} />
              </div>
              <TextArea label="解释" name={`rationale:${row.hypothesisId}`} defaultValue={row.rationale} required />
            </div>
          ))}
        </div>
        <button className="min-h-9 rounded-md bg-moss px-3 text-sm font-semibold text-white">确认为证据并更新</button>
      </form>
    );
  }

  return <div className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-berry">该连接没有可保存的业务含义。</div>;
}

function NodeEditor({
  editor,
  selectedNode,
  returnPath,
  filteredNodeId,
  onFilterNode,
  onClearFilter
}: {
  editor: WorldModelGraphEditorData;
  selectedNode?: WorldModelGraphNode;
  returnPath?: string;
  filteredNodeId?: string | null;
  onFilterNode: (nodeId: string) => void;
  onClearFilter: () => void;
}) {
  if (!selectedNode) {
    return <div className="text-sm text-ink/55">未选择节点</div>;
  }

  const isFilteredToSelected = filteredNodeId === selectedNode.id;

  return (
    <div className="grid gap-3">
      <div>
        <div className="text-xs font-medium text-ink/50">{selectedNode.type.toUpperCase()}</div>
        <h3 className="text-sm font-semibold text-ink">
          {selectedNode.code} · {selectedNode.label}
        </h3>
      </div>
      <button
        type="button"
        onClick={() => {
          if (isFilteredToSelected) {
            onClearFilter();
          } else {
            onFilterNode(selectedNode.id);
          }
        }}
        className="inline-flex min-h-9 w-fit items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink hover:border-moss hover:text-moss"
      >
        {isFilteredToSelected ? <X size={16} /> : <Filter size={16} />}
        {isFilteredToSelected ? "显示全部" : "只看相关"}
      </button>
      {selectedNode.type === "source" ? <SourceEditor editor={editor} sourceId={selectedNode.id} returnPath={returnPath} /> : null}
      {selectedNode.type === "belief" ? <BeliefEditor editor={editor} beliefId={selectedNode.id} returnPath={returnPath} /> : null}
      {selectedNode.type === "hypothesis" ? <HypothesisEditor editor={editor} hypothesisId={selectedNode.id} returnPath={returnPath} /> : null}
      {selectedNode.type === "observation" ? <ObservationEditor editor={editor} observationId={selectedNode.id} returnPath={returnPath} /> : null}
      {selectedNode.type === "evidence" ? <EvidenceEditor editor={editor} evidenceId={selectedNode.id} returnPath={returnPath} /> : null}
      {selectedNode.type === "update" ? <UpdateEditor editor={editor} updateId={selectedNode.id} returnPath={returnPath} /> : null}
    </div>
  );
}

export function WorldModelGraphView({
  graph,
  editor,
  mode = "embedded",
  returnPath,
  initialSelection
}: {
  graph: WorldModelGraph;
  editor?: WorldModelGraphEditorData;
  mode?: WorldModelGraphViewMode;
  returnPath?: string;
  initialSelection?: WorldModelGraphInitialSelection;
}) {
  const nodeIdMap = useMemo(() => createFlowNodeIdMap(graph.nodes), [graph.nodes]);
  const initialNodes = useMemo(() => createFlowNodes(graph.nodes, nodeIdMap), [graph.nodes, nodeIdMap]);
  const [nodes, setNodes] = useState<Node<FlowData>[]>(initialNodes);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<Node<FlowData>, Edge<FlowEdgeData>> | null>(null);
  const nodeByCode = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const graphNodeById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const graphEdgeById = useMemo(() => new Map(graph.edges.map((edge) => [edge.id, edge])), [graph.edges]);
  const initialSelectionNodeCandidate = initialSelection?.nodeId;
  const initialSelectionNodeId = useMemo(
    () => createGraphInitialSelection(graph.nodes, { nodeId: initialSelectionNodeCandidate }, graph.edges).nodeId,
    [graph.edges, graph.nodes, initialSelectionNodeCandidate]
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(initialSelectionNodeId);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [pendingConnection, setPendingConnection] = useState<PendingConnection | null>(null);
  const [filteredNodeId, setFilteredNodeId] = useState<string | null>(null);
  const [embeddedPanActivated, setEmbeddedPanActivated] = useState(false);
  const filteredNodeIds = useMemo(() => (filteredNodeId ? createRelatedNodeIds(graph, filteredNodeId) : null), [filteredNodeId, graph]);
  const visibleGraphEdges = useMemo(
    () => (filteredNodeIds ? graph.edges.filter((edge) => filteredNodeIds.has(edge.source) && filteredNodeIds.has(edge.target)) : graph.edges),
    [filteredNodeIds, graph.edges]
  );
  const edges = useMemo(() => createFlowEdges(visibleGraphEdges, nodeIdMap), [nodeIdMap, visibleGraphEdges]);
  const visibleNodes = useMemo<Node<FlowData>[]>(
    () =>
      nodes
        .filter((node) => !filteredNodeIds || filteredNodeIds.has(node.data.domainId))
        .map((node) => {
          const selected = node.data.domainId === selectedNodeId;
          return {
            ...node,
            selected,
            style: createGraphNodeVisualStyle(node.style ?? {}, selected)
          };
        }),
    [filteredNodeIds, nodes, selectedNodeId]
  );
  const interactionOptions = useMemo(
    () => createGraphInteractionOptions({ mode, panActivated: embeddedPanActivated }),
    [embeddedPanActivated, mode]
  );
  const viewportOptions = useMemo(
    () => createGraphViewportOptions({ mode, nodeCount: graph.nodes.length }),
    [graph.nodes.length, mode]
  );

  useEffect(() => {
    setNodes(mergeSavedPositions(initialNodes));
  }, [initialNodes]);

  useEffect(() => {
    setSelectedNodeId(initialSelectionNodeId);
    setSelectedEdgeId(null);
    setPendingConnection(null);
    setFilteredNodeId(null);
  }, [initialSelectionNodeId]);

  useEffect(() => {
    if (filteredNodeId && !graphNodeById.has(filteredNodeId)) {
      setFilteredNodeId(null);
    }
  }, [filteredNodeId, graphNodeById]);

  const onNodesChange = useCallback(
    (changes: NodeChange<Node<FlowData>>[]) => {
      setNodes((current) => {
        const next = applyNodeChanges(changes, current);
        savePositions(next);
        return next;
      });
    },
    []
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
      setSelectedEdgeId(null);
    },
    [nodeByCode]
  );

  const filterSelectedNode = useCallback(
    (nodeId: string) => {
      setFilteredNodeId(nodeId);
      setSelectedNodeId(nodeId);
      setSelectedEdgeId(null);
      setPendingConnection(null);
      window.requestAnimationFrame(() => {
        void flowInstance?.fitView({ duration: 160 });
      });
    },
    [flowInstance]
  );

  const clearNodeFilter = useCallback(() => {
    setFilteredNodeId(null);
    window.requestAnimationFrame(() => {
      void flowInstance?.fitView({ duration: 160 });
    });
  }, [flowInstance]);

  if (graph.nodes.length === 0) {
    return <div className="rounded-md border border-dashed border-line bg-white px-4 py-6 text-sm text-ink/55">暂无图谱数据</div>;
  }

  const selectedNode = selectedNodeId ? graphNodeById.get(selectedNodeId) : undefined;
  const selectedEdge = selectedEdgeId ? graphEdgeById.get(selectedEdgeId) : undefined;
  const filteredNode = filteredNodeId ? graphNodeById.get(filteredNodeId) : undefined;
  const canvasHeightClass = mode === "workspace" ? "h-[calc(100vh-150px)] min-h-[640px]" : "h-[clamp(640px,calc(100vh-120px),860px)]";
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
        <ReactFlow<Node<FlowData>, Edge<FlowEdgeData>>
          nodes={visibleNodes}
          edges={edges}
          fitView={viewportOptions.fitView}
          fitViewOptions={viewportOptions.fitView ? viewportOptions.fitViewOptions : undefined}
          defaultViewport={!viewportOptions.fitView ? viewportOptions.defaultViewport : undefined}
          minZoom={0.25}
          maxZoom={1.4}
          onInit={(instance) => setFlowInstance(instance)}
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) => {
            setSelectedNodeId(node.data.domainId);
            setSelectedEdgeId(null);
            setPendingConnection(null);
          }}
          onEdgeClick={(_, edge) => {
            setSelectedEdgeId(edge.data?.edgeId ?? null);
            setSelectedNodeId(null);
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
        {filteredNode ? (
          <div className="mb-3 flex items-center justify-between gap-2 rounded-md border border-moss/30 bg-moss/5 px-3 py-2 text-xs text-moss">
            <span className="min-w-0">
              只看相关 · {filteredNode.code} · {filteredNode.label}
            </span>
            <button type="button" className="shrink-0 whitespace-nowrap font-semibold hover:underline" onClick={clearNodeFilter}>
              显示全部
            </button>
          </div>
        ) : null}
        {editor && pendingConnection ? <ConnectionEditor editor={editor} connection={pendingConnection} returnPath={returnPath} /> : null}
        {editor && !pendingConnection && selectedEdge ? (
          <GraphEdgeEditor editor={editor} edge={selectedEdge} nodeById={graphNodeById} returnPath={returnPath} />
        ) : null}
        {editor && !pendingConnection && !selectedEdge ? (
          <NodeEditor
            editor={editor}
            selectedNode={selectedNode}
            returnPath={returnPath}
            filteredNodeId={filteredNodeId}
            onFilterNode={filterSelectedNode}
            onClearFilter={clearNodeFilter}
          />
        ) : null}
        {!editor ? <div className="text-sm text-ink/55">当前图谱未提供可编辑数据。</div> : null}
      </aside>
    </div>
  );
}
