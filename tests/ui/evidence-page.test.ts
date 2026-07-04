import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { vi } from "vitest";
import type { BayesianUpdateEventRecord, BeliefRecord, EvidenceRecord, ObservationSourceRecord } from "@/server/services/types";

const loadWorldModelData = vi.fn();
const WorldModelGraphView = vi.fn(({ graph, editor, returnPath }) =>
  React.createElement(
    "section",
    { "data-testid": "world-model-graph", "data-return-path": returnPath },
    [
      ...graph.nodes.map((node: { id: string; label: string }) => React.createElement("div", { key: node.id }, node.label)),
      React.createElement("div", { key: "editor-count" }, `editable:${editor?.evidence?.length ?? 0}`)
    ]
  )
);

vi.mock("server-only", () => ({}));

vi.mock("@/app/admin/world-model/data", () => ({
  loadWorldModelData
}));

vi.mock("@/components/world-model/WorldModelGraphView", () => ({
  WorldModelGraphView
}));

function evidence(input: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    id: "evidence_rejected",
    observationId: "observation_rejected",
    title: "Rejected evidence",
    content: "Rejected evidence content",
    confirmedAt: new Date("2026-06-11T08:00:00.000Z"),
    confirmationMode: "MANUAL",
    credibility: 0.6,
    status: "REJECTED",
    metadata: {},
    links: [],
    ...input
  };
}

function belief(input: Partial<BeliefRecord> = {}): BeliefRecord {
  const createdAt = new Date("2026-06-11T07:00:00.000Z");
  return {
    id: "belief_ai_agents",
    title: "AI agents",
    category: "AI_TREND",
    description: "Track whether AI agents improve delivery.",
    probabilityMode: "INDEPENDENT",
    origin: "INTERNAL",
    status: "ACTIVE",
    createdAt,
    updatedAt: createdAt,
    hypotheses: [
      {
        id: "hypothesis_support",
        beliefId: "belief_ai_agents",
        proposition: "AI agents improve delivery quality",
        notes: "",
        stance: "SUPPORTS",
        priorProbability: 0.4,
        currentProbability: 0.4,
        strength: 0.4,
        status: "ACTIVE",
        createdAt,
        updatedAt: createdAt
      },
      {
        id: "hypothesis_oppose",
        beliefId: "belief_ai_agents",
        proposition: "AI agents increase review overhead",
        notes: "",
        stance: "OPPOSES",
        priorProbability: 0.35,
        currentProbability: 0.35,
        strength: 0.35,
        status: "ACTIVE",
        createdAt: new Date("2026-06-11T07:01:00.000Z"),
        updatedAt: new Date("2026-06-11T07:01:00.000Z")
      }
    ],
    ...input
  };
}

function update(input: Partial<BayesianUpdateEventRecord> = {}): BayesianUpdateEventRecord {
  return {
    id: "update_reverted",
    beliefId: "belief_ai_agents",
    evidenceId: "evidence_reverted",
    priorSnapshot: { hypothesis_support: 0.4 },
    posteriorSnapshot: { hypothesis_support: 0.6 },
    mode: "APPLIED",
    status: "ROLLED_BACK",
    confidence: 0.7,
    explanations: [],
    createdAt: new Date("2026-06-11T09:00:00.000Z"),
    rolledBackAt: new Date("2026-06-11T10:00:00.000Z"),
    ...input
  };
}

function source(input: Partial<ObservationSourceRecord> = {}): ObservationSourceRecord {
  const createdAt = new Date("2026-06-11T06:00:00.000Z");
  return {
    id: "source_search",
    name: "Search source",
    kind: "SEARCH",
    url: "https://example.com/search?q={query}",
    adapter: "search",
    credibility: 0.8,
    enabled: true,
    autoConfirm: true,
    autoConfirmThreshold: 0.85,
    createdAt,
    updatedAt: createdAt,
    ...input
  };
}

