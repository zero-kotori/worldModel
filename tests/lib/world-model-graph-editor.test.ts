import {
  createEvidenceAuditRows,
  createEvidenceEdgeEditorRows,
  createEvidenceLinkEditorRows,
  createObservationConnectionEditorRows,
  createUpdateAuditRows,
  createWorldModelGraphEditorData
} from "@/lib/world-model-graph-editor";
import type { BayesianUpdateEventRecord, BeliefRecord, EvidenceRecord, LikelihoodRunRecord, ObservationRecord } from "@/server/services/types";

describe("world model graph editor data", () => {
  it("keeps hypothesis time windows editable in graph workspaces", () => {
    const startsAt = new Date("2026-06-12T01:30:00.000Z");
    const expiresAt = new Date("2026-06-20T01:30:00.000Z");
    const belief: BeliefRecord = {
      id: "belief_market",
      title: "市场判断",
      category: "INVESTMENT",
      description: "跟踪市场假设",
      probabilityMode: "INDEPENDENT",
      origin: "INTERNAL",
      status: "ACTIVE",
      createdAt: new Date("2026-06-10T00:00:00.000Z"),
      updatedAt: new Date("2026-06-10T00:00:00.000Z"),
      hypotheses: [
        {
          id: "hypothesis_alpha",
          beliefId: "belief_market",
          proposition: "流动性改善将支撑估值",
          notes: "需要每周复核",
          stance: "SUPPORTS",
          priorProbability: 0.45,
          currentProbability: 0.58,
          strength: 0.58,
          status: "ACTIVE",
          startsAt,
          expiresAt,
          expiryCondition: "央行政策路径发生反转",
          createdAt: new Date("2026-06-11T00:00:00.000Z"),
          updatedAt: new Date("2026-06-11T00:00:00.000Z")
        }
      ]
    };

    const editor = createWorldModelGraphEditorData({ beliefs: [belief], evidence: [], updates: [] });

    expect(editor.hypotheses[0]).toMatchObject({
      startsAt,
      expiresAt,
      expiryCondition: "央行政策路径发生反转"
    });
  });

  it("builds editable evidence link rows for existing and new hypothesis links", () => {
    const createdAt = new Date("2026-06-11T00:00:00.000Z");
    const belief: BeliefRecord = {
      id: "belief_market",
      title: "市场判断",
      category: "INVESTMENT",
      description: "跟踪市场假设",
      probabilityMode: "INDEPENDENT",
      origin: "INTERNAL",
      status: "ACTIVE",
      createdAt: new Date("2026-06-10T00:00:00.000Z"),
      updatedAt: new Date("2026-06-10T00:00:00.000Z"),
      hypotheses: [
        {
          id: "hypothesis_support",
          beliefId: "belief_market",
          proposition: "盈利改善",
          notes: "",
          stance: "SUPPORTS",
          priorProbability: 0.45,
          currentProbability: 0.58,
          strength: 0.58,
          status: "ACTIVE",
          createdAt,
          updatedAt: createdAt
        },
        {
          id: "hypothesis_risk",
          beliefId: "belief_market",
          proposition: "估值承压",
          notes: "",
          stance: "OPPOSES",
          priorProbability: 0.35,
          currentProbability: 0.3,
          strength: 0.3,
          status: "ACTIVE",
          createdAt: new Date("2026-06-11T00:01:00.000Z"),
          updatedAt: createdAt
        }
      ]
    };
    const evidence: EvidenceRecord = {
      id: "evidence_1",
      observationId: "observation_1",
      title: "利润率下滑",
      content: "利润率下滑削弱盈利改善假设。",
      confirmedAt: new Date("2026-06-11T01:00:00.000Z"),
      confirmationMode: "MANUAL",
      credibility: 0.8,
      status: "ACTIVE",
      metadata: {},
      links: [
        {
          id: "link_1",
          evidenceId: "evidence_1",
          hypothesisId: "hypothesis_support",
          direction: "OPPOSES",
          relevance: 0.9,
          likelihoodRatio: 0.4,
          confidence: 0.75,
          rationale: "利润率下降直接反驳盈利改善。",
          createdAt
        }
      ]
    };

    const editor = createWorldModelGraphEditorData({ beliefs: [belief], evidence: [evidence], updates: [] });

    expect(createEvidenceLinkEditorRows(editor, "evidence_1")).toEqual([
      {
        hypothesisId: "hypothesis_support",
        hypothesisCode: "H-001",
        beliefCode: "B-001",
        beliefTitle: "市场判断",
        proposition: "盈利改善",
        checked: true,
        direction: "OPPOSES",
        relevance: 0.9,
        likelihoodRatio: 0.4,
        confidence: 0.75,
        rationale: "利润率下降直接反驳盈利改善。"
      },
      {
        hypothesisId: "hypothesis_risk",
        hypothesisCode: "H-002",
        beliefCode: "B-001",
        beliefTitle: "市场判断",
        proposition: "估值承压",
        checked: false,
        direction: "SUPPORTS",
        relevance: 0.5,
        likelihoodRatio: 1,
        confidence: 0.5,
        rationale: "从图谱编辑证据关联"
      }
    ]);
  });

  it("builds safe single-edge evidence edit rows without dropping sibling links", () => {
    const createdAt = new Date("2026-06-11T00:00:00.000Z");
    const belief: BeliefRecord = {
      id: "belief_market",
      title: "市场判断",
      category: "INVESTMENT",
      description: "跟踪市场假设",
      probabilityMode: "INDEPENDENT",
      origin: "INTERNAL",
      status: "ACTIVE",
      createdAt: new Date("2026-06-10T00:00:00.000Z"),
      updatedAt: new Date("2026-06-10T00:00:00.000Z"),
      hypotheses: [
        {
          id: "hypothesis_support",
          beliefId: "belief_market",
          proposition: "盈利改善",
          notes: "",
          stance: "SUPPORTS",
          priorProbability: 0.45,
          currentProbability: 0.58,
          strength: 0.58,
          status: "ACTIVE",
          createdAt,
          updatedAt: createdAt
        },
        {
          id: "hypothesis_risk",
          beliefId: "belief_market",
          proposition: "估值承压",
          notes: "",
          stance: "OPPOSES",
          priorProbability: 0.35,
          currentProbability: 0.3,
          strength: 0.3,
          status: "ACTIVE",
          createdAt: new Date("2026-06-11T00:01:00.000Z"),
          updatedAt: createdAt
        }
      ]
    };
    const evidence: EvidenceRecord = {
      id: "evidence_1",
      observationId: "observation_1",
      title: "利润率下滑",
      content: "利润率下滑削弱盈利改善假设，同时强化估值压力。",
      confirmedAt: new Date("2026-06-11T01:00:00.000Z"),
      confirmationMode: "MANUAL",
      credibility: 0.8,
      status: "ACTIVE",
      metadata: {},
      links: [
        {
          id: "link_support",
          evidenceId: "evidence_1",
          hypothesisId: "hypothesis_support",
          direction: "OPPOSES",
          relevance: 0.9,
          likelihoodRatio: 0.4,
          confidence: 0.75,
          rationale: "利润率下降直接反驳盈利改善。",
          createdAt
        },
        {
          id: "link_risk",
          evidenceId: "evidence_1",
          hypothesisId: "hypothesis_risk",
          direction: "SUPPORTS",
          relevance: 0.7,
          likelihoodRatio: 1.6,
          confidence: 0.65,
          rationale: "利润率下降强化估值承压。",
          createdAt
        }
      ]
    };
    const editor = createWorldModelGraphEditorData({ beliefs: [belief], evidence: [evidence], updates: [] });

    expect(createEvidenceEdgeEditorRows(editor, "evidence_1", "hypothesis_risk")).toEqual([
      expect.objectContaining({
        hypothesisId: "hypothesis_risk",
        selected: true,
        checked: true,
        direction: "SUPPORTS",
        likelihoodRatio: 1.6
      }),
      expect.objectContaining({
        hypothesisId: "hypothesis_support",
        selected: false,
        checked: true,
        direction: "OPPOSES",
        likelihoodRatio: 0.4
      })
    ]);
  });

  it("builds editable link rows for rejected evidence recovery", () => {
    const createdAt = new Date("2026-06-11T00:00:00.000Z");
    const belief: BeliefRecord = {
      id: "belief_market",
      title: "市场判断",
      category: "INVESTMENT",
      description: "跟踪市场假设",
      probabilityMode: "INDEPENDENT",
      origin: "INTERNAL",
      status: "ACTIVE",
      createdAt: new Date("2026-06-10T00:00:00.000Z"),
      updatedAt: new Date("2026-06-10T00:00:00.000Z"),
      hypotheses: [
        {
          id: "hypothesis_support",
          beliefId: "belief_market",
          proposition: "盈利改善",
          notes: "",
          stance: "SUPPORTS",
          priorProbability: 0.45,
          currentProbability: 0.58,
          strength: 0.58,
          status: "ACTIVE",
          createdAt,
          updatedAt: createdAt
        }
      ]
    };
    const evidence: EvidenceRecord = {
      id: "evidence_rejected",
      observationId: "observation_1",
      title: "已拒绝证据",
      content: "这条证据已被拒绝。",
      confirmedAt: new Date("2026-06-11T01:00:00.000Z"),
      confirmationMode: "MANUAL",
      credibility: 0.8,
      status: "REJECTED",
      metadata: {},
      links: [
        {
          id: "link_1",
          evidenceId: "evidence_rejected",
          hypothesisId: "hypothesis_support",
          direction: "SUPPORTS",
          relevance: 0.9,
          likelihoodRatio: 2,
          confidence: 0.75,
          rationale: "已拒绝证据不应继续编辑关联。",
          createdAt
        }
      ]
    };
    const editor = createWorldModelGraphEditorData({ beliefs: [belief], evidence: [evidence], updates: [] });

    expect(createEvidenceLinkEditorRows(editor, "evidence_rejected")).toEqual([
      {
        hypothesisId: "hypothesis_support",
        hypothesisCode: "H-001",
        beliefCode: "B-001",
        beliefTitle: "市场判断",
        proposition: "盈利改善",
        checked: true,
        direction: "SUPPORTS",
        relevance: 0.9,
        likelihoodRatio: 2,
        confidence: 0.75,
        rationale: "已拒绝证据不应继续编辑关联。"
      }
    ]);
    expect(createEvidenceAuditRows(editor, "evidence_rejected")).toEqual([
      {
        hypothesisId: "hypothesis_support",
        hypothesisCode: "H-001",
        beliefCode: "B-001",
        beliefTitle: "市场判断",
        proposition: "盈利改善",
        checked: true,
        direction: "SUPPORTS",
        relevance: 0.9,
        likelihoodRatio: 2,
        confidence: 0.75,
        rationale: "已拒绝证据不应继续编辑关联。"
      }
    ]);
    expect(createEvidenceEdgeEditorRows(editor, "evidence_rejected", "hypothesis_support")).toEqual([
      expect.objectContaining({
        hypothesisId: "hypothesis_support",
        selected: true,
        checked: true,
        direction: "SUPPORTS",
        relevance: 0.9,
        likelihoodRatio: 2,
        confidence: 0.75
      })
    ]);
  });

  it("keeps pending observations editable with their recommended hypothesis links", () => {
    const createdAt = new Date("2026-06-11T00:00:00.000Z");
    const belief: BeliefRecord = {
      id: "belief_market",
      title: "市场判断",
      category: "INVESTMENT",
      description: "跟踪市场假设",
      probabilityMode: "INDEPENDENT",
      origin: "INTERNAL",
      status: "ACTIVE",
      createdAt: new Date("2026-06-10T00:00:00.000Z"),
      updatedAt: new Date("2026-06-10T00:00:00.000Z"),
      hypotheses: [
        {
          id: "hypothesis_support",
          beliefId: "belief_market",
          proposition: "订单恢复",
          notes: "",
          stance: "SUPPORTS",
          priorProbability: 0.45,
          currentProbability: 0.58,
          strength: 0.58,
          status: "ACTIVE",
          createdAt,
          updatedAt: createdAt
        }
      ]
    };
    const observation: ObservationRecord = {
      id: "observation_orders",
      title: "订单排产恢复",
      content: "多个来源显示订单排产恢复。",
      url: "https://example.com/orders",
      author: "industry feed",
      observedAt: new Date("2026-06-11T01:00:00.000Z"),
      status: "PENDING",
      credibility: 0.82,
      metadata: {
        recommendedLinks: [
          {
            hypothesisId: "hypothesis_support",
            direction: "SUPPORTS",
            relevance: 0.74,
            likelihoodRatio: 1.9,
            confidence: 0.68,
            rationale: "订单恢复支持需求改善。"
          }
        ]
      }
    };

    const editor = createWorldModelGraphEditorData({
      beliefs: [belief],
      observations: [observation],
      evidence: [],
      updates: []
    } as Parameters<typeof createWorldModelGraphEditorData>[0] & { observations: ObservationRecord[] });

    expect((editor as { observations?: unknown }).observations).toEqual([
      {
        id: "observation_orders",
        code: "O-001",
        title: "订单排产恢复",
        content: "多个来源显示订单排产恢复。",
        url: "https://example.com/orders",
        author: "industry feed",
        credibility: 0.82,
        status: "PENDING",
        links: [
          {
            hypothesisId: "hypothesis_support",
            hypothesisCode: "H-001",
            beliefCode: "B-001",
            beliefTitle: "市场判断",
            proposition: "订单恢复",
            checked: true,
            direction: "SUPPORTS",
            relevance: 0.74,
            likelihoodRatio: 1.9,
            confidence: 0.68,
            rationale: "订单恢复支持需求改善。"
          }
        ]
      }
    ]);
  });

  it("filters inactive hypotheses out of observation connection rows", () => {
    const createdAt = new Date("2026-06-11T00:00:00.000Z");
    const belief: BeliefRecord = {
      id: "belief_market",
      title: "市场判断",
      category: "INVESTMENT",
      description: "跟踪市场假设",
      probabilityMode: "INDEPENDENT",
      origin: "INTERNAL",
      status: "ACTIVE",
      createdAt: new Date("2026-06-10T00:00:00.000Z"),
      updatedAt: new Date("2026-06-10T00:00:00.000Z"),
      hypotheses: [
        {
          id: "hypothesis_active",
          beliefId: "belief_market",
          proposition: "订单恢复",
          notes: "",
          stance: "SUPPORTS",
          priorProbability: 0.45,
          currentProbability: 0.58,
          strength: 0.58,
          status: "ACTIVE",
          createdAt,
          updatedAt: createdAt
        },
        {
          id: "hypothesis_paused",
          beliefId: "belief_market",
          proposition: "订单恢复不可持续",
          notes: "",
          stance: "OPPOSES",
          priorProbability: 0.35,
          currentProbability: 0.31,
          strength: 0.31,
          status: "PAUSED",
          createdAt: new Date("2026-06-11T00:01:00.000Z"),
          updatedAt: createdAt
        }
      ]
    };
    const observation: ObservationRecord = {
      id: "observation_orders",
      title: "订单排产恢复",
      content: "多个来源显示订单排产恢复。",
      observedAt: new Date("2026-06-11T01:00:00.000Z"),
      status: "PENDING",
      credibility: 0.82,
      metadata: {
        recommendedLinks: [
          {
            hypothesisId: "hypothesis_active",
            direction: "SUPPORTS",
            relevance: 0.74,
            likelihoodRatio: 1.9,
            confidence: 0.68,
            rationale: "订单恢复支持需求改善。"
          },
          {
            hypothesisId: "hypothesis_paused",
            direction: "OPPOSES",
            relevance: 0.8,
            likelihoodRatio: 0.6,
            confidence: 0.62,
            rationale: "暂停假设不应作为确认目标。"
          }
        ]
      }
    };
    const editor = createWorldModelGraphEditorData({
      beliefs: [belief],
      observations: [observation],
      evidence: [],
      updates: []
    });

    expect(editor.observations[0].links.map((link) => link.hypothesisId)).toEqual(["hypothesis_active"]);
    expect(createObservationConnectionEditorRows(editor, "observation_orders", "hypothesis_active").map((row) => row.hypothesisId)).toEqual([
      "hypothesis_active"
    ]);
    expect(createObservationConnectionEditorRows(editor, "observation_orders", "hypothesis_paused")).toEqual([]);
  });

  it("builds multi-hypothesis rows when connecting an observation to one hypothesis in a belief group", () => {
    const createdAt = new Date("2026-06-11T00:00:00.000Z");
    const belief: BeliefRecord = {
      id: "belief_market",
      title: "市场判断",
      category: "INVESTMENT",
      description: "跟踪市场假设",
      probabilityMode: "INDEPENDENT",
      origin: "INTERNAL",
      status: "ACTIVE",
      createdAt: new Date("2026-06-10T00:00:00.000Z"),
      updatedAt: new Date("2026-06-10T00:00:00.000Z"),
      hypotheses: [
        {
          id: "hypothesis_support",
          beliefId: "belief_market",
          proposition: "订单恢复",
          notes: "",
          stance: "SUPPORTS",
          priorProbability: 0.45,
          currentProbability: 0.58,
          strength: 0.58,
          status: "ACTIVE",
          createdAt,
          updatedAt: createdAt
        },
        {
          id: "hypothesis_oppose",
          beliefId: "belief_market",
          proposition: "订单恢复不可持续",
          notes: "",
          stance: "OPPOSES",
          priorProbability: 0.35,
          currentProbability: 0.31,
          strength: 0.31,
          status: "ACTIVE",
          createdAt: new Date("2026-06-11T00:01:00.000Z"),
          updatedAt: createdAt
        }
      ]
    };
    const observation: ObservationRecord = {
      id: "observation_orders",
      title: "订单排产恢复",
      content: "多个来源显示订单排产恢复。",
      observedAt: new Date("2026-06-11T01:00:00.000Z"),
      status: "UNKNOWN",
      credibility: 0.82,
      metadata: {
        ignoredReason: "UNMATCHED"
      }
    };
    const editor = createWorldModelGraphEditorData({
      beliefs: [belief],
      observations: [observation],
      evidence: [],
      updates: []
    });

    expect(createObservationConnectionEditorRows(editor, "observation_orders", "hypothesis_support")).toEqual([
      expect.objectContaining({
        hypothesisId: "hypothesis_support",
        checked: true,
        direction: "SUPPORTS",
        likelihoodRatio: 1.5
      }),
      expect.objectContaining({
        hypothesisId: "hypothesis_oppose",
        checked: false,
        direction: "OPPOSES",
        likelihoodRatio: 0.67
      })
    ]);
  });

  it("builds update audit rows with evidence, belief, probability delta, and likelihood context", () => {
    const createdAt = new Date("2026-06-11T00:00:00.000Z");
    const belief: BeliefRecord = {
      id: "belief_agents",
      title: "Agent adoption",
      category: "AI_TREND",
      description: "Track agent adoption.",
      probabilityMode: "INDEPENDENT",
      origin: "INTERNAL",
      status: "ACTIVE",
      createdAt,
      updatedAt: createdAt,
      hypotheses: [
        {
          id: "hypothesis_signal",
          beliefId: "belief_agents",
          proposition: "Agents improve delivery",
          notes: "",
          stance: "SUPPORTS",
          priorProbability: 0.35,
          currentProbability: 0.62,
          strength: 0.62,
          status: "ACTIVE",
          createdAt,
          updatedAt: createdAt
        }
      ]
    };
    const evidence: EvidenceRecord = {
      id: "evidence_signal",
      observationId: "observation_signal",
      title: "Adoption evidence",
      content: "A high-quality adoption signal.",
      confirmedAt: new Date("2026-06-11T01:00:00.000Z"),
      confirmationMode: "AUTO",
      credibility: 0.82,
      status: "ACTIVE",
      metadata: {},
      links: [
        {
          id: "link_signal",
          evidenceId: "evidence_signal",
          hypothesisId: "hypothesis_signal",
          direction: "SUPPORTS",
          relevance: 0.9,
          likelihoodRatio: 2.4,
          confidence: 0.78,
          rationale: "The adoption signal directly supports delivery improvement.",
          createdAt
        }
      ]
    };
    const likelihoodRun: LikelihoodRunRecord = {
      id: "likelihood_run_3d6953b9-93f3-4121-8cb5-b53cb30af9d7",
      evidenceId: "evidence_signal",
      hypothesisId: "hypothesis_signal",
      ensembleLikelihoodRatio: 2.4,
      ensembleConfidence: 0.78,
      estimatorOutputs: [],
      modelVersion: "llm-v1",
      createdAt: new Date("2026-06-11T01:30:00.000Z")
    };
    const update: BayesianUpdateEventRecord = {
      id: "update_signal",
      beliefId: "belief_agents",
      evidenceId: "evidence_signal",
      likelihoodRunId: likelihoodRun.id,
      priorSnapshot: { hypothesis_signal: 0.35 },
      posteriorSnapshot: { hypothesis_signal: 0.62 },
      mode: "APPLIED",
      status: "APPLIED",
      confidence: 0.73,
      explanations: ["hypothesis_signal: The adoption signal increased the delivery hypothesis."],
      createdAt: new Date("2026-06-11T02:00:00.000Z")
    };
    const editor = createWorldModelGraphEditorData({ beliefs: [belief], evidence: [evidence], updates: [update], likelihoodRuns: [likelihoodRun] });

    expect(createUpdateAuditRows(editor, "update_signal")).toEqual({
      updateId: "update_signal",
      updateCode: "U-001",
      status: "APPLIED",
      confidence: 0.73,
      likelihoodRunId: likelihoodRun.id,
      likelihoodRunIds: undefined,
      likelihoodRunCode: "L-001",
      likelihoodRunCodes: ["L-001"],
      evidenceCode: "E-001",
      evidenceTitle: "Adoption evidence",
      evidenceStatus: "ACTIVE",
      beliefCode: "B-001",
      beliefTitle: "Agent adoption",
      explanations: ["H-001 · Agents improve delivery: The adoption signal increased the delivery hypothesis."],
      rows: [
        {
          hypothesisId: "hypothesis_signal",
          hypothesisCode: "H-001",
          proposition: "Agents improve delivery",
          prior: 0.35,
          posterior: 0.62,
          delta: 0.27,
          direction: "SUPPORTS",
          relevance: 0.9,
          likelihoodRatio: 2.4,
          linkConfidence: 0.78,
          rationale: "The adoption signal directly supports delivery improvement."
        }
      ]
    });
  });

  it("keeps deleted hypotheses readable in update audit rows without exposing raw ids", () => {
    const createdAt = new Date("2026-06-11T00:00:00.000Z");
    const missingHypothesisId = "hypothesis_3d6953b9-93f3-4121-8cb5-b53cb30af9d7";
    const belief: BeliefRecord = {
      id: "belief_agents",
      title: "Agent adoption",
      category: "AI_TREND",
      description: "Track agent adoption.",
      probabilityMode: "INDEPENDENT",
      origin: "INTERNAL",
      status: "ACTIVE",
      createdAt,
      updatedAt: createdAt,
      hypotheses: []
    };
    const evidence: EvidenceRecord = {
      id: "evidence_signal",
      observationId: "observation_signal",
      title: "Deleted hypothesis evidence",
      content: "This evidence used to update a hypothesis that no longer exists.",
      confirmedAt: new Date("2026-06-11T01:00:00.000Z"),
      confirmationMode: "AUTO",
      credibility: 0.82,
      status: "ACTIVE",
      metadata: {},
      links: [
        {
          id: "link_missing",
          evidenceId: "evidence_signal",
          hypothesisId: missingHypothesisId,
          direction: "SUPPORTS",
          relevance: 0.9,
          likelihoodRatio: 2.4,
          confidence: 0.78,
          rationale: "The original hypothesis was later removed.",
          createdAt
        }
      ]
    };
    const update: BayesianUpdateEventRecord = {
      id: "update_signal",
      beliefId: "belief_agents",
      evidenceId: "evidence_signal",
      priorSnapshot: { [missingHypothesisId]: 0.35 },
      posteriorSnapshot: { [missingHypothesisId]: 0.62 },
      mode: "APPLIED",
      status: "APPLIED",
      confidence: 0.73,
      explanations: [`${missingHypothesisId}: The removed hypothesis changed before deletion.`],
      createdAt: new Date("2026-06-11T02:00:00.000Z")
    };
    const editor = createWorldModelGraphEditorData({ beliefs: [belief], evidence: [evidence], updates: [update] });
    const audit = createUpdateAuditRows(editor, "update_signal");

    expect(audit?.explanations).toEqual(["H-? · 已删除假设: The removed hypothesis changed before deletion."]);
    expect(audit?.rows[0]).toMatchObject({
      hypothesisId: missingHypothesisId,
      hypothesisCode: "H-?",
      proposition: "已删除假设"
    });
    expect(JSON.stringify(audit)).not.toContain(`hypothesisCode":"${missingHypothesisId}`);
    expect(audit?.explanations.join("\n")).not.toContain(missingHypothesisId);
  });
});
