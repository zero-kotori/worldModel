import { createWorldModelGraph, focusWorldModelGraphData } from "@/lib/world-model-graph";
import type {
  BayesianUpdateEventRecord,
  BeliefRecord,
  EvidenceRecord,
  ObservationRecord,
  ObservationSourceRecord
} from "@/server/services/types";

describe("world model graph", () => {
  it("excludes archived belief subgraphs from the rendered graph", () => {
    const createdAt = new Date("2026-06-11T00:00:00.000Z");
    const activeBelief: BeliefRecord = {
      id: "belief_active",
      title: "Active belief",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      status: "ACTIVE",
      createdAt,
      updatedAt: createdAt,
      hypotheses: [
        {
          id: "hypothesis_active",
          beliefId: "belief_active",
          proposition: "Active hypothesis",
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
    };
    const archivedBelief: BeliefRecord = {
      ...activeBelief,
      id: "belief_archived",
      title: "Archived belief",
      status: "ARCHIVED",
      hypotheses: [
        {
          ...activeBelief.hypotheses[0],
          id: "hypothesis_archived_parent",
          beliefId: "belief_archived",
          proposition: "Archived parent hypothesis"
        }
      ]
    };
    const archivedObservation: ObservationRecord = {
      id: "observation_archived",
      title: "Archived belief observation",
      content: "Observation tied only to an archived belief.",
      observedAt: new Date("2026-06-11T01:00:00.000Z"),
      status: "CONFIRMED",
      credibility: 0.7,
      metadata: {}
    };
    const archivedEvidence: EvidenceRecord = {
      id: "evidence_archived",
      observationId: archivedObservation.id,
      title: "Archived belief evidence",
      content: "Evidence tied only to an archived belief.",
      confirmedAt: new Date("2026-06-11T02:00:00.000Z"),
      confirmationMode: "MANUAL",
      credibility: 0.7,
      status: "ACTIVE",
      metadata: {},
      links: [
        {
          id: "link_archived",
          evidenceId: "evidence_archived",
          hypothesisId: "hypothesis_archived_parent",
          direction: "SUPPORTS",
          relevance: 0.8,
          likelihoodRatio: 2,
          confidence: 0.7,
          rationale: "Archived belief evidence should not render.",
          createdAt
        }
      ]
    };
    const archivedUpdate: BayesianUpdateEventRecord = {
      id: "update_archived",
      beliefId: archivedBelief.id,
      evidenceId: archivedEvidence.id,
      priorSnapshot: { hypothesis_archived_parent: 0.4 },
      posteriorSnapshot: { hypothesis_archived_parent: 0.6 },
      mode: "APPLIED",
      status: "APPLIED",
      confidence: 0.7,
      explanations: [],
      createdAt
    };

    const graph = createWorldModelGraph({
      beliefs: [activeBelief, archivedBelief],
      observations: [archivedObservation],
      evidence: [archivedEvidence],
      updates: [archivedUpdate]
    });
    const nodeIds = graph.nodes.map((node) => node.id);

    expect(nodeIds).toContain("belief_active");
    expect(nodeIds).toContain("hypothesis_active");
    expect(nodeIds).not.toContain("belief_archived");
    expect(nodeIds).not.toContain("hypothesis_archived_parent");
    expect(nodeIds).not.toContain("observation_archived");
    expect(nodeIds).not.toContain("evidence_archived");
    expect(nodeIds).not.toContain("update_archived");
    expect(graph.edges.every((edge) => nodeIds.includes(edge.source) && nodeIds.includes(edge.target))).toBe(true);
  });

  it("excludes archived hypotheses while keeping visible sibling evidence links", () => {
    const createdAt = new Date("2026-06-11T00:00:00.000Z");
    const belief: BeliefRecord = {
      id: "belief_mixed",
      title: "Mixed hypothesis belief",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      status: "ACTIVE",
      createdAt,
      updatedAt: createdAt,
      hypotheses: [
        {
          id: "hypothesis_visible",
          beliefId: "belief_mixed",
          proposition: "Visible hypothesis",
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
          id: "hypothesis_archived",
          beliefId: "belief_mixed",
          proposition: "Archived hypothesis",
          notes: "",
          stance: "SUPPORTS",
          priorProbability: 0.4,
          currentProbability: 0.4,
          strength: 0.4,
          status: "ARCHIVED",
          createdAt,
          updatedAt: createdAt
        }
      ]
    };
    const observation: ObservationRecord = {
      id: "observation_mixed",
      title: "Mixed evidence observation",
      content: "Observation confirmed into evidence.",
      observedAt: new Date("2026-06-11T01:00:00.000Z"),
      status: "CONFIRMED",
      credibility: 0.8,
      metadata: {
        recommendedLinks: [
          { hypothesisId: "hypothesis_archived", direction: "SUPPORTS", relevance: 0.9, likelihoodRatio: 2.2 }
        ]
      }
    };
    const evidence: EvidenceRecord = {
      id: "evidence_mixed",
      observationId: observation.id,
      title: "Mixed evidence",
      content: "Evidence has one visible and one archived link.",
      confirmedAt: new Date("2026-06-11T02:00:00.000Z"),
      confirmationMode: "MANUAL",
      credibility: 0.8,
      status: "ACTIVE",
      metadata: {},
      links: [
        {
          id: "link_visible",
          evidenceId: "evidence_mixed",
          hypothesisId: "hypothesis_visible",
          direction: "SUPPORTS",
          relevance: 0.8,
          likelihoodRatio: 2,
          confidence: 0.7,
          rationale: "Visible link.",
          createdAt
        },
        {
          id: "link_archived",
          evidenceId: "evidence_mixed",
          hypothesisId: "hypothesis_archived",
          direction: "SUPPORTS",
          relevance: 0.8,
          likelihoodRatio: 2,
          confidence: 0.7,
          rationale: "Archived link.",
          createdAt
        }
      ]
    };

    const graph = createWorldModelGraph({ beliefs: [belief], observations: [observation], evidence: [evidence], updates: [] });
    const nodeIds = graph.nodes.map((node) => node.id);

    expect(nodeIds).toContain("hypothesis_visible");
    expect(nodeIds).toContain("evidence_mixed");
    expect(nodeIds).not.toContain("hypothesis_archived");
    expect(graph.edges.filter((edge) => edge.relation === "INFLUENCES").map((edge) => edge.target)).toEqual(["hypothesis_visible"]);
    expect(graph.edges.filter((edge) => edge.relation === "CANDIDATE")).toEqual([]);
    expect(graph.edges.every((edge) => nodeIds.includes(edge.source) && nodeIds.includes(edge.target))).toBe(true);
  });

  it("excludes rejected observations and deleted evidence from the rendered graph", () => {
    const createdAt = new Date("2026-06-11T00:00:00.000Z");
    const belief: BeliefRecord = {
      id: "belief_cleanup",
      title: "Cleanup belief",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      status: "ACTIVE",
      createdAt,
      updatedAt: createdAt,
      hypotheses: [
        {
          id: "hypothesis_cleanup",
          beliefId: "belief_cleanup",
          proposition: "Cleanup hypothesis",
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
    };
    const rejectedObservation: ObservationRecord = {
      id: "observation_rejected",
      title: "Rejected observation",
      content: "Rejected observation content.",
      observedAt: new Date("2026-06-11T01:00:00.000Z"),
      status: "REJECTED",
      credibility: 0.7,
      metadata: {
        recommendedLinks: [{ hypothesisId: "hypothesis_cleanup", direction: "SUPPORTS", relevance: 0.8, likelihoodRatio: 2 }]
      }
    };
    const deletedEvidence: EvidenceRecord = {
      id: "evidence_deleted",
      observationId: "observation_deleted",
      title: "Deleted evidence",
      content: "Deleted evidence content.",
      confirmedAt: new Date("2026-06-11T02:00:00.000Z"),
      confirmationMode: "MANUAL",
      credibility: 0.8,
      status: "DELETED",
      metadata: {},
      links: [
        {
          id: "link_deleted",
          evidenceId: "evidence_deleted",
          hypothesisId: "hypothesis_cleanup",
          direction: "SUPPORTS",
          relevance: 0.8,
          likelihoodRatio: 2,
          confidence: 0.7,
          rationale: "Deleted evidence should not render.",
          createdAt
        }
      ]
    };

    const graph = createWorldModelGraph({
      beliefs: [belief],
      observations: [rejectedObservation],
      evidence: [deletedEvidence],
      updates: []
    });
    const nodeIds = graph.nodes.map((node) => node.id);

    expect(nodeIds).not.toContain("observation_rejected");
    expect(nodeIds).not.toContain("evidence_deleted");
    expect(graph.edges.every((edge) => nodeIds.includes(edge.source) && nodeIds.includes(edge.target))).toBe(true);
  });

  it("includes source and confirmed observation provenance for evidence", () => {
    const createdAt = new Date("2026-06-11T00:00:00.000Z");
    const source: ObservationSourceRecord = {
      id: "source_news",
      name: "News source",
      kind: "WEB_PAGE",
      adapter: "web_page",
      credibility: 0.7,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.8,
      createdAt,
      updatedAt: createdAt
    };
    const belief: BeliefRecord = {
      id: "belief_signal",
      title: "AI adoption",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      status: "ACTIVE",
      createdAt,
      updatedAt: createdAt,
      hypotheses: [
        {
          id: "hypothesis_signal",
          beliefId: "belief_signal",
          proposition: "AI adoption accelerates",
          notes: "",
          stance: "SUPPORTS",
          priorProbability: 0.35,
          currentProbability: 0.35,
          strength: 0.35,
          status: "ACTIVE",
          createdAt,
          updatedAt: createdAt
        }
      ]
    };
    const observation: ObservationRecord = {
      id: "observation_confirmed",
      sourceId: source.id,
      title: "Confirmed source observation",
      content: "Confirmed source observation content.",
      observedAt: new Date("2026-06-11T01:00:00.000Z"),
      status: "CONFIRMED",
      credibility: 0.7,
      metadata: {}
    };
    const evidence: EvidenceRecord = {
      id: "evidence_signal",
      observationId: observation.id,
      title: "Confirmed evidence",
      content: "Confirmed evidence content.",
      confirmedAt: new Date("2026-06-11T02:00:00.000Z"),
      confirmationMode: "AUTO",
      credibility: 0.7,
      status: "ACTIVE",
      metadata: {},
      links: [
        {
          id: "link_signal",
          evidenceId: "evidence_signal",
          hypothesisId: "hypothesis_signal",
          direction: "SUPPORTS",
          relevance: 0.8,
          likelihoodRatio: 2,
          confidence: 0.7,
          rationale: "Confirmed source evidence supports adoption.",
          createdAt
        }
      ]
    };

    const graph = createWorldModelGraph({
      sources: [source],
      beliefs: [belief],
      observations: [observation],
      evidence: [evidence],
      updates: []
    });

    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "source_news", type: "source", code: "S-001", label: "News source" }),
        expect.objectContaining({ id: "observation_confirmed", type: "observation", status: "CONFIRMED" })
      ])
    );
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "source_news",
          target: "observation_confirmed",
          relation: "COLLECTED",
          label: "采集观察"
        }),
        expect.objectContaining({
          source: "observation_confirmed",
          target: "evidence_signal",
          relation: "CONFIRMED_AS",
          label: "确认为证据"
        }),
        expect.objectContaining({
          source: "evidence_signal",
          target: "hypothesis_signal",
          relation: "INFLUENCES"
        })
      ])
    );
  });

  it("focuses graph source data to one observation source and keeps its downstream impact", () => {
    const createdAt = new Date("2026-06-11T00:00:00.000Z");
    const focusedSource: ObservationSourceRecord = {
      id: "source_news",
      name: "News source",
      kind: "WEB_PAGE",
      adapter: "web_page",
      credibility: 0.8,
      enabled: true,
      autoConfirm: true,
      autoConfirmThreshold: 0.8,
      createdAt,
      updatedAt: createdAt
    };
    const otherSource: ObservationSourceRecord = {
      ...focusedSource,
      id: "source_other",
      name: "Other source",
      createdAt: new Date("2026-06-11T00:01:00.000Z")
    };
    const belief: BeliefRecord = {
      id: "belief_focus",
      title: "Focused belief",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      status: "ACTIVE",
      createdAt,
      updatedAt: createdAt,
      hypotheses: [
        {
          id: "hypothesis_focus",
          beliefId: "belief_focus",
          proposition: "Focused source signal matters",
          notes: "",
          stance: "SUPPORTS",
          priorProbability: 0.45,
          currentProbability: 0.55,
          strength: 0.55,
          status: "ACTIVE",
          createdAt,
          updatedAt: createdAt
        }
      ]
    };
    const otherBelief: BeliefRecord = {
      ...belief,
      id: "belief_other",
      title: "Other belief",
      hypotheses: [
        {
          ...belief.hypotheses[0],
          id: "hypothesis_other",
          beliefId: "belief_other",
          proposition: "Other source signal matters"
        }
      ]
    };
    const focusedObservation: ObservationRecord = {
      id: "observation_focus",
      sourceId: focusedSource.id,
      title: "Focused source observation",
      content: "Observation collected from the focused source.",
      observedAt: new Date("2026-06-11T01:00:00.000Z"),
      status: "CONFIRMED",
      credibility: 0.8,
      metadata: {}
    };
    const otherObservation: ObservationRecord = {
      ...focusedObservation,
      id: "observation_other",
      sourceId: otherSource.id,
      title: "Other source observation"
    };
    const focusedEvidence: EvidenceRecord = {
      id: "evidence_focus",
      observationId: focusedObservation.id,
      title: "Focused source evidence",
      content: "Evidence confirmed from the focused source.",
      confirmedAt: new Date("2026-06-11T02:00:00.000Z"),
      confirmationMode: "AUTO",
      credibility: 0.8,
      status: "ACTIVE",
      metadata: {},
      links: [
        {
          id: "link_focus",
          evidenceId: "evidence_focus",
          hypothesisId: "hypothesis_focus",
          direction: "SUPPORTS",
          relevance: 0.9,
          likelihoodRatio: 2.1,
          confidence: 0.75,
          rationale: "Focused source evidence supports the hypothesis.",
          createdAt
        }
      ]
    };
    const otherEvidence: EvidenceRecord = {
      ...focusedEvidence,
      id: "evidence_other",
      observationId: otherObservation.id,
      title: "Other source evidence",
      links: [{ ...focusedEvidence.links[0], id: "link_other", evidenceId: "evidence_other", hypothesisId: "hypothesis_other" }]
    };
    const focusedUpdate: BayesianUpdateEventRecord = {
      id: "update_focus",
      beliefId: "belief_focus",
      evidenceId: focusedEvidence.id,
      priorSnapshot: { hypothesis_focus: 0.45 },
      posteriorSnapshot: { hypothesis_focus: 0.55 },
      mode: "APPLIED",
      status: "APPLIED",
      confidence: 0.75,
      explanations: [],
      createdAt
    };
    const otherUpdate: BayesianUpdateEventRecord = {
      ...focusedUpdate,
      id: "update_other",
      beliefId: "belief_other",
      evidenceId: otherEvidence.id,
      priorSnapshot: { hypothesis_other: 0.45 },
      posteriorSnapshot: { hypothesis_other: 0.35 }
    };

    const focused = focusWorldModelGraphData(
      {
        sources: [focusedSource, otherSource],
        beliefs: [belief, otherBelief],
        observations: [focusedObservation, otherObservation],
        evidence: [focusedEvidence, otherEvidence],
        updates: [focusedUpdate, otherUpdate]
      },
      { sourceId: "source_news" }
    );
    const graph = createWorldModelGraph(focused, {
      sources: [focusedSource, otherSource],
      beliefs: [belief, otherBelief],
      observations: [focusedObservation, otherObservation],
      evidence: [focusedEvidence, otherEvidence],
      updates: [focusedUpdate, otherUpdate]
    });

    expect(focused.sources?.map((source) => source.id)).toEqual(["source_news"]);
    expect(focused.observations?.map((observation) => observation.id)).toEqual(["observation_focus"]);
    expect(focused.evidence.map((evidence) => evidence.id)).toEqual(["evidence_focus"]);
    expect(focused.beliefs.map((item) => item.id)).toEqual(["belief_focus"]);
    expect(focused.updates.map((event) => event.id)).toEqual(["update_focus"]);
    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "source_news", type: "source", code: "S-001" }),
        expect.objectContaining({ id: "observation_focus", type: "observation" }),
        expect.objectContaining({ id: "evidence_focus", type: "evidence" }),
        expect.objectContaining({ id: "hypothesis_focus", type: "hypothesis" })
      ])
    );
    expect(graph.nodes.map((node) => node.id)).not.toContain("source_other");
    expect(graph.nodes.map((node) => node.id)).not.toContain("evidence_other");
  });

  it("keeps an explicitly focused source visible even before it has graphable observations", () => {
    const createdAt = new Date("2026-06-11T00:00:00.000Z");
    const source: ObservationSourceRecord = {
      id: "source_empty",
      name: "Empty source",
      kind: "WEB_PAGE",
      adapter: "web_page",
      credibility: 0.7,
      enabled: true,
      autoConfirm: false,
      autoConfirmThreshold: 0.8,
      createdAt,
      updatedAt: createdAt
    };

    const focused = focusWorldModelGraphData(
      {
        sources: [source],
        beliefs: [],
        observations: [],
        evidence: [],
        updates: []
      },
      { sourceId: "source_empty" }
    );
    const graph = createWorldModelGraph(focused);

    expect(graph.nodes).toEqual([expect.objectContaining({ id: "source_empty", type: "source", code: "S-001" })]);
  });

  it("includes reviewable observations and their candidate hypothesis links", () => {
    const createdAt = new Date("2026-06-11T00:00:00.000Z");
    const belief: BeliefRecord = {
      id: "belief_automation",
      title: "AI adoption",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      status: "ACTIVE",
      createdAt,
      updatedAt: createdAt,
      hypotheses: [
        {
          id: "hypothesis_delay",
          beliefId: "belief_automation",
          proposition: "Procurement delays slow adoption",
          notes: "",
          stance: "OPPOSES",
          priorProbability: 0.35,
          currentProbability: 0.35,
          strength: 0.35,
          status: "ACTIVE",
          createdAt,
          updatedAt: createdAt
        }
      ]
    };
    const observation: ObservationRecord = {
      id: "observation_delay",
      title: "Governance procurement delays",
      content: "Governance procurement delays slow adoption.",
      observedAt: new Date("2026-06-11T01:00:00.000Z"),
      status: "PENDING",
      credibility: 0.8,
      metadata: {
        recommendedLinks: [
          {
            hypothesisId: "hypothesis_delay",
            direction: "SUPPORTS",
            relevance: 0.7,
            likelihoodRatio: 1.8,
            confidence: 0.65,
            rationale: "The observation maps to procurement delay risk."
          }
        ]
      }
    };

    const graph = createWorldModelGraph({ beliefs: [belief], observations: [observation], evidence: [], updates: [] });

    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "observation_delay",
          type: "observation",
          code: "O-001",
          label: "Governance procurement delays",
          status: "PENDING",
          credibility: 0.8
        })
      ])
    );
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "observation_delay",
          target: "hypothesis_delay",
          relation: "CANDIDATE",
          direction: "SUPPORTS",
          relevance: 0.7,
          likelihoodRatio: 1.8,
          status: "PENDING"
        })
      ])
    );
  });

  it("does not create candidate observation edges to inactive hypotheses", () => {
    const createdAt = new Date("2026-06-11T00:00:00.000Z");
    const belief: BeliefRecord = {
      id: "belief_automation",
      title: "AI adoption",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      status: "ACTIVE",
      createdAt,
      updatedAt: createdAt,
      hypotheses: [
        {
          id: "hypothesis_active",
          beliefId: "belief_automation",
          proposition: "Active adoption hypothesis",
          notes: "",
          stance: "SUPPORTS",
          priorProbability: 0.45,
          currentProbability: 0.45,
          strength: 0.45,
          status: "ACTIVE",
          createdAt,
          updatedAt: createdAt
        },
        {
          id: "hypothesis_paused",
          beliefId: "belief_automation",
          proposition: "Paused adoption hypothesis",
          notes: "",
          stance: "SUPPORTS",
          priorProbability: 0.35,
          currentProbability: 0.35,
          strength: 0.35,
          status: "PAUSED",
          createdAt: new Date("2026-06-11T00:01:00.000Z"),
          updatedAt: createdAt
        }
      ]
    };
    const observation: ObservationRecord = {
      id: "observation_signal",
      title: "Adoption signal",
      content: "A signal mentions both adoption hypotheses.",
      observedAt: new Date("2026-06-11T01:00:00.000Z"),
      status: "PENDING",
      credibility: 0.8,
      metadata: {
        recommendedLinks: [
          {
            hypothesisId: "hypothesis_active",
            direction: "SUPPORTS",
            relevance: 0.7,
            likelihoodRatio: 1.8,
            confidence: 0.65,
            rationale: "Active target."
          },
          {
            hypothesisId: "hypothesis_paused",
            direction: "SUPPORTS",
            relevance: 0.9,
            likelihoodRatio: 2.2,
            confidence: 0.72,
            rationale: "Paused target."
          }
        ]
      }
    };

    const graph = createWorldModelGraph({ beliefs: [belief], observations: [observation], evidence: [], updates: [] });

    expect(graph.edges.filter((edge) => edge.relation === "CANDIDATE").map((edge) => edge.target)).toEqual(["hypothesis_active"]);
  });

  it("keeps settled observations linked to their resolved hypothesis as audit provenance", () => {
    const createdAt = new Date("2026-06-11T00:00:00.000Z");
    const belief: BeliefRecord = {
      id: "belief_settlement",
      title: "Rollout settlement",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      status: "ACTIVE",
      createdAt,
      updatedAt: createdAt,
      hypotheses: [
        {
          id: "hypothesis_rollout",
          beliefId: "belief_settlement",
          proposition: "The rollout reaches production",
          notes: "",
          stance: "SUPPORTS",
          priorProbability: 0.42,
          currentProbability: 0,
          strength: 0,
          status: "RESOLVED_FALSE",
          resolvedOutcome: "The rollout did not reach production.",
          createdAt,
          updatedAt: createdAt
        }
      ]
    };
    const observation: ObservationRecord = {
      id: "observation_settlement",
      title: "Final rollout result",
      content: "The rollout did not reach production.",
      observedAt: new Date("2026-06-11T01:00:00.000Z"),
      status: "SETTLED",
      credibility: 0.82,
      metadata: {
        reviewReason: "SETTLEMENT_REVIEW",
        settlementResolved: true,
        settlementOutcome: "RESOLVED_FALSE",
        settlementResolvedHypothesisId: "hypothesis_rollout",
        settlementResolvedOutcome: "The rollout did not reach production."
      }
    };

    const focused = focusWorldModelGraphData(
      { beliefs: [belief], observations: [observation], evidence: [], updates: [] },
      { hypothesisId: "hypothesis_rollout" }
    );
    const graph = createWorldModelGraph(focused, { beliefs: [belief], observations: [observation], evidence: [], updates: [] });

    expect(focused.observations?.map((item) => item.id)).toEqual(["observation_settlement"]);
    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "observation_settlement", type: "observation", status: "SETTLED", code: "O-001" }),
        expect.objectContaining({ id: "hypothesis_rollout", type: "hypothesis", status: "RESOLVED_FALSE" })
      ])
    );
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "observation_settlement",
          target: "hypothesis_rollout",
          relation: "SETTLED",
          label: "结算为未发生",
          status: "SETTLED"
        })
      ])
    );
  });

  it("keeps rejected evidence influence edges as grey audit relationships", () => {
    const createdAt = new Date("2026-06-11T00:00:00.000Z");
    const belief: BeliefRecord = {
      id: "belief_evidence",
      title: "Evidence quality",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      status: "ACTIVE",
      createdAt,
      updatedAt: createdAt,
      hypotheses: [
        {
          id: "hypothesis_quality",
          beliefId: "belief_evidence",
          proposition: "Quality evidence should move beliefs",
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
    };
    const activeEvidence: EvidenceRecord = {
      id: "evidence_active",
      observationId: "observation_active",
      title: "Active evidence",
      content: "Evidence that remains valid.",
      confirmedAt: new Date("2026-06-11T01:00:00.000Z"),
      confirmationMode: "MANUAL",
      credibility: 0.8,
      status: "ACTIVE",
      metadata: {},
      links: [
        {
          id: "link_active",
          evidenceId: "evidence_active",
          hypothesisId: "hypothesis_quality",
          direction: "SUPPORTS",
          relevance: 0.8,
          likelihoodRatio: 2,
          confidence: 0.7,
          rationale: "Active evidence supports the hypothesis.",
          createdAt
        }
      ]
    };
    const rejectedEvidence: EvidenceRecord = {
      ...activeEvidence,
      id: "evidence_rejected",
      observationId: "observation_rejected",
      title: "Rejected evidence",
      status: "REJECTED",
      links: [
        {
          ...activeEvidence.links[0],
          id: "link_rejected",
          evidenceId: "evidence_rejected"
        }
      ]
    };

    const graph = createWorldModelGraph({
      beliefs: [belief],
      observations: [],
      evidence: [activeEvidence, rejectedEvidence],
      updates: []
    });

    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "evidence_rejected", type: "evidence", status: "REJECTED" })
      ])
    );
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "evidence_active",
          target: "hypothesis_quality",
          relation: "INFLUENCES",
          status: "ACTIVE",
          label: "SUPPORTS · 相关性 0.80 · LR 2.00"
        }),
        expect.objectContaining({
          source: "evidence_rejected",
          target: "hypothesis_quality",
          relation: "INFLUENCES",
          status: "REJECTED",
          label: "已拒绝 · SUPPORTS · 相关性 0.80 · LR 2.00"
        })
      ])
    );
  });

  it("focuses graph source data to one belief and trims cross-belief evidence links", () => {
    const createdAt = new Date("2026-06-11T00:00:00.000Z");
    const selectedBelief: BeliefRecord = {
      id: "belief_focus",
      title: "Focused belief",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      status: "ACTIVE",
      createdAt,
      updatedAt: createdAt,
      hypotheses: [
        {
          id: "hypothesis_focus",
          beliefId: "belief_focus",
          proposition: "Focused hypothesis",
          notes: "",
          stance: "SUPPORTS",
          priorProbability: 0.45,
          currentProbability: 0.55,
          strength: 0.55,
          status: "ACTIVE",
          createdAt,
          updatedAt: createdAt
        }
      ]
    };
    const otherBelief: BeliefRecord = {
      ...selectedBelief,
      id: "belief_other",
      title: "Other belief",
      hypotheses: [
        {
          ...selectedBelief.hypotheses[0],
          id: "hypothesis_other",
          beliefId: "belief_other",
          proposition: "Other hypothesis"
        }
      ]
    };
    const candidateObservation: ObservationRecord = {
      id: "observation_focus",
      title: "Focused candidate observation",
      content: "Observation linked to the focused hypothesis.",
      observedAt: new Date("2026-06-11T01:00:00.000Z"),
      status: "PENDING",
      credibility: 0.75,
      metadata: {
        recommendedLinks: [
          {
            hypothesisId: "hypothesis_focus",
            direction: "SUPPORTS",
            relevance: 0.8,
            likelihoodRatio: 1.9
          }
        ]
      }
    };
    const otherObservation: ObservationRecord = {
      ...candidateObservation,
      id: "observation_other",
      title: "Other candidate observation",
      metadata: {
        recommendedLinks: [
          {
            hypothesisId: "hypothesis_other",
            direction: "SUPPORTS",
            relevance: 0.8,
            likelihoodRatio: 1.9
          }
        ]
      }
    };
    const crossEvidence: EvidenceRecord = {
      id: "evidence_cross",
      observationId: "observation_confirmed",
      title: "Cross belief evidence",
      content: "Evidence linked to hypotheses from multiple beliefs.",
      confirmedAt: new Date("2026-06-11T02:00:00.000Z"),
      confirmationMode: "AUTO",
      credibility: 0.8,
      status: "ACTIVE",
      metadata: {},
      links: [
        {
          id: "link_focus",
          evidenceId: "evidence_cross",
          hypothesisId: "hypothesis_focus",
          direction: "SUPPORTS",
          relevance: 0.9,
          likelihoodRatio: 2.1,
          confidence: 0.7,
          rationale: "Focused link.",
          createdAt
        },
        {
          id: "link_other",
          evidenceId: "evidence_cross",
          hypothesisId: "hypothesis_other",
          direction: "OPPOSES",
          relevance: 0.5,
          likelihoodRatio: 0.7,
          confidence: 0.6,
          rationale: "Other link.",
          createdAt
        }
      ]
    };
    const unrelatedEvidence: EvidenceRecord = {
      ...crossEvidence,
      id: "evidence_other",
      title: "Other evidence",
      links: [{ ...crossEvidence.links[1], id: "link_other_only", evidenceId: "evidence_other" }]
    };
    const selectedUpdate: BayesianUpdateEventRecord = {
      id: "update_focus",
      beliefId: "belief_focus",
      evidenceId: "evidence_cross",
      priorSnapshot: { hypothesis_focus: 0.45 },
      posteriorSnapshot: { hypothesis_focus: 0.55 },
      mode: "APPLIED",
      status: "APPLIED",
      confidence: 0.7,
      explanations: [],
      createdAt
    };
    const otherUpdate: BayesianUpdateEventRecord = {
      ...selectedUpdate,
      id: "update_other",
      beliefId: "belief_other",
      evidenceId: "evidence_other",
      priorSnapshot: { hypothesis_other: 0.4 },
      posteriorSnapshot: { hypothesis_other: 0.3 }
    };

    const focused = focusWorldModelGraphData(
      {
        beliefs: [selectedBelief, otherBelief],
        observations: [candidateObservation, otherObservation],
        evidence: [crossEvidence, unrelatedEvidence],
        updates: [selectedUpdate, otherUpdate]
      },
      "belief_focus"
    );

    expect(focused.beliefs.map((belief) => belief.id)).toEqual(["belief_focus"]);
    expect(focused.observations?.map((observation) => observation.id)).toEqual(["observation_focus"]);
    expect(focused.evidence.map((evidence) => evidence.id)).toEqual(["evidence_cross"]);
    expect(focused.evidence[0].links.map((link) => link.hypothesisId)).toEqual(["hypothesis_focus"]);
    expect(focused.updates.map((event) => event.id)).toEqual(["update_focus"]);
  });

  it("focuses graph source data to one update event and trims unrelated evidence links", () => {
    const createdAt = new Date("2026-06-11T00:00:00.000Z");
    const selectedBelief: BeliefRecord = {
      id: "belief_focus",
      title: "Focused belief",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      status: "ACTIVE",
      createdAt,
      updatedAt: createdAt,
      hypotheses: [
        {
          id: "hypothesis_focus",
          beliefId: "belief_focus",
          proposition: "Focused hypothesis",
          notes: "",
          stance: "SUPPORTS",
          priorProbability: 0.45,
          currentProbability: 0.55,
          strength: 0.55,
          status: "ACTIVE",
          createdAt,
          updatedAt: createdAt
        }
      ]
    };
    const otherBelief: BeliefRecord = {
      ...selectedBelief,
      id: "belief_other",
      title: "Other belief",
      hypotheses: [
        {
          ...selectedBelief.hypotheses[0],
          id: "hypothesis_other",
          beliefId: "belief_other",
          proposition: "Other hypothesis"
        }
      ]
    };
    const observation: ObservationRecord = {
      id: "observation_shared",
      title: "Shared observation",
      content: "Observation later confirmed as shared evidence.",
      observedAt: new Date("2026-06-11T01:00:00.000Z"),
      status: "CONFIRMED",
      credibility: 0.75,
      metadata: {}
    };
    const sharedEvidence: EvidenceRecord = {
      id: "evidence_shared",
      observationId: "observation_shared",
      title: "Shared evidence",
      content: "Evidence linked to two beliefs.",
      confirmedAt: new Date("2026-06-11T02:00:00.000Z"),
      confirmationMode: "AUTO",
      credibility: 0.8,
      status: "ACTIVE",
      metadata: {},
      links: [
        {
          id: "link_focus",
          evidenceId: "evidence_shared",
          hypothesisId: "hypothesis_focus",
          direction: "SUPPORTS",
          relevance: 0.9,
          likelihoodRatio: 2.1,
          confidence: 0.7,
          rationale: "Focused link.",
          createdAt
        },
        {
          id: "link_other",
          evidenceId: "evidence_shared",
          hypothesisId: "hypothesis_other",
          direction: "OPPOSES",
          relevance: 0.5,
          likelihoodRatio: 0.7,
          confidence: 0.6,
          rationale: "Other link.",
          createdAt
        }
      ]
    };
    const selectedUpdate: BayesianUpdateEventRecord = {
      id: "update_focus",
      beliefId: "belief_focus",
      evidenceId: "evidence_shared",
      priorSnapshot: { hypothesis_focus: 0.45 },
      posteriorSnapshot: { hypothesis_focus: 0.55 },
      mode: "APPLIED",
      status: "APPLIED",
      confidence: 0.7,
      explanations: [],
      createdAt
    };
    const otherUpdate: BayesianUpdateEventRecord = {
      ...selectedUpdate,
      id: "update_other",
      beliefId: "belief_other",
      priorSnapshot: { hypothesis_other: 0.4 },
      posteriorSnapshot: { hypothesis_other: 0.3 }
    };

    const fullData = {
      beliefs: [selectedBelief, otherBelief],
      observations: [observation],
      evidence: [sharedEvidence],
      updates: [selectedUpdate, otherUpdate]
    };
    const focused = focusWorldModelGraphData(fullData, { updateId: "update_other" });
    const graph = createWorldModelGraph(focused, fullData);

    expect(focused.beliefs.map((belief) => belief.id)).toEqual(["belief_other"]);
    expect(focused.observations?.map((item) => item.id)).toEqual(["observation_shared"]);
    expect(focused.evidence.map((item) => item.id)).toEqual(["evidence_shared"]);
    expect(focused.evidence[0].links.map((link) => link.hypothesisId)).toEqual(["hypothesis_other"]);
    expect(focused.updates.map((event) => event.id)).toEqual(["update_other"]);
    expect(graph.nodes.find((node) => node.id === "update_other")?.code).toBe("U-002");
  });

  it("focuses graph source data to one hypothesis and trims sibling hypothesis links", () => {
    const createdAt = new Date("2026-06-11T00:00:00.000Z");
    const belief: BeliefRecord = {
      id: "belief_focus",
      title: "Focused belief",
      category: "AI_TREND",
      description: "",
      probabilityMode: "INDEPENDENT",
      status: "ACTIVE",
      createdAt,
      updatedAt: createdAt,
      hypotheses: [
        {
          id: "hypothesis_focus",
          beliefId: "belief_focus",
          proposition: "Focused hypothesis",
          notes: "",
          stance: "SUPPORTS",
          priorProbability: 0.45,
          currentProbability: 0.55,
          strength: 0.55,
          status: "ACTIVE",
          createdAt,
          updatedAt: createdAt
        },
        {
          id: "hypothesis_sibling",
          beliefId: "belief_focus",
          proposition: "Sibling hypothesis",
          notes: "",
          stance: "OPPOSES",
          priorProbability: 0.35,
          currentProbability: 0.35,
          strength: 0.35,
          status: "ACTIVE",
          createdAt,
          updatedAt: createdAt
        }
      ]
    };
    const evidence: EvidenceRecord = {
      id: "evidence_shared",
      observationId: "observation_shared",
      title: "Shared evidence",
      content: "Evidence linked to two hypotheses.",
      confirmedAt: new Date("2026-06-11T02:00:00.000Z"),
      confirmationMode: "AUTO",
      credibility: 0.8,
      status: "ACTIVE",
      metadata: {},
      links: [
        {
          id: "link_focus",
          evidenceId: "evidence_shared",
          hypothesisId: "hypothesis_focus",
          direction: "SUPPORTS",
          relevance: 0.9,
          likelihoodRatio: 2.1,
          confidence: 0.7,
          rationale: "Focused link.",
          createdAt
        },
        {
          id: "link_sibling",
          evidenceId: "evidence_shared",
          hypothesisId: "hypothesis_sibling",
          direction: "OPPOSES",
          relevance: 0.5,
          likelihoodRatio: 0.7,
          confidence: 0.6,
          rationale: "Sibling link.",
          createdAt
        }
      ]
    };
    const update: BayesianUpdateEventRecord = {
      id: "update_focus",
      beliefId: "belief_focus",
      evidenceId: "evidence_shared",
      priorSnapshot: { hypothesis_focus: 0.45 },
      posteriorSnapshot: { hypothesis_focus: 0.55 },
      mode: "APPLIED",
      status: "APPLIED",
      confidence: 0.7,
      explanations: [],
      createdAt
    };

    const focused = focusWorldModelGraphData(
      {
        beliefs: [belief],
        observations: [],
        evidence: [evidence],
        updates: [update]
      },
      { hypothesisId: "hypothesis_focus" }
    );

    expect(focused.beliefs[0].hypotheses.map((hypothesis) => hypothesis.id)).toEqual(["hypothesis_focus"]);
    expect(focused.evidence.map((item) => item.id)).toEqual(["evidence_shared"]);
    expect(focused.evidence[0].links.map((link) => link.hypothesisId)).toEqual(["hypothesis_focus"]);
    expect(focused.updates.map((event) => event.id)).toEqual(["update_focus"]);
  });
});
