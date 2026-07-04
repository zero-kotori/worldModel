import { Plus } from "lucide-react";
import Link from "next/link";
import { createBeliefAction, createHypothesisAction, createRecommendedHypothesisAction } from "@/app/admin/world-model/actions";
import { loadWorldModelData } from "@/app/admin/world-model/data";
import { getWorldModelServices } from "@/server/services";
import { categoryLabels, hypothesisStanceLabels, probabilityModeLabels } from "@/lib/world-model-navigation";
import {
  hypothesisTimeStatus,
  isHypothesisReviewDue,
  summarizeHypothesisEvidenceImpact,
  summarizeHypothesisStanceCoverage
} from "@/lib/world-model-beliefs-ui";
import { createReadableCodes, readableCode } from "@/lib/world-model-display";
import { Field, SelectField, TextAreaField } from "@/components/world-model/Field";
import { DataWarning, EmptyState, PageSection, StatusNotice } from "@/components/world-model/PageSection";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function beliefStrength(hypotheses: Awaited<ReturnType<typeof loadWorldModelData>>["beliefs"][number]["hypotheses"]) {
  const active = hypotheses.filter((hypothesis) => hypothesis.status === "ACTIVE");
  if (active.length === 0) return 0;
  return (
    active.reduce(
      (sum, hypothesis) => sum + (hypothesis.stance === "OPPOSES" ? 1 - hypothesis.currentProbability : hypothesis.currentProbability),
      0
    ) / active.length
  );
}

function timeToneClass(tone: ReturnType<typeof hypothesisTimeStatus>["tone"]) {
  if (tone === "healthy") return "text-moss";
  if (tone === "warning") return "text-amber-700";
  if (tone === "expired") return "text-berry";
  return "text-ink/55";
}

function evidenceImpactToneClass(tone: ReturnType<typeof summarizeHypothesisEvidenceImpact>["tone"]) {
  if (tone === "support") return "text-moss";
  if (tone === "oppose") return "text-berry";
  if (tone === "mixed") return "text-amber-700";
  return "text-ink/55";
}

function stanceCoverageToneClass(tone: ReturnType<typeof summarizeHypothesisStanceCoverage>["tone"]) {
  if (tone === "healthy") return "text-moss";
  if (tone === "warning") return "text-amber-700";
  return "text-ink/55";
}

