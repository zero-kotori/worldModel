import Link from "next/link";
import { Check, Maximize2, Play, RotateCcw, Save, Trash2, Zap } from "lucide-react";
import {
  applyEvidenceUpdateAction,
  confirmEvidenceAction,
  createEvidenceFromObservationAction,
  deleteEvidenceAction,
  rejectEvidenceAction,
  runEvidenceLoopAction,
  runEvidenceLoopDryRunAction,
  updateEvidenceAction,
  rollbackUpdateAction
} from "@/app/admin/world-model/actions";
import { loadWorldModelData } from "@/app/admin/world-model/data";
import { createUpdatePreview } from "@/domain/updates";
import { isHypothesisCurrentlyEffective } from "@/lib/world-model-beliefs-ui";
import { createReadableCodes, readableCode } from "@/lib/world-model-display";
import {
  canApplyEvidenceUpdate,
  canDeleteEvidence,
  canEditEvidence,
  canRejectEvidence,
  evidenceCandidateEvaluationSummary,
  evidenceQueryContextSummary
} from "@/lib/world-model-evidence-ui";
import { createWorldModelGraph } from "@/lib/world-model-graph";
import { createWorldModelGraphEditorData } from "@/lib/world-model-graph-editor";
import { getObservationRecommendedLinks } from "@/lib/world-model-observations-ui";
import { evidenceDirectionLabels, hypothesisStanceLabels } from "@/lib/world-model-navigation";
import { createRollbackOptions, summarizeUpdateDelta, summarizeUpdateExplanation } from "@/lib/world-model-updates-ui";
import { Field, SelectField, TextAreaField } from "@/components/world-model/Field";
import { DataWarning, EmptyState, PageSection, StatusNotice } from "@/components/world-model/PageSection";
import { WorldModelGraphView } from "@/components/world-model/WorldModelGraphView";
import type { BeliefRecord, EvidenceRecord, HypothesisRecord } from "@/server/services/types";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function deltaToneClass(tone: ReturnType<typeof summarizeUpdateDelta>["tone"]) {
  if (tone === "increase") return "text-moss";
  if (tone === "decrease") return "text-berry";
  return "text-ink/55";
}

function probabilityDeltaToneClass(delta: number) {
  if (delta > 0.000001) return "text-moss";
  if (delta < -0.000001) return "text-berry";
  return "text-ink/55";
}

