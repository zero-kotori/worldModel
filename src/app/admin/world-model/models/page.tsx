import { Download, Play, Upload } from "lucide-react";
import {
  fetchTrainingDataAction,
  importModelArtifactAction,
  runLlmEvaluationAction,
  trainLightweightModelAction
} from "@/app/admin/world-model/actions";
import { loadWorldModelData } from "@/app/admin/world-model/data";
import { createReadableCodes, readableCode } from "@/lib/world-model-display";
import {
  summarizeLlmAutoApplyReadiness,
  summarizeLlmEvaluationQualityDiagnostics,
  summarizeLlmHypothesisRecommendationConfig,
  summarizeLlmScorerConfig
} from "@/lib/world-model-models-ui";
import { Field, SelectField } from "@/components/world-model/Field";
import { DataWarning, EmptyState, PageSection, StatusNotice } from "@/components/world-model/PageSection";

export const dynamic = "force-dynamic";
const DEFAULT_LLM_EVALUATION_LIMIT = 30;
const DEFAULT_TRAINING_FETCH_LIMIT = 20;

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function scorerToneClass(tone: "healthy" | "warning") {
  return tone === "healthy" ? "text-moss" : "text-amber-700";
}

function formatPercent(value: number | null | undefined) {
  return value === null || value === undefined ? "未评分" : `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value: number | null | undefined) {
  return value === null || value === undefined ? "未记录" : value.toFixed(2);
}

function diagnosticToneClass(level: "info" | "warning" | "error") {
  if (level === "error") return "text-berry";
  if (level === "warning") return "text-amber-700";
  return "text-ink/65";
}

function estimatorSummary(outputs: Awaited<ReturnType<typeof loadWorldModelData>>["likelihoodRuns"][number]["estimatorOutputs"]) {
  if (outputs.length === 0) return "";
  return outputs
    .map((output) => `${output.estimator}: ${output.rationale ?? "no rationale supplied"}`)
    .join("；");
}

function numericMetric(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sourceCountsSummary(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, count]) => typeof count === "number" && Number.isFinite(count))
    .sort(([left], [right]) => left.localeCompare(right));
  return entries.length > 0 ? entries.map(([source, count]) => `${source} ${count}`).join("，") : "";
}

function modelTrainingSummary(model: Awaited<ReturnType<typeof loadWorldModelData>>["models"][number]) {
  const metrics = model.metrics ?? {};
  const trained =
    metrics.trained === true ? "已训练" : metrics.trained === false ? "未训练" : model.kind === "LIGHTWEIGHT" ? "训练状态未记录" : "";
  const sampleCount = numericMetric(metrics.sampleCount);
  const sampleSummary = sampleCount === null ? "" : `样本 ${sampleCount}`;
  const sourceSummary = sourceCountsSummary(metrics.sourceCounts);
  const parts = [trained, sampleSummary, sourceSummary].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "未记录";
}

function LlmAutoApplyReadinessCard({
  readiness
}: {
  readiness: ReturnType<typeof summarizeLlmAutoApplyReadiness>;
}) {
  return (
    <div className="rounded-md border border-line bg-white p-4">
      <div className="text-xs text-ink/55">自动应用保护</div>
      <div className={`mt-1 font-semibold ${scorerToneClass(readiness.tone)}`}>{readiness.label}</div>
      <div className="mt-2 text-sm text-ink/65">{readiness.detail}</div>
    </div>
  );
}

function LlmEvaluationSection({ evaluation }: { evaluation: Awaited<ReturnType<typeof loadWorldModelData>>["llmEvaluation"] }) {
  const autoApplyReadiness = summarizeLlmAutoApplyReadiness(evaluation);
  if (!evaluation) {
    return (
      <PageSection title="LLM 评估结果">
        <div className="grid gap-3">
          <LlmAutoApplyReadinessCard readiness={autoApplyReadiness} />
          <EmptyState label="暂无 LLM 评估结果" />
        </div>
      </PageSection>
    );
  }

  const summary = evaluation.summary;
  const supportsAccuracy = summary.directionAccuracy.SUPPORTS.accuracy;
  const opposesAccuracy = summary.directionAccuracy.OPPOSES.accuracy;
  const neutralAccuracy = summary.directionAccuracy.NEUTRAL.accuracy;
  const sourceCoverage = sourceCountsSummary(summary.sourceCounts);
  const qualityDiagnostics = summarizeLlmEvaluationQualityDiagnostics(evaluation);

  return (
    <PageSection title="LLM 评估结果">
      <div className="rounded-md border border-line bg-white p-4">
        <div className="grid gap-4 text-sm lg:grid-cols-6">
          <div>
            <div className="text-xs text-ink/55">自动应用保护</div>
            <div className={`mt-1 font-semibold ${scorerToneClass(autoApplyReadiness.tone)}`}>{autoApplyReadiness.label}</div>
            <div className="mt-1 text-xs text-ink/60">{autoApplyReadiness.detail}</div>
          </div>
          <div>
            <div className="text-xs text-ink/55">模型</div>
            <div className="mt-1 font-mono text-xs text-ink">{summary.modelName}</div>
          </div>
          <div>
            <div className="text-xs text-ink/55">样本</div>
            <div className="mt-1 font-semibold text-ink">样本 {summary.sampleCount}</div>
          </div>
          <div>
            <div className="text-xs text-ink/55">评分覆盖</div>
            <div className="mt-1 font-semibold text-ink">已评分 {summary.scoredCount}</div>
          </div>
          <div>
            <div className="text-xs text-ink/55">低置信度</div>
            <div className="mt-1 font-semibold text-amber-700">低置信度 {formatPercent(summary.lowConfidenceRate)}</div>
          </div>
          <div>
            <div className="text-xs text-ink/55">需复核</div>
            <div className="mt-1 font-semibold text-amber-700">需复核 {formatPercent(summary.reviewRequiredRate)}</div>
          </div>
        </div>
        <div className="mt-3 grid gap-3 border-t border-line pt-3 text-sm lg:grid-cols-3">
          <div className="rounded-md border border-line bg-panel px-3 py-2">
            支持 {formatPercent(supportsAccuracy)}
          </div>
          <div className="rounded-md border border-line bg-panel px-3 py-2">
            反对 {formatPercent(opposesAccuracy)}
          </div>
          <div className="rounded-md border border-line bg-panel px-3 py-2">
            中性 {formatPercent(neutralAccuracy)}
          </div>
        </div>
        <div className="mt-3 grid gap-3 border-t border-line pt-3 text-xs text-ink/65 lg:grid-cols-4">
          <div>LR 均值 {formatNumber(summary.likelihoodRatio.mean)}</div>
          <div>fallback 分歧 {formatPercent(summary.fallbackDivergenceRate)}</div>
          <div>{sourceCoverage ? `来源覆盖 ${sourceCoverage}` : "来源覆盖未记录"}</div>
          <div>{evaluation.generatedAt ? `评估时间 ${evaluation.generatedAt.toLocaleString("zh-CN")}` : "评估时间未记录"}</div>
        </div>
        {qualityDiagnostics.length > 0 ? (
          <div className="mt-3 border-t border-line pt-3">
            <div className="text-xs font-semibold text-ink/65">LLM 评估质量诊断</div>
            <div className="mt-2 grid gap-2 text-xs">
              {qualityDiagnostics.map((diagnostic) => (
                <div key={diagnostic.title} className={diagnosticToneClass(diagnostic.level)}>
                  <span className="font-semibold">{diagnostic.title}</span>：{diagnostic.detail}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </PageSection>
  );
}

export default async function ModelsPage({ searchParams }: PageProps) {
  const data = await loadWorldModelData();
  const params = (await searchParams) ?? {};
  const llmScorer = summarizeLlmScorerConfig(process.env);
  const llmHypothesisRecommendations = summarizeLlmHypothesisRecommendationConfig(process.env);
  const likelihoodRuns = data.likelihoodRuns ?? [];
  const evidenceCodes = createReadableCodes(data.evidence, "E", (evidence) => evidence.confirmedAt);
  const hypothesisCodes = createReadableCodes(
    data.beliefs.flatMap((belief) => belief.hypotheses),
    "H",
    (hypothesis) => hypothesis.createdAt
  );
  const evidenceById = new Map(data.evidence.map((evidence) => [evidence.id, evidence]));
  const hypothesisById = new Map(
    data.beliefs.flatMap((belief) => belief.hypotheses.map((hypothesis) => [hypothesis.id, { belief, hypothesis }] as const))
  );

  return (
    <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <DataWarning message={data.error} />
      <StatusNotice message={firstParam(params.message)} />
      <StatusNotice message={firstParam(params.error)} tone="error" />
      <PageSection title="LLM API 配置">
        <div className="grid gap-3 xl:grid-cols-2">
          <div className="rounded-md border border-line bg-white p-4">
            <div className="text-xs text-ink/55">LLM 主评分器</div>
            <div className="mt-3 grid gap-4 text-sm md:grid-cols-2 xl:grid-cols-3">
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
          <div className="rounded-md border border-line bg-white p-4">
            <div className="text-xs text-ink/55">LLM 假设推荐</div>
            <div className="mt-3 grid gap-4 text-sm md:grid-cols-2 xl:grid-cols-3">
              <div>
                <div className="text-xs text-ink/55">状态</div>
                <div className={`mt-1 font-semibold ${scorerToneClass(llmHypothesisRecommendations.tone)}`}>
                  {llmHypothesisRecommendations.label}
                </div>
              </div>
              <div>
                <div className="text-xs text-ink/55">开关</div>
                <div className="mt-1 text-ink">{llmHypothesisRecommendations.llmPathEnabled ? "默认启用" : "已关闭"}</div>
              </div>
              <div>
                <div className="text-xs text-ink/55">Provider</div>
                <div className="mt-1 text-ink">{llmHypothesisRecommendations.provider}</div>
              </div>
              <div>
                <div className="text-xs text-ink/55">Model</div>
                <div className="mt-1 font-mono text-xs text-ink">{llmHypothesisRecommendations.model}</div>
              </div>
              <div>
                <div className="text-xs text-ink/55">API Key</div>
                <div className="mt-1 text-ink">{llmHypothesisRecommendations.hasApiKey ? "已配置" : "未配置"}</div>
              </div>
            </div>
            <div className="mt-3 border-t border-line pt-3 text-sm text-ink/65">{llmHypothesisRecommendations.detail}</div>
          </div>
        </div>
      </PageSection>
      <LlmEvaluationSection evaluation={data.llmEvaluation} />
      <PageSection title="LLM 评估运行">
        <form
          action={runLlmEvaluationAction}
          className="grid gap-3 rounded-md border border-line bg-white p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,180px)_auto]"
        >
          <Field label="输出目录" name="outputDir" defaultValue="model-artifacts" required />
          <Field label="样本上限" name="limit" type="number" min="1" step="1" defaultValue={DEFAULT_LLM_EVALUATION_LIMIT} required />
          <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-moss px-3 text-sm font-semibold text-white">
            <Play size={16} /> 运行 LLM 评估
          </button>
        </form>
      </PageSection>
      <PageSection title="真实训练数据抓取">
        <form
          action={fetchTrainingDataAction}
          className="grid gap-3 rounded-md border border-line bg-white p-4 lg:grid-cols-[minmax(0,220px)_minmax(0,1fr)_auto]"
        >
          <Field label="每个数据集行数" name="limit" type="number" min="1" step="1" defaultValue={DEFAULT_TRAINING_FETCH_LIMIT} required />
          <Field label="输出目录" name="outputDir" defaultValue="model-artifacts" required />
          <button className="inline-flex min-h-9 items-center justify-center gap-2 self-end rounded-md bg-moss px-3 text-sm font-semibold text-white">
            <Download size={16} /> 抓取公开训练样本
          </button>
        </form>
      </PageSection>
      <PageSection title="轻量模型训练">
        <form
          action={trainLightweightModelAction}
          className="grid gap-3 rounded-md border border-line bg-white p-4 lg:grid-cols-[minmax(0,1fr)_auto]"
        >
          <input type="hidden" name="returnPath" value="/admin/world-model/models" />
          <Field label="输出目录" name="outputDir" defaultValue="model-artifacts" required />
          <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-moss px-3 text-sm font-semibold text-white">
            <Play size={16} /> 准备样本、训练并导入
          </button>
        </form>
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
          <Field label="训练样本数" name="sampleCount" type="number" min="1" step="1" />
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
                  <th className="px-3 py-2">训练指标</th>
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
                    <td className="px-3 py-2 text-xs text-ink/70">{modelTrainingSummary(model)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{model.path}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PageSection>
      <PageSection title="似然评分审计">
        {likelihoodRuns.length === 0 ? (
          <EmptyState label="暂无似然评分记录" />
        ) : (
          <div className="overflow-x-auto rounded-md border border-line bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-panel text-xs text-ink/55">
                <tr>
                  <th className="px-3 py-2">时间</th>
                  <th className="px-3 py-2">证据</th>
                  <th className="px-3 py-2">假设</th>
                  <th className="px-3 py-2">似然比</th>
                  <th className="px-3 py-2">置信度</th>
                  <th className="px-3 py-2">模型版本</th>
                  <th className="px-3 py-2">评分解释</th>
                </tr>
              </thead>
              <tbody>
                {likelihoodRuns.slice(0, 25).map((run) => {
                  const evidence = evidenceById.get(run.evidenceId);
                  const target = hypothesisById.get(run.hypothesisId);
                  return (
                    <tr key={run.id} className="border-t border-line">
                      <td className="px-3 py-2">{run.createdAt.toLocaleString("zh-CN")}</td>
                      <td className="px-3 py-2">
                        <span className="font-mono text-xs">{readableCode(evidenceCodes, run.evidenceId, "E")}</span>
                        <span className="ml-2 text-ink/75">{evidence?.title ?? "已删除证据"}</span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-mono text-xs">{readableCode(hypothesisCodes, run.hypothesisId, "H")}</span>
                        <span className="ml-2 text-ink/75">
                          {target ? `${target.belief.title} · ${target.hypothesis.proposition}` : "已删除假设"}
                        </span>
                      </td>
                      <td className="px-3 py-2">{run.ensembleLikelihoodRatio.toFixed(2)}</td>
                      <td className="px-3 py-2">{run.ensembleConfidence.toFixed(2)}</td>
                      <td className="px-3 py-2 font-mono text-xs">{run.modelVersion}</td>
                      <td className="max-w-md px-3 py-2 text-xs text-ink/70">{estimatorSummary(run.estimatorOutputs)}</td>
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
