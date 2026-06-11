import Link from "next/link";
import { Check, Plus, Trash2 } from "lucide-react";
import {
  confirmRecommendedEvidenceAction,
  createObservationAction,
  rejectObservationAction
} from "@/app/admin/world-model/actions";
import { loadWorldModelData } from "@/app/admin/world-model/data";
import { createReadableCodes, readableCode } from "@/lib/world-model-display";
import {
  getObservationRecommendedLinks,
  groupObservationsForReview,
  observationStatusLabels
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

function reviewReasonLabel(reason: unknown) {
  if (reason === "REVIEW_ONLY") return "待审模式";
  if (reason === "SOURCE_REQUIRES_REVIEW") return "来源待审";
  if (reason === "QUALITY_THRESHOLD") return "阈值待审";
  return "";
}

export default async function ObservationsPage({ searchParams }: PageProps) {
  const data = await loadWorldModelData();
  const params = (await searchParams) ?? {};
  const observationCodes = createReadableCodes(data.observations, "O", (observation) => observation.observedAt);
  const hypotheses = data.beliefs.flatMap((belief) => belief.hypotheses.map((hypothesis) => ({ belief, hypothesis })));
  const hypothesisCodes = createReadableCodes(
    hypotheses.map((item) => item.hypothesis),
    "H",
    (hypothesis) => hypothesis.createdAt
  );
  const hypothesisById = new Map(hypotheses.map((item) => [item.hypothesis.id, item] as const));
  const groupedObservations = groupObservationsForReview(data.observations);

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
                  <th className="px-3 py-2">推荐关联</th>
                  <th className="px-3 py-2">原因</th>
                  <th className="px-3 py-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {groupedObservations.reviewCandidates.map((observation) => {
                  const code = readableCode(observationCodes, observation.id, "O");
                  const links = getObservationRecommendedLinks(observation);
                  return (
                    <tr key={observation.id} className="border-t border-line align-top">
                      <td className="px-3 py-2 font-mono text-xs">{code}</td>
                      <td className="px-3 py-2">{observation.title}</td>
                      <td className="px-3 py-2">
                        <div className="grid gap-2">
                          {links.map((link) => {
                            const target = hypothesisById.get(link.hypothesisId);
                            return (
                              <div key={link.hypothesisId} className="rounded-md border border-line bg-panel p-2">
                                <div className="text-xs font-semibold text-ink">
                                  <span className="font-mono">{readableCode(hypothesisCodes, link.hypothesisId, "H")}</span>
                                  <span className="ml-2">
                                    {target ? `${target.belief.title} · ${target.hypothesis.proposition}` : "已删除假设"}
                                  </span>
                                </div>
                                <div className="mt-1 text-xs text-ink/60">
                                  {evidenceDirectionLabels[link.direction]} · 相关性 {link.relevance.toFixed(2)} · LR{" "}
                                  {link.likelihoodRatio.toFixed(2)} · 置信度 {link.confidence.toFixed(2)}
                                </div>
                                <div className="mt-1 text-xs text-ink/55">{link.rationale}</div>
                              </div>
                            );
                          })}
                        </div>
                      </td>
                      <td className="px-3 py-2">{reviewReasonLabel(observation.metadata.reviewReason)}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
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
      <PageSection title="未知证据队列">
        {groupedObservations.unknown.length === 0 ? (
          <EmptyState label="暂无未知证据" />
        ) : (
          <div className="overflow-x-auto rounded-md border border-line bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-panel text-xs text-ink/55">
                <tr>
                  <th className="px-3 py-2">编号</th>
                  <th className="px-3 py-2">标题</th>
                  <th className="px-3 py-2">可信度</th>
                  <th className="px-3 py-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {groupedObservations.unknown.map((observation) => {
                  const code = readableCode(observationCodes, observation.id, "O");
                  return (
                    <tr key={observation.id} className="border-t border-line">
                      <td className="px-3 py-2 font-mono text-xs">{code}</td>
                      <td className="px-3 py-2">{observation.title}</td>
                      <td className="px-3 py-2">{observation.credibility.toFixed(2)}</td>
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
      <PageSection title="重复候选">
        {groupedObservations.duplicates.length === 0 ? (
          <EmptyState label="暂无重复候选" />
        ) : (
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
                      {observation.duplicateOfId ? readableCode(observationCodes, observation.duplicateOfId, "O") : ""}
                    </td>
                    <td className="px-3 py-2">
                      <form action={rejectObservationAction}>
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
        )}
      </PageSection>
      <PageSection title="观察池">
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
                </tr>
              </thead>
              <tbody>
                {data.observations.map((observation) => (
                  <tr key={observation.id} className="border-t border-line">
                    <td className="px-3 py-2">{observation.title}</td>
                    <td className="px-3 py-2">{observationStatusLabels[observation.status]}</td>
                    <td className="px-3 py-2">{observation.credibility.toFixed(2)}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {observation.duplicateOfId ? readableCode(observationCodes, observation.duplicateOfId, "O") : ""}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{readableCode(observationCodes, observation.id, "O")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PageSection>
    </main>
  );
}
