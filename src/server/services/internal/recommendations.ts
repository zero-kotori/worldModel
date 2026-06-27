import {
  CALIBRATION_QUERY_ERROR_THRESHOLD,
  OBSERVATION_RECOMMENDATION_THRESHOLD,
  isCurrentlyEffectiveHypothesis,
  overlapScore
} from "@/server/services/internal/shared";
import type {
  BeliefRecord,
  CreateBeliefInput,
  HypothesisRecommendation,
  HypothesisRecommendationGenerator,
  HypothesisRecommendationOptions,
  HypothesisRecord,
  ObservationRecord
} from "@/server/services/types";

// Hypothesis recommendation engine: calibration-repair, observation-driven and
// category-template recommendations. Extracted from the service factory so the
// belief service stays focused on persistence (AGENTS.md §3).

function normalizedTextKey(value: string) {
  return value.toLowerCase().replaceAll(/[^a-z0-9\u4e00-\u9fa5]+/g, "");
}

function categoryRecommendationTemplates(category: CreateBeliefInput["category"]) {
  const shared = [
    {
      stance: "SUPPORTS" as const,
      priorProbability: 0.45,
      proposition: (title: string) => `${title} 在未来 6-12 个月出现可重复的正向证据`,
      rationale: "建立一个短周期正向检验点，避免只停留在长期直觉。",
      notes: "可观察：至少 3 个可信来源给出方向一致的进展、采用或结果数据。"
    },
    {
      stance: "OPPOSES" as const,
      priorProbability: 0.35,
      proposition: (title: string) => `${title} 的关键反例在未来 6-12 个月持续出现`,
      rationale: "保留反证假设，避免只收集支持性证据。",
      notes: "可观察：高可信来源持续出现失败案例、负面结果、停滞指标或替代解释。"
    }
  ];

  const specific: Record<CreateBeliefInput["category"], typeof shared> = {
    AI_TREND: [
      {
        stance: "SUPPORTS",
        priorProbability: 0.5,
        proposition: (title) => `${title} 带来真实工作流中的效率或质量提升`,
        rationale: "AI 趋势需要落到真实任务结果，而不是只看发布热度。",
        notes: "可观察：企业案例、基准复现、用户留存或交付周期数据显示持续改善。"
      },
      {
        stance: "OPPOSES",
        priorProbability: 0.35,
        proposition: (title) => `${title} 被评审成本、可靠性或集成复杂度抵消`,
        rationale: "反向检验采用阻力，防止高估演示效果。",
        notes: "可观察：失败复盘、成本上升、人工返工、可靠性事故或弃用信号。"
      }
    ],
    INVESTMENT: [
      {
        stance: "SUPPORTS",
        priorProbability: 0.45,
        proposition: (title) => `${title} 的基本面或资金面指标持续改善`,
        rationale: "投资判断需要拆成可跟踪的驱动因素。",
        notes: "可观察：财报、订单、现金流、估值、资金流或行业数据连续改善。"
      },
      {
        stance: "OPPOSES",
        priorProbability: 0.4,
        proposition: (title) => `${title} 的核心驱动被估值、周期或竞争压力削弱`,
        rationale: "明确反向风险，避免单边叙事。",
        notes: "可观察：利润率恶化、估值压缩、监管变化、竞争加剧或需求下滑。"
      }
    ],
    TECH_TREND: [
      {
        stance: "SUPPORTS",
        priorProbability: 0.45,
        proposition: (title) => `${title} 获得开发者、企业或生态的持续采用`,
        rationale: "技术趋势要看采用和生态，而不只是概念热度。",
        notes: "可观察：GitHub、下载量、客户案例、标准化进展或生态工具增长。"
      },
      {
        stance: "OPPOSES",
        priorProbability: 0.35,
        proposition: (title) => `${title} 因迁移成本、性能或生态缺口停留在小众场景`,
        rationale: "技术采用常被切换成本和生态约束限制。",
        notes: "可观察：迁移失败、性能瓶颈、维护停滞、社区活跃下降或替代方案胜出。"
      }
    ],
    CAREER: [
      {
        stance: "SUPPORTS",
        priorProbability: 0.45,
        proposition: (title) => `${title} 提升长期能力、机会质量或选择权`,
        rationale: "职业判断要拆成能力、机会和选择权三个可追踪维度。",
        notes: "可观察：岗位要求、薪酬区间、项目产出、人脉质量或学习曲线改善。"
      },
      {
        stance: "OPPOSES",
        priorProbability: 0.35,
        proposition: (title) => `${title} 的机会成本高于实际收益`,
        rationale: "保留机会成本假设，避免只看路径收益。",
        notes: "可观察：收入差距、时间投入、压力水平、技能折旧或替代路径表现更好。"
      }
    ],
    SOURCE_RELIABILITY: [
      {
        stance: "SUPPORTS",
        priorProbability: 0.55,
        proposition: (title) => `${title} 在关键事实上持续被后续证据验证`,
        rationale: "来源可靠性应由历史命中率和修正透明度检验。",
        notes: "可观察：原始证据、后续验证、勘误记录、引用链和过往预测准确率。"
      },
      {
        stance: "OPPOSES",
        priorProbability: 0.35,
        proposition: (title) => `${title} 存在选择性报道、误导性归因或低质量引用`,
        rationale: "可靠性判断必须持续寻找系统性偏差。",
        notes: "可观察：断章取义、缺少一手来源、反复误报、利益冲突或回避更正。"
      }
    ]
  };

  return [...specific[category], ...shared];
}

