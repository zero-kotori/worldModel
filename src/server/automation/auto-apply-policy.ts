import { isHypothesisCurrentlyEffective } from "@/lib/world-model-beliefs-ui";
import { llmEvaluationAutoApplyRisk, llmEvaluationDiagnostics, sourceEvidenceQualityAutoApplyRisk } from "@/lib/world-model-sources-ui";
import type { WorldModelServices } from "@/server/services/types";
import { loadLlmEvaluationArtifact, type LlmEvaluationArtifact } from "@/server/training/llm-evaluation-artifact";

type AutoApplyOptions = {
  reviewOnly?: boolean;
  forceAutoApply?: boolean;
  beliefIds?: string[];
  sourceIds?: string[];
};

function joinNotices(...notices: string[]) {
  return notices.filter(Boolean).join("；");
}

async function activeScopedBeliefs(services: WorldModelServices, beliefIds?: string[]) {
  const requestedBeliefIds = new Set(beliefIds?.filter(Boolean) ?? []);
  return (await services.beliefs.listBeliefs()).filter(
    (belief) => belief.status === "ACTIVE" && (requestedBeliefIds.size === 0 || requestedBeliefIds.has(belief.id))
  );
}

function hasSourceEvidenceQualityServices(services: WorldModelServices) {
  const candidate = services as Partial<WorldModelServices>;
  return (
    typeof candidate.sources?.listSources === "function" &&
    typeof candidate.observations?.listObservations === "function" &&
    typeof candidate.evidence?.listEvidence === "function" &&
    typeof candidate.updates?.listEvents === "function"
  );
}

function downgradeToReviewOnly<T extends AutoApplyOptions>(options: T, notice: string) {
  return {
    options: {
      ...options,
      reviewOnly: true,
      forceAutoApply: false
    } as T,
    notice
  };
}

async function loadLlmEvaluationArtifactForGuard(): Promise<{
  evaluation: LlmEvaluationArtifact | null;
  loadFailed: boolean;
}> {
  try {
    return { evaluation: await loadLlmEvaluationArtifact(), loadFailed: false };
  } catch {
    return { evaluation: null, loadFailed: true };
  }
}

export async function guardAutoApplyWithEffectiveHypotheses<T extends AutoApplyOptions>(
  services: WorldModelServices,
  options: T
) {
  if (options.reviewOnly || !options.forceAutoApply) {
    return { options, notice: "" };
  }

  const beliefs = await activeScopedBeliefs(services, options.beliefIds);
  const hasEffectiveHypothesis = beliefs
    .some((belief) => belief.hypotheses.some((hypothesis) => isHypothesisCurrentlyEffective(hypothesis)));

  if (hasEffectiveHypothesis) {
    return { options, notice: "" };
  }

  return downgradeToReviewOnly(options, "没有当前有效假设，已切换为待审模式。");
}

export async function guardAutoApplyWithBalancedHypothesisCoverage<T extends AutoApplyOptions>(
  services: WorldModelServices,
  options: T
) {
  if (options.reviewOnly || !options.forceAutoApply) {
    return { options, notice: "" };
  }

  const hasOneSidedCoverage = (await activeScopedBeliefs(services, options.beliefIds)).some((belief) => {
    const effectiveHypotheses = belief.hypotheses.filter((hypothesis) => isHypothesisCurrentlyEffective(hypothesis));
    const hasSupport = effectiveHypotheses.some((hypothesis) => hypothesis.stance === "SUPPORTS");
    const hasOppose = effectiveHypotheses.some((hypothesis) => hypothesis.stance === "OPPOSES");
    return (hasSupport || hasOppose) && hasSupport !== hasOppose;
  });

  if (!hasOneSidedCoverage) {
    return { options, notice: "" };
  }

  return downgradeToReviewOnly(options, "假设覆盖单向，已切换为待审模式。");
}

export async function guardAutoApplyWithLlmEvaluation<T extends AutoApplyOptions>(options: T) {
  if (options.reviewOnly || !options.forceAutoApply) {
    return { options, notice: "" };
  }

  const { evaluation, loadFailed } = await loadLlmEvaluationArtifactForGuard();
  if (loadFailed) {
    return downgradeToReviewOnly(options, "LLM 评估风险：LLM 评估加载失败，已切换为待审模式。");
  }

  const risk = llmEvaluationAutoApplyRisk(evaluation);
  if (!risk) {
    const warningTitles = llmEvaluationDiagnostics(evaluation)
      .filter((diagnostic) => diagnostic.level === "warning")
      .map((diagnostic) => diagnostic.title);
    return {
      options,
      notice: warningTitles.length > 0 ? `LLM 评估提示：${warningTitles.join("、")}。` : ""
    };
  }

  return downgradeToReviewOnly(options, `LLM 评估风险：${risk.title}，已切换为待审模式。`);
}

export async function guardAutoApplyWithSourceEvidenceQuality<T extends AutoApplyOptions>(
  services: WorldModelServices,
  options: T
) {
  if (options.reviewOnly || !options.forceAutoApply || !hasSourceEvidenceQualityServices(services)) {
    return { options, notice: "" };
  }

  const [sources, observations, evidence, updates] = await Promise.all([
    services.sources.listSources(),
    services.observations.listObservations(),
    services.evidence.listEvidence(),
    services.updates.listEvents()
  ]);
  const risk = sourceEvidenceQualityAutoApplyRisk({
    sources,
    observations,
    evidence,
    updates,
    sourceIds: options.sourceIds
  });
  if (!risk) return { options, notice: "" };

  return downgradeToReviewOnly(
    options,
    `来源证据质量风险：${risk.source.name} 的证据质量偏低（${risk.quality.problemEvidenceCount}/${risk.quality.evidenceCount} 条出现拒绝或回滚），已切换为待审模式。`
  );
}

export async function guardAutoApply<T extends AutoApplyOptions>(services: WorldModelServices, options: T) {
  const effective = await guardAutoApplyWithEffectiveHypotheses(services, options);
  const balanced = await guardAutoApplyWithBalancedHypothesisCoverage(services, effective.options);
  const sourceQuality = await guardAutoApplyWithSourceEvidenceQuality(services, balanced.options);
  const llm = await guardAutoApplyWithLlmEvaluation(sourceQuality.options);
  return {
    options: llm.options,
    notice: joinNotices(effective.notice, balanced.notice, sourceQuality.notice, llm.notice)
  };
}
