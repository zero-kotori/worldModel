import { Upload } from "lucide-react";
import { importModelArtifactAction } from "@/app/admin/world-model/actions";
import { loadWorldModelData } from "@/app/admin/world-model/data";
import { summarizeLlmScorerConfig } from "@/lib/world-model-models-ui";
import { Field, SelectField } from "@/components/world-model/Field";
import { DataWarning, EmptyState, PageSection, StatusNotice } from "@/components/world-model/PageSection";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function scorerToneClass(tone: ReturnType<typeof summarizeLlmScorerConfig>["tone"]) {
  return tone === "healthy" ? "text-moss" : "text-amber-700";
}

export default async function ModelsPage({ searchParams }: PageProps) {
  const data = await loadWorldModelData();
  const params = (await searchParams) ?? {};
  const llmScorer = summarizeLlmScorerConfig(process.env);

  return (
    <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <DataWarning message={data.error} />
      <StatusNotice message={firstParam(params.message)} />
      <StatusNotice message={firstParam(params.error)} tone="error" />
      <PageSection title="LLM 主评分器">
        <div className="rounded-md border border-line bg-white p-4">
          <div className="grid gap-4 text-sm lg:grid-cols-5">
            <div>
              <div className="text-xs text-ink/55">状态</div>
              <div className={`mt-1 font-semibold ${scorerToneClass(llmScorer.tone)}`}>{llmScorer.label}</div>
            </div>
            <div>
              <div className="text-xs text-ink/55">Provider</div>
              <div className="mt-1 text-ink">{llmScorer.provider}</div>
            </div>
            <div>
              <div className="text-xs text-ink/55">Base URL</div>
              <div className="mt-1 break-all font-mono text-xs text-ink">{llmScorer.baseUrl}</div>
            </div>
            <div>
              <div className="text-xs text-ink/55">Model</div>
              <div className="mt-1 font-mono text-xs text-ink">{llmScorer.model}</div>
            </div>
            <div>
              <div className="text-xs text-ink/55">API Key</div>
              <div className="mt-1 text-ink">{llmScorer.hasApiKey ? "已配置" : "未配置"}</div>
            </div>
          </div>
          <div className="mt-3 border-t border-line pt-3 text-sm text-ink/65">{llmScorer.detail}</div>
        </div>
      </PageSection>
      <PageSection title="模型产物导入">
        <form action={importModelArtifactAction} className="grid gap-3 rounded-md border border-line bg-white p-4 lg:grid-cols-4">
          <Field label="名称" name="name" defaultValue="lightweight-local" required />
          <SelectField
            label="类型"
            name="kind"
            options={["LIGHTWEIGHT", "LLM", "DEEP_ADAPTER"].map((value) => ({ value, label: value }))}
          />
          <Field label="版本" name="version" defaultValue="0.1.0" required />
          <Field label="路径" name="path" defaultValue="./model-artifacts/lightweight-local.json" required />
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