function formatProbability(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatPointDelta(value: number) {
  const points = value * 100;
  const sign = points > 0 ? "+" : "";
  return `${sign}${points.toFixed(1)}pp`;
}

const hypothesisLinkRowClass = "grid gap-2 border-t border-line py-3 lg:grid-cols-[minmax(18rem,2fr)_repeat(4,minmax(8rem,1fr))]";
const hypothesisLinkSummaryClass = "flex items-start gap-2 text-sm text-ink/75";

function withEffectiveHypotheses(beliefs: BeliefRecord[], referenceTime = new Date()) {
  return beliefs
    .map((belief) => ({
      ...belief,
      hypotheses: belief.hypotheses.filter((hypothesis) => isHypothesisCurrentlyEffective(hypothesis, referenceTime))
    }))
    .filter((belief) => belief.hypotheses.length > 0);
}

function createEvidencePreviewGroups(evidence: EvidenceRecord, beliefs: BeliefRecord[]) {
  const hypothesisBeliefIds = new Map<string, string>();
  const effectiveBeliefs = withEffectiveHypotheses(beliefs);
  for (const belief of effectiveBeliefs) {
    for (const hypothesis of belief.hypotheses) {
      hypothesisBeliefIds.set(hypothesis.id, belief.id);
    }
  }

  return effectiveBeliefs.flatMap((belief) => {
    const links = evidence.links.filter((link) => hypothesisBeliefIds.get(link.hypothesisId) === belief.id);
    if (links.length === 0) return [];

    const preview = createUpdatePreview(
      {
        id: belief.id,
        probabilityMode: belief.probabilityMode,
        hypotheses: belief.hypotheses.map((hypothesis) => ({
          id: hypothesis.id,
          proposition: hypothesis.proposition,
          currentProbability: hypothesis.currentProbability,
          strength: hypothesis.strength
        }))
      },
      links.map((link) => ({
        hypothesisId: link.hypothesisId,
        likelihoodRatio: link.likelihoodRatio,
        credibility: evidence.credibility,
        confidence: link.confidence,
        rationale: link.rationale
      }))
    );

    return [
      {
        belief,
        confidence: preview.confidence,
        reviewRequired: preview.reviewRequired,
        rows: belief.hypotheses.map((hypothesis) => ({
          hypothesis,
          prior: preview.priorSnapshot[hypothesis.id] ?? hypothesis.currentProbability,
          posterior: preview.posteriorSnapshot[hypothesis.id] ?? hypothesis.currentProbability
        }))
      }
    ];
  });
}

function HypothesisLinkControls({
  beliefs,
  defaultRationale
}: {
  beliefs: Awaited<ReturnType<typeof loadWorldModelData>>["beliefs"];
  defaultRationale: string;
}) {
  const hypothesisCodes = createReadableCodes(
    beliefs.flatMap((belief) => belief.hypotheses),
    "H",
    (hypothesis) => hypothesis.createdAt
  );

  if (beliefs.length === 0) {
    return <div className="text-sm text-ink/55">暂无可关联假设</div>;
  }

  return (
    <div className="grid gap-3 lg:col-span-4">
      <div className="text-xs font-medium text-ink/65">关联假设</div>
      {beliefs.map((belief) => (
        <div key={belief.id} className="grid gap-2 rounded-md border border-line bg-panel p-3">
          <div className="text-sm font-semibold text-ink">{belief.title}</div>
          {belief.hypotheses.map((hypothesis) => (
            <div key={hypothesis.id} className={hypothesisLinkRowClass}>
              <label className={hypothesisLinkSummaryClass}>
                <input name="linkHypothesisIds" value={hypothesis.id} type="checkbox" className="mt-1" />
                <span>
                  <span className="font-mono text-xs">{readableCode(hypothesisCodes, hypothesis.id, "H")}</span>
                  <span className="ml-2">{hypothesis.proposition}</span>
                  <span className="ml-2 text-xs text-ink/45">
                    {hypothesisStanceLabels[hypothesis.stance]} · {(hypothesis.currentProbability * 100).toFixed(1)}%
                  </span>
                </span>
              </label>
              <SelectField
                label="方向"
                name={`direction:${hypothesis.id}`}
                defaultValue="SUPPORTS"
                options={Object.entries(evidenceDirectionLabels).map(([value, label]) => ({ value, label }))}
              />
              <Field
                label="相关性"
                name={`relevance:${hypothesis.id}`}
                type="number"
                step="0.01"
                min="0"
                max="1"
                defaultValue="0.8"
              />
              <Field
                label="似然比"
                name={`likelihoodRatio:${hypothesis.id}`}
                type="number"
                step="0.01"
                min="0.01"
                defaultValue="1.5"
              />
              <Field
                label="置信度"
                name={`confidence:${hypothesis.id}`}
                type="number"
                step="0.01"
                min="0"
                max="1"
                defaultValue="0.7"
              />
              <div className="lg:col-span-5">
                <TextAreaField label="解释" name={`rationale:${hypothesis.id}`} defaultValue={defaultRationale} />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default async function EvidencePage({ searchParams }: PageProps) {
  const data = await loadWorldModelData();
  const params = (await searchParams) ?? {};
  const sources = data.sources ?? [];
  const pendingObservations = data.observations.filter((observation) =>
    observation.status === "PENDING" || observation.status === "UNKNOWN" || observation.status === "DUPLICATE"
  );
  const appliedEvidenceIds = new Set(data.updates.filter((event) => event.status === "APPLIED").map((event) => event.evidenceId));
  const observationCodes = createReadableCodes(data.observations, "O", (observation) => observation.observedAt);
  const selectedObservationParam = firstParam(params.observation);
  const selectedObservation = pendingObservations.find(
    (observation) => observation.id === selectedObservationParam || readableCode(observationCodes, observation.id, "O") === selectedObservationParam
  );
  const evidenceCodes = createReadableCodes(data.evidence, "E", (evidence) => evidence.confirmedAt);
  const selectedEvidenceParam = firstParam(params.evidence);
  const selectedEvidence = data.evidence.find(
    (evidence) => evidence.id === selectedEvidenceParam || readableCode(evidenceCodes, evidence.id, "E") === selectedEvidenceParam
  );
  const selectedEvidenceCode = selectedEvidence ? readableCode(evidenceCodes, selectedEvidence.id, "E") : undefined;
  const evidenceReturnPath = selectedEvidenceCode
    ? `/admin/world-model/evidence?evidence=${encodeURIComponent(selectedEvidenceCode)}#${encodeURIComponent(selectedEvidenceCode)}`
    : "/admin/world-model/evidence";
  const updateCodes = createReadableCodes(data.updates, "U", (event) => event.createdAt);
  const selectedUpdateParam = firstParam(params.update);
  const selectedUpdate = data.updates.find(
    (event) => event.id === selectedUpdateParam || readableCode(updateCodes, event.id, "U") === selectedUpdateParam
  );
  const selectedUpdateCode = selectedUpdate ? readableCode(updateCodes, selectedUpdate.id, "U") : undefined;
  const updateReturnPath = selectedUpdateCode
    ? `/admin/world-model/evidence?update=${encodeURIComponent(selectedUpdateCode)}#${encodeURIComponent(selectedUpdateCode)}`
    : "/admin/world-model/evidence#update-events";
  const evidenceLoopReturnPath = "/admin/world-model/evidence#evidence-loop";
  const beliefCodes = createReadableCodes(data.beliefs, "B", (belief) => belief.createdAt);
  const hypothesisCodes = createReadableCodes(
    data.beliefs.flatMap((belief) => belief.hypotheses),
    "H",
    (hypothesis) => hypothesis.createdAt
  );
  const evidenceById = new Map(data.evidence.map((evidence) => [evidence.id, evidence]));
  const allHypotheses = data.beliefs.flatMap((belief) => belief.hypotheses.map((hypothesis) => ({ belief, hypothesis })));
  const effectiveBeliefs = withEffectiveHypotheses(data.beliefs);
  const canCreateEvidenceUpdates = effectiveBeliefs.length > 0;
  const canConfirmObservation = canCreateEvidenceUpdates && pendingObservations.length > 0;
  const hypothesisById = new Map(
    allHypotheses.map((item) => [item.hypothesis.id, item] as const)
  );
  const effectiveHypothesisIds = new Set(effectiveBeliefs.flatMap((belief) => belief.hypotheses.map((hypothesis) => hypothesis.id)));
  const sourceCodes = createReadableCodes(sources, "S", (source) => source.createdAt);
  const beliefOptions = effectiveBeliefs.map((belief) => ({
    value: belief.id,
    label: `${readableCode(beliefCodes, belief.id, "B")} · ${belief.title}`
  }));
  const sourceOptions = sources.map((source) => ({
    value: source.id,
    label: `${readableCode(sourceCodes, source.id, "S")} · ${source.name}`
  }));
  const canRunEvidenceLoop = effectiveBeliefs.length > 0;
  const selectedRecommendedLinks = selectedObservation
    ? getObservationRecommendedLinks(selectedObservation).filter((link) => effectiveHypothesisIds.has(link.hypothesisId))
    : [];
  const rollbackOptions = createRollbackOptions(
    data.updates,
    (eventId) => readableCode(updateCodes, eventId, "U"),
    (evidenceId) => {
      const evidence = evidenceById.get(evidenceId);
      return evidence ? `${readableCode(evidenceCodes, evidenceId, "E")} · ${evidence.title}` : readableCode(evidenceCodes, evidenceId, "E");
    }
  );
  const selectedRollbackEventId = rollbackOptions.some((option) => option.value === selectedUpdate?.id) ? selectedUpdate?.id : undefined;
  const evidenceGraph = createWorldModelGraph({
    sources,
    beliefs: data.beliefs,
    observations: data.observations,
    evidence: data.evidence,
    updates: data.updates
  });
  const evidenceGraphEditor = createWorldModelGraphEditorData({
    sources,
    beliefs: data.beliefs,
    observations: data.observations,
    evidence: data.evidence,
    updates: data.updates,
    likelihoodRuns: data.likelihoodRuns
  });

  return (
    <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <DataWarning message={data.error} />
      <StatusNotice message={firstParam(params.message)} />
      <StatusNotice message={firstParam(params.error)} tone="error" />
      <div id="evidence-loop">
        <PageSection title="自动搜证闭环">
          <form action={runEvidenceLoopDryRunAction} className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-line bg-white p-3">
            <input type="hidden" name="returnPath" value={evidenceLoopReturnPath} />
            <input type="hidden" name="maxQueries" value="3" />
            <input type="hidden" name="maxSources" value="3" />
            <input type="hidden" name="maxObservations" value="20" />
            <input type="hidden" name="bootstrapDefaultSources" value="true" />
            <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-moss px-3 text-sm font-semibold text-moss">
              <Play size={16} /> 预检闭环
            </button>
          </form>
          <form action={runEvidenceLoopAction} className="grid gap-3 rounded-md border border-line bg-white p-4 lg:grid-cols-5">
            <input type="hidden" name="returnPath" value={evidenceLoopReturnPath} />
            <label className="grid gap-1 text-xs font-medium text-ink/65 lg:col-span-2">
              <span>限定信念</span>
              <select
                name="beliefIds"
                multiple
                size={Math.min(Math.max(beliefOptions.length, 2), 5)}
                className="min-h-24 rounded-md border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-moss"
              >
                {beliefOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-medium text-ink/65 lg:col-span-2">
              <span>限定来源</span>
              <select
                name="sourceIds"
                multiple
                size={Math.min(Math.max(sourceOptions.length, 2), 5)}
                className="min-h-24 rounded-md border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-moss"
              >
                {sourceOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <Field label="最大查询" name="maxQueries" type="number" min="1" defaultValue="3" />
            <Field label="最大来源" name="maxSources" type="number" min="1" defaultValue="3" />
            <Field label="最大观察" name="maxObservations" type="number" min="1" defaultValue="20" />
            <Field label="候选阈值" name="candidateThreshold" type="number" step="0.01" min="0" max="1" defaultValue="0.25" />
            <Field label="应用阈值" name="autoConfirmThreshold" type="number" step="0.01" min="0" max="1" defaultValue="0.85" />
            <label className="flex items-center gap-2 text-sm text-ink/70">
              <input name="reviewOnly" type="checkbox" defaultChecked /> 仅生成待审
            </label>
            <label className="flex items-center gap-2 text-sm text-ink/70">
              <input name="bootstrapDefaultSources" type="checkbox" defaultChecked /> 补齐推荐来源
            </label>
            <label className="flex items-center gap-2 text-sm text-ink/70">
              <input name="forceAutoApply" type="checkbox" /> 本次自动应用
            </label>
            {canRunEvidenceLoop ? (
              <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-moss px-3 text-sm font-semibold text-white">
                <Play size={16} /> 运行闭环
              </button>
            ) : null}
          </form>
        </PageSection>
      </div>
      {selectedObservation && selectedRecommendedLinks.length > 0 ? (
        <PageSection title="推荐候选确认">
          <form action={confirmEvidenceAction} className="grid gap-3 rounded-md border border-line bg-white p-4">
            <input type="hidden" name="observationId" value={selectedObservation.id} />
            <div>
              <div className="text-sm font-semibold text-ink">{selectedObservation.title}</div>
              <div className="mt-1 font-mono text-xs text-ink/55">
                {readableCode(observationCodes, selectedObservation.id, "O")} · 可信度 {selectedObservation.credibility.toFixed(2)}
              </div>
            </div>
            <div className="grid gap-3">
              {selectedRecommendedLinks.map((link) => {
                const target = hypothesisById.get(link.hypothesisId);
                return (
                  <div key={link.hypothesisId} className={hypothesisLinkRowClass}>
                    <label className={hypothesisLinkSummaryClass}>
                      <input name="linkHypothesisIds" value={link.hypothesisId} type="checkbox" defaultChecked className="mt-1" />
                      <span>
                        <span className="font-mono text-xs">{readableCode(hypothesisCodes, link.hypothesisId, "H")}</span>
                        <span className="ml-2">
                          {target ? `${target.belief.title} · ${target.hypothesis.proposition}` : "已删除假设"}
                        </span>
                      </span>
                    </label>
                    <SelectField
                      label="方向"
                      name={`direction:${link.hypothesisId}`}
                      defaultValue={link.direction}
                      options={Object.entries(evidenceDirectionLabels).map(([value, label]) => ({ value, label }))}
                    />
                    <Field
                      label="相关性"
                      name={`relevance:${link.hypothesisId}`}
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      defaultValue={link.relevance}
                    />
                    <Field
                      label="似然比"
                      name={`likelihoodRatio:${link.hypothesisId}`}
                      type="number"
                      step="0.01"
                      min="0.01"
                      defaultValue={link.likelihoodRatio}
                    />
                    <Field
                      label="置信度"
                      name={`confidence:${link.hypothesisId}`}
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      defaultValue={link.confidence}
                    />
                    <div className="lg:col-span-5">
                      <TextAreaField label="解释" name={`rationale:${link.hypothesisId}`} defaultValue={link.rationale} />
                    </div>
                  </div>
                );
              })}
            </div>
            <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-moss px-3 text-sm font-semibold text-white">
              <Check size={16} /> 确认并更新
            </button>
          </form>
        </PageSection>
      ) : null}
      <div id="confirm-observation">
      <PageSection title="从观察确认为证据">
        <form action={confirmEvidenceAction} className="grid gap-3 rounded-md border border-line bg-white p-4 lg:grid-cols-4">
          <SelectField
            label="观察"
            name="observationId"
            defaultValue={selectedObservation?.id}
            options={pendingObservations.map((observation) => ({
              value: observation.id,
              label: `${readableCode(observationCodes, observation.id, "O")} · ${observation.title} · ${observation.status}`
            }))}
          />
          <HypothesisLinkControls beliefs={effectiveBeliefs} defaultRationale="人工确认的证据关联" />
          {canConfirmObservation ? (
            <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-moss px-3 text-sm font-semibold text-white">
              <Check size={16} /> 确认并更新
            </button>
          ) : null}
        </form>
      </PageSection>
      </div>
      <PageSection title="手动录入证据">
        <form action={createEvidenceFromObservationAction} className="grid gap-3 rounded-md border border-line bg-white p-4 lg:grid-cols-4">
          <Field label="标题" name="title" required />
          <Field label="链接" name="url" type="url" />
          <Field label="作者/来源" name="author" />
          <Field label="可信度" name="credibility" type="number" step="0.01" min="0" max="1" defaultValue="0.6" />
          <TextAreaField label="正文" name="content" required />
          <HypothesisLinkControls beliefs={effectiveBeliefs} defaultRationale="人工录入并确认的证据" />
          {canCreateEvidenceUpdates ? (
            <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-moss px-3 text-sm font-semibold text-white">
              <Check size={16} /> 录入并更新
            </button>
          ) : null}
        </form>
      </PageSection>
      <PageSection title="证据影响图谱">
        <div className="grid gap-3">
          <Link
            href="/admin/world-model/graph"
            className="inline-flex min-h-9 w-fit items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink hover:border-moss hover:text-moss"
          >
            <Maximize2 size={16} /> 打开图谱工作区
          </Link>
          <WorldModelGraphView graph={evidenceGraph} editor={evidenceGraphEditor} returnPath={evidenceReturnPath} />
        </div>
      </PageSection>
      <PageSection title="证据库">
        {data.evidence.length === 0 ? (
          <EmptyState label="暂无证据" />
        ) : (
          <div className="grid gap-3">
            {data.evidence.map((evidence) => {
              const canApply = canApplyEvidenceUpdate(evidence, appliedEvidenceIds, effectiveHypothesisIds);
              const previewGroups = canApply ? createEvidencePreviewGroups(evidence, data.beliefs) : [];
              const candidateEvaluation = evidenceCandidateEvaluationSummary(evidence);
              const queryContext = evidenceQueryContextSummary(evidence);
              const evidenceCode = readableCode(evidenceCodes, evidence.id, "E");
              const isFocusedEvidence = selectedEvidence?.id === evidence.id;
              const evidenceCardReturnPath = `/admin/world-model/evidence?evidence=${encodeURIComponent(evidenceCode)}#${encodeURIComponent(
                evidenceCode
              )}`;

              return (
              <div
                key={evidence.id}
                id={evidenceCode}
                data-focused-evidence={isFocusedEvidence ? "true" : undefined}
                className={`rounded-md border bg-white p-4 ${
                  isFocusedEvidence ? "border-moss ring-1 ring-moss/30" : "border-line"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">
                      {evidenceCode} · {evidence.title}
                    </h2>
                    <p className="text-xs text-ink/55">
                      {evidence.status} · {evidence.confirmationMode} · 可信度 {evidence.credibility.toFixed(2)}
                    </p>
                    {candidateEvaluation ? <p className="mt-1 text-xs text-ink/55">{candidateEvaluation}</p> : null}
                    {queryContext ? <p className="mt-1 text-xs text-ink/55">{queryContext}</p> : null}
                  </div>
                  {appliedEvidenceIds.has(evidence.id) ? (
                    <span className="rounded-md bg-moss/10 px-3 py-2 text-sm font-semibold text-moss">已应用</span>
                  ) : canApply ? (
                    <form action={applyEvidenceUpdateAction}>
                      <input type="hidden" name="returnPath" value={evidenceCardReturnPath} />
                      <input type="hidden" name="evidenceId" value={evidence.id} />
                      <button className="inline-flex min-h-9 items-center gap-2 rounded-md bg-berry px-3 text-sm font-semibold text-white">
                        <Zap size={16} /> 应用更新
                      </button>
                    </form>
                  ) : (
                    <span className="rounded-md bg-panel px-3 py-2 text-sm font-semibold text-ink/55">不可应用</span>
                  )}
                </div>
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="text-xs text-ink/50">
                      <tr>
                        <th className="py-2">假设</th>
                        <th className="py-2">方向</th>
                        <th className="py-2">相关性</th>
                        <th className="py-2">似然比</th>
                        <th className="py-2">置信度</th>
                        <th className="py-2">解释</th>
                      </tr>
                    </thead>
                    <tbody>
                      {evidence.links.map((link) => {
                        const target = hypothesisById.get(link.hypothesisId);
                        return (
                          <tr key={link.id} className="border-t border-line">
                            <td className="py-2 pr-3">
                              <span className="font-mono text-xs">{readableCode(hypothesisCodes, link.hypothesisId, "H")}</span>
                              <span className="ml-2 text-ink/75">
                                {target ? `${target.belief.title} · ${target.hypothesis.proposition}` : "已删除假设"}
                              </span>
                            </td>
                            <td className="py-2 pr-3">{evidenceDirectionLabels[link.direction]}</td>
                            <td className="py-2 pr-3">{link.relevance.toFixed(2)}</td>
                            <td className="py-2 pr-3">{link.likelihoodRatio.toFixed(2)}</td>
                            <td className="py-2 pr-3">{link.confidence.toFixed(2)}</td>
                            <td className="py-2 pr-3">{link.rationale}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {previewGroups.length > 0 ? (
                  <div className="mt-3 rounded-md border border-line bg-panel p-3">
                    <div className="text-xs font-semibold uppercase text-ink/55">更新预览</div>
                    <div className="mt-2 grid gap-2">
                      {previewGroups.map((group) => (
                        <div key={group.belief.id} className="rounded-md border border-line bg-white p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                            <div className="font-semibold text-ink">
                              <span className="font-mono text-xs">{readableCode(beliefCodes, group.belief.id, "B")}</span>
                              <span className="ml-2">{group.belief.title}</span>
                            </div>
                            <div className="text-xs text-ink/55">预览置信度 {group.confidence.toFixed(2)}</div>
                          </div>
                          <div className="mt-2 overflow-x-auto">
                            <table className="min-w-full text-left text-sm">
                              <thead className="text-xs text-ink/50">
                                <tr>
                                  <th className="py-2">假设</th>
                                  <th className="py-2">概率</th>
                                  <th className="py-2">变化</th>
                                </tr>
                              </thead>
                              <tbody>
                                {group.rows.map((row: { hypothesis: HypothesisRecord; prior: number; posterior: number }) => {
                                  const delta = row.posterior - row.prior;
                                  return (
                                    <tr key={row.hypothesis.id} className="border-t border-line">
                                      <td className="py-2 pr-3">
                                        <span className="font-mono text-xs">{readableCode(hypothesisCodes, row.hypothesis.id, "H")}</span>
                                        <span className="ml-2 text-ink/75">{row.hypothesis.proposition}</span>
                                      </td>
                                      <td className="py-2 pr-3">
                                        {formatProbability(row.prior)} → {formatProbability(row.posterior)}
                                      </td>
                                      <td className={`py-2 pr-3 font-semibold ${probabilityDeltaToneClass(delta)}`}>
                                        {formatPointDelta(delta)}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {canEditEvidence(evidence) || canRejectEvidence(evidence) ? (
                <details open={isFocusedEvidence || undefined} className="mt-4 border-t border-line pt-4">
                  <summary className="cursor-pointer text-sm font-semibold text-ink">编辑证据和关联</summary>
                  <form action={updateEvidenceAction} className="mt-3 grid gap-3 lg:grid-cols-4">
                    <input type="hidden" name="returnPath" value={evidenceCardReturnPath} />
                    <input type="hidden" name="evidenceId" value={evidence.id} />
                    <Field label="标题" name="title" defaultValue={evidence.title} required />
                    <Field label="链接" name="url" type="url" defaultValue={evidence.url ?? ""} />
                    <Field
                      label="可信度"
                      name="credibility"
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      defaultValue={evidence.credibility}
                    />
                    <TextAreaField label="正文" name="content" defaultValue={evidence.content} required />
                    <div className="grid gap-3 lg:col-span-4">
                      <div className="text-xs font-medium text-ink/65">证据-假设关联</div>
                      {allHypotheses.map(({ belief, hypothesis }) => {
                        const link = evidence.links.find((candidate) => candidate.hypothesisId === hypothesis.id);
                        return (
                          <div key={hypothesis.id} className={hypothesisLinkRowClass}>
                            <label className={hypothesisLinkSummaryClass}>
                              <input
                                name="linkHypothesisIds"
                                value={hypothesis.id}
                                type="checkbox"
                                defaultChecked={Boolean(link)}
                                className="mt-1"
                              />
                              <span>
                                <span className="font-mono text-xs">{readableCode(hypothesisCodes, hypothesis.id, "H")}</span>
                                <span className="ml-2">{belief.title} · {hypothesis.proposition}</span>
                              </span>
                            </label>
                            <SelectField
                              label="方向"
                              name={`direction:${hypothesis.id}`}
                              defaultValue={link?.direction ?? "SUPPORTS"}
                              options={Object.entries(evidenceDirectionLabels).map(([value, label]) => ({ value, label }))}
                            />
                            <Field
                              label="相关性"
                              name={`relevance:${hypothesis.id}`}
                              type="number"
                              step="0.01"
                              min="0"
                              max="1"
                              defaultValue={link?.relevance ?? 0.5}
                            />
                            <Field
                              label="似然比"
                              name={`likelihoodRatio:${hypothesis.id}`}
                              type="number"
                              step="0.01"
                              min="0.01"
                              defaultValue={link?.likelihoodRatio ?? 1}
                            />
                            <Field
                              label="置信度"
                              name={`confidence:${hypothesis.id}`}
                              type="number"
                              step="0.01"
                              min="0"
                              max="1"
                              defaultValue={link?.confidence ?? 0.5}
                            />
                            <div className="lg:col-span-5">
                              <TextAreaField
                                label="解释"
                                name={`rationale:${hypothesis.id}`}
                                defaultValue={link?.rationale ?? "证据编辑后重新评估"}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-moss px-3 text-sm font-semibold text-white">
                      <Save size={16} /> 保存并重算
                    </button>
                  </form>
                  {canRejectEvidence(evidence) ? (
                    <form action={rejectEvidenceAction} className="mt-3">
                      <input type="hidden" name="returnPath" value={evidenceCardReturnPath} />
                      <input type="hidden" name="evidenceId" value={evidence.id} />
                      <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-berry px-3 text-sm font-semibold text-berry">
                        <Trash2 size={16} /> 拒绝证据
                      </button>
                    </form>
                  ) : null}
                  {canDeleteEvidence(evidence) ? (
                    <form action={deleteEvidenceAction} className="mt-3">
                      <input type="hidden" name="returnPath" value={evidenceCardReturnPath} />
                      <input type="hidden" name="evidenceId" value={evidence.id} />
                      <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-berry px-3 text-sm font-semibold text-berry">
                        <Trash2 size={16} /> 删除证据
                      </button>
                    </form>
                  ) : null}
                </details>
                ) : null}
              </div>
              );
            })}
          </div>
        )}
      </PageSection>
      <div id="update-events">
      <PageSection title="更新回滚">
        <div className="grid gap-3 rounded-md border border-line bg-white p-4">
          {rollbackOptions.length === 0 ? (
            <EmptyState label="暂无可回滚事件" />
          ) : (
            <form action={rollbackUpdateAction} className="grid gap-3 lg:grid-cols-[1fr_auto]">
              <input type="hidden" name="returnPath" value={updateReturnPath} />
              <SelectField label="更新事件" name="eventId" options={rollbackOptions} defaultValue={selectedRollbackEventId} />
              <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-line px-3 text-sm font-semibold text-ink">
                <RotateCcw size={16} /> 回滚
              </button>
            </form>
          )}
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs text-ink/50">
                <tr>
                  <th className="py-2">事件</th>
                  <th className="py-2">状态</th>
                  <th className="py-2">证据</th>
                  <th className="py-2">变化</th>
                </tr>
              </thead>
              <tbody>
                {data.updates.map((event) => {
                  const delta = summarizeUpdateDelta(event, (hypothesisId) => readableCode(hypothesisCodes, hypothesisId, "H"));
                  const explanation = summarizeUpdateExplanation(event, (hypothesisId) => {
                    const target = hypothesisById.get(hypothesisId);
                    const code = readableCode(hypothesisCodes, hypothesisId, "H");
                    return target ? `${code} · ${target.hypothesis.proposition}` : code;
                  });
                  const updateCode = readableCode(updateCodes, event.id, "U");
                  const isFocusedUpdate = selectedUpdate?.id === event.id;
                  return (
                    <tr
                      key={event.id}
                      id={updateCode}
                      data-focused-update={isFocusedUpdate ? "true" : undefined}
                      className={`border-t border-line ${isFocusedUpdate ? "bg-amber-50" : ""}`}
                    >
                      <td className="py-2 pr-3 font-mono text-xs">{updateCode}</td>
                      <td className="py-2 pr-3">{event.status}</td>
                      <td className="py-2 pr-3">
                        <span className="font-mono text-xs">{readableCode(evidenceCodes, event.evidenceId, "E")}</span>
                        <span className="ml-2 text-ink/75">{evidenceById.get(event.evidenceId)?.title ?? "已删除证据"}</span>
                      </td>
                      <td className="py-2 pr-3">
                        <span className={`font-semibold ${deltaToneClass(delta.tone)}`}>{delta.label}</span>
                        <span className="ml-2 text-xs text-ink/55">{delta.detail}</span>
                        {explanation ? <div className="mt-1 text-xs text-ink/60">{explanation}</div> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </PageSection>
      </div>
    </main>
  );
}