export function observationSignalText(observation: ObservationRecord) {
  return [observation.title, observation.content].filter(Boolean).join(" ");
}

function compactObservationTitle(title: string) {
  const normalized = title.replace(/\s+/g, " ").trim();
  if (normalized.length <= 96) return normalized;
  return `${normalized.slice(0, 94)}...`;
}

function observationDrivenStance(observation: ObservationRecord): HypothesisRecord["stance"] {
  const signal = observationSignalText(observation);
  if (/(delay|slow|risk|fail|cost|overhead|decline|drop|weak|阻力|延迟|放缓|风险|失败|成本|下降|削弱)/i.test(signal)) {
    return "OPPOSES";
  }
  return "SUPPORTS";
}

export function resolvedOutcomeValue(status: HypothesisRecord["status"]): 0 | 1 | null {
  if (status === "RESOLVED_TRUE") return 1;
  if (status === "RESOLVED_FALSE") return 0;
  return null;
}

function createCalibrationRepairRecommendations(
  belief: BeliefRecord,
  seen: Set<string>,
  limit: number
): Array<{
  hypothesis: HypothesisRecord;
  outcome: 0 | 1;
  predictedProbability: number;
  error: number;
  fallback: HypothesisRecommendation;
}> {
  return belief.hypotheses
    .flatMap((hypothesis) => {
      const outcome = resolvedOutcomeValue(hypothesis.status);
      if (outcome === null) return [];

      const predictedProbability = Math.min(1, Math.max(0, hypothesis.currentProbability));
      const error = Math.abs(predictedProbability - outcome);
      if (error < CALIBRATION_QUERY_ERROR_THRESHOLD) return [];

      const stance: HypothesisRecord["stance"] = outcome === 0 ? "OPPOSES" : "SUPPORTS";
      const proposition =
        outcome === 0
          ? `导致「${hypothesis.proposition}」被证伪的条件仍可能复现`
          : `导致「${hypothesis.proposition}」最终成立的领先信号仍可能复现`;
      const key = normalizedTextKey(proposition);
      if (!proposition || seen.has(key)) return [];
      seen.add(key);

      const outcomeLabel = outcome === 0 ? "未发生" : "发生";
      const resolvedOutcome = hypothesis.resolvedOutcome?.trim();
      const fallback = {
        proposition,
        stance,
        priorProbability: stance === "OPPOSES" ? 0.35 : 0.45,
        notes: `可观察：复盘已结算假设的误判条件、领先信号和反证来源。${resolvedOutcome ? `结算记录：${resolvedOutcome}` : ""}`.trim(),
        evidenceSearchQuery: `${belief.title} ${hypothesis.proposition} ${resolvedOutcome ?? ""}`.trim(),
        rationale: `校准偏差：${hypothesis.proposition} 结算为${outcomeLabel}，结算概率 ${(predictedProbability * 100).toFixed(
          1
        )}%，误差 ${(error * 100).toFixed(1)}pp。`,
        calibrationHypothesisId: hypothesis.id,
        calibrationError: Number(error.toFixed(3))
      } satisfies HypothesisRecommendation;
      return [
        {
          hypothesis,
          outcome,
          predictedProbability,
          error,
          fallback
        }
      ];
    })
    .sort((left, right) => right.error - left.error || left.fallback.proposition.localeCompare(right.fallback.proposition))
    .slice(0, limit);
}