describe("world model evidence page", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    loadWorldModelData.mockReset();
    WorldModelGraphView.mockClear();
  });

  it("exposes edit controls but not duplicate reject actions for rejected evidence", async () => {
    loadWorldModelData.mockResolvedValue({
      error: undefined,
      beliefs: [belief()],
      observations: [],
      evidence: [evidence()],
      updates: []
    });
    const { default: EvidencePage } = await import("@/app/admin/world-model/evidence/page");

    const html = renderToStaticMarkup(await EvidencePage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("Rejected evidence");
    expect(html).toContain("不可应用");
    expect(html).toContain("编辑证据和关联");
    expect(html).toContain("删除证据");
    expect(html).not.toContain("拒绝证据");
  });

  it("exposes automated evidence loop controls on the evidence page", async () => {
    loadWorldModelData.mockResolvedValue({
      error: undefined,
      beliefs: [belief()],
      observations: [],
      evidence: [],
      sources: [source()],
      updates: []
    });
    const { default: EvidencePage } = await import("@/app/admin/world-model/evidence/page");

    const html = renderToStaticMarkup(await EvidencePage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("自动搜证闭环");
    expect(html).toContain('id="evidence-loop"');
    expect(html).toContain("预检闭环");
    expect(html).toContain('name="returnPath" value="/admin/world-model/evidence#evidence-loop"');
    expect(html).toContain('name="maxQueries" value="3"');
    expect(html).toContain('name="maxSources" value="3"');
    expect(html).toContain('name="maxObservations" value="20"');
    expect(html).toContain('name="bootstrapDefaultSources" value="true"');
    expect(html).toContain('name="beliefIds"');
    expect(html).toContain("B-001 · AI agents");
    expect(html).toContain('name="sourceIds"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("S-001 · Search source");
    expect(html).not.toContain('<select name="sourceIds" multiple=""');
    expect(html).toContain('name="candidateThreshold"');
    expect(html).toContain('name="autoConfirmThreshold"');
    expect(html).toContain('name="reviewOnly"');
    expect(html).toContain('name="forceAutoApply"');
    expect(html).toContain('data-pending-label="预检中"');
    expect(html).toContain('data-pending-label="运行中"');
    expect(html).toContain("运行闭环");
  });

  it("renders per-hypothesis link controls when manually confirming evidence", async () => {
    loadWorldModelData.mockResolvedValue({
      error: undefined,
      beliefs: [belief()],
      observations: [
        {
          id: "observation_agent_signal",
          title: "Agent rollout signal",
          content: "Agent rollout improves delivery but adds review overhead.",
          observedAt: new Date("2026-06-11T08:00:00.000Z"),
          status: "PENDING",
          credibility: 0.7,
          metadata: {}
        }
      ],
      evidence: [],
      updates: []
    });
    const { default: EvidencePage } = await import("@/app/admin/world-model/evidence/page");

    const html = renderToStaticMarkup(await EvidencePage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain('name="linkHypothesisIds"');
    expect(html).toContain('name="direction:hypothesis_support"');
    expect(html).toContain('name="direction:hypothesis_oppose"');
    expect(html).toContain('name="relevance:hypothesis_support"');
    expect(html).toContain('name="likelihoodRatio:hypothesis_oppose"');
    expect(html).toContain("lg:grid-cols-[minmax(18rem,2fr)_repeat(4,minmax(8rem,1fr))]");
    expect(html).toContain('class="lg:col-span-5"');
    expect(html).not.toContain('name="hypothesisIds"');
  });

  it("does not render recommended confirmation controls for paused hypothesis candidates", async () => {
    loadWorldModelData.mockResolvedValue({
      error: undefined,
      beliefs: [
        belief({
          hypotheses: [
            {
              id: "hypothesis_paused",
              beliefId: "belief_ai_agents",
              proposition: "Paused recommendation should not be confirmed",
              notes: "",
              stance: "SUPPORTS",
              priorProbability: 0.4,
              currentProbability: 0.4,
              strength: 0.4,
              status: "PAUSED",
              createdAt: new Date("2026-06-11T07:00:00.000Z"),
              updatedAt: new Date("2026-06-11T08:00:00.000Z")
            }
          ]
        })
      ],
      observations: [
        {
          id: "observation_paused_candidate",
          title: "Paused candidate signal",
          content: "This pending observation only recommends a paused hypothesis.",
          observedAt: new Date("2026-06-11T08:00:00.000Z"),
          status: "PENDING",
          credibility: 0.7,
          metadata: {
            recommendedLinks: [
              {
                hypothesisId: "hypothesis_paused",
                direction: "SUPPORTS",
                relevance: 0.8,
                likelihoodRatio: 2,
                confidence: 0.75,
                rationale: "Paused hypothesis candidate."
              }
            ]
          }
        }
      ],
      evidence: [],
      updates: []
    });
    const { default: EvidencePage } = await import("@/app/admin/world-model/evidence/page");

    const html = renderToStaticMarkup(await EvidencePage({ searchParams: Promise.resolve({ observation: "O-001" }) }));

    expect(html).toContain("Paused candidate signal");
    expect(html).not.toContain("推荐候选确认");
    expect(html).not.toContain('name="direction:hypothesis_paused"');
  });

  it("does not render evidence submission buttons when there are no effective hypotheses", async () => {
    loadWorldModelData.mockResolvedValue({
      error: undefined,
      beliefs: [
        belief({
          hypotheses: [
            {
              id: "hypothesis_paused",
              beliefId: "belief_ai_agents",
              proposition: "Paused hypothesis cannot be selected",
              notes: "",
              stance: "SUPPORTS",
              priorProbability: 0.4,
              currentProbability: 0.4,
              strength: 0.4,
              status: "PAUSED",
              createdAt: new Date("2026-06-11T07:00:00.000Z"),
              updatedAt: new Date("2026-06-11T08:00:00.000Z")
            }
          ]
        })
      ],
      observations: [
        {
          id: "observation_agent_signal",
          title: "Agent rollout signal",
          content: "Agent rollout improves delivery.",
          observedAt: new Date("2026-06-11T08:00:00.000Z"),
          status: "PENDING",
          credibility: 0.7,
          metadata: {}
        }
      ],
      evidence: [],
      updates: []
    });
    const { default: EvidencePage } = await import("@/app/admin/world-model/evidence/page");

    const html = renderToStaticMarkup(await EvidencePage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("暂无可关联假设");
    expect(html).not.toContain("确认并更新");
    expect(html).not.toContain("录入并更新");
  });

  it("does not render the observation confirmation button when there are no pending observations", async () => {
    loadWorldModelData.mockResolvedValue({
      error: undefined,
      beliefs: [belief()],
      observations: [],
      evidence: [],
      updates: []
    });
    const { default: EvidencePage } = await import("@/app/admin/world-model/evidence/page");

    const html = renderToStaticMarkup(await EvidencePage({ searchParams: Promise.resolve({}) }));

    expect(html).not.toContain("确认并更新");
    expect(html).toContain("录入并更新");
  });

  it("shows relevance and confidence for each evidence-hypothesis link", async () => {
    loadWorldModelData.mockResolvedValue({
      error: undefined,
      beliefs: [belief()],
      observations: [],
      evidence: [
        evidence({
          id: "evidence_active",
          title: "Active evidence",
          status: "ACTIVE",
          links: [
            {
              id: "link_support",
              evidenceId: "evidence_active",
              hypothesisId: "hypothesis_support",
              direction: "SUPPORTS",
              relevance: 0.82,
              likelihoodRatio: 1.7,
              confidence: 0.64,
              rationale: "A specific relationship estimate.",
              createdAt: new Date("2026-06-11T08:01:00.000Z")
            }
          ]
        })
      ],
      updates: []
    });
    const { default: EvidencePage } = await import("@/app/admin/world-model/evidence/page");

    const html = renderToStaticMarkup(await EvidencePage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("<th");
    expect(html).toContain(">相关性</th>");
    expect(html).toContain(">置信度</th>");
    expect(html).toContain(">0.82</td>");
    expect(html).toContain(">0.64</td>");
  });

  it("shows retained LLM candidate evaluation diagnostics for confirmed evidence", async () => {
    loadWorldModelData.mockResolvedValue({
      error: undefined,
      beliefs: [belief()],
      observations: [],
      evidence: [
        evidence({
          id: "evidence_auto_llm",
          title: "Auto-applied LLM evidence",
          status: "ACTIVE",
          confirmationMode: "AUTO",
          metadata: {
            candidateEvaluation: {
              estimator: "llm",
              attemptedCount: 2,
              usableCount: 1,
              abstainedCount: 0,
              rejectedCount: 1,
              latestRationale: "The selected evidence was strong enough for automatic application."
            }
          },
          links: [
            {
              id: "link_support",
              evidenceId: "evidence_auto_llm",
              hypothesisId: "hypothesis_support",
              direction: "SUPPORTS",
              relevance: 0.91,
              likelihoodRatio: 2.4,
              confidence: 0.92,
              rationale: "The evidence supports the hypothesis.",
              createdAt: new Date("2026-06-11T08:01:00.000Z")
            }
          ]
        })
      ],
      updates: []
    });
    const { default: EvidencePage } = await import("@/app/admin/world-model/evidence/page");

    const html = renderToStaticMarkup(await EvidencePage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("Auto-applied LLM evidence");
    expect(html).toContain("llm 评估 2 个候选，1 个可用，1 个低相关；The selected evidence was strong enough for automatic application.");
  });

  it("shows retained auto-search query context for confirmed evidence", async () => {
    loadWorldModelData.mockResolvedValue({
      error: undefined,
      beliefs: [belief()],
      observations: [],
      evidence: [
        evidence({
          id: "evidence_auto_query",
          title: "Auto-collected query evidence",
          status: "ACTIVE",
          confirmationMode: "AUTO",
          metadata: {
            query: "AI agents engineering teams adoption",
            queryBeliefCode: "B-001",
            queryHypothesisCode: "H-001",
            queryPriority: 0.74,
            queryPriorityReason: "high uncertainty; no active evidence"
          }
        })
      ],
      updates: []
    });
    const { default: EvidencePage } = await import("@/app/admin/world-model/evidence/page");

    const html = renderToStaticMarkup(await EvidencePage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("Auto-collected query evidence");
    expect(html).toContain("搜证目标 H-001 · B-001；优先级 0.74；high uncertainty; no active evidence；查询：AI agents engineering teams adoption");
  });

  it("links to the graph workspace without embedding the evidence graph", async () => {
    loadWorldModelData.mockResolvedValue({
      error: undefined,
      beliefs: [belief()],
      observations: [],
      evidence: [
        evidence({
          id: "evidence_active",
          title: "Active evidence graph node",
          status: "ACTIVE",
          links: [
            {
              id: "link_support",
              evidenceId: "evidence_active",
              hypothesisId: "hypothesis_support",
              direction: "SUPPORTS",
              relevance: 0.82,
              likelihoodRatio: 1.7,
              confidence: 0.64,
              rationale: "A specific relationship estimate.",
              createdAt: new Date("2026-06-11T08:01:00.000Z")
            }
          ]
        })
      ],
      updates: []
    });
    const { default: EvidencePage } = await import("@/app/admin/world-model/evidence/page");

    const html = renderToStaticMarkup(await EvidencePage({ searchParams: Promise.resolve({}) }));

    expect(html).not.toContain('data-testid="world-model-graph"');
    expect(html).not.toContain("editable:1");
    expect(html).toContain('href="/admin/world-model/graph"');
  });

  it("focuses the selected evidence card and keeps graph edits returning to it", async () => {
    loadWorldModelData.mockResolvedValue({
      error: undefined,
      beliefs: [belief()],
      observations: [],
      evidence: [
        evidence({
          id: "evidence_focus",
          title: "Focused evidence",
          status: "ACTIVE",
          confirmedAt: new Date("2026-06-11T08:00:00.000Z"),
          links: [
            {
              id: "link_support",
              evidenceId: "evidence_focus",
              hypothesisId: "hypothesis_support",
              direction: "SUPPORTS",
              relevance: 0.82,
              likelihoodRatio: 1.7,
              confidence: 0.64,
              rationale: "Focused relationship estimate.",
              createdAt: new Date("2026-06-11T08:01:00.000Z")
            }
          ]
        }),
        evidence({
          id: "evidence_other",
          title: "Other evidence",
          status: "ACTIVE",
          confirmedAt: new Date("2026-06-11T08:05:00.000Z")
        })
      ],
      updates: []
    });
    const { default: EvidencePage } = await import("@/app/admin/world-model/evidence/page");

    const html = renderToStaticMarkup(await EvidencePage({ searchParams: Promise.resolve({ evidence: "E-001" }) }));
    const focusedStart = html.indexOf('id="E-001"');
    const otherStart = html.indexOf('id="E-002"');
    const focusedHtml = html.slice(focusedStart, otherStart > focusedStart ? otherStart : undefined);

    expect(html).toContain('href="/admin/world-model/graph?evidence=E-001"');
    expect(focusedStart).toBeGreaterThan(-1);
    expect(focusedHtml).toContain('data-focused-evidence="true"');
    expect(focusedHtml).toContain("Focused evidence");
    expect(focusedHtml).toContain('<details open=""');
    expect(focusedHtml).toContain('name="returnPath" value="/admin/world-model/evidence?evidence=E-001#E-001"');
    expect(focusedHtml).not.toContain("Other evidence");
  });

  it("previews evidence updates grouped by affected belief before applying", async () => {
    const createdAt = new Date("2026-06-11T07:00:00.000Z");
    loadWorldModelData.mockResolvedValue({
      error: undefined,
      beliefs: [
        belief({
          id: "belief_ai_agents",
          title: "AI agents",
          hypotheses: [
            {
              id: "hypothesis_support",
              beliefId: "belief_ai_agents",
              proposition: "AI agents improve delivery quality",
              notes: "",
              stance: "SUPPORTS",
              priorProbability: 0.4,
              currentProbability: 0.4,
              strength: 0.4,
              status: "ACTIVE",
              createdAt,
              updatedAt: createdAt
            }
          ]
        }),
        belief({
          id: "belief_career",
          title: "Career focus",
          category: "CAREER",
          hypotheses: [
            {
              id: "hypothesis_focus",
              beliefId: "belief_career",
              proposition: "Automation reduces focus time",
              notes: "",
              stance: "OPPOSES",
              priorProbability: 0.6,
              currentProbability: 0.6,
              strength: 0.6,
              status: "ACTIVE",
              createdAt: new Date("2026-06-11T07:02:00.000Z"),
              updatedAt: new Date("2026-06-11T07:02:00.000Z")
            }
          ]
        })
      ],
      observations: [],
      evidence: [
        evidence({
          id: "evidence_cross",
          title: "Cross belief evidence",
          status: "ACTIVE",
          credibility: 0.8,
          links: [
            {
              id: "link_support",
              evidenceId: "evidence_cross",
              hypothesisId: "hypothesis_support",
              direction: "SUPPORTS",
              relevance: 0.9,
              likelihoodRatio: 2,
              confidence: 0.7,
              rationale: "Raises the delivery-quality hypothesis.",
              createdAt: new Date("2026-06-11T08:01:00.000Z")
            },
            {
              id: "link_focus",
              evidenceId: "evidence_cross",
              hypothesisId: "hypothesis_focus",
              direction: "OPPOSES",
              relevance: 0.6,
              likelihoodRatio: 0.5,
              confidence: 0.5,
              rationale: "Weakens the focus-time hypothesis.",
              createdAt: new Date("2026-06-11T08:02:00.000Z")
            }
          ]
        })
      ],
      updates: []
    });
    const { default: EvidencePage } = await import("@/app/admin/world-model/evidence/page");

    const html = renderToStaticMarkup(await EvidencePage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("更新预览");
    expect(html).toContain("AI agents");
    expect(html).toContain("Career focus");
    expect(html).toContain("40.0% → 54.5%");
    expect(html).toContain("+14.5pp");
    expect(html).toContain("60.0% → 47.4%");
    expect(html).toContain("-12.6pp");
    expect(html).toContain("应用更新");
  });

  it("does not expose the apply action when evidence has no current hypothesis links", async () => {
    loadWorldModelData.mockResolvedValue({
      error: undefined,
      beliefs: [],
      observations: [],
      evidence: [
        evidence({
          id: "evidence_stale_link",
          title: "Evidence with stale link",
          status: "ACTIVE",
          links: [
            {
              id: "link_stale",
              evidenceId: "evidence_stale_link",
              hypothesisId: "hypothesis_deleted",
              direction: "SUPPORTS",
              relevance: 0.8,
              likelihoodRatio: 1.5,
              confidence: 0.7,
              rationale: "The target hypothesis no longer exists.",
              createdAt: new Date("2026-06-11T08:03:00.000Z")
            }
          ]
        })
      ],
      updates: []
    });
    const { default: EvidencePage } = await import("@/app/admin/world-model/evidence/page");

    const html = renderToStaticMarkup(await EvidencePage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("Evidence with stale link");
    expect(html).toContain("不可应用");
    expect(html).not.toContain("应用更新");
    expect(html).not.toContain("更新预览");
  });

  it("does not expose the apply action or preview for evidence linked only to paused hypotheses", async () => {
    loadWorldModelData.mockResolvedValue({
      error: undefined,
      beliefs: [
        belief({
          hypotheses: [
            {
              id: "hypothesis_paused",
              beliefId: "belief_ai_agents",
              proposition: "Paused hypothesis should not receive updates",
              notes: "",
              stance: "SUPPORTS",
              priorProbability: 0.4,
              currentProbability: 0.4,
              strength: 0.4,
              status: "PAUSED",
              createdAt: new Date("2026-06-11T07:00:00.000Z"),
              updatedAt: new Date("2026-06-11T08:00:00.000Z")
            }
          ]
        })
      ],
      observations: [],
      evidence: [
        evidence({
          id: "evidence_paused_only",
          title: "Evidence linked to paused hypothesis",
          status: "ACTIVE",
          links: [
            {
              id: "link_paused",
              evidenceId: "evidence_paused_only",
              hypothesisId: "hypothesis_paused",
              direction: "SUPPORTS",
              relevance: 0.8,
              likelihoodRatio: 1.5,
              confidence: 0.7,
              rationale: "The target hypothesis is paused.",
              createdAt: new Date("2026-06-11T08:03:00.000Z")
            }
          ]
        })
      ],
      updates: []
    });
    const { default: EvidencePage } = await import("@/app/admin/world-model/evidence/page");

    const html = renderToStaticMarkup(await EvidencePage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("Evidence linked to paused hypothesis");
    expect(html).toContain("不可应用");
    expect(html).not.toContain("应用更新");
    expect(html).not.toContain("更新预览");
  });

  it("anchors and highlights a focused update event for rollback review links", async () => {
    loadWorldModelData.mockResolvedValue({
      error: undefined,
      beliefs: [belief()],
      observations: [],
      evidence: [
        evidence({
          id: "evidence_reverted",
          title: "Reverted evidence",
          status: "ACTIVE"
        })
      ],
      updates: [update({ status: "APPLIED", rolledBackAt: undefined })]
    });
    const { default: EvidencePage } = await import("@/app/admin/world-model/evidence/page");

    const html = renderToStaticMarkup(await EvidencePage({ searchParams: Promise.resolve({ update: "U-001" }) }));

    expect(html).toContain('id="update-events"');
    expect(html).toContain('data-focused-update="true"');
    expect(html).toContain(">U-001</td>");
    expect(html).toContain("Reverted evidence");
    expect(html).toContain('name="returnPath" value="/admin/world-model/evidence?update=U-001#U-001"');
  });

  it("renders human-readable update explanation summaries in the rollback table", async () => {
    loadWorldModelData.mockResolvedValue({
      error: undefined,
      beliefs: [belief()],
      observations: [],
      evidence: [
        evidence({
          id: "evidence_reverted",
          title: "Readable update evidence",
          status: "ACTIVE"
        })
      ],
      updates: [
        update({
          status: "APPLIED",
          rolledBackAt: undefined,
          explanations: ["hypothesis_support: Strong source evidence increased confidence."]
        })
      ]
    });
    const { default: EvidencePage } = await import("@/app/admin/world-model/evidence/page");

    const html = renderToStaticMarkup(await EvidencePage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("H-001 · AI agents improve delivery quality: Strong source evidence increased confidence.");
    expect(html).not.toContain("hypothesis_support: Strong source evidence");
  });
});
