import Link from "next/link";
import { Play, Plus } from "lucide-react";
import {
  createMissingSourcePresetsAction,
  createSourcePresetAction,
  createSourceAction,
  applySourceCalibrationAction,
  runEvidenceLoopAction,
  runEvidenceLoopDryRunAction,
  runSourceAction,
  runSourceDryRunAction,
  runSourceReviewOnlyAction,
  startEvidenceLoopWorkerAction,
  stopEvidenceLoopWorkerAction,
  updateSourceAction
} from "@/app/admin/world-model/actions";
import { loadWorldModelData } from "@/app/admin/world-model/data";
import { isHypothesisCurrentlyEffective } from "@/lib/world-model-beliefs-ui";
import { createReadableCodes, readableCode } from "@/lib/world-model-display";
import { summarizeLlmScorerConfig } from "@/lib/world-model-models-ui";
import { listSourcePresets } from "@/lib/world-model-source-presets";
import {
  automationAttentionItems,
  getLatestSourceRun,
  runErrorSummary,
  runFollowupActions,
  runQuerySummary,
  sourceHealthLabel,
  summarizeAutomationHealth,
  recommendSourceEvidenceQualityAdjustment,
  summarizeSourceEvidenceQuality
} from "@/lib/world-model-sources-ui";
import { Field, SelectField, TextAreaField } from "@/components/world-model/Field";
import { DataWarning, EmptyState, PageSection, StatusNotice } from "@/components/world-model/PageSection";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function healthToneClass(tone: ReturnType<typeof summarizeAutomationHealth>["tone"]) {
  if (tone === "healthy") return "text-moss";
  if (tone === "warning") return "text-amber-700";
  if (tone === "failing") return "text-berry";
  return "text-ink/55";
}

function diagnosticToneClass(level: ReturnType<typeof summarizeAutomationHealth>["diagnostics"][number]["level"]) {
  if (level === "error") return "text-berry";
  if (level === "warning") return "text-amber-700";
  return "text-ink/70";
}

function sourceQualityToneClass(tone: ReturnType<typeof summarizeSourceEvidenceQuality>["tone"]) {
  if (tone === "warning") return "text-amber-700";
  return "text-ink/55";
}

function fallbackWorkerConfig() {
  return {
    id: "default",
    enabled: false,
    intervalMs: 900_000,
    failureBackoffMultiplier: 2,
    maxIntervalMs: 3_600_000,
    reviewOnly: false,
    maxQueries: 3,
    maxSources: 3,
    beliefIds: undefined,
    sourceIds: undefined,
    maxObservations: 20,
    candidateThreshold: 0.25,
    autoConfirmThreshold: 0.85,
    bootstrapDefaultSources: true,
    forceAutoApply: true
  };
}

const sourceKindOptions = ["RSS", "WEB_PAGE", "SEARCH", "GITHUB", "HUGGING_FACE", "GDELT", "PREDICTION_MARKET", "SOCIAL"].map(
  (value) => ({ value, label: value })
);

