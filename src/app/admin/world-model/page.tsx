import { loadWorldModelData } from "@/app/admin/world-model/data";
import { DataWarning, PageSection } from "@/components/world-model/PageSection";

export const dynamic = "force-dynamic";

export default async function WorldModelDashboardPage() {
  const data = await loadWorldModelData();
  const activeHypotheses = data.beliefs.flatMap((belief) => belief.hypotheses).filter((item) => item.status === "ACTIVE");
  const pendingObservations = data.observations.filter((item) => item.status === "PENDING" || item.status === "DUPLICATE");

  return (
    <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <DataWarning message={data.error} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["信念", data.beliefs.length],
          ["活跃假设", activeHypotheses.length],
          ["待处理观察", pendingObservations.length],
          ["已确认信据", data.evidence.length],
          ["更新事件", data.updates.length]
        ].map(([label, value]) => (
          <div key={label} className="rounded-md border border-line bg-white px-4 py-3">
            <div className="text-xs text-ink/55">{label}</div>
            <div className="mt-1 text-2xl font-semibold text-ink">{value}</div>
          </div>
        ))}
      </div>
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
                  <td className="px-3 py-2 font-mono text-xs">{event.id}</td>
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