function addRecommendationIfUsable(
  recommendations: HypothesisRecommendation[],
  seen: Set<string>,
  recommendation: HypothesisRecommendation,
  fallback: HypothesisRecommendation,
  limit: number
) {
  if (recommendations.length >= limit) return false;
  const proposition = recommendation.proposition.trim();
  const key = normalizedTextKey(proposition);
  if (!proposition || seen.has(key)) return false;
  if (recommendation.stance !== "SUPPORTS" && recommendation.stance !== "OPPOSES") return false;
  if (!Number.isFinite(recommendation.priorProbability)) return false;

  seen.add(key);
  recommendations.push({
    proposition,
    stance: recommendation.stance,
    priorProbability: Math.min(0.95, Math.max(0.05, recommendation.priorProbability)),
    notes: recommendation.notes.trim() || fallback.notes,
    evidenceSearchQuery: recommendation.evidenceSearchQuery.trim() || fallback.evidenceSearchQuery,
    rationale: recommendation.rationale.trim() || fallback.rationale,
    sourceObservationId: recommendation.sourceObservationId ?? fallback.sourceObservationId,
    calibrationHypothesisId: fallback.calibrationHypothesisId,
    calibrationError: fallback.calibrationError
  });
  return true;
}

async function createCalibrationRepairRecommendationList(
  belief: BeliefRecord,
  seen: Set<string>,
  limit: number,
  generator?: HypothesisRecommendationGenerator
): Promise<HypothesisRecommendation[]> {
  const contexts = createCalibrationRepairRecommendations(belief, new Set(seen), limit);
  const recommendations: HypothesisRecommendation[] = [];

  for (const context of contexts) {
    const generated =
      generator && recommendations.length < limit
        ? await generator({
            belief,
            calibration: {
              hypothesis: context.hypothesis,
              outcome: context.outcome,
              predictedProbability: context.predictedProbability,
              error: context.error,
              resolvedOutcome: context.hypothesis.resolvedOutcome
            },
            limit: limit - recommendations.length
          }).catch(() => [])
        : [];

    for (const recommendation of generated) {
      addRecommendationIfUsable(recommendations, seen, recommendation, context.fallback, limit);
    }
    addRecommendationIfUsable(recommendations, seen, context.fallback, context.fallback, limit);
    if (recommendations.length >= limit) break;
  }

  return recommendations;
}

function createObservationDrivenRecommendationContexts(
  belief: BeliefRecord,
  observations: ObservationRecord[],
  seen: Set<string>,
  limit: number
): Array<{ observation: ObservationRecord; fallback: HypothesisRecommendation }> {
  const context = [belief.title, belief.description].filter(Boolean).join(" ");
  return observations
    .filter(
      (observation) =>
        observation.metadata.ignoredReason === "UNMATCHED" &&
        observation.status !== "CONFIRMED" &&
        observation.status !== "REJECTED" &&
        observation.status !== "DUPLICATE"
    )
    .map((observation) => ({
      observation,
      score: overlapScore(observationSignalText(observation), context)
    }))
    .filter((item) => item.score >= OBSERVATION_RECOMMENDATION_THRESHOLD)
    .sort((a, b) => b.score - a.score || b.observation.observedAt.getTime() - a.observation.observedAt.getTime())
    .flatMap((item) => {
      const observationTitle = compactObservationTitle(item.observation.title);
      const stance = observationDrivenStance(item.observation);
      const proposition = `${observationTitle} 持续影响「${belief.title}」`;
      const key = normalizedTextKey(proposition);
      if (!observationTitle || seen.has(key)) return [];
      seen.add(key);
      const fallback = {
        proposition,
        stance,
        priorProbability: stance === "OPPOSES" ? 0.35 : 0.45,
        notes: `可观察：跟踪这条未匹配观察是否被更多来源复现、量化或反驳。来源观察：${observationTitle}`,
        evidenceSearchQuery: `${belief.title} ${observationTitle}`.trim(),
        rationale: `来自未匹配观察：${observationTitle}`,
        sourceObservationId: item.observation.id
      } satisfies HypothesisRecommendation;
      return [
        {
          observation: item.observation,
          fallback
        }
      ];
    })
    .slice(0, limit);
}

