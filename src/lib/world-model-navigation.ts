export const worldModelSections = [
  { label: "总览", href: "/admin/world-model" },
  { label: "图谱", href: "/admin/world-model/graph" },
  { label: "信念", href: "/admin/world-model/beliefs" },
  { label: "观察", href: "/admin/world-model/observations" },
  { label: "证据", href: "/admin/world-model/evidence" },
  { label: "来源", href: "/admin/world-model/sources" },
  { label: "模型", href: "/admin/world-model/models" }
] as const;

export const categoryLabels = {
  AI_TREND: "AI 技术趋势",
  INVESTMENT: "投资判断",
  TECH_TREND: "其他技术趋势",
  CAREER: "职业方向",
  SOURCE_RELIABILITY: "信息源可靠性"
} as const;

export const probabilityModeLabels = {
  MUTUALLY_EXCLUSIVE: "互斥完备",
  INDEPENDENT: "相互独立"
} as const;

export const hypothesisStanceLabels = {
  SUPPORTS: "支持信念",
  OPPOSES: "反对信念"
} as const;

export const evidenceDirectionLabels = {
  SUPPORTS: "支持假设",
  OPPOSES: "削弱假设",
  MIXED: "混合影响",
  NEUTRAL: "中性"
} as const;
