import { Play, Plus } from "lucide-react";
import {
  createSourcePresetAction,
  createSourceAction,
  runEvidenceLoopAction,
  runSourceAction,
  runSourceDryRunAction,
  runSourceReviewOnlyAction
} from "@/app/admin/world-model/actions";
import { loadWorldModelData } from "@/app/admin/world-model/data";
import { createReadableCodes, readableCode } from "@/lib/world-model-display";
import { listSourcePresets } from "@/lib/world-model-source-presets";
import { getLatestSourceRun, runErrorSummary, sourceHealthLabel } from "@/lib/world-model-sources-ui";
import { Field, SelectField, TextAreaField } from "@/components/world-model/Field";
import { DataWarning, EmptyState, PageSection, StatusNotice } from "@/components/world-model/PageSection";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SourcesPage({ searchParams }: PageProps) {
  const data = await loadWorldModelData();
  const params = (await searchParams) ?? {};
  const sourceCodes = createReadableCodes(data.sources, "S", (source) => source.createdAt);
  const sourceOptions = data.sources.map((source) => ({
    value: source.id,
    label: `${readableCode(sourceCodes, source.id, "S")} · ${source.name} · ${source.kind}`
  }));
  const sourceById = new Map(data.sources.map((source) => [source.id, source]));
  const sourcePresets = listSourcePresets(data.sources);

  return (
    <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <DataWarning message={data.error} />
      <StatusNotice message={firstParam(params.message)} />
      <StatusNotice message={firstParam(params.error)} tone="error" />
      <PageSection title="推荐来源">
        <div className="grid gap-3 lg:grid-cols-2">
          {sourcePresets.map((preset) => (
            <div key={preset.id} className="rounded-md border border-line bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-ink">{preset.name}</div>
                  <div className="mt-1 text-xs text-ink/55">
                    {preset.kind} · 可信度 {preset.credibility.toFixed(2)} · 阈值 {preset.autoConfirmThreshold.toFixed(2)}
                  </div>
                  <div className="mt-2 break-all text-xs text-ink/55">{preset.url}</div>
                  <div className="mt-2 text-sm text-ink/70">{preset.description}</div>
                </div>
                {preset.installed ? (
                  <span className="rounded-md bg-moss/10 px-3 py-2 text-sm font-semibold text-moss">已添加</span>
                ) : (
                  <form action={createSourcePresetAction}>
                    <input type="hidden" name="presetId" value={preset.id} />
                    <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-moss px-3 text-sm font-semibold text-moss">
                      <Plus size={16} /> 添加
                    </button>
                  </form>
                )}
              </div>
            </div>
          ))}
        </div>
      </PageSection>
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
      <PageSection title="运行来源">
        <div className="grid gap-3 rounded-md border border-line bg-white p-4 lg:grid-cols-3">
          <form action={runSourceAction} className="grid gap-3">
            <SelectField label="来源" name="sourceId" options={sourceOptions} />
            <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-moss px-3 text-sm font-semibold text-white">
              <Play size={16} /> 采集入库
            </button>
          </form>
          <form action={runSourceReviewOnlyAction} className="grid gap-3">
            <SelectField label="待审来源" name="sourceId" options={sourceOptions} />
            <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-moss px-3 text-sm font-semibold text-moss">
              <Play size={16} /> 仅采集待审
            </button>
          </form>
          <form action={runSourceDryRunAction} className="grid gap-3">
            <SelectField label="Dry-run 来源" name="sourceId" options={sourceOptions} />
            <Field label="样本标题" name="sampleTitle" defaultValue="AI source sample" required />
            <Field label="样本链接" name="sampleUrl" type="url" />
            <TextAreaField label="样本正文" name="sampleContent" defaultValue="Sample observation content" required />
            <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-line px-3 text-sm font-semibold text-ink">
              <Play size={16} /> Dry-run
            </button>
          </form>
        </div>
      </PageSection>
      <PageSection title="自动证据闭环">
        <form action={runEvidenceLoopAction} className="grid gap-3 rounded-md border border-line bg-white p-4 lg:grid-cols-4">
          <Field label="单次最大观察" name="maxObservations" type="number" min="1" defaultValue="20" />
          <Field label="自动应用阈值" name="autoConfirmThreshold" type="number" step="0.01" min="0" max="1" defaultValue="0.85" />
          <label className="flex items-center gap-2 text-sm text-ink/70">
            <input name="reviewOnly" type="checkbox" defaultChecked /> 仅生成待审
          </label>
          <label className="flex items-center gap-2 text-sm text-ink/70">
            <input name="bootstrapDefaultSources" type="checkbox" defaultChecked /> 补齐推荐来源
          </label>
          <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-moss px-3 text-sm font-semibold text-white">
            <Play size={16} /> 运行闭环
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
                  <th className="px-3 py-2">启用</th>
                  <th className="px-3 py-2">自动确认</th>
                  <th className="px-3 py-2">最近状态</th>
                  <th className="px-3 py-2">错误</th>
                  <th className="px-3 py-2">凭据引用</th>
                  <th className="px-3 py-2">可信度</th>
                  <th className="px-3 py-2">编号</th>
                </tr>
              </thead>
              <tbody>
                {data.sources.map((source) => {
                  const latestRun = getLatestSourceRun(source.id, data.runs);
                  return (
                    <tr key={source.id} className="border-t border-line">
                      <td className="px-3 py-2">{source.name}</td>
                      <td className="px-3 py-2">{source.kind}</td>
                      <td className="px-3 py-2">{source.enabled ? "是" : "否"}</td>
                      <td className="px-3 py-2">{source.autoConfirm ? "是" : "否"}</td>
                      <td className="px-3 py-2">{sourceHealthLabel(source, latestRun)}</td>
                      <td className="max-w-xs px-3 py-2 text-xs text-berry">{runErrorSummary(latestRun)}</td>
                      <td className="px-3 py-2">{source.credentialRef ?? ""}</td>
                      <td className="px-3 py-2">{source.credibility.toFixed(2)}</td>
                      <td className="px-3 py-2 font-mono text-xs">{readableCode(sourceCodes, source.id, "S")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </PageSection>
      <PageSection title="运行记录">
        {data.runs.length === 0 ? (
          <EmptyState label="暂无运行记录" />
        ) : (
          <div className="overflow-x-auto rounded-md border border-line bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-panel text-xs text-ink/55">
                <tr>
                  <th className="px-3 py-2">时间</th>
                  <th className="px-3 py-2">来源</th>
                  <th className="px-3 py-2">状态</th>
                  <th className="px-3 py-2">采集</th>
                  <th className="px-3 py-2">去重</th>
                  <th className="px-3 py-2">查询</th>
                  <th className="px-3 py-2">候选</th>
                  <th className="px-3 py-2">自动应用</th>
                  <th className="px-3 py-2">待审</th>
                  <th className="px-3 py-2">错误</th>
                </tr>
              </thead>
              <tbody>
                {data.runs.slice(0, 12).map((run) => (
                  <tr key={run.id} className="border-t border-line">
                    <td className="px-3 py-2">{run.startedAt.toLocaleString("zh-CN")}</td>
                    <td className="px-3 py-2">{run.sourceId ? sourceById.get(run.sourceId)?.name ?? run.sourceId : ""}</td>
                    <td className="px-3 py-2">{run.status}</td>
                    <td className="px-3 py-2">{run.itemCount}</td>
                    <td className="px-3 py-2">{run.deduplicatedCount}</td>
                    <td className="px-3 py-2">{run.queryCount}</td>
                    <td className="px-3 py-2">{run.candidateCount}</td>
                    <td className="px-3 py-2">{run.autoAppliedCount}</td>
                    <td className="px-3 py-2">{run.reviewCount}</td>
                    <td className="max-w-xs px-3 py-2 text-xs text-berry">{runErrorSummary(run)}</td>
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
