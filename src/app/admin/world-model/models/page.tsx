import { Upload } from "lucide-react";
import { importModelArtifactAction } from "@/app/admin/world-model/actions";
import { loadWorldModelData } from "@/app/admin/world-model/data";
import { Field, SelectField } from "@/components/world-model/Field";
import { DataWarning, EmptyState, PageSection } from "@/components/world-model/PageSection";

export const dynamic = "force-dynamic";

export default async function ModelsPage() {
  const data = await loadWorldModelData();

  return (
    <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <DataWarning message={data.error} />
      <PageSection title="模型产物导入">
        <form action={importModelArtifactAction} className="grid gap-3 rounded-md border border-line bg-white p-4 lg:grid-cols-4">
          <Field label="名称" name="name" defaultValue="lightweight-demo" required />
          <SelectField
            label="类型"
            name="kind"
            options={["LIGHTWEIGHT", "LLM", "DEEP_ADAPTER"].map((value) => ({ value, label: value }))}
          />
          <Field label="版本" name="version" defaultValue="0.1.0" required />
          <Field label="路径" name="path" defaultValue="./model-artifacts/lightweight-demo.json" required />
          <label className="flex items-center gap-2 text-sm text-ink/70">
            <input name="enabled" type="checkbox" defaultChecked /> 启用
          </label>
          <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-moss px-3 text-sm font-semibold text-white">
            <Upload size={16} /> 导入
          </button>
        </form>
      </PageSection>
      <PageSection title="模型状态">
        {data.models.length === 0 ? (
          <EmptyState label="暂无模型产物" />
        ) : (
          <div className="overflow-x-auto rounded-md border border-line bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-panel text-xs text-ink/55">
                <tr>
                  <th className="px-3 py-2">名称</th>
                  <th className="px-3 py-2">类型</th>
                  <th className="px-3 py-2">版本</th>
                  <th className="px-3 py-2">启用</th>
                  <th className="px-3 py-2">路径</th>
                </tr>
              </thead>
              <tbody>
                {data.models.map((model) => (
                  <tr key={model.id} className="border-t border-line">
                    <td className="px-3 py-2">{model.name}</td>
                    <td className="px-3 py-2">{model.kind}</td>
                    <td className="px-3 py-2">{model.version}</td>
                    <td className="px-3 py-2">{model.enabled ? "是" : "否"}</td>
                    <td className="px-3 py-2 font-mono text-xs">{model.path}</td>
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