async function createObservationDrivenRecommendationList(
  belief: BeliefRecord,
  observations: ObservationRecord[],
  seen: Set<string>,
  limit: number,
  generator?: HypothesisRecommendationGenerator
): Promise<HypothesisRecommendation[]> {
  const contexts = createObservationDrivenRecommendationContexts(belief, observations, new Set(seen), limit);
  const recommendations: HypothesisRecommendation[] = [];

  for (const context of contexts) {
    const generated =
      generator && recommendations.length < limit
        ? await generator({
            belief,
            sourceObservation: context.observation,
            limit: limit - recommendations.length
          }).catch(() => [])
        : [];

    for (const recommendation of generated) {
      addRecommendationIfUsable(recommendations, seen, recommendation, context.fallback, limit);
    }
    addRecommendationIfUsable(recommendations, seen, context.fallback, context.fallback, limit);
    if (recommendations.length >= limit) break;
  }

  return recommendations;
}

export async function createHypothesisRecommendations(
  belief: BeliefRecord,
  options: HypothesisRecommendationOptions = {},
  observations: ObservationRecord[] = [],
  generator?: HypothesisRecommendationGenerator
): Promise<HypothesisRecommendation[]> {
  const limit = Math.max(1, Math.min(8, options.limit ?? 4));
  const existing = new Set(belief.hypotheses.map((hypothesis) => normalizedTextKey(hypothesis.proposition)));
  const seen = new Set(existing);
  const title = belief.title.trim();
  const context = [belief.title, belief.description].filter(Boolean).join(" ");
  const templates = categoryRecommendationTemplates(belief.category);
  const recommendations: HypothesisRecommendation[] = await createCalibrationRepairRecommendationList(belief, seen, limit, generator);
  recommendations.push(
    ...(await createObservationDrivenRecommendationList(belief, observations, seen, limit - recommendations.length, generator))
  );
  if (options.sourceObservationId) {
    return recommendations.filter((recommendation) => recommendation.sourceObservationId === options.sourceObservationId).slice(0, limit);
  }
  const effectiveStances = new Set(belief.hypotheses.filter((hypothesis) => isCurrentlyEffectiveHypothesis(hypothesis)).map((hypothesis) => hypothesis.stance));

  function addTemplateRecommendation(template: (typeof templates)[number]) {
    const proposition = template.proposition(title).trim();
    const key = normalizedTextKey(proposition);
    if (!proposition || seen.has(key)) return false;
    seen.add(key);
    recommendations.push({
      proposition,
      stance: template.stance,
      priorProbability: template.priorProbability,
      notes: template.notes,
      evidenceSearchQuery: `${context} ${proposition}`.trim(),
      rationale: template.rationale
    });
    return true;
  }

  for (const missingStance of [
    effectiveStances.has("SUPPORTS") ? undefined : "SUPPORTS",
    effectiveStances.has("OPPOSES") ? undefined : "OPPOSES"
  ] as Array<HypothesisRecord["stance"] | undefined>) {
    if (!missingStance || recommendations.some((recommendation) => recommendation.stance === missingStance)) continue;
    const template = templates.find((candidate) => candidate.stance === missingStance);
    if (!template) continue;
    if (recommendations.length >= limit) {
      const replaceIndex = recommendations.findLastIndex((recommendation) => recommendation.sourceObservationId && recommendation.stance !== missingStance);
      if (replaceIndex < 0) continue;
      recommendations.splice(replaceIndex, 1);
    }
    addTemplateRecommendation(template);
  }

  for (const template of templates) {
    if (recommendations.length >= limit) break;
    addTemplateRecommendation(template);
  }

  return recommendations;
}
