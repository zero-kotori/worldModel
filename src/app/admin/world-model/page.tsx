import Link from "next/link";
import { Play } from "lucide-react";
import { startEvidenceLoopWorkerAction } from "@/app/admin/world-model/actions";
import { loadWorldModelData } from "@/app/admin/world-model/data";
import { DataWarning, PageSection } from "@/components/world-model/PageSection";
import { WorldModelGraphView } from "@/components/world-model/WorldModelGraphView";
import { isHypothesisCurrentlyEffective, summarizeHypothesisTimeCoverage } from "@/lib/world-model-beliefs-ui";
import { summarizeDashboardActions, summarizeResolvedHypothesisCalibration } from "@/lib/world-model-dashboard-ui";
import { createReadableCodes, readableCode } from "@/lib/world-model-display";
import { createWorldModelGraph } from "@/lib/world-model-graph";
import { createWorldModelGraphEditorData } from "@/lib/world-model-graph-editor";
import { summarizeLlmScorerConfig } from "@/lib/world-model-models-ui";
import { categoryLabels } from "@/lib/world-model-navigation";
import { summarizeAutomationHealth } from "@/lib/world-model-sources-ui";
import { summarizeUpdateDelta } from "@/lib/world-model-updates-ui";

export const dynamic = "force-dynamic";

function actionToneClass(level: ReturnType<typeof summarizeDashboardActions>[number]["level"]) {
  if (level === "error") return "border-berry text-berry";
  if (level === "warning") return "border-amber-600 text-amber-700";
  return "border-line text-ink";
}

function deltaToneClass(tone: ReturnType<typeof summarizeUpdateDelta>["tone"]) {
  if (tone === "increase") return "text-moss";
  if (tone === "decrease") return "text-berry";
  return "text-ink/55";
}

function calibrationToneClass(tone: ReturnType<typeof summarizeResolvedHypothesisCalibration>["tone"]) {
  if (tone === "healthy") return "text-moss";
  if (tone === "warning") return "text-amber-700";
  return "text-ink/55";
}

