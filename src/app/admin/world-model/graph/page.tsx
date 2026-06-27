import Link from "next/link";
import { loadWorldModelData } from "@/app/admin/world-model/data";
import { DataWarning, StatusNotice } from "@/components/world-model/PageSection";
import { WorldModelGraphView } from "@/components/world-model/WorldModelGraphView";
import { createReadableCodes, readableCode } from "@/lib/world-model-display";
import { createWorldModelGraph, focusWorldModelGraphData } from "@/lib/world-model-graph";
import { createWorldModelGraphEditorData } from "@/lib/world-model-graph-editor";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function graphBeliefHref(beliefCode: string) {
  const params = new URLSearchParams({ belief: beliefCode });
  return `/admin/world-model/graph?${params.toString()}`;
}

function graphHypothesisHref(hypothesisCode: string) {
  const params = new URLSearchParams({ hypothesis: hypothesisCode });
  return `/admin/world-model/graph?${params.toString()}`;
}

function graphUpdateHref(updateCode: string) {
  const params = new URLSearchParams({ update: updateCode });
  return `/admin/world-model/graph?${params.toString()}`;
}

function graphEvidenceHref(evidenceCode: string) {
  const params = new URLSearchParams({ evidence: evidenceCode });
  return `/admin/world-model/graph?${params.toString()}`;
}

function graphSourceHref(sourceCode: string) {
  const params = new URLSearchParams({ source: sourceCode });
  return `/admin/world-model/graph?${params.toString()}`;
}

