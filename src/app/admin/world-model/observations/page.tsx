import { Plus } from "lucide-react";
import { createObservationAction } from "@/app/admin/world-model/actions";
import { loadWorldModelData } from "@/app/admin/world-model/data";
import { Field, TextAreaField } from "@/components/world-model/Field";
import { DataWarning, EmptyState, PageSection } from "@/components/world-model/PageSection";

export const dynamic = "force-dynamic";

export default async function ObservationsPage() {
  const data = await loadWorldModelData();

  return (
    <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <DataWarning message={data.error} />
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
                  <th className="px-3 py-2">ID</th>
                </tr>
              </thead>
              <tbody>
                {data.observations.map((observation) => (
                  <tr key={observation.id} className="border-t border-line">
                    <td className="px-3 py-2">{observation.title}</td>
                    <td className="px-3 py-2">{observation.status}</td>
                    <td className="px-3 py-2">{observation.credibility.toFixed(2)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{observation.duplicateOfId ?? ""}</td>
                    <td className="px-3 py-2 font-mono text-xs text-ink/45">{observation.id}</td>
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