export default async function WorldModelDashboardPage() {
  const data = await loadWorldModelData();
  const beliefCodes = createReadableCodes(data.beliefs, "B", (belief) => belief.createdAt);
  const evidenceCodes = createReadableCodes(data.evidence, "E", (evidence) => evidence.confirmedAt);
  const updateCodes = createReadableCodes(data.updates, "U", (event) => event.createdAt);
  const sourceCodes = createReadableCodes(data.sources, "S", (source) => source.createdAt);
  const hypothesisCodes = createReadableCodes(
    data.beliefs.flatMap((belief) => belief.hypotheses),
    "H",
    (hypothesis) => hypothesis.createdAt
  );
  const observationCodes = createReadableCodes(data.observations, "O", (observation) => observation.observedAt);
  const hypothesisById = new Map(data.beliefs.flatMap((belief) => belief.hypotheses).map((hypothesis) => [hypothesis.id, hypothesis]));
  const evidenceById = new Map(data.evidence.map((evidence) => [evidence.id, evidence]));
  const sourceById = new Map(data.sources.map((source) => [source.id, source]));
  const graph = createWorldModelGraph({
    sources: data.sources,
    beliefs: data.beliefs,
    observations: data.observations,
    evidence: data.evidence,
    updates: data.updates
  });
  const graphEditor = createWorldModelGraphEditorData({
    sources: data.sources,
    beliefs: data.beliefs,
    observations: data.observations,
    evidence: data.evidence,
    updates: data.updates,
    likelihoodRuns: data.likelihoodRuns
  });
  const referenceTime = new Date();
  const hypothesisCoverage = summarizeHypothesisTimeCoverage(
    data.beliefs.flatMap((belief) => belief.hypotheses),
    referenceTime
  );
  const pendingObservations = data.observations.filter((item) => item.status === "PENDING" || item.status === "DUPLICATE" || item.status === "UNKNOWN");
  const latestUnmatchedObservation = data.observations
    .filter((observation) => observation.status === "UNKNOWN" && observation.metadata.ignoredReason === "UNMATCHED")
    .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime())[0];
  const activeEvidenceCount = data.evidence.filter((item) => item.status === "ACTIVE").length;
  const automationSources = data.sources.filter((source) => source.kind !== "MANUAL");
  const activeBeliefs = data.beliefs.filter((belief) => belief.status === "ACTIVE");
  const activeHypothesisCount = activeBeliefs.reduce(
    (count, belief) => count + belief.hypotheses.filter((hypothesis) => hypothesis.status === "ACTIVE").length,
    0
  );
  const effectiveHypothesisCount = activeBeliefs.reduce(
    (count, belief) => count + belief.hypotheses.filter((hypothesis) => isHypothesisCurrentlyEffective(hypothesis, referenceTime)).length,
    0
  );
  const llmScorer = summarizeLlmScorerConfig(process.env);
  const automationHealth = summarizeAutomationHealth(data.runs, data.heartbeats, {
    workerRuntime: data.workerRuntime,
    sources: automationSources,
    sourceCount: automationSources.length,
    enabledSourceCount: automationSources.filter((source) => source.enabled).length,
    activeBeliefCount: activeBeliefs.length,
    activeHypothesisCount,
    effectiveHypothesisCount,
    openObservationCount: pendingObservations.length,
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
  const dashboardActions = summarizeDashboardActions({
    observations: data.observations,
    beliefs: data.beliefs,
    evidence: data.evidence,
    updates: data.updates,
    hypothesisCode: (hypothesisId) => readableCode(hypothesisCodes, hypothesisId, "H"),
    observationCode: (observationId) => readableCode(observationCodes, observationId, "O"),
    hypothesisLabel: (hypothesisId) => {
      const code = readableCode(hypothesisCodes, hypothesisId, "H");
      const hypothesis = hypothesisById.get(hypothesisId);
      return hypothesis ? `${code} · ${hypothesis.proposition}` : code;
    },
    beliefLabel: (beliefId) => readableCode(beliefCodes, beliefId, "B"),
    updateLabel: (updateId) => readableCode(updateCodes, updateId, "U"),
    evidenceLabel: (evidenceId) => readableCode(evidenceCodes, evidenceId, "E"),
    sourceLabel: (sourceId) => {
      const code = readableCode(sourceCodes, sourceId, "S");
      const source = sourceById.get(sourceId);
      return source ? `${code} · ${source.name}` : code;
    },
    reviewDueHypothesisCount: hypothesisCoverage.reviewDueCount,
    automation: automationHealth
  });
  const showDefaultWorkerStart = automationHealth.nextActions.some((action) => action.label === "启动守护进程");
  const calibration = summarizeResolvedHypothesisCalibration(data.beliefs, {
    beliefLabel: (beliefId) => readableCode(beliefCodes, beliefId, "B"),
    hypothesisLabel: (hypothesisId) => {
      const code = readableCode(hypothesisCodes, hypothesisId, "H");
      const hypothesis = hypothesisById.get(hypothesisId);
      return hypothesis ? `${code} · ${hypothesis.proposition}` : code;
    }
  });
  const metrics = [
    ["信念", data.beliefs.length, "/admin/world-model/beliefs"],
    ["当前有效假设", hypothesisCoverage.effectiveCount, "/admin/world-model/beliefs"],
    ["待复核假设", hypothesisCoverage.reviewDueCount, "/admin/world-model/beliefs?view=review-due"],
    ["待处理观察", pendingObservations.length, "/admin/world-model/observations"],
    ["已确认证据", activeEvidenceCount, "/admin/world-model/evidence"]
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
      <PageSection title="闭环行动">
        {showDefaultWorkerStart ? (
          <form action={startEvidenceLoopWorkerAction} className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-moss/30 bg-moss/5 p-3">
            <input type="hidden" name="returnPath" value="/admin/world-model" />
            <input type="hidden" name="workerId" value="default" />
            <input type="hidden" name="intervalSeconds" value="900" />
            <input type="hidden" name="maxQueries" value="3" />
            <input type="hidden" name="maxSources" value="3" />
            <input type="hidden" name="maxObservations" value="20" />
            <input type="hidden" name="candidateThreshold" value="0.25" />
            <input type="hidden" name="autoConfirmThreshold" value="0.85" />
            <input type="hidden" name="failureBackoffMultiplier" value="2" />
            <input type="hidden" name="maxIntervalSeconds" value="3600" />
            <input type="hidden" name="bootstrapDefaultSources" value="true" />
            <input type="hidden" name="forceAutoApply" value="true" />
            <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-moss px-3 text-sm font-semibold text-white">
              <Play size={16} /> 启动默认守护进程
            </button>
            <span className="text-xs text-ink/55">自动应用 · 15 分钟 · 补齐推荐来源</span>
          </form>
        ) : null}
        {dashboardActions.length === 0 ? (
          <div className="rounded-md border border-dashed border-line bg-white px-4 py-6 text-sm text-ink/55">暂无待处理事项</div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {dashboardActions.slice(0, 6).map((action) => (
              <Link
                key={`${action.label}-${action.href}`}
                href={action.href}
                className={`rounded-md border bg-white p-4 hover:border-moss ${actionToneClass(action.level)}`}
              >
                <div className="text-sm font-semibold">{action.label}</div>
                <div className="mt-2 text-sm text-ink/65">{action.detail}</div>
              </Link>
            ))}
          </div>
        )}
      </PageSection>
      <PageSection title="结算校准">
        {calibration.resolvedCount === 0 ? (
          <div className="rounded-md border border-dashed border-line bg-white px-4 py-6 text-sm text-ink/55">{calibration.detail}</div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
            <div className="rounded-md border border-line bg-white p-4">
              <div className={`text-sm font-semibold ${calibrationToneClass(calibration.tone)}`}>{calibration.label}</div>
              <div className="mt-2 text-sm text-ink/65">{calibration.detail}</div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-md bg-panel px-3 py-2">
                  <div className="text-xs text-ink/50">已结算假设</div>
                  <div className="font-semibold text-ink">{calibration.resolvedCount}</div>
                </div>
                <div className="rounded-md bg-panel px-3 py-2">
                  <div className="text-xs text-ink/50">Brier</div>
                  <div className="font-semibold text-ink">Brier {calibration.brierScore?.toFixed(3)}</div>
                </div>
                <div className="rounded-md bg-panel px-3 py-2">
                  <div className="text-xs text-ink/50">发生</div>
                  <div className="font-semibold text-ink">{calibration.trueCount}</div>
                </div>
                <div className="rounded-md bg-panel px-3 py-2">
                  <div className="text-xs text-ink/50">未发生</div>
                  <div className="font-semibold text-ink">{calibration.falseCount}</div>
                </div>
              </div>
            </div>
            <div className="grid gap-2">
              {calibration.examples.map((example) => {
                const hypothesisCode = readableCode(hypothesisCodes, example.hypothesisId, "H");
                return (
                  <Link
                    key={example.hypothesisId}
                    href={`/admin/world-model/graph?hypothesis=${encodeURIComponent(hypothesisCode)}`}
                    className="rounded-md border border-line bg-white p-3 hover:border-moss"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-ink">{example.hypothesisLabel}</div>
                      <div className="text-xs text-ink/55">
                        {example.beliefLabel} · {example.outcomeLabel} · 预测 {(example.predictedProbability * 100).toFixed(1)}%
                      </div>
                    </div>
                    {example.resolvedOutcome ? <div className="mt-2 text-sm text-ink/65">{example.resolvedOutcome}</div> : null}
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </PageSection>
      <PageSection title="关系图谱">
        <WorldModelGraphView graph={graph} editor={graphEditor} returnPath="/admin/world-model" />
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
                <th className="px-3 py-2">变化</th>
                <th className="px-3 py-2">时间</th>
              </tr>
            </thead>
            <tbody>
              {data.updates.slice(0, 8).map((event) => {
                const delta = summarizeUpdateDelta(event, (hypothesisId) => readableCode(hypothesisCodes, hypothesisId, "H"));
                return (
                  <tr key={event.id} className="border-t border-line">
                    <td className="px-3 py-2">
                      <span className="font-mono text-xs">{readableCode(updateCodes, event.id, "U")}</span>
                      <span className="ml-2 text-ink/65">
                        {evidenceById.get(event.evidenceId)?.title ?? readableCode(evidenceCodes, event.evidenceId, "E")}
                      </span>
                    </td>
                    <td className="px-3 py-2">{event.status}</td>
                    <td className="px-3 py-2">
                      <span className={`font-semibold ${deltaToneClass(delta.tone)}`}>{delta.label}</span>
                      <span className="ml-2 text-xs text-ink/55">{delta.detail}</span>
                    </td>
                    <td className="px-3 py-2">{event.createdAt.toLocaleString("zh-CN")}</td>
                  </tr>
                );
              })}
              {data.updates.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-ink/50" colSpan={4}>
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
