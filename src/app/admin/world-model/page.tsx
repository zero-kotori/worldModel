import Link from "next/link";
import { loadWorldModelData } from "@/app/admin/world-model/data";
import { DataWarning, PageSection } from "@/components/world-model/PageSection";
import { WorldModelGraphView } from "@/components/world-model/WorldModelGraphView";
import { isHypothesisCurrentlyEffective, summarizeHypothesisTimeCoverage } from "@/lib/world-model-beliefs-ui";
import { createReadableCodes, readableCode } from "@/lib/world-model-display";
import { createWorldModelGraph } from "@/lib/world-model-graph";
import { createWorldModelGraphEditorData } from "@/lib/world-model-graph-editor";
import { categoryLabels } from "@/lib/world-model-navigation";

export const dynamic = "force-dynamic";

export default async function WorldModelDashboardPage() {
  const data = await loadWorldModelData();
  const beliefCodes = createReadableCodes(data.beliefs, "B", (belief) => belief.createdAt);
  const evidenceCodes = createReadableCodes(data.evidence, "E", (evidence) => evidence.confirmedAt);
  const updateCodes = createReadableCodes(data.updates, "U", (event) => event.createdAt);
  const evidenceById = new Map(data.evidence.map((evidence) => [evidence.id, evidence]));
  const graph = createWorldModelGraph({ beliefs: data.beliefs, evidence: data.evidence, updates: data.updates });
  const graphEditor = createWorldModelGraphEditorData({ beliefs: data.beliefs, evidence: data.evidence, updates: data.updates });
  const referenceTime = new Date();
  const hypothesisCoverage = summarizeHypothesisTimeCoverage(
    data.beliefs.flatMap((belief) => belief.hypotheses),
    referenceTime
  );
  const pendingObservations = data.observations.filter((item) => item.status === "PENDING" || item.status === "DUPLICATE");
  const metrics = [
    ["信念", data.beliefs.length, "/admin/world-model/beliefs"],
    ["当前有效假设", hypothesisCoverage.effectiveCount, "/admin/world-model/beliefs"],
    ["待复核假设", hypothesisCoverage.reviewDueCount, "/admin/world-model/beliefs"],
    ["待处理观察", pendingObservations.length, "/admin/world-model/observations"],
    ["已确认证据", data.evidence.length, "/admin/world-model/evidence"]
  ] as const;

  return (
    <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <DataWarning message={data.error} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {metrics.map(([label, value, href]) => (
          <Link key={label} href={href} className="rounded-md border border-line bg-white px-4 py-3 hover:border-moss">
            <div className="text-xs text-ink/55">{label}</div>
            <div className="mt-1 text-2xl font-semibold text-ink">{value}</div>
          </Link>
        ))}
      </div>
      <PageSection title="关系图谱">
        <WorldModelGraphView graph={graph} editor={graphEditor} />
      </PageSection>
      <PageSection title="信念表">
        {data.beliefs.length === 0 ? (
          <div className="rounded-md border border-dashed border-line bg-white px-4 py-6 text-sm text-ink/55">暂无信念</div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {data.beliefs.slice(0, 6).map((belief) => {
              const beliefCode = readableCode(beliefCodes, belief.id, "B");
              const coverage = summarizeHypothesisTimeCoverage(belief.hypotheses, referenceTime);
              const effective = belief.hypotheses.filter((hypothesis) => isHypothesisCurrentlyEffective(hypothesis, referenceTime));
              const strength =
                effective.length === 0
                  ? 0
                  : effective.reduce((sum, hypothesis) => {
                      return sum + (hypothesis.stance === "OPPOSES" ? 1 - hypothesis.currentProbability : hypothesis.currentProbability);
                    }, 0) / effective.length;
              return (
                <Link
                  key={belief.id}
                  href={`/admin/world-model/beliefs?belief=${beliefCode}#${beliefCode}`}
                  className="rounded-md border border-line bg-white p-4 hover:border-moss"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="font-semibold text-ink">
                        {beliefCode} · {belief.title}
                      </h2>
                      <p className="mt-1 text-xs text-ink/55">
                        {categoryLabels[belief.category]} · {coverage.effectiveCount} 个当前有效假设
                        {coverage.reviewDueCount > 0 ? ` · ${coverage.reviewDueCount} 个待复核` : ""}
                      </p>
                    </div>
                    <span className="rounded-md bg-moss/10 px-2 py-1 text-xs font-semibold text-moss">
                      {(strength * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-panel">
                    <div className="h-full bg-moss" style={{ width: `${Math.round(strength * 100)}%` }} />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </PageSection>
      <PageSection title="最近更新">
        <div className="overflow-x-auto rounded-md border border-line bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-panel text-xs text-ink/55">
              <tr>
                <th className="px-3 py-2">事件</th>
                <th className="px-3 py-2">状态</th>
                <th className="px-3 py-2">时间</th>
              </tr>
            </thead>
            <tbody>
              {data.updates.slice(0, 8).map((event) => (
                <tr key={event.id} className="border-t border-line">
                  <td className="px-3 py-2">
                    <span className="font-mono text-xs">{readableCode(updateCodes, event.id, "U")}</span>
                    <span className="ml-2 text-ink/65">
                      {evidenceById.get(event.evidenceId)?.title ?? readableCode(evidenceCodes, event.evidenceId, "E")}
                    </span>
                  </td>
                  <td className="px-3 py-2">{event.status}</td>
                  <td className="px-3 py-2">{event.createdAt.toLocaleString("zh-CN")}</td>
                </tr>
              ))}
              {data.updates.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-ink/50" colSpan={3}>
                    暂无更新事件
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </PageSection>
    </main>
  );
}
