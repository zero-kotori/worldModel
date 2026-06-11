import Link from "next/link";
import { Check, Maximize2, RotateCcw, Save, Trash2, Zap } from "lucide-react";
import {
  applyEvidenceUpdateAction,
  confirmEvidenceAction,
  createEvidenceFromObservationAction,
  rejectEvidenceAction,
  updateEvidenceAction,
  rollbackUpdateAction
} from "@/app/admin/world-model/actions";
import { loadWorldModelData } from "@/app/admin/world-model/data";
import { createReadableCodes, readableCode } from "@/lib/world-model-display";
import { getObservationRecommendedLinks } from "@/lib/world-model-observations-ui";
import { evidenceDirectionLabels, hypothesisStanceLabels } from "@/lib/world-model-navigation";
import { summarizeUpdateDelta } from "@/lib/world-model-updates-ui";
import { Field, SelectField, TextAreaField } from "@/components/world-model/Field";
import { DataWarning, EmptyState, PageSection, StatusNotice } from "@/components/world-model/PageSection";

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

function HypothesisCheckboxes({ beliefs }: { beliefs: Awaited<ReturnType<typeof loadWorldModelData>>["beliefs"] }) {
  const hypothesisCodes = createReadableCodes(
    beliefs.flatMap((belief) => belief.hypotheses),
    "H",
    (hypothesis) => hypothesis.createdAt
  );

  if (beliefs.length === 0) {
    return <div className="text-sm text-ink/55">暂无可关联假设</div>;
  }

  return (
    <div className="grid gap-2 lg:col-span-4">
      <div className="text-xs font-medium text-ink/65">关联假设</div>
      <div className="grid gap-2 lg:grid-cols-2">
        {beliefs.map((belief) => (
          <div key={belief.id} className="rounded-md border border-line bg-panel p-3">
            <div className="mb-2 text-sm font-semibold text-ink">{belief.title}</div>
            <div className="grid gap-2">
              {belief.hypotheses.map((hypothesis) => (
                <label key={hypothesis.id} className="flex items-start gap-2 text-sm text-ink/75">
                  <input name="hypothesisIds" value={hypothesis.id} type="checkbox" className="mt-1" />
                  <span>
                    <span className="font-mono text-xs">{readableCode(hypothesisCodes, hypothesis.id, "H")}</span>
                    <span className="ml-2">{hypothesis.proposition}</span>
                    <span className="ml-2 text-xs text-ink/45">
                      {hypothesisStanceLabels[hypothesis.stance]} · {(hypothesis.currentProbability * 100).toFixed(1)}%
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function EvidencePage({ searchParams }: PageProps) {
  const data = await loadWorldModelData();
  const params = (await searchParams) ?? {};
  const pendingObservations = data.observations.filter((observation) => observation.status !== "CONFIRMED" && observation.status !== "REJECTED");
  const appliedEvidenceIds = new Set(data.updates.filter((event) => event.status === "APPLIED").map((event) => event.evidenceId));
  const observationCodes = createReadableCodes(data.observations, "O", (observation) => observation.observedAt);
  const selectedObservationParam = firstParam(params.observation);
  const selectedObservation = pendingObservations.find(
    (observation) => observation.id === selectedObservationParam || readableCode(observationCodes, observation.id, "O") === selectedObservationParam
  );
  const selectedRecommendedLinks = selectedObservation ? getObservationRecommendedLinks(selectedObservation) : [];
  const evidenceCodes = createReadableCodes(data.evidence, "E", (evidence) => evidence.confirmedAt);
  const updateCodes = createReadableCodes(data.updates, "U", (event) => event.createdAt);
  const hypothesisCodes = createReadableCodes(
    data.beliefs.flatMap((belief) => belief.hypotheses),
    "H",
    (hypothesis) => hypothesis.createdAt
  );
  const evidenceById = new Map(data.evidence.map((evidence) => [evidence.id, evidence]));
  const allHypotheses = data.beliefs.flatMap((belief) => belief.hypotheses.map((hypothesis) => ({ belief, hypothesis })));
  const hypothesisById = new Map(
    allHypotheses.map((item) => [item.hypothesis.id, item] as const)
  );
  const rollbackOptions = data.updates.map((event) => {
    const evidence = evidenceById.get(event.evidenceId);
    return {
      value: event.id,
      label: `${readableCode(updateCodes, event.id, "U")} · ${evidence?.title ?? readableCode(evidenceCodes, event.evidenceId, "E")} · ${event.status}`
    };
  });

  return (
    <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <DataWarning message={data.error} />
      <StatusNotice message={firstParam(params.message)} />
      <StatusNotice message={firstParam(params.error)} tone="error" />
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
                  <div key={link.hypothesisId} className="grid gap-2 border-t border-line py-3 lg:grid-cols-5">
                    <label className="flex items-start gap-2 text-sm text-ink/75 lg:col-span-2">
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
                    <TextAreaField label="解释" name={`rationale:${link.hypothesisId}`} defaultValue={link.rationale} />
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
          <SelectField
            label="方向"
            name="direction"
            options={Object.entries(evidenceDirectionLabels).map(([value, label]) => ({ value, label }))}
          />
          <Field label="相关性" name="relevance" type="number" step="0.01" min="0" max="1" defaultValue="0.8" />
          <Field label="似然比" name="likelihoodRatio" type="number" step="0.01" min="0.01" defaultValue="1.5" />
          <Field label="置信度" name="confidence" type="number" step="0.01" min="0" max="1" defaultValue="0.7" />
          <TextAreaField label="解释" name="rationale" defaultValue="人工确认的证据关联" required />
          <HypothesisCheckboxes beliefs={data.beliefs} />
          <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-moss px-3 text-sm font-semibold text-white">
            <Check size={16} /> 确认并更新
          </button>
        </form>
      </PageSection>
      </div>
      <PageSection title="手动录入证据">
        <form action={createEvidenceFromObservationAction} className="grid gap-3 rounded-md border border-line bg-white p-4 lg:grid-cols-4">
          <Field label="标题" name="title" required />
          <Field label="链接" name="url" type="url" />
          <Field label="作者/来源" name="author" />
          <Field label="可信度" name="credibility" type="number" step="0.01" min="0" max="1" defaultValue="0.6" />
          <SelectField
            label="方向"
            name="direction"
            options={Object.entries(evidenceDirectionLabels).map(([value, label]) => ({ value, label }))}
          />
          <Field label="相关性" name="relevance" type="number" step="0.01" min="0" max="1" defaultValue="0.8" />
          <Field label="似然比" name="likelihoodRatio" type="number" step="0.01" min="0.01" defaultValue="1.5" />
          <Field label="置信度" name="confidence" type="number" step="0.01" min="0" max="1" defaultValue="0.7" />
          <TextAreaField label="正文" name="content" required />
          <TextAreaField label="解释" name="rationale" defaultValue="人工录入并确认的证据" required />
          <HypothesisCheckboxes beliefs={data.beliefs} />
          <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-moss px-3 text-sm font-semibold text-white">
            <Check size={16} /> 录入并更新
          </button>
        </form>
      </PageSection>
      <PageSection title="证据影响图谱">
        <Link
          href="/admin/world-model/graph"
          className="inline-flex min-h-9 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink hover:border-moss hover:text-moss"
        >
          <Maximize2 size={16} /> 打开图谱工作区
        </Link>
      </PageSection>
      <PageSection title="证据库">
        {data.evidence.length === 0 ? (
          <EmptyState label="暂无证据" />
        ) : (
          <div className="grid gap-3">
            {data.evidence.map((evidence) => (
              <div key={evidence.id} className="rounded-md border border-line bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">
                      {readableCode(evidenceCodes, evidence.id, "E")} · {evidence.title}
                    </h2>
                    <p className="text-xs text-ink/55">
                      {evidence.status} · {evidence.confirmationMode} · 可信度 {evidence.credibility.toFixed(2)}
                    </p>
                  </div>
                  {appliedEvidenceIds.has(evidence.id) ? (
                    <span className="rounded-md bg-moss/10 px-3 py-2 text-sm font-semibold text-moss">已应用</span>
                  ) : (
                    <form action={applyEvidenceUpdateAction}>
                      <input type="hidden" name="evidenceId" value={evidence.id} />
                      <button className="inline-flex min-h-9 items-center gap-2 rounded-md bg-berry px-3 text-sm font-semibold text-white">
                        <Zap size={16} /> 应用更新
                      </button>
                    </form>
                  )}
                </div>
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="text-xs text-ink/50">
                      <tr>
                        <th className="py-2">假设</th>
                        <th className="py-2">方向</th>
                        <th className="py-2">似然比</th>
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
                            <td className="py-2 pr-3">{link.likelihoodRatio.toFixed(2)}</td>
                            <td className="py-2 pr-3">{link.rationale}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <details className="mt-4 border-t border-line pt-4">
                  <summary className="cursor-pointer text-sm font-semibold text-ink">编辑证据和关联</summary>
                  <form action={updateEvidenceAction} className="mt-3 grid gap-3 lg:grid-cols-4">
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
                          <div key={hypothesis.id} className="grid gap-2 border-t border-line py-3 lg:grid-cols-5">
                            <label className="flex items-start gap-2 text-sm text-ink/75 lg:col-span-2">
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
                            <TextAreaField
                              label="解释"
                              name={`rationale:${hypothesis.id}`}
                              defaultValue={link?.rationale ?? "证据编辑后重新评估"}
                            />
                          </div>
                        );
                      })}
                    </div>
                    <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-moss px-3 text-sm font-semibold text-white">
                      <Save size={16} /> 保存并重算
                    </button>
                  </form>
                  <form action={rejectEvidenceAction} className="mt-3">
                    <input type="hidden" name="evidenceId" value={evidence.id} />
                    <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-berry px-3 text-sm font-semibold text-berry">
                      <Trash2 size={16} /> 拒绝证据
                    </button>
                  </form>
                </details>
              </div>
            ))}
          </div>
        )}
      </PageSection>
      <PageSection title="更新回滚">
        <div className="grid gap-3 rounded-md border border-line bg-white p-4">
          {rollbackOptions.length === 0 ? (
            <EmptyState label="暂无可回滚事件" />
          ) : (
            <form action={rollbackUpdateAction} className="grid gap-3 lg:grid-cols-[1fr_auto]">
              <SelectField label="更新事件" name="eventId" options={rollbackOptions} />
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
                  return (
                    <tr key={event.id} className="border-t border-line">
                      <td className="py-2 pr-3 font-mono text-xs">{readableCode(updateCodes, event.id, "U")}</td>
                      <td className="py-2 pr-3">{event.status}</td>
                      <td className="py-2 pr-3">
                        <span className="font-mono text-xs">{readableCode(evidenceCodes, event.evidenceId, "E")}</span>
                        <span className="ml-2 text-ink/75">{evidenceById.get(event.evidenceId)?.title ?? "已删除证据"}</span>
                      </td>
                      <td className="py-2 pr-3">
                        <span className={`font-semibold ${deltaToneClass(delta.tone)}`}>{delta.label}</span>
                        <span className="ml-2 text-xs text-ink/55">{delta.detail}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </PageSection>
    </main>
  );
}