export default async function WorldModelGraphPage({ searchParams }: PageProps) {
  const data = await loadWorldModelData();
  const params = (await searchParams) ?? {};
  const fullGraphData = { sources: data.sources, beliefs: data.beliefs, observations: data.observations, evidence: data.evidence, updates: data.updates };
  const sourceCodes = createReadableCodes(data.sources, "S", (source) => source.createdAt);
  const beliefCodes = createReadableCodes(data.beliefs, "B", (belief) => belief.createdAt);
  const hypotheses = data.beliefs.flatMap((belief) => belief.hypotheses);
  const hypothesisCodes = createReadableCodes(hypotheses, "H", (hypothesis) => hypothesis.createdAt);
  const evidenceCodes = createReadableCodes(data.evidence, "E", (evidence) => evidence.confirmedAt);
  const updateCodes = createReadableCodes(data.updates, "U", (event) => event.createdAt);
  const selectedSourceCode = firstParam(params.source);
  const selectedBeliefCode = firstParam(params.belief);
  const selectedHypothesisCode = firstParam(params.hypothesis);
  const selectedEvidenceCode = firstParam(params.evidence);
  const selectedUpdateCode = firstParam(params.update);
  const selectedSource = data.sources.find((source) => readableCode(sourceCodes, source.id, "S") === selectedSourceCode);
  const selectedBelief = data.beliefs.find((belief) => readableCode(beliefCodes, belief.id, "B") === selectedBeliefCode);
  const selectedHypothesis = hypotheses.find(
    (hypothesis) => readableCode(hypothesisCodes, hypothesis.id, "H") === selectedHypothesisCode
  );
  const selectedEvidence = data.evidence.find((evidence) => readableCode(evidenceCodes, evidence.id, "E") === selectedEvidenceCode);
  const selectedUpdate = data.updates.find((event) => readableCode(updateCodes, event.id, "U") === selectedUpdateCode);
  const graphData = focusWorldModelGraphData(
    fullGraphData,
    selectedUpdate
      ? { updateId: selectedUpdate.id }
      : selectedEvidence
        ? { evidenceId: selectedEvidence.id }
        : selectedHypothesis
          ? { hypothesisId: selectedHypothesis.id }
          : selectedSource
            ? { sourceId: selectedSource.id }
            : selectedBelief
              ? { beliefId: selectedBelief.id }
              : undefined
  );
  const graph = createWorldModelGraph(graphData, fullGraphData);
  const graphEditor = createWorldModelGraphEditorData({
    sources: data.sources,
    beliefs: data.beliefs,
    observations: data.observations,
    evidence: data.evidence,
    updates: data.updates,
    likelihoodRuns: data.likelihoodRuns
  });
  const graphReturnPath =
    selectedUpdateCode && selectedUpdate
      ? graphUpdateHref(selectedUpdateCode)
      : selectedEvidenceCode && selectedEvidence
        ? graphEvidenceHref(selectedEvidenceCode)
        : selectedHypothesisCode && selectedHypothesis
          ? graphHypothesisHref(selectedHypothesisCode)
          : selectedSourceCode && selectedSource
            ? graphSourceHref(selectedSourceCode)
            : selectedBeliefCode && selectedBelief
              ? graphBeliefHref(selectedBeliefCode)
              : "/admin/world-model/graph";
  const graphTitle = selectedUpdate
    ? `证据影响图谱 · ${readableCode(updateCodes, selectedUpdate.id, "U")}`
    : selectedEvidence
      ? `证据影响图谱 · ${readableCode(evidenceCodes, selectedEvidence.id, "E")}`
      : selectedHypothesis
        ? `证据影响图谱 · ${readableCode(hypothesisCodes, selectedHypothesis.id, "H")} · ${selectedHypothesis.proposition}`
        : selectedSource
          ? `证据影响图谱 · ${readableCode(sourceCodes, selectedSource.id, "S")} · ${selectedSource.name}`
          : selectedBelief
            ? `证据影响图谱 · ${selectedBelief.title}`
            : "证据影响图谱 · 图谱工作区";
  const initialSelection = selectedUpdate
    ? { nodeId: selectedUpdate.id }
    : selectedEvidence
      ? { nodeId: selectedEvidence.id }
      : selectedHypothesis
        ? { nodeId: selectedHypothesis.id }
        : selectedSource
          ? { nodeId: selectedSource.id }
          : selectedBelief
            ? { nodeId: selectedBelief.id }
            : undefined;
  const hasGraphFocus = Boolean(selectedUpdate || selectedEvidence || selectedHypothesis || selectedSource || selectedBelief);

  return (
    <main className="px-4 py-4 sm:px-6 lg:px-8">
      <DataWarning message={data.error} />
      <StatusNotice message={firstParam(params.message)} />
      <StatusNotice message={firstParam(params.error)} tone="error" />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/65">
          {graphTitle}
        </h2>
        <Link
          href="/admin/world-model/evidence"
          className="inline-flex min-h-9 items-center rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink hover:border-moss hover:text-moss"
        >
          证据库
        </Link>
      </div>
      <nav aria-label="信念图谱筛选" className="mb-3 flex gap-2 overflow-x-auto pb-1">
        <Link
          href="/admin/world-model/graph"
          className={`inline-flex min-h-9 shrink-0 items-center rounded-md border px-3 text-sm font-semibold ${
            hasGraphFocus ? "border-line bg-white text-ink hover:border-moss hover:text-moss" : "border-moss bg-moss text-white"
          }`}
        >
          全部图谱
        </Link>
        {data.beliefs.map((belief) => {
          const beliefCode = readableCode(beliefCodes, belief.id, "B");
          const active = selectedBelief?.id === belief.id || selectedHypothesis?.beliefId === belief.id;
          return (
            <Link
              key={belief.id}
              href={graphBeliefHref(beliefCode)}
              className={`inline-flex min-h-9 shrink-0 items-center rounded-md border px-3 text-sm font-semibold ${
                active ? "border-moss bg-moss text-white" : "border-line bg-white text-ink hover:border-moss hover:text-moss"
              }`}
            >
              {beliefCode} · {belief.title}
            </Link>
          );
        })}
        {data.sources.map((source) => {
          const sourceCode = readableCode(sourceCodes, source.id, "S");
          const active = selectedSource?.id === source.id;
          return (
            <Link
              key={source.id}
              href={graphSourceHref(sourceCode)}
              className={`inline-flex min-h-9 shrink-0 items-center rounded-md border px-3 text-sm font-semibold ${
                active ? "border-moss bg-moss text-white" : "border-line bg-white text-ink hover:border-moss hover:text-moss"
              }`}
            >
              {sourceCode} · {source.name}
            </Link>
          );
        })}
      </nav>
      <WorldModelGraphView
        graph={graph}
        editor={graphEditor}
        mode="workspace"
        returnPath={graphReturnPath}
        initialSelection={initialSelection}
      />
    </main>
  );
}