export default async function SourcesPage({ searchParams }: PageProps) {
  const data = await loadWorldModelData();
  const params = (await searchParams) ?? {};
  const observationCodes = createReadableCodes(data.observations, "O", (observation) => observation.observedAt);
  const sourceCodes = createReadableCodes(data.sources, "S", (source) => source.createdAt);
  const beliefCodes = createReadableCodes(data.beliefs, "B", (belief) => belief.createdAt);
  const sourceOptions = data.sources.map((source) => ({
    value: source.id,
    label: `${readableCode(sourceCodes, source.id, "S")} · ${source.name} · ${source.kind}`
  }));
  const selectedBeliefCode = firstParam(params.belief);
  const beliefOptions = data.beliefs.map((belief) => ({
    value: belief.id,
    label: `${readableCode(beliefCodes, belief.id, "B")} · ${belief.title}`
  }));
  const scopedBeliefIds = data.beliefs
    .filter((belief) => selectedBeliefCode && readableCode(beliefCodes, belief.id, "B") === selectedBeliefCode)
    .map((belief) => belief.id);
  const sourcesReturnPath = selectedBeliefCode
    ? `/admin/world-model/sources?belief=${encodeURIComponent(selectedBeliefCode)}`
    : "/admin/world-model/sources";
  const evidenceLoopReturnPath = `${sourcesReturnPath}#evidence-loop`;
  const sourceById = new Map(data.sources.map((source) => [source.id, source]));
  const sourcePresets = listSourcePresets(data.sources);
  const automationSources = data.sources.filter((source) => source.kind !== "MANUAL");
  const activeBeliefs = data.beliefs.filter((belief) => belief.status === "ACTIVE");
  const referenceTime = new Date();
  const activeHypothesisCount = activeBeliefs.reduce(
    (count, belief) => count + belief.hypotheses.filter((hypothesis) => hypothesis.status === "ACTIVE").length,
    0
  );
  const effectiveHypothesisCount = activeBeliefs.reduce(
    (count, belief) => count + belief.hypotheses.filter((hypothesis) => isHypothesisCurrentlyEffective(hypothesis, referenceTime)).length,
    0
  );
  const openObservationCount = data.observations.filter((observation) => ["PENDING", "UNKNOWN"].includes(observation.status)).length;
  const duplicateObservationCount = data.observations.filter((observation) => observation.status === "DUPLICATE").length;
  const latestUnmatchedObservation = data.observations
    .filter((observation) => observation.status === "UNKNOWN" && observation.metadata.ignoredReason === "UNMATCHED")
    .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime())[0];
  const llmScorer = summarizeLlmScorerConfig(process.env);
  const automationHealth = summarizeAutomationHealth(data.runs, data.heartbeats, {
    workerRuntime: data.workerRuntime,
    sources: automationSources,
    sourceCount: automationSources.length,
    enabledSourceCount: automationSources.filter((source) => source.enabled).length,
    activeBeliefCount: activeBeliefs.length,
    activeHypothesisCount,
    effectiveHypothesisCount,
    openObservationCount,
    duplicateObservationCount,
    llmScorerReady: llmScorer.tone === "healthy",
    llmEvaluation: data.llmEvaluation,
    observations: data.observations,
    evidence: data.evidence,
    updates: data.updates,
    beliefs: data.beliefs,
    latestUnmatchedObservationCode: latestUnmatchedObservation
      ? readableCode(observationCodes, latestUnmatchedObservation.id, "O")
      : undefined
  });
  const attentionItems = automationAttentionItems(data.observations, {
    limit: 3,
    observationCode: (observation) => readableCode(observationCodes, observation.id, "O")
  });
  const workerConfig =
    (automationHealth.worker.id ? data.workerConfigs.find((config) => config.id === automationHealth.worker.id) : undefined) ??
    data.workerConfigs.find((config) => config.enabled) ??
    data.workerConfigs[0] ??
    fallbackWorkerConfig();
  const stopWorkerId =
    automationHealth.worker.status && automationHealth.worker.status !== "IDLE"
      ? automationHealth.worker.id ?? workerConfig.id
      : workerConfig.id;
  const canRunImmediateLoop = effectiveHypothesisCount > 0;
  const workerBeliefIds = workerConfig.beliefIds?.length ? workerConfig.beliefIds : scopedBeliefIds;

  return (
    <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <DataWarning message={data.error} />
      <StatusNotice message={firstParam(params.message)} />
      <StatusNotice message={firstParam(params.error)} tone="error" />
      <PageSection title="自动闭环状态">
        <div className="rounded-md border border-line bg-white p-4">
          <div className="grid gap-4 text-sm lg:grid-cols-9">
            <div>
              <div className="text-xs text-ink/55">状态</div>
              <div className={`mt-1 font-semibold ${healthToneClass(automationHealth.tone)}`}>{automationHealth.label}</div>
            </div>
            <div>
              <div className="text-xs text-ink/55">守护进程</div>
              <div className={`mt-1 font-semibold ${healthToneClass(automationHealth.worker.tone)}`}>
                {automationHealth.worker.label}
              </div>
            </div>
            <div>
              <div className="text-xs text-ink/55">下次运行</div>
              <div className="mt-1 text-ink">{automationHealth.worker.nextRunAt?.toLocaleString("zh-CN") ?? ""}</div>
            </div>
            <div>
              <div className="text-xs text-ink/55">最近运行</div>
              <div className="mt-1 text-ink">{automationHealth.latestRunAt?.toLocaleString("zh-CN") ?? ""}</div>
            </div>
            <div>
              <div className="text-xs text-ink/55">最近成功</div>
              <div className="mt-1 text-ink">{automationHealth.lastSuccessAt?.toLocaleString("zh-CN") ?? ""}</div>
            </div>
            <div>
              <div className="text-xs text-ink/55">连续失败</div>
              <div className="mt-1 text-ink">{automationHealth.consecutiveFailureCount}</div>
            </div>
            <div>
              <div className="text-xs text-ink/55">最近候选</div>
              <div className="mt-1 text-ink">
                {automationHealth.latestCounts.candidateCount} / {automationHealth.latestCounts.autoAppliedCount} /{" "}
                {automationHealth.latestCounts.reviewCount} / {automationHealth.latestCounts.lowImpactCount} /{" "}
                {automationHealth.latestCounts.unmatchedCount}
              </div>
            </div>
            <div>
              <div className="text-xs text-ink/55">最近采集</div>
              <div className="mt-1 text-ink">{automationHealth.latestCounts.itemCount}</div>
            </div>
            <div>
              <div className="text-xs text-ink/55">最近重试</div>
              <div className="mt-1 text-ink">{automationHealth.latestCounts.reprocessedObservationCount}</div>
            </div>
          </div>
          {automationHealth.latestError ? (
            <div className="mt-3 border-t border-line pt-3 text-xs text-berry">{automationHealth.latestError}</div>
          ) : null}
          {automationHealth.worker.lastNotice ? (
            <div className="mt-3 border-t border-line pt-3 text-xs text-amber-700">{automationHealth.worker.lastNotice}</div>
          ) : null}
          {automationHealth.worker.lastError ? (
            <div className="mt-3 border-t border-line pt-3 text-xs text-berry">{automationHealth.worker.lastError}</div>
          ) : null}
          {automationHealth.diagnostics.length > 0 ? (
            <div className="mt-3 border-t border-line pt-3">
              <div className="text-xs font-semibold text-ink/55">诊断</div>
              <div className="mt-2 grid gap-2">
                {automationHealth.diagnostics.map((diagnostic) => (
                  <div key={`${diagnostic.level}-${diagnostic.title}`} className="text-sm">
                    <span className={`font-semibold ${diagnosticToneClass(diagnostic.level)}`}>{diagnostic.title}</span>
                    <span className="ml-2 text-ink/60">{diagnostic.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {automationHealth.nextActions.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
              {automationHealth.nextActions.map((action) => (
                <Link
                  key={`${action.label}-${action.href}`}
                  href={action.href}
                  className="inline-flex min-h-8 items-center rounded-md border border-moss px-3 text-xs font-semibold text-moss hover:bg-moss/10"
                >
                  {action.label}
                </Link>
              ))}
            </div>
          ) : null}
          {attentionItems.length > 0 ? (
            <div className="mt-3 border-t border-line pt-3">
              <div className="text-xs font-semibold text-ink/55">待处理样本</div>
              <div className="mt-2 grid gap-2">
                {attentionItems.map((item) => (
                  <Link
                    key={item.key}
                    href={item.href}
                    className="grid gap-1 rounded-md bg-panel px-3 py-2 text-sm hover:bg-moss/10 md:grid-cols-[auto_1fr_auto]"
                  >
                    <span className="font-mono text-xs text-ink/55">{item.code}</span>
                    <span className="font-semibold text-ink">{item.title}</span>
                    <span className="text-xs text-ink/60">{item.label}</span>
                    <span className="text-xs text-ink/55 md:col-start-2 md:col-end-4">{item.detail}</span>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </PageSection>
      <div id="recommended-sources">
        <PageSection title="推荐来源">
          <form action={createMissingSourcePresetsAction} className="mb-3">
            <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-moss px-3 text-sm font-semibold text-white">
              <Plus size={16} /> 补齐推荐来源
            </button>
          </form>
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
      </div>
      <PageSection title="来源配置">
        <form action={createSourceAction} className="grid gap-3 rounded-md border border-line bg-white p-4 lg:grid-cols-4">
          <Field label="名称" name="name" required />
          <SelectField label="类型" name="kind" options={sourceKindOptions} />
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
            <input type="hidden" name="returnPath" value={sourcesReturnPath} />
            {scopedBeliefIds.map((beliefId) => (
              <input key={`run-${beliefId}`} type="hidden" name="beliefIds" value={beliefId} />
            ))}
            <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-moss px-3 text-sm font-semibold text-white">
              <Play size={16} /> 采集入库
            </button>
          </form>
          <form action={runSourceReviewOnlyAction} className="grid gap-3">
            <SelectField label="待审来源" name="sourceId" options={sourceOptions} />
            <input type="hidden" name="returnPath" value={sourcesReturnPath} />
            {scopedBeliefIds.map((beliefId) => (
              <input key={`review-${beliefId}`} type="hidden" name="beliefIds" value={beliefId} />
            ))}
            <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-moss px-3 text-sm font-semibold text-moss">
              <Play size={16} /> 仅采集待审
            </button>
          </form>
          <form action={runSourceDryRunAction} className="grid gap-3">
            <SelectField label="Dry-run 来源" name="sourceId" options={sourceOptions} />
            <input type="hidden" name="returnPath" value={sourcesReturnPath} />
            <Field label="样本标题" name="sampleTitle" required />
            <Field label="样本链接" name="sampleUrl" type="url" />
            <TextAreaField label="样本正文" name="sampleContent" required />
            <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-line px-3 text-sm font-semibold text-ink">
              <Play size={16} /> Dry-run
            </button>
          </form>
        </div>
      </PageSection>
      <div id="evidence-loop">
        <PageSection title="自动证据闭环">
          <form action={runEvidenceLoopDryRunAction} className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-line bg-white p-3">
            <input type="hidden" name="returnPath" value={evidenceLoopReturnPath} />
            <input type="hidden" name="maxQueries" value="3" />
            <input type="hidden" name="maxSources" value="3" />
            <input type="hidden" name="maxObservations" value="20" />
            {scopedBeliefIds.map((beliefId) => (
              <input key={`dry-${beliefId}`} type="hidden" name="beliefIds" value={beliefId} />
            ))}
            <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-moss px-3 text-sm font-semibold text-moss">
              <Play size={16} /> 预检闭环
            </button>
          </form>
          {canRunImmediateLoop ? (
            <form action={runEvidenceLoopAction} className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-moss/30 bg-moss/5 p-3">
              <input type="hidden" name="returnPath" value={evidenceLoopReturnPath} />
              <input type="hidden" name="maxQueries" value="3" />
              <input type="hidden" name="maxSources" value="3" />
              <input type="hidden" name="maxObservations" value="20" />
              <input type="hidden" name="candidateThreshold" value="0.25" />
              <input type="hidden" name="autoConfirmThreshold" value="0.85" />
              <input type="hidden" name="bootstrapDefaultSources" value="true" />
              <input type="hidden" name="forceAutoApply" value="true" />
              {scopedBeliefIds.map((beliefId) => (
                <input key={beliefId} type="hidden" name="beliefIds" value={beliefId} />
              ))}
              <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-moss px-3 text-sm font-semibold text-white">
                <Play size={16} /> 立即自动闭环
              </button>
              <span className="text-xs text-ink/55">自动应用 · 补齐推荐来源 · 阈值 0.85</span>
            </form>
          ) : (
            <div className="mb-3 rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink/55">没有当前有效假设</div>
          )}
          <form action={runEvidenceLoopAction} className="grid gap-3 rounded-md border border-line bg-white p-4 lg:grid-cols-4">
            <input type="hidden" name="returnPath" value={evidenceLoopReturnPath} />
            <label className="grid gap-1 text-xs font-medium text-ink/65">
              <span>限定信念</span>
              <select
                name="beliefIds"
                multiple
                defaultValue={scopedBeliefIds}
                size={Math.min(Math.max(beliefOptions.length, 2), 5)}
                className="min-h-24 rounded-md border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-moss"
              >
                {beliefOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-medium text-ink/65">
              <span>限定来源</span>
              <select
                name="sourceIds"
                multiple
                size={Math.min(Math.max(sourceOptions.length, 2), 5)}
                className="min-h-24 rounded-md border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-moss"
              >
                {sourceOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <Field label="单次最大查询" name="maxQueries" type="number" min="1" defaultValue="3" />
            <Field label="单次最大来源" name="maxSources" type="number" min="1" defaultValue="3" />
            <Field label="单次最大观察" name="maxObservations" type="number" min="1" defaultValue="20" />
            <Field label="候选识别阈值" name="candidateThreshold" type="number" step="0.01" min="0" max="1" defaultValue="0.25" />
            <Field label="自动应用阈值" name="autoConfirmThreshold" type="number" step="0.01" min="0" max="1" defaultValue="0.85" />
            <label className="flex items-center gap-2 text-sm text-ink/70">
              <input name="reviewOnly" type="checkbox" defaultChecked /> 仅生成待审
            </label>
            <label className="flex items-center gap-2 text-sm text-ink/70">
              <input name="bootstrapDefaultSources" type="checkbox" defaultChecked /> 补齐推荐来源
            </label>
            {canRunImmediateLoop ? (
              <label className="flex items-center gap-2 text-sm text-ink/70">
                <input name="forceAutoApply" type="checkbox" /> 本次自动应用
              </label>
            ) : null}
            <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-moss px-3 text-sm font-semibold text-white">
              <Play size={16} /> 运行闭环
            </button>
          </form>
          <div id="automation-worker" className="mt-3 grid gap-3 rounded-md border border-line bg-white p-4 lg:grid-cols-[1fr_auto]">
            <form action={startEvidenceLoopWorkerAction} className="grid gap-3 lg:grid-cols-5">
              <input type="hidden" name="returnPath" value={evidenceLoopReturnPath} />
              <Field label="Worker" name="workerId" defaultValue={workerConfig.id} required />
              <label className="grid gap-1 text-xs font-medium text-ink/65 lg:col-span-2">
                <span>Worker 信念</span>
                <select
                  name="beliefIds"
                  multiple
                  defaultValue={workerBeliefIds}
                  size={Math.min(Math.max(beliefOptions.length, 2), 5)}
                  className="min-h-24 rounded-md border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-moss"
                >
                  {beliefOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-medium text-ink/65 lg:col-span-2">
                <span>Worker 来源</span>
                <select
                  name="sourceIds"
                  multiple
                  defaultValue={workerConfig.sourceIds ?? []}
                  size={Math.min(Math.max(sourceOptions.length, 2), 5)}
                  className="min-h-24 rounded-md border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-moss"
                >
                  {sourceOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <Field label="间隔秒" name="intervalSeconds" type="number" min="60" defaultValue={Math.floor(workerConfig.intervalMs / 1000)} />
              <Field label="最大查询" name="maxQueries" type="number" min="1" defaultValue={workerConfig.maxQueries ?? 3} />
              <Field label="最大来源" name="maxSources" type="number" min="1" defaultValue={workerConfig.maxSources ?? 3} />
              <Field label="最大观察" name="maxObservations" type="number" min="1" defaultValue={workerConfig.maxObservations ?? 20} />
              <Field
                label="候选阈值"
                name="candidateThreshold"
                type="number"
                step="0.01"
                min="0"
                max="1"
                defaultValue={workerConfig.candidateThreshold ?? 0.25}
              />
              <Field
                label="应用阈值"
                name="autoConfirmThreshold"
                type="number"
                step="0.01"
                min="0"
                max="1"
                defaultValue={workerConfig.autoConfirmThreshold ?? 0.85}
              />
              <Field
                label="失败退避"
                name="failureBackoffMultiplier"
                type="number"
                step="0.1"
                min="1"
                defaultValue={workerConfig.failureBackoffMultiplier}
              />
              <Field
                label="最长间隔秒"
                name="maxIntervalSeconds"
                type="number"
                min="60"
                defaultValue={Math.floor(workerConfig.maxIntervalMs / 1000)}
              />
              <label className="flex items-center gap-2 text-sm text-ink/70">
                <input name="reviewOnly" type="checkbox" defaultChecked={workerConfig.reviewOnly} /> 仅生成待审
              </label>
              <label className="flex items-center gap-2 text-sm text-ink/70">
                <input name="bootstrapDefaultSources" type="checkbox" defaultChecked={workerConfig.bootstrapDefaultSources} /> 补齐推荐来源
              </label>
              {canRunImmediateLoop ? (
                <label className="flex items-center gap-2 text-sm text-ink/70">
                  <input name="forceAutoApply" type="checkbox" defaultChecked={workerConfig.forceAutoApply} /> 自动应用
                </label>
              ) : null}
              <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-moss px-3 text-sm font-semibold text-white lg:col-span-2">
                <Play size={16} /> 启动守护进程
              </button>
            </form>
            <form action={stopEvidenceLoopWorkerAction} className="grid content-end gap-3">
              <input type="hidden" name="returnPath" value={evidenceLoopReturnPath} />
              <Field label="Worker" name="workerId" defaultValue={stopWorkerId} required />
              <button className="inline-flex min-h-9 items-center justify-center rounded-md border border-line px-3 text-sm font-semibold text-ink">
                停止
              </button>
            </form>
          </div>
        </PageSection>
      </div>
      <div id="source-list">
        <PageSection title="来源列表">
        {data.sources.length === 0 ? (
          <EmptyState label="暂无来源" />
        ) : (
          <div className="grid gap-3">
            {data.sources.map((source) => {
              const latestRun = getLatestSourceRun(source.id, data.runs);
              const evidenceQuality = summarizeSourceEvidenceQuality(source.id, {
                observations: data.observations,
                evidence: data.evidence,
                updates: data.updates
              });
              const evidenceQualityAdjustment = recommendSourceEvidenceQualityAdjustment(source, evidenceQuality);
              return (
                <form
                  key={source.id}
                  action={updateSourceAction}
                  className="grid gap-3 rounded-md border border-line bg-white p-4 lg:grid-cols-12"
                >
                  <input type="hidden" name="sourceId" value={source.id} />
                  <input type="hidden" name="returnPath" value={sourcesReturnPath} />
                  <div className="lg:col-span-2">
                    <Field label="名称" name="name" defaultValue={source.name} required />
                    <div className="mt-2 font-mono text-xs text-ink/45">{readableCode(sourceCodes, source.id, "S")}</div>
                  </div>
                  <div className="lg:col-span-2">
                    <SelectField label="类型" name="kind" options={sourceKindOptions} defaultValue={source.kind} />
                    <div className="mt-2 text-xs text-ink/55">{sourceHealthLabel(source, latestRun)}</div>
                    {evidenceQuality.evidenceCount > 0 ? (
                      <div className={`mt-2 grid gap-1 text-xs ${sourceQualityToneClass(evidenceQuality.tone)}`}>
                        <div>{evidenceQuality.detail}</div>
                        {evidenceQualityAdjustment ? (
                          <div className="grid gap-2">
                            <div>{evidenceQualityAdjustment.detail}</div>
                            {evidenceQualityAdjustment.actionable ? (
                              <>
                                <input
                                  type="hidden"
                                  name="suggestedCredibility"
                                  value={evidenceQualityAdjustment.suggestedCredibility}
                                />
                                <input
                                  type="hidden"
                                  name="suggestedAutoConfirmThreshold"
                                  value={evidenceQualityAdjustment.suggestedAutoConfirmThreshold}
                                />
                                <button
                                  formAction={applySourceCalibrationAction}
                                  className="inline-flex min-h-8 w-fit items-center justify-center rounded-md border border-amber-700 px-2 text-xs font-semibold text-amber-700"
                                >
                                  应用建议
                                </button>
                              </>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="lg:col-span-3">
                    <Field label="URL" name="url" type="url" defaultValue={source.url ?? ""} />
                    <div className="mt-2 break-all text-xs text-berry">{runErrorSummary(latestRun)}</div>
                  </div>
                  <Field label="Adapter" name="adapter" defaultValue={source.adapter} required />
                  <Field label="凭据引用名" name="credentialRef" defaultValue={source.credentialRef ?? ""} />
                  <Field
                    label="可信度"
                    name="credibility"
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    defaultValue={source.credibility}
                  />
                  <Field
                    label="自动确认阈值"
                    name="autoConfirmThreshold"
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    defaultValue={source.autoConfirmThreshold}
                  />
                  <div className="flex flex-wrap items-end gap-4 lg:col-span-12">
                    <label className="flex items-center gap-2 text-sm text-ink/70">
                      <input name="enabled" type="checkbox" defaultChecked={source.enabled} /> 启用
                    </label>
                    <label className="flex items-center gap-2 text-sm text-ink/70">
                      <input name="autoConfirm" type="checkbox" defaultChecked={source.autoConfirm} /> 自动确认
                    </label>
                    <button className="inline-flex min-h-9 items-center justify-center rounded-md border border-moss px-3 text-sm font-semibold text-moss">
                      保存来源
                    </button>
                  </div>
                </form>
              );
            })}
          </div>
        )}
        </PageSection>
      </div>
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
                  <th className="px-3 py-2">旧观察重试</th>
                  <th className="px-3 py-2">去重</th>
                  <th className="px-3 py-2">查询</th>
                  <th className="px-3 py-2">查询摘要</th>
                  <th className="px-3 py-2">候选</th>
                  <th className="px-3 py-2">自动应用</th>
                  <th className="px-3 py-2">待审</th>
                  <th className="px-3 py-2">低影响</th>
                  <th className="px-3 py-2">未匹配</th>
                  <th className="px-3 py-2">处理</th>
                  <th className="px-3 py-2">错误</th>
                </tr>
              </thead>
              <tbody>
                {data.runs.slice(0, 12).map((run) => {
                  const followupActions = runFollowupActions(run, {
                    observations: data.observations,
                    observationCode: (observation) => readableCode(observationCodes, observation.id, "O")
                  });
                  return (
                    <tr key={run.id} className="border-t border-line">
                      <td className="px-3 py-2">{run.startedAt.toLocaleString("zh-CN")}</td>
                      <td className="px-3 py-2">
                        {run.sourceId
                          ? sourceById.get(run.sourceId)?.name ?? run.sourceCode ?? readableCode(sourceCodes, run.sourceId, "S")
                          : run.reprocessedObservationCount > 0
                            ? "旧观察重试"
                            : ""}
                      </td>
                      <td className="px-3 py-2">{run.status}</td>
                      <td className="px-3 py-2">{run.itemCount}</td>
                      <td className="px-3 py-2">{run.reprocessedObservationCount}</td>
                      <td className="px-3 py-2">{run.deduplicatedCount}</td>
                      <td className="px-3 py-2">{run.queryCount}</td>
                      <td className="max-w-sm px-3 py-2 text-xs text-ink/70">{runQuerySummary(run)}</td>
                      <td className="px-3 py-2">{run.candidateCount}</td>
                      <td className="px-3 py-2">{run.autoAppliedCount}</td>
                      <td className="px-3 py-2">{run.reviewCount}</td>
                      <td className="px-3 py-2">{run.lowImpactCount}</td>
                      <td className="px-3 py-2">{run.unmatchedCount}</td>
                      <td className="px-3 py-2">
                        {followupActions.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {followupActions.map((action) => (
                              <Link
                                key={`${run.id}-${action.label}`}
                                href={action.href}
                                className="inline-flex min-h-7 items-center rounded-md border border-line px-2 text-xs font-semibold text-ink hover:border-moss hover:text-moss"
                              >
                                {action.label}
                              </Link>
                            ))}
                          </div>
                        ) : null}
                      </td>
                      <td className="max-w-xs px-3 py-2 text-xs text-berry">{runErrorSummary(run)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </PageSection>
    </main>
  );
}