export default async function BeliefsPage({ searchParams }: PageProps) {
  const data = await loadWorldModelData();
  const params = (await searchParams) ?? {};
  const referenceTime = new Date();
  const beliefCodes = createReadableCodes(data.beliefs, "B", (belief) => belief.createdAt);
  const hypothesisCodes = createReadableCodes(
    data.beliefs.flatMap((belief) => belief.hypotheses),
    "H",
    (hypothesis) => hypothesis.createdAt
  );
  const evidenceCodes = createReadableCodes(data.evidence, "E", (evidence) => evidence.confirmedAt);
  const observationCodes = createReadableCodes(data.observations, "O", (observation) => observation.observedAt);
  const observationById = new Map(data.observations.map((observation) => [observation.id, observation]));
  const selectedBeliefCode = firstParam(params.belief);
  const sourceObservationCode = firstParam(params.sourceObservation);
  const sourceObservation = data.observations.find(
    (observation) => readableCode(observationCodes, observation.id, "O") === sourceObservationCode
  );
  const sourceObservationId = sourceObservation?.id;
  const reviewDueOnly = firstParam(params.view) === "review-due";
  const services = getWorldModelServices();
  const recommendationOptions = sourceObservationId ? { limit: 4, sourceObservationId } : { limit: 4 };
  const recommendationsByBeliefId = new Map(
    await Promise.all(
      data.beliefs.map(async (belief) => [belief.id, await services.beliefs.recommendHypotheses(belief.id, recommendationOptions)] as const)
    )
  );
  const recommendationsForBelief = (beliefId: string) => {
    const recommendations = recommendationsByBeliefId.get(beliefId) ?? [];
    return sourceObservationId
      ? recommendations.filter((recommendation) => recommendation.sourceObservationId === sourceObservationId)
      : recommendations;
  };
  const sourceRecommendationBeliefIds = new Set(
    sourceObservationId ? data.beliefs.filter((belief) => recommendationsForBelief(belief.id).length > 0).map((belief) => belief.id) : []
  );
  const selectedBelief = data.beliefs.find((belief) => readableCode(beliefCodes, belief.id, "B") === selectedBeliefCode);
  const reviewDueBeliefs = data.beliefs
    .map((belief) => ({
      ...belief,
      hypotheses: belief.hypotheses.filter((hypothesis) => isHypothesisReviewDue(hypothesis, referenceTime))
    }))
    .filter((belief) => belief.hypotheses.length > 0);
  const visibleBeliefs =
    sourceObservationId && !selectedBelief
      ? data.beliefs.filter((belief) => sourceRecommendationBeliefIds.has(belief.id))
      : reviewDueOnly && !selectedBelief
        ? reviewDueBeliefs
        : data.beliefs;
  const beliefSectionTitle = sourceObservationId ? "来源观察推荐" : reviewDueOnly ? "待复核假设" : "信念表";
  const sourceObservationSeed = sourceObservation
    ? {
        title: sourceObservation.title,
        description: sourceObservation.content,
        proposition1: `${sourceObservation.title} 会持续影响这个判断`,
        proposition2: `${sourceObservation.title} 的影响有限或不可持续`
      }
    : undefined;

  return (
    <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <DataWarning message={data.error} />
      <StatusNotice message={firstParam(params.message)} />
      <StatusNotice message={firstParam(params.error)} tone="error" />
      <div id="recommendations">
      <PageSection title={beliefSectionTitle}>
        {visibleBeliefs.length === 0 ? (
          <EmptyState label={sourceObservationId ? "暂无来自该观察的推荐" : reviewDueOnly ? "暂无待复核假设" : "暂无信念"} />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {visibleBeliefs.map((belief) => {
              const beliefCode = readableCode(beliefCodes, belief.id, "B");
              const recommendations = recommendationsForBelief(belief.id);
              const stanceCoverage = summarizeHypothesisStanceCoverage(belief.hypotheses);
              return (
                <details
                  key={belief.id}
                  id={beliefCode}
                  open={reviewDueOnly || selectedBeliefCode === beliefCode || Boolean(sourceObservationId)}
                  className="rounded-md border border-line bg-white p-4 open:border-moss"
                >
                  <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="text-base font-semibold">
                        {beliefCode} · {belief.title}
                      </span>
                      <p className="text-xs text-ink/55">
                        {categoryLabels[belief.category]} · {probabilityModeLabels[belief.probabilityMode]} · {belief.status}
                      </p>
                      {stanceCoverage.tone !== "healthy" ? (
                        <p className={`mt-1 text-xs ${stanceCoverageToneClass(stanceCoverage.tone)}`}>{stanceCoverage.detail}</p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-md bg-panel px-2 py-1 text-xs font-semibold ${stanceCoverageToneClass(stanceCoverage.tone)}`}>
                        {stanceCoverage.label}
                      </span>
                      <span className="rounded-md bg-moss/10 px-2 py-1 text-xs font-semibold text-moss">
                        强度 {(beliefStrength(belief.hypotheses) * 100).toFixed(1)}%
                      </span>
                    </div>
                  </summary>
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead className="text-xs text-ink/50">
                        <tr>
                          <th className="py-2">编号</th>
                          <th className="py-2">假设</th>
                          <th className="py-2">类型</th>
                          <th className="py-2">当前概率</th>
                          <th className="py-2">状态</th>
                          <th className="py-2">证据影响</th>
                          <th className="py-2">时间窗口</th>
                        </tr>
                      </thead>
                      <tbody>
                        {belief.hypotheses.map((hypothesis) => {
                          const timeStatus = hypothesisTimeStatus(hypothesis, referenceTime);
                          const evidenceImpact = summarizeHypothesisEvidenceImpact(hypothesis.id, data.evidence, (evidenceId) =>
                            readableCode(evidenceCodes, evidenceId, "E")
                          );
                          return (
                            <tr key={hypothesis.id} className="border-t border-line">
                              <td className="py-2 pr-3 font-mono text-xs">{readableCode(hypothesisCodes, hypothesis.id, "H")}</td>
                              <td className="py-2 pr-3">{hypothesis.proposition}</td>
                              <td className="py-2 pr-3">{hypothesisStanceLabels[hypothesis.stance]}</td>
                              <td className="py-2 pr-3">{(hypothesis.currentProbability * 100).toFixed(1)}%</td>
                              <td className="py-2 pr-3">{hypothesis.status}</td>
                              <td className="py-2 pr-3">
                                <div className={`font-semibold ${evidenceImpactToneClass(evidenceImpact.tone)}`}>{evidenceImpact.label}</div>
                                <div className="mt-1 text-xs text-ink/50">{evidenceImpact.detail}</div>
                              </td>
                              <td className="py-2 pr-3">
                                <div className={`font-semibold ${timeToneClass(timeStatus.tone)}`}>{timeStatus.label}</div>
                                {timeStatus.detail ? <div className="mt-1 text-xs text-ink/50">{timeStatus.detail}</div> : null}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-4 grid gap-2 border-t border-line pt-4">
                    <div className="text-xs font-medium text-ink/65">推荐假设</div>
                    {recommendations.length === 0 ? (
                      <div className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink/55">暂无推荐</div>
                    ) : (
                      <div className="grid gap-2">
                        {recommendations.map((recommendation) => {
                          const sourceObservation = recommendation.sourceObservationId
                            ? observationById.get(recommendation.sourceObservationId)
                            : undefined;
                          const calibrationHypothesisCode = recommendation.calibrationHypothesisId
                            ? readableCode(hypothesisCodes, recommendation.calibrationHypothesisId, "H")
                            : undefined;
                          return (
                            <div key={recommendation.proposition} className="rounded-md border border-line bg-panel p-3">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <div className="text-sm font-semibold text-ink">{recommendation.proposition}</div>
                                  <div className="mt-1 text-xs text-ink/60">
                                    {hypothesisStanceLabels[recommendation.stance]} · 初始概率{" "}
                                    {(recommendation.priorProbability * 100).toFixed(1)}%
                                  </div>
                                  <div className="mt-1 text-xs text-ink/55">{recommendation.notes}</div>
                                  <div className="mt-1 text-xs text-ink/55">搜证查询：{recommendation.evidenceSearchQuery}</div>
                                  {recommendation.sourceObservationId ? (
                                    <div className="mt-2 text-xs text-ink/60">
                                      来源观察{" "}
                                      <Link
                                        href="/admin/world-model/observations#unknown-evidence"
                                        className="font-semibold text-moss hover:underline"
                                      >
                                        {readableCode(observationCodes, recommendation.sourceObservationId, "O")} ·{" "}
                                        {sourceObservation?.title ?? "已删除观察"}
                                      </Link>
                                    </div>
                                  ) : null}
                                  {calibrationHypothesisCode ? (
                                    <div className="mt-2 text-xs text-ink/60">
                                      校准来源{" "}
                                      <Link
                                        href={`/admin/world-model/graph?hypothesis=${encodeURIComponent(calibrationHypothesisCode)}`}
                                        className="font-semibold text-moss hover:underline"
                                      >
                                        {calibrationHypothesisCode}
                                      </Link>
                                      {typeof recommendation.calibrationError === "number"
                                        ? ` · 误差 ${(recommendation.calibrationError * 100).toFixed(1)}pp`
                                        : ""}
                                    </div>
                                  ) : null}
                                </div>
                                <form action={createRecommendedHypothesisAction}>
                                  <input type="hidden" name="beliefId" value={belief.id} />
                                  <input type="hidden" name="proposition" value={recommendation.proposition} />
                                  <input type="hidden" name="stance" value={recommendation.stance} />
                                  <input type="hidden" name="priorProbability" value={recommendation.priorProbability} />
                                  <input type="hidden" name="evidenceSearchQuery" value={recommendation.evidenceSearchQuery} />
                                  {recommendation.sourceObservationId ? (
                                    <input type="hidden" name="sourceObservationId" value={recommendation.sourceObservationId} />
                                  ) : null}
                                  <input
                                    type="hidden"
                                    name="notes"
                                    value={`${recommendation.notes}\n推荐依据：${recommendation.rationale}`}
                                  />
                                  <button className="inline-flex min-h-8 items-center gap-2 rounded-md border border-line bg-white px-2 text-xs font-semibold text-ink hover:border-moss hover:text-moss">
                                    <Plus size={14} /> 添加
                                  </button>
                                </form>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <form action={createHypothesisAction} className="mt-4 grid gap-3 border-t border-line pt-4 lg:grid-cols-4">
                    <input type="hidden" name="beliefId" value={belief.id} />
                    <Field label="新增假设" name="proposition" required />
                    <SelectField
                      label="类型"
                      name="stance"
                      options={Object.entries(hypothesisStanceLabels).map(([value, label]) => ({ value, label }))}
                    />
                    <Field
                      label="初始概率"
                      name="priorProbability"
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      defaultValue="0.5"
                    />
                    <Field label="备注" name="notes" />
                    <Field label="搜证查询" name="evidenceSearchQuery" />
                    <Field label="开始时间" name="startsAt" type="datetime-local" />
                    <Field label="到期时间" name="expiresAt" type="datetime-local" />
                    <Field label="过期条件" name="expiryCondition" />
                    <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-moss px-3 text-sm font-semibold text-white">
                      <Plus size={16} /> 添加假设
                    </button>
                  </form>
                </details>
              );
            })}
          </div>
        )}
      </PageSection>
      </div>
      <PageSection title="新建信念表">
        <form action={createBeliefAction} className="grid gap-3 rounded-md border border-line bg-white p-4 lg:grid-cols-4">
          {sourceObservationId ? <input type="hidden" name="sourceObservationId" value={sourceObservationId} /> : null}
          <Field label="标题" name="title" required defaultValue={sourceObservationSeed?.title} />
          <SelectField
            label="分类"
            name="category"
            options={Object.entries(categoryLabels).map(([value, label]) => ({ value, label }))}
          />
          <SelectField
            label="概率结构"
            name="probabilityMode"
            defaultValue={sourceObservationSeed ? "INDEPENDENT" : undefined}
            options={Object.entries(probabilityModeLabels).map(([value, label]) => ({ value, label }))}
          />
          <TextAreaField label="描述" name="description" defaultValue={sourceObservationSeed?.description} />
          <Field label="假设 A" name="proposition1" required defaultValue={sourceObservationSeed?.proposition1} />
          <SelectField
            label="假设 A 类型"
            name="stance1"
            options={Object.entries(hypothesisStanceLabels).map(([value, label]) => ({ value, label }))}
          />
          <Field
            label="假设 A 初始概率"
            name="priorProbability1"
            type="number"
            step="0.01"
            min="0"
            max="1"
            defaultValue={sourceObservationSeed ? "0.45" : "0.5"}
          />
          <Field label="假设 A 搜证查询" name="evidenceSearchQuery1" defaultValue={sourceObservationSeed?.title} />
          <Field label="假设 B" name="proposition2" required defaultValue={sourceObservationSeed?.proposition2} />
          <SelectField
            label="假设 B 类型"
            name="stance2"
            defaultValue="OPPOSES"
            options={Object.entries(hypothesisStanceLabels).map(([value, label]) => ({ value, label }))}
          />
          <Field
            label="假设 B 初始概率"
            name="priorProbability2"
            type="number"
            step="0.01"
            min="0"
            max="1"
            defaultValue={sourceObservationSeed ? "0.35" : "0.5"}
          />
          <Field label="假设 B 搜证查询" name="evidenceSearchQuery2" defaultValue={sourceObservationSeed?.title} />
          <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-moss px-3 text-sm font-semibold text-white">
            <Plus size={16} /> 创建信念表
          </button>
        </form>
      </PageSection>
    </main>
  );
}
