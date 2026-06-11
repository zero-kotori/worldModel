import type { ObservationRecord } from "@/server/services/types";
import { groupObservationsForReview } from "@/lib/world-model-observations-ui";

type ActionLevel = "error" | "warning" | "info";

type AutomationDiagnostic = {
  level: ActionLevel;
  title: string;
  detail: string;
};

type AutomationNextAction = {
  label: string;
  href: string;
};

type DashboardActionInput = {
  observations: ObservationRecord[];
  reviewDueHypothesisCount: number;
  automation: {
    diagnostics: AutomationDiagnostic[];
    nextActions: AutomationNextAction[];
  };
};

export type DashboardAction = {
  label: string;
  detail: string;
  href: string;
  level: ActionLevel;
};

const automationActionDiagnosticTitles: Record<string, string[]> = {
  添加推荐来源: ["缺少采集来源", "没有启用来源"],
  创建信念表: ["缺少活跃信念"],
  补充假设: ["缺少活跃假设"],
  检查来源配置: ["来源抓取失败", "来源已自动降噪"],
  处理待审候选: ["候选等待确认"],
  调整信念假设: ["未识别候选证据", "没有当前有效假设"],
  调整采集来源: ["未采集观察"],
  检查守护进程: ["守护进程心跳过期"],
  处理观察积压: ["观察等待处理"],
  检查模型配置: ["LLM 主评分器未配置"]
};

function actionRank(level: ActionLevel) {
  if (level === "error") return 0;
  if (level === "warning") return 1;
  return 2;
}

function addDashboardAction(actions: DashboardAction[], action: DashboardAction) {
  if (!actions.some((item) => item.label === action.label && item.href === action.href)) {
    actions.push(action);
  }
}

function diagnosticForAction(action: AutomationNextAction, diagnostics: AutomationDiagnostic[]) {
  const titles = automationActionDiagnosticTitles[action.label] ?? [];
  return diagnostics.find((diagnostic) => titles.includes(diagnostic.title));
}

export function summarizeDashboardActions(input: DashboardActionInput): DashboardAction[] {
  const grouped = groupObservationsForReview(input.observations);
  const actions: DashboardAction[] = [];

  if (grouped.reviewCandidates.length > 0) {
    addDashboardAction(actions, {
      label: "处理待审候选",
      detail: `${grouped.reviewCandidates.length} 条候选已有推荐关联，确认后可以直接更新对应假设和信念。`,
      href: "/admin/world-model/observations",
      level: "warning"
    });
  }

  const unlinkedObservationCount = grouped.activePool.length + grouped.unknown.length + grouped.duplicates.length;
  if (unlinkedObservationCount > 0) {
    addDashboardAction(actions, {
      label: "处理观察积压",
      detail: `${unlinkedObservationCount} 条观察尚未确认为证据或拒绝。`,
      href: "/admin/world-model/observations",
      level: "info"
    });
  }

  if (input.reviewDueHypothesisCount > 0) {
    addDashboardAction(actions, {
      label: "复核假设时效",
      detail: `${input.reviewDueHypothesisCount} 个假设已到复核窗口，需要续期、归档或调整。`,
      href: "/admin/world-model/beliefs?view=review-due",
      level: "warning"
    });
  }

  for (const action of input.automation.nextActions) {
    const diagnostic = diagnosticForAction(action, input.automation.diagnostics);
    addDashboardAction(actions, {
      label: action.label,
      detail: diagnostic?.detail ?? "自动闭环需要处理。",
      href: action.href,
      level: diagnostic?.level ?? "info"
    });
  }

  return actions
    .map((action, index) => ({ action, index }))
    .sort((a, b) => actionRank(a.action.level) - actionRank(b.action.level) || a.index - b.index)
    .map(({ action }) => action);
}
