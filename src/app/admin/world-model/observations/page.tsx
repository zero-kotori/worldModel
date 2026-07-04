import Link from "next/link";
import { Check, Plus, Save, Trash2, X } from "lucide-react";
import {
  confirmRecommendedEvidenceAction,
  createObservationAction,
  deleteDuplicateObservationsAction,
  deleteLowImpactObservationsAction,
  deleteUnknownObservationsAction,
  rejectDuplicateObservationsAction,
  rejectLowImpactObservationsAction,
  rejectObservationAction,
  rejectUnknownObservationsAction,
  settleObservationAction,
  updateGraphObservationAction
} from "@/app/admin/world-model/actions";
import { loadWorldModelData } from "@/app/admin/world-model/data";
import { createReadableCodes, readableCode } from "@/lib/world-model-display";
import {
  getObservationRecommendedLinks,
  groupObservationsForReview,
  isSettlementReviewObservation,
  observationCandidateEvaluationSummary,
  observationConversionSummary,
  observationIgnoredReasonLabel,
  observationQueryContextSummary,
  observationRecommendedLinkLikelihoodSummary,
  observationReviewPriority,
  observationReviewPriorityLabel,
  observationReviewReasonLabel,
  observationStatusLabels,
  summarizeObservationCandidateImpact
} from "@/lib/world-model-observations-ui";
import { evidenceDirectionLabels } from "@/lib/world-model-navigation";
import { Field, TextAreaField } from "@/components/world-model/Field";
import { DataWarning, EmptyState, PageSection, StatusNotice } from "@/components/world-model/PageSection";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function impactToneClass(tone: ReturnType<typeof summarizeObservationCandidateImpact>["tone"]) {
  if (tone === "increase") return "text-moss";
  if (tone === "decrease") return "text-berry";
  return "text-ink/55";
}

