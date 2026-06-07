import { Plus } from "lucide-react";
import { createBeliefAction } from "@/app/admin/world-model/actions";
import { loadWorldModelData } from "@/app/admin/world-model/data";
import { categoryLabels, probabilityModeLabels } from "@/lib/world-model-navigation";
import { Field, SelectField, TextAreaField } from "@/components/world-model/Field";
import { DataWarning, EmptyState, PageSection } from "@/components/world-model/PageSection";

export const dynamic = "force-dynamic";

export default async function BeliefsPage() {
  const data = await loadWorldModelData();

  return (
    <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <DataWarning message={data.error} />
      <PageSection title="创建信念">
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
          <Field label="假设 A 初始概率" name="priorProbability1" type="number" step="0.01" min="0" defaultValue="0.5" />
          <Field label="假设 A" name="proposition1" required />
          <Field label="假设 B 初始概率" name="priorProbability2" type="number" step="0.01" min="0" defaultValue="0.5" />
          <Field label="假设 B" name="proposition2" required />
          <TextAreaField label="描述" name="description" />
          <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-moss px-3 text-sm font-semibold text-white">
            <Plus size={16} /> 创建
          </button>
        </form>
      </PageSection>
      <PageSection title="信念表">
        {data.beliefs.length === 0 ? (
          <EmptyState label="暂无信念" />
        ) : (
          <div className="grid gap-3">
            {data.beliefs.map((belief) => (
              <div key={belief.id} className="rounded-md border border-line bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold">{belief.title}</h2>
                    <p className="text-xs text-ink/55">
                      {categoryLabels[belief.category]} · {probabilityModeLabels[belief.probabilityMode]} · {belief.status}
                    </p>
                  </div>
                  <span className="font-mono text-xs text-ink/45">{belief.id}</span>
                </div>
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="text-xs text-ink/50">
                      <tr>
                        <th className="py-2">假设</th>
                        <th className="py-2">当前概率</th>
                        <th className="py-2">状态</th>
                        <th className="py-2">ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {belief.hypotheses.map((hypothesis) => (
                        <tr key={hypothesis.id} className="border-t border-line">
                          <td className="py-2 pr-3">{hypothesis.proposition}</td>
                          <td className="py-2 pr-3">{(hypothesis.currentProbability * 100).toFixed(1)}%</td>
                          <td className="py-2 pr-3">{hypothesis.status}</td>
                          <td className="py-2 font-mono text-xs text-ink/45">{hypothesis.id}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </PageSection>
    </main>
  );
}
