import { Play, Plus } from "lucide-react";
import { createSourceAction, runSourceDryRunAction } from "@/app/admin/world-model/actions";
import { loadWorldModelData } from "@/app/admin/world-model/data";
import { Field, SelectField, TextAreaField } from "@/components/world-model/Field";
import { DataWarning, EmptyState, PageSection } from "@/components/world-model/PageSection";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const data = await loadWorldModelData();

  return (
    <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <DataWarning message={data.error} />
      <PageSection title="来源配置">
        <form action={createSourceAction} className="grid gap-3 rounded-md border border-line bg-white p-4 lg:grid-cols-4">
          <Field label="名称" name="name" required />
          <SelectField
            label="类型"
            name="kind"
            options={["RSS", "WEB_PAGE", "SEARCH", "GITHUB", "HUGGING_FACE", "GDELT", "PREDICTION_MARKET", "SOCIAL"].map(
              (value) => ({ value, label: value })
            )}
          />
          <Field label="URL" name="url" type="url" />
          <Field label="Adapter" name="adapter" defaultValue="rss" required />
          <Field label="凭据引用名" name="credentialRef" />
          <Field label="可信度" name="credibility" type="number" step="0.01" min="0" max="1" defaultValue="0.6" />
          <Field
            label="自动确认阈值"
            name="autoConfirmThreshold"
            type="number"
            step="0.01"
            min="0"
            max="1"
            defaultValue="0.9"
          />
          <label className="flex items-center gap-2 text-sm text-ink/70">
            <input name="enabled" type="checkbox" defaultChecked /> 启用
          </label>
          <label className="flex items-center gap-2 text-sm text-ink/70">
            <input name="autoConfirm" type="checkbox" /> 自动确认
          </label>
          <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-moss px-3 text-sm font-semibold text-white">
            <Plus size={16} /> 新增
          </button>
        </form>
      </PageSection>
      <PageSection title="Dry-run">
        <form action={runSourceDryRunAction} className="grid gap-3 rounded-md border border-line bg-white p-4 lg:grid-cols-4">
          <Field label="来源 ID" name="sourceId" required />
          <Field label="样本标题" name="sampleTitle" defaultValue="AI source sample" required />
          <Field label="样本链接" name="sampleUrl" type="url" />
          <TextAreaField label="样本正文" name="sampleContent" defaultValue="Sample observation content" required />
          <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-line px-3 text-sm font-semibold text-ink">
            <Play size={16} /> 运行
          </button>
        </form>
      </PageSection>
      <PageSection title="来源列表">
        {data.sources.length === 0 ? (
          <EmptyState label="暂无来源" />
        ) : (
          <div className="overflow-x-auto rounded-md border border-line bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-panel text-xs text-ink/55">
                <tr>
                  <th className="px-3 py-2">名称</th>
                  <th className="px-3 py-2">类型</th>
                  <th className="px-3 py-2">凭据引用</th>
                  <th className="px-3 py-2">可信度</th>
                  <th className="px-3 py-2">ID</th>
                </tr>
              </thead>
              <tbody>
                {data.sources.map((source) => (
                  <tr key={source.id} className="border-t border-line">
                    <td className="px-3 py-2">{source.name}</td>
                    <td className="px-3 py-2">{source.kind}</td>
                    <td className="px-3 py-2">{source.credentialRef ?? ""}</td>
                    <td className="px-3 py-2">{source.credibility.toFixed(2)}</td>
                    <td className="px-3 py-2 font-mono text-xs text-ink/45">{source.id}</td>
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
