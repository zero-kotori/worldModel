import { Plus } from "lucide-react";
import { createBeliefAction, createHypothesisAction, createRecommendedHypothesisAction } from "@/app/admin/world-model/actions";
import { loadWorldModelData } from "@/app/admin/world-model/data";
import { getWorldModelServices } from "@/server/services";
import { categoryLabels, hypothesisStanceLabels, probabilityModeLabels } from "@/lib/world-model-navigation";
import { createReadableCodes, readableCode } from "@/lib/world-model-display";
import { createWorldModelGraph } from "@/lib/world-model-graph";
import { createWorldModelGraphEditorData } from "@/lib/world-model-graph-editor";
import { Field, SelectField, TextAreaField } from "@/components/world-model/Field";
import { DataWarning, EmptyState, PageSection, StatusNotice } from "@/components/world-model/PageSection";
import { WorldModelGraphView } from "@/components/world-model/WorldModelGraphView";

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

export default async function BeliefsPage({ searchParams }: PageProps) {
  const data = await loadWorldModelData();
  const params = (await searchParams) ?? {};
  const beliefCodes = createReadableCodes(data.beliefs, "B", (belief) => belief.createdAt);
  const hypothesisCodes = createReadableCodes(
    data.beliefs.flatMap((belief) => belief.hypotheses),
    "H",
    (hypothesis) => hypothesis.createdAt
  );
  const selectedBeliefCode = firstParam(params.belief);
  const selectedBelief = data.beliefs.find((belief) => readableCode(beliefCodes, belief.id, "B") === selectedBeliefCode);
  const graphBeliefs = selectedBelief ? [selectedBelief] : data.beliefs;
  const graphBeliefIds = new Set(graphBeliefs.map((belief) => belief.id));
  const graphHypothesisIds = new Set(graphBeliefs.flatMap((belief) => belief.hypotheses.map((hypothesis) => hypothesis.id)));
  const graphEvidence = data.evidence
    .map((evidence) => ({ ...evidence, links: evidence.links.filter((link) => graphHypothesisIds.has(link.hypothesisId)) }))
    .filter((evidence) => evidence.links.length > 0);
  const graphEvidenceIds = new Set(graphEvidence.map((evidence) => evidence.id));
  const graphUpdates = data.updates.filter((event) => graphBeliefIds.has(event.beliefId) && graphEvidenceIds.has(event.evidenceId));
  const graph = createWorldModelGraph({ beliefs: graphBeliefs, evidence: graphEvidence, updates: graphUpdates });
  const graphEditor = createWorldModelGraphEditorData({ beliefs: data.beliefs, evidence: data.evidence, updates: data.updates });
  const services = getWorldModelServices();
  const recommendationsByBeliefId = new Map(
    await Promise.all(
      data.beliefs.map(async (belief) => [belief.id, await services.beliefs.recommendHypotheses(belief.id, { limit: 4 })] as const)
    )
  );

  return (
    <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <DataWarning message={data.error} />
      <StatusNotice message={firstParam(params.message)} />
      <StatusNotice message={firstParam(params.error)} tone="error" />
      <PageSection title={selectedBelief ? "信念关系图谱" : "信念全局图谱"}>
        <WorldModelGraphView graph={graph} editor={graphEditor} />
      </PageSection>
      <PageSection title="信念表">
        {data.beliefs.length === 0 ? (
          <EmptyState label="暂无信念" />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {data.beliefs.map((belief) => {
              const beliefCode = readableCode(beliefCodes, belief.id, "B");
              return (
                <details
                  key={belief.id}
                  id={beliefCode}
                  open={selectedBeliefCode === beliefCode}
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
                    </div>
                    <span className="rounded-md bg-moss/10 px-2 py-1 text-xs font-semibold text-moss">
                      强度 {(beliefStrength(belief.hypotheses) * 100).toFixed(1)}%
                    </span>
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
                        </tr>
                      </thead>
                      <tbody>
                        {belief.hypotheses.map((hypothesis) => (
                          <tr key={hypothesis.id} className="border-t border-line">
                            <td className="py-2 pr-3 font-mono text-xs">{readableCode(hypothesisCodes, hypothesis.id, "H")}</td>
                            <td className="py-2 pr-3">{hypothesis.proposition}</td>
                            <td className="py-2 pr-3">{hypothesisStanceLabels[hypothesis.stance]}</td>
                            <td className="py-2 pr-3">{(hypothesis.currentProbability * 100).toFixed(1)}%</td>
                            <td className="py-2 pr-3">{hypothesis.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-4 grid gap-2 border-t border-line pt-4">
                    <div className="text-xs font-medium text-ink/65">推荐假设</div>
                    {(recommendationsByBeliefId.get(belief.id) ?? []).length === 0 ? (
                      <div className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink/55">暂无推荐</div>
                    ) : (
                      <div className="grid gap-2">
                        {(recommendationsByBeliefId.get(belief.id) ?? []).map((recommendation) => (
                          <div key={recommendation.proposition} className="rounded-md border border-line bg-panel p-3">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-semibold text-ink">{recommendation.proposition}</div>
                                <div className="mt-1 text-xs text-ink/60">
                                  {hypothesisStanceLabels[recommendation.stance]} · 初始概率{" "}
                                  {(recommendation.priorProbability * 100).toFixed(1)}%
                                </div>
                                <div className="mt-1 text-xs text-ink/55">{recommendation.notes}</div>
                              </div>
                              <form action={createRecommendedHypothesisAction}>
                                <input type="hidden" name="beliefId" value={belief.id} />
                                <input type="hidden" name="proposition" value={recommendation.proposition} />
                                <input type="hidden" name="stance" value={recommendation.stance} />
                                <input type="hidden" name="priorProbability" value={recommendation.priorProbability} />
                                <input
                                  type="hidden"
                                  name="notes"
                                  value={`${recommendation.notes}\n推荐依据：${recommendation.rationale}\n证据检索：${recommendation.evidenceSearchQuery}`}
                                />
                                <button className="inline-flex min-h-8 items-center gap-2 rounded-md border border-line bg-white px-2 text-xs font-semibold text-ink hover:border-moss hover:text-moss">
                                  <Plus size={14} /> 添加
                                </button>
                              </form>
                            </div>
                          </div>
                        ))}
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
      <PageSection title="新建信念表">
        <form action={createBeliefAction} className="grid gap-3 rounded-md border border-line bg-white p-4 lg:grid-cols-4">
          <Field label="标题" name="title" required />
          <SelectField
            label="分类"
            name="category"
            options={Object.entries(categoryLabels).map(([value, label]) => ({ value, label }))}
          />
          <SelectField
            label="概率结构"
            name="probabilityMode"
            options={Object.entries(probabilityModeLabels).map(([value, label]) => ({ value, label }))}
          />
          <TextAreaField label="描述" name="description" />
          <Field label="假设 A" name="proposition1" required />
          <SelectField
            label="假设 A 类型"
            name="stance1"
            options={Object.entries(hypothesisStanceLabels).map(([value, label]) => ({ value, label }))}
          />
          <Field label="假设 A 初始概率" name="priorProbability1" type="number" step="0.01" min="0" max="1" defaultValue="0.5" />
          <Field label="假设 B" name="proposition2" required />
          <SelectField
            label="假设 B 类型"
            name="stance2"
            defaultValue="OPPOSES"
            options={Object.entries(hypothesisStanceLabels).map(([value, label]) => ({ value, label }))}
          />
          <Field label="假设 B 初始概率" name="priorProbability2" type="number" step="0.01" min="0" max="1" defaultValue="0.5" />
          <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-moss px-3 text-sm font-semibold text-white">
            <Plus size={16} /> 创建信念表
          </button>
        </form>
      </PageSection>
    </main>
  );
}