export default async function ObservationsPage({ searchParams }: PageProps) {
  const data = await loadWorldModelData();
  const params = (await searchParams) ?? {};
  const observationCodes = createReadableCodes(data.observations, "O", (observation) => observation.observedAt);
  const beliefCodes = createReadableCodes(data.beliefs, "B", (belief) => belief.createdAt);
  const hypotheses = data.beliefs.flatMap((belief) => belief.hypotheses.map((hypothesis) => ({ belief, hypothesis })));
  const hypothesisCodes = createReadableCodes(
    hypotheses.map((item) => item.hypothesis),
    "H",
    (hypothesis) => hypothesis.createdAt
  );
  const hypothesisById = new Map(hypotheses.map((item) => [item.hypothesis.id, item] as const));
  const groupedObservations = groupObservationsForReview(data.observations);
  const lowImpactObservations = groupedObservations.unknown.filter(
    (observation) => observation.metadata.ignoredReason === "LOW_IMPACT"
  );
  const showObservationPool = firstParam(params.view) === "pool";
  function renderRecommendedLinks(links: ReturnType<typeof getObservationRecommendedLinks>) {
    if (links.length === 0) return null;
    return (
      <div className="grid gap-2">
        {links.map((link) => {
          const target = hypothesisById.get(link.hypothesisId);
          return (
            <div key={link.hypothesisId} className="rounded-md border border-line bg-panel p-2">
              <div className="text-xs font-semibold text-ink">
                <span className="font-mono">{readableCode(hypothesisCodes, link.hypothesisId, "H")}</span>
                <span className="ml-2">{target ? `${target.belief.title} · ${target.hypothesis.proposition}` : "已删除假设"}</span>
              </div>
              <div className="mt-1 text-xs text-ink/60">
                {evidenceDirectionLabels[link.direction]} · 相关性 {link.relevance.toFixed(2)} ·{" "}
                {observationRecommendedLinkLikelihoodSummary(link)} · 置信度 {link.confidence.toFixed(2)}
              </div>
              <div className="mt-1 text-xs text-ink/55">{link.rationale}</div>
            </div>
          );
        })}
      </div>
    );
  }

  function metadataText(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : "";
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <DataWarning message={data.error} />
      <StatusNotice message={firstParam(params.message)} />
      <StatusNotice message={firstParam(params.error)} tone="error" />
      <PageSection title="手动观察">
        <form action={createObservationAction} className="grid gap-3 rounded-md border border-line bg-white p-4 lg:grid-cols-4">
          <Field label="标题" name="title" required />
          <Field label="链接" name="url" type="url" />
          <Field label="作者/来源" name="author" />
          <Field label="可信度" name="credibility" type="number" step="0.01" min="0" max="1" defaultValue="0.5" />
          <Field label="文本 hash" name="normalizedHash" />
          <Field label="语义 key" name="semanticKey" />
          <TextAreaField label="正文" name="content" required />
          <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-moss px-3 text-sm font-semibold text-white">
            <Plus size={16} /> 录入
          </button>
        </form>
      </PageSection>
      <div id="review-candidates">
      <PageSection title="待审候选">
        {groupedObservations.reviewCandidates.length === 0 ? (
          <EmptyState label="暂无待审候选" />
        ) : (
          <div className="overflow-x-auto rounded-md border border-line bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-panel text-xs text-ink/55">
                <tr>
                  <th className="px-3 py-2">编号</th>
                  <th className="px-3 py-2">标题</th>
                  <th className="px-3 py-2">优先级</th>
                  <th className="px-3 py-2">预期影响</th>
                  <th className="px-3 py-2">推荐关联</th>
                  <th className="px-3 py-2">原因</th>
                  <th className="px-3 py-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {groupedObservations.reviewCandidates.map((observation) => {
                  const code = readableCode(observationCodes, observation.id, "O");
                  const links = getObservationRecommendedLinks(observation);
                  const priority = observationReviewPriority(observation);
                  const impact = summarizeObservationCandidateImpact(observation, data.beliefs, (hypothesisId) =>
                    readableCode(hypothesisCodes, hypothesisId, "H")
                  );
                  const conversionSummary = observationConversionSummary(observation, {
                    beliefLabel: (beliefId) => readableCode(beliefCodes, beliefId, "B"),
                    hypothesisLabel: (hypothesisId) => readableCode(hypothesisCodes, hypothesisId, "H")
                  });
                  const candidateEvaluation = observationCandidateEvaluationSummary(observation);
                  const queryContext = observationQueryContextSummary(observation);
                  const settlementReview = isSettlementReviewObservation(observation);
                  const settlementHypothesisId =
                    metadataText(observation.metadata.settlementHypothesisId) || metadataText(observation.metadata.queryHypothesisId);
                  const settlementHypothesisCode =
                    metadataText(observation.metadata.settlementHypothesisCode) || metadataText(observation.metadata.queryHypothesisCode);
                  const settlementOutcomeText = observation.content || observation.title;
                  return (
                    <tr key={observation.id} className="border-t border-line align-top">
                      <td className="px-3 py-2 font-mono text-xs">{code}</td>
                      <td className="px-3 py-2">{observation.title}</td>
                      <td className="px-3 py-2">
                        <div className="font-semibold text-ink">{observationReviewPriorityLabel(priority)}</div>
                        <div className="mt-1 text-xs text-ink/50">{priority.toFixed(2)}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div className={`font-semibold ${impactToneClass(impact.tone)}`}>{impact.label}</div>
                        <div className="mt-1 text-xs text-ink/50">{impact.detail}</div>
                      </td>
                      <td className="px-3 py-2">
                        {renderRecommendedLinks(links)}
                      </td>
                      <td className="px-3 py-2">
                        <div>{observationReviewReasonLabel(observation.metadata.reviewReason)}</div>
                        {conversionSummary ? <div className="mt-1 text-xs text-ink/55">{conversionSummary}</div> : null}
                        {queryContext ? <div className="mt-1 text-xs text-ink/55">{queryContext}</div> : null}
                        {candidateEvaluation ? <div className="mt-1 text-xs text-ink/55">{candidateEvaluation}</div> : null}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          {links.length > 0 ? (
                            <>
                              <form action={confirmRecommendedEvidenceAction}>
                                <input type="hidden" name="observationId" value={observation.id} />
                                <button className="inline-flex min-h-8 items-center gap-2 rounded-md bg-moss px-2 text-xs font-semibold text-white">
                                  <Check size={14} /> 确认推荐
                                </button>
                              </form>
                              <Link
                                href={`/admin/world-model/evidence?observation=${encodeURIComponent(code)}#confirm-observation`}
                                className="inline-flex min-h-8 items-center gap-2 rounded-md border border-line px-2 text-xs font-semibold text-ink hover:border-moss hover:text-moss"
                              >
                                <Check size={14} /> 调整
                              </Link>
                            </>
                          ) : null}
                          {settlementReview && settlementHypothesisCode ? (
                            <Link
                              href={`/admin/world-model/graph?hypothesis=${encodeURIComponent(settlementHypothesisCode)}`}
                              className="inline-flex min-h-8 items-center gap-2 rounded-md border border-line px-2 text-xs font-semibold text-ink hover:border-moss hover:text-moss"
                            >
                              <Check size={14} /> 结算假设
                            </Link>
                          ) : null}
                          {settlementReview && settlementHypothesisId ? (
                            <>
                              <form action={settleObservationAction}>
                                <input type="hidden" name="returnPath" value="/admin/world-model/observations#review-candidates" />
                                <input type="hidden" name="observationId" value={observation.id} />
                                <input type="hidden" name="hypothesisId" value={settlementHypothesisId} />
                                <input type="hidden" name="outcome" value="RESOLVED_TRUE" />
                                <input type="hidden" name="resolvedOutcome" value={settlementOutcomeText} />
                                <button className="inline-flex min-h-8 items-center gap-2 rounded-md bg-moss px-2 text-xs font-semibold text-white">
                                  <Check size={14} /> 结算发生
                                </button>
                              </form>
                              <form action={settleObservationAction}>
                                <input type="hidden" name="returnPath" value="/admin/world-model/observations#review-candidates" />
                                <input type="hidden" name="observationId" value={observation.id} />
                                <input type="hidden" name="hypothesisId" value={settlementHypothesisId} />
                                <input type="hidden" name="outcome" value="RESOLVED_FALSE" />
                                <input type="hidden" name="resolvedOutcome" value={settlementOutcomeText} />
                                <button className="inline-flex min-h-8 items-center gap-2 rounded-md border border-berry px-2 text-xs font-semibold text-berry">
                                  <X size={14} /> 结算未发生
                                </button>
                              </form>
                            </>
                          ) : null}
                          {observation.metadata.reviewReason === "ONE_SIDED_HYPOTHESIS_COVERAGE" ? (
                            <Link
                              href={`/admin/world-model/beliefs?sourceObservation=${encodeURIComponent(code)}#recommendations`}
                              className="inline-flex min-h-8 items-center gap-2 rounded-md border border-line px-2 text-xs font-semibold text-ink hover:border-moss hover:text-moss"
                            >
                              <Plus size={14} /> 补假设
                            </Link>
                          ) : null}
                          <form action={rejectObservationAction}>
                            <input type="hidden" name="observationId" value={observation.id} />
                            <button className="inline-flex min-h-8 items-center gap-2 rounded-md border border-berry px-2 text-xs font-semibold text-berry">
                              <Trash2 size={14} /> 拒绝
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </PageSection>
      </div>
      <div id="pending-observations">
      <PageSection title="待处理观察">
        {groupedObservations.activePool.length === 0 ? (
          <EmptyState label="暂无待处理观察" />
        ) : (
          <div className="overflow-x-auto rounded-md border border-line bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-panel text-xs text-ink/55">
                <tr>
                  <th className="px-3 py-2">编号</th>
                  <th className="px-3 py-2">标题</th>
                  <th className="px-3 py-2">可信度</th>
                  <th className="px-3 py-2">时间</th>
                  <th className="px-3 py-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {groupedObservations.activePool.map((observation) => {
                  const code = readableCode(observationCodes, observation.id, "O");
                  const queryContext = observationQueryContextSummary(observation);
                  return (
                    <tr key={observation.id} id={code} className="border-t border-line">
                      <td className="px-3 py-2 font-mono text-xs">{code}</td>
                      <td className="px-3 py-2">
                        <div>{observation.title}</div>
                        {queryContext ? <div className="mt-1 text-xs text-ink/55">{queryContext}</div> : null}
                      </td>
                      <td className="px-3 py-2">{observation.credibility.toFixed(2)}</td>
                      <td className="px-3 py-2">{observation.observedAt.toLocaleString("zh-CN")}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          <Link
                            href={`/admin/world-model/evidence?observation=${encodeURIComponent(code)}#confirm-observation`}
                            className="inline-flex min-h-8 items-center gap-2 rounded-md border border-line px-2 text-xs font-semibold text-ink hover:border-moss hover:text-moss"
                          >
                            <Check size={14} /> 转为证据
                          </Link>
                          <form action={rejectObservationAction}>
                            <input type="hidden" name="observationId" value={observation.id} />
                            <button className="inline-flex min-h-8 items-center gap-2 rounded-md border border-berry px-2 text-xs font-semibold text-berry">
                              <Trash2 size={14} /> 拒绝
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </PageSection>
      </div>
      <div id="unknown-evidence">
      <PageSection title="未知证据队列">
        {groupedObservations.unknown.length === 0 ? (
          <EmptyState label="暂无未知证据" />
        ) : (
          <div className="grid gap-3">
            <div className="flex flex-wrap justify-end gap-2">
              {lowImpactObservations.length > 0 ? (
                <form action={rejectLowImpactObservationsAction}>
                  <input type="hidden" name="returnPath" value="/admin/world-model/observations#unknown-evidence" />
                  {lowImpactObservations.map((observation) => (
                    <input key={observation.id} type="hidden" name="observationIds" value={observation.id} />
                  ))}
                  <button className="inline-flex min-h-8 items-center gap-2 rounded-md border border-berry px-2 text-xs font-semibold text-berry">
                    <Trash2 size={14} /> 拒绝全部低影响观察
                  </button>
                </form>
              ) : null}
              {lowImpactObservations.length > 0 ? (
                <form action={deleteLowImpactObservationsAction}>
                  <input type="hidden" name="returnPath" value="/admin/world-model/observations#unknown-evidence" />
                  {lowImpactObservations.map((observation) => (
                    <input key={observation.id} type="hidden" name="observationIds" value={observation.id} />
                  ))}
                  <button className="inline-flex min-h-8 items-center gap-2 rounded-md border border-berry px-2 text-xs font-semibold text-berry">
                    <Trash2 size={14} /> 删除全部低影响观察
                  </button>
                </form>
              ) : null}
              <form action={rejectUnknownObservationsAction}>
                <input type="hidden" name="returnPath" value="/admin/world-model/observations#unknown-evidence" />
                {groupedObservations.unknown.map((observation) => (
                  <input key={observation.id} type="hidden" name="observationIds" value={observation.id} />
                ))}
                <button className="inline-flex min-h-8 items-center gap-2 rounded-md border border-berry px-2 text-xs font-semibold text-berry">
                  <Trash2 size={14} /> 拒绝全部未知证据
                </button>
              </form>
              <form action={deleteUnknownObservationsAction}>
                <input type="hidden" name="returnPath" value="/admin/world-model/observations#unknown-evidence" />
                {groupedObservations.unknown.map((observation) => (
                  <input key={observation.id} type="hidden" name="observationIds" value={observation.id} />
                ))}
                <button className="inline-flex min-h-8 items-center gap-2 rounded-md border border-berry px-2 text-xs font-semibold text-berry">
                  <Trash2 size={14} /> 删除全部未知证据
                </button>
              </form>
            </div>
            <div className="overflow-x-auto rounded-md border border-line bg-white">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-panel text-xs text-ink/55">
                  <tr>
                    <th className="px-3 py-2">编号</th>
                    <th className="px-3 py-2">标题</th>
                    <th className="px-3 py-2">可信度</th>
                    <th className="px-3 py-2">原因</th>
                    <th className="px-3 py-2">预期影响</th>
                    <th className="px-3 py-2">推荐关联</th>
                    <th className="px-3 py-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedObservations.unknown.map((observation) => {
                    const code = readableCode(observationCodes, observation.id, "O");
                    const links = getObservationRecommendedLinks(observation);
                    const impact = summarizeObservationCandidateImpact(observation, data.beliefs, (hypothesisId) =>
                      readableCode(hypothesisCodes, hypothesisId, "H")
                    );
                    const candidateEvaluation = observationCandidateEvaluationSummary(observation);
                    const queryContext = observationQueryContextSummary(observation);
                    return (
                      <tr key={observation.id} className="border-t border-line align-top">
                        <td className="px-3 py-2 font-mono text-xs">{code}</td>
                        <td className="px-3 py-2">{observation.title}</td>
                        <td className="px-3 py-2">{observation.credibility.toFixed(2)}</td>
                        <td className="px-3 py-2">
                          <div>{observationIgnoredReasonLabel(observation.metadata.ignoredReason)}</div>
                          {queryContext ? <div className="mt-1 text-xs text-ink/55">{queryContext}</div> : null}
                          {candidateEvaluation ? <div className="mt-1 text-xs text-ink/55">{candidateEvaluation}</div> : null}
                        </td>
                        <td className="px-3 py-2">
                          {links.length > 0 ? (
                            <>
                              <div className={`font-semibold ${impactToneClass(impact.tone)}`}>{impact.label}</div>
                              <div className="mt-1 text-xs text-ink/50">{impact.detail}</div>
                            </>
                          ) : null}
                        </td>
                        <td className="px-3 py-2">{renderRecommendedLinks(links)}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-2">
                            {links.length > 0 ? (
                              <form action={confirmRecommendedEvidenceAction}>
                                <input type="hidden" name="observationId" value={observation.id} />
                                <button className="inline-flex min-h-8 items-center gap-2 rounded-md bg-moss px-2 text-xs font-semibold text-white">
                                  <Check size={14} /> 确认推荐
                                </button>
                              </form>
                            ) : null}
                            {observation.metadata.ignoredReason === "UNMATCHED" ? (
                              <Link
                                href={`/admin/world-model/beliefs?sourceObservation=${encodeURIComponent(code)}#recommendations`}
                                className="inline-flex min-h-8 items-center gap-2 rounded-md border border-line px-2 text-xs font-semibold text-ink hover:border-moss hover:text-moss"
                              >
                                <Plus size={14} /> 推荐假设
                              </Link>
                            ) : null}
                            <Link
                              href={`/admin/world-model/evidence?observation=${encodeURIComponent(code)}#confirm-observation`}
                              className="inline-flex min-h-8 items-center gap-2 rounded-md border border-line px-2 text-xs font-semibold text-ink hover:border-moss hover:text-moss"
                            >
                              <Check size={14} /> 转为证据
                            </Link>
                            <form action={rejectObservationAction}>
                              <input type="hidden" name="returnPath" value="/admin/world-model/observations#unknown-evidence" />
                              <input type="hidden" name="observationId" value={observation.id} />
                              <button className="inline-flex min-h-8 items-center gap-2 rounded-md border border-berry px-2 text-xs font-semibold text-berry">
                                <Trash2 size={14} /> 拒绝
                              </button>
                            </form>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </PageSection>
      </div>
      <div id="duplicate-candidates">
      <PageSection title="重复候选">
        {groupedObservations.duplicates.length === 0 ? (
          <EmptyState label="暂无重复候选" />
        ) : (
          <div className="grid gap-3">
            <form action={rejectDuplicateObservationsAction} className="flex justify-end">
              <input type="hidden" name="returnPath" value="/admin/world-model/observations#duplicate-candidates" />
              {groupedObservations.duplicates.map((observation) => (
                <input key={observation.id} type="hidden" name="observationIds" value={observation.id} />
              ))}
              <button className="inline-flex min-h-8 items-center gap-2 rounded-md border border-berry px-2 text-xs font-semibold text-berry">
                <Trash2 size={14} /> 拒绝全部重复候选
              </button>
            </form>
            <form action={deleteDuplicateObservationsAction} className="flex justify-end">
              <input type="hidden" name="returnPath" value="/admin/world-model/observations#duplicate-candidates" />
              {groupedObservations.duplicates.map((observation) => (
                <input key={observation.id} type="hidden" name="observationIds" value={observation.id} />
              ))}
              <button className="inline-flex min-h-8 items-center gap-2 rounded-md border border-berry px-2 text-xs font-semibold text-berry">
                <Trash2 size={14} /> 删除全部重复候选
              </button>
            </form>
            <div className="overflow-x-auto rounded-md border border-line bg-white">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-panel text-xs text-ink/55">
                  <tr>
                    <th className="px-3 py-2">编号</th>
                    <th className="px-3 py-2">标题</th>
                    <th className="px-3 py-2">重复来源</th>
                    <th className="px-3 py-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {groupedObservations.duplicates.map((observation) => (
                    <tr key={observation.id} className="border-t border-line">
                      <td className="px-3 py-2 font-mono text-xs">{readableCode(observationCodes, observation.id, "O")}</td>
                      <td className="px-3 py-2">{observation.title}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {observation.duplicateOfId ? (
                          <a href={`#${readableCode(observationCodes, observation.duplicateOfId, "O")}`} className="text-moss hover:underline">
                            {readableCode(observationCodes, observation.duplicateOfId, "O")}
                          </a>
                        ) : (
                          ""
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <form action={rejectObservationAction}>
                          <input type="hidden" name="returnPath" value="/admin/world-model/observations#duplicate-candidates" />
                          <input type="hidden" name="observationId" value={observation.id} />
                          <button className="inline-flex min-h-8 items-center gap-2 rounded-md border border-berry px-2 text-xs font-semibold text-berry">
                            <Trash2 size={14} /> 拒绝
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </PageSection>
      </div>
      <div id="observation-pool">
      <PageSection title="观察池">
        {!showObservationPool ? (
          <Link
            href="/admin/world-model/observations?view=pool#observation-pool"
            className="inline-flex min-h-9 w-fit items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink hover:border-moss hover:text-moss"
          >
            打开观察池
          </Link>
        ) : (
          <div className="grid gap-3">
            <Link
              href="/admin/world-model/observations#observation-pool"
              className="inline-flex min-h-9 w-fit items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink hover:border-moss hover:text-moss"
            >
              收起观察池
            </Link>
        {data.observations.length === 0 ? (
          <EmptyState label="暂无观察" />
        ) : (
          <div className="overflow-x-auto rounded-md border border-line bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-panel text-xs text-ink/55">
                <tr>
                  <th className="px-3 py-2">标题</th>
                  <th className="px-3 py-2">状态</th>
                  <th className="px-3 py-2">可信度</th>
                  <th className="px-3 py-2">重复来源</th>
                  <th className="px-3 py-2">编号</th>
                  <th className="px-3 py-2">编辑</th>
                </tr>
              </thead>
              <tbody>
                {data.observations.map((observation) => {
                  const code = readableCode(observationCodes, observation.id, "O");
                  return (
                  <tr key={observation.id} id={code} className="border-t border-line">
                    <td className="px-3 py-2">{observation.title}</td>
                    <td className="px-3 py-2">{observationStatusLabels[observation.status]}</td>
                    <td className="px-3 py-2">{observation.credibility.toFixed(2)}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {observation.duplicateOfId ? readableCode(observationCodes, observation.duplicateOfId, "O") : ""}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{code}</td>
                    <td className="min-w-[320px] px-3 py-2">
                      <form action={updateGraphObservationAction} className="grid gap-2">
                        <input type="hidden" name="returnPath" value="/admin/world-model/observations?view=pool#observation-pool" />
                        <input type="hidden" name="observationId" value={observation.id} />
                        <Field label="标题" name="title" defaultValue={observation.title} required />
                        <Field label="链接" name="url" type="url" defaultValue={observation.url ?? ""} />
                        <Field label="作者/来源" name="author" defaultValue={observation.author ?? ""} />
                        <Field
                          label="可信度"
                          name="credibility"
                          type="number"
                          step="0.01"
                          min="0"
                          max="1"
                          defaultValue={observation.credibility}
                        />
                        <TextAreaField label="正文" name="content" defaultValue={observation.content} required />
                        <button className="inline-flex min-h-8 items-center justify-center gap-2 rounded-md border border-moss px-2 text-xs font-semibold text-moss">
                          <Save size={14} /> 保存观察
                        </button>
                      </form>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
          </div>
        )}
      </PageSection>
      </div>
    </main>
  );
}
