import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { vi } from "vitest";

const loadWorldModelData = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("@/app/admin/world-model/data", () => ({
  loadWorldModelData
}));

function emptyWorldModelData() {
  return {
    error: undefined,
    beliefs: [],
    observations: [],
    evidence: [],
    sources: [],
    runs: [],
    heartbeats: [],
    workerConfigs: [],
    workerRuntime: [],
    models: [],
    updates: []
  };
}

function activeBeliefWithHypothesis() {
  const createdAt = new Date("2026-06-11T00:00:00.000Z");
  return {
    id: "belief_ai_agents",
    title: "AI agents",
    category: "AI_TREND",
    description: "",
    probabilityMode: "INDEPENDENT",
    status: "ACTIVE",
    createdAt,
    updatedAt: createdAt,
    hypotheses: [
      {
        id: "hypothesis_agents",
        beliefId: "belief_ai_agents",
        proposition: "AI agents improve delivery",
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
}

describe("world model sources page", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { React: typeof React }).React = React;
    loadWorldModelData.mockReset();
  });

  it("offers a one-click auto-apply evidence loop entry", async () => {
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      beliefs: [activeBeliefWithHypothesis()]
    });
    const { default: SourcesPage } = await import("@/app/admin/world-model/sources/page");

    const html = renderToStaticMarkup(await SourcesPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("立即自动闭环");
    expect(html).toContain('name="forceAutoApply" value="true"');
    expect(html).toContain('name="bootstrapDefaultSources" value="true"');
    expect(html).toContain('name="maxQueries" value="3"');
    expect(html).toContain('name="maxSources" value="3"');
    expect(html).not.toContain('name="reviewOnly" value="true"');
  });

  it("anchors the automated evidence loop form for overview collection actions", async () => {
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      beliefs: [activeBeliefWithHypothesis()]
    });
    const { default: SourcesPage } = await import("@/app/admin/world-model/sources/page");

    const html = renderToStaticMarkup(await SourcesPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain('id="evidence-loop"');
    expect(html).toContain("自动证据闭环");
  });

  it("renders automation next actions to concrete observation queues", async () => {
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      beliefs: [activeBeliefWithHypothesis()],
      sources: [
        {
          id: "source_signal",
          name: "Signal source",
          kind: "WEB_PAGE",
          adapter: "web_page",
          credibility: 0.7,
          enabled: true,
          autoConfirm: true,
          autoConfirmThreshold: 0.85,
          createdAt: new Date("2026-06-11T07:00:00.000Z"),
          updatedAt: new Date("2026-06-11T07:00:00.000Z")
        }
      ],
      runs: [
        {
          id: "run_attention",
          sourceId: "source_signal",
          status: "REVIEW_ONLY",
          startedAt: new Date("2026-06-11T08:00:00.000Z"),
          finishedAt: new Date("2026-06-11T08:00:02.000Z"),
          itemCount: 3,
          reprocessedObservationCount: 0,
          deduplicatedCount: 0,
          queryCount: 1,
          querySummary: [],
          candidateCount: 2,
          autoAppliedCount: 0,
          reviewCount: 2,
          lowImpactCount: 1,
          unmatchedCount: 0
        }
      ]
    });
    const { default: SourcesPage } = await import("@/app/admin/world-model/sources/page");

    const html = renderToStaticMarkup(await SourcesPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain('href="/admin/world-model/observations#review-candidates"');
    expect(html).toContain('href="/admin/world-model/sources#evidence-loop"');
    expect(html).toContain("启用自动应用");
    expect(html).toContain('href="/admin/world-model/observations#unknown-evidence"');
    expect(html).not.toContain('href="/admin/world-model/observations">处理待审候选');
    expect(html).not.toContain('href="/admin/world-model/observations">查看低影响观察');
  });

  it("renders healthy worker attention as a notice instead of an error", async () => {
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      beliefs: [activeBeliefWithHypothesis()],
      sources: [
        {
          id: "source_signal",
          name: "Signal source",
          kind: "WEB_PAGE",
          adapter: "web_page",
          credibility: 0.7,
          enabled: true,
          autoConfirm: true,
          autoConfirmThreshold: 0.85,
          createdAt: new Date("2026-06-11T07:00:00.000Z"),
          updatedAt: new Date("2026-06-11T07:00:00.000Z")
        }
      ],
      heartbeats: [
        {
          id: "default",
          status: "RUNNING",
          heartbeatAt: new Date("2099-06-11T08:00:00.000Z"),
          nextRunAt: new Date("2099-06-11T08:15:00.000Z"),
          intervalMs: 900_000,
          consecutiveFailureCount: 0,
          lastNotice: "2 条候选观察等待确认。",
          lastError: "",
          createdAt: new Date("2099-06-11T08:00:00.000Z"),
          updatedAt: new Date("2099-06-11T08:00:00.000Z")
        }
      ]
    });
    const { default: SourcesPage } = await import("@/app/admin/world-model/sources/page");

    const html = renderToStaticMarkup(await SourcesPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("2 条候选观察等待确认。");
    expect(html).toContain('class="mt-3 border-t border-line pt-3 text-xs text-amber-700">2 条候选观察等待确认。');
    expect(html).not.toContain('class="mt-3 border-t border-line pt-3 text-xs text-berry">2 条候选观察等待确认。');
  });

  it("offers a real-source dry-run loop before writable evidence loop runs", async () => {
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      beliefs: [activeBeliefWithHypothesis()],
      sources: [
        {
          id: "source_github",
          name: "GitHub Search",
          kind: "GITHUB",
          url: undefined,
          adapter: "github",
          credentialRef: undefined,
          credibility: 0.7,
          enabled: true,
          autoConfirm: false,
          autoConfirmThreshold: 0.85,
          createdAt: new Date("2026-06-11T00:02:00.000Z"),
          updatedAt: new Date("2026-06-11T00:02:00.000Z")
        }
      ]
    });
    const { default: SourcesPage } = await import("@/app/admin/world-model/sources/page");

    const html = renderToStaticMarkup(await SourcesPage({ searchParams: Promise.resolve({ belief: "B-001" }) }));
    const loopSection = html.slice(html.indexOf('id="evidence-loop"'), html.indexOf('id="automation-worker"'));

    expect(loopSection).toContain("预检闭环");
    expect(loopSection).toContain('name="returnPath" value="/admin/world-model/sources?belief=B-001#evidence-loop"');
    expect(loopSection).toContain('name="maxQueries" value="3"');
    expect(loopSection).toContain('name="maxSources" value="3"');
    expect(loopSection).toContain('name="maxObservations" value="20"');
    expect(loopSection).toContain('name="bootstrapDefaultSources" value="true"');
    expect(loopSection).toContain('name="beliefIds" value="belief_ai_agents"');
  });

  it("scopes evidence loop forms to the selected belief code from overview actions", async () => {
    const selectedBelief = activeBeliefWithHypothesis();
    const otherCreatedAt = new Date("2026-06-11T00:01:00.000Z");
    const otherBelief = {
      ...activeBeliefWithHypothesis(),
      id: "belief_other",
      title: "Other belief",
      createdAt: otherCreatedAt,
      updatedAt: otherCreatedAt,
      hypotheses: activeBeliefWithHypothesis().hypotheses.map((hypothesis) => ({
        ...hypothesis,
        id: "hypothesis_other",
        beliefId: "belief_other",
        createdAt: otherCreatedAt,
        updatedAt: otherCreatedAt
      }))
    };
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      beliefs: [selectedBelief, otherBelief]
    });
    const { default: SourcesPage } = await import("@/app/admin/world-model/sources/page");

    const html = renderToStaticMarkup(await SourcesPage({ searchParams: Promise.resolve({ belief: "B-001" }) }));

    expect(html).toContain('name="beliefIds" value="belief_ai_agents"');
    expect(html).not.toContain('name="beliefIds" value="belief_other"');
    expect(html).toContain('<option value="belief_ai_agents" selected="">B-001 · AI agents</option>');
    expect(html).toContain('<option value="belief_other">B-002 · Other belief</option>');
  });

  it("defaults the worker startup belief scope from the selected overview belief when no worker scope is saved", async () => {
    const selectedBelief = activeBeliefWithHypothesis();
    const otherCreatedAt = new Date("2026-06-11T00:01:00.000Z");
    const otherBelief = {
      ...activeBeliefWithHypothesis(),
      id: "belief_other",
      title: "Other belief",
      createdAt: otherCreatedAt,
      updatedAt: otherCreatedAt,
      hypotheses: activeBeliefWithHypothesis().hypotheses.map((hypothesis) => ({
        ...hypothesis,
        id: "hypothesis_other",
        beliefId: "belief_other",
        createdAt: otherCreatedAt,
        updatedAt: otherCreatedAt
      }))
    };
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      beliefs: [selectedBelief, otherBelief]
    });
    const { default: SourcesPage } = await import("@/app/admin/world-model/sources/page");

    const html = renderToStaticMarkup(await SourcesPage({ searchParams: Promise.resolve({ belief: "B-001" }) }));
    const workerSection = html.slice(html.indexOf('id="automation-worker"'), html.indexOf('id="source-list"'));

    expect(workerSection).toContain('<option value="belief_ai_agents" selected="">B-001 · AI agents</option>');
    expect(workerSection).toContain('<option value="belief_other">B-002 · Other belief</option>');
  });

  it("scopes manual source run forms to the selected belief code from overview actions", async () => {
    const selectedBelief = activeBeliefWithHypothesis();
    const otherCreatedAt = new Date("2026-06-11T00:01:00.000Z");
    const otherBelief = {
      ...activeBeliefWithHypothesis(),
      id: "belief_other",
      title: "Other belief",
      createdAt: otherCreatedAt,
      updatedAt: otherCreatedAt,
      hypotheses: activeBeliefWithHypothesis().hypotheses.map((hypothesis) => ({
        ...hypothesis,
        id: "hypothesis_other",
        beliefId: "belief_other",
        createdAt: otherCreatedAt,
        updatedAt: otherCreatedAt
      }))
    };
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      beliefs: [selectedBelief, otherBelief],
      sources: [
        {
          id: "source_github",
          name: "GitHub Search",
          kind: "GITHUB",
          url: undefined,
          adapter: "github",
          credentialRef: undefined,
          credibility: 0.7,
          enabled: true,
          autoConfirm: false,
          autoConfirmThreshold: 0.85,
          createdAt: new Date("2026-06-11T00:02:00.000Z"),
          updatedAt: new Date("2026-06-11T00:02:00.000Z")
        }
      ]
    });
    const { default: SourcesPage } = await import("@/app/admin/world-model/sources/page");

    const html = renderToStaticMarkup(await SourcesPage({ searchParams: Promise.resolve({ belief: "B-001" }) }));
    const manualRunSection = html.slice(html.indexOf("运行来源"), html.indexOf('id="evidence-loop"'));

    expect(manualRunSection).toContain('name="beliefIds" value="belief_ai_agents"');
    expect(manualRunSection).not.toContain('name="beliefIds" value="belief_other"');
  });

  it("keeps scoped source actions on the selected belief context after submission", async () => {
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      beliefs: [activeBeliefWithHypothesis()],
      sources: [
        {
          id: "source_github",
          name: "GitHub Search",
          kind: "GITHUB",
          url: undefined,
          adapter: "github",
          credentialRef: undefined,
          credibility: 0.7,
          enabled: true,
          autoConfirm: false,
          autoConfirmThreshold: 0.85,
          createdAt: new Date("2026-06-11T00:02:00.000Z"),
          updatedAt: new Date("2026-06-11T00:02:00.000Z")
        }
      ]
    });
    const { default: SourcesPage } = await import("@/app/admin/world-model/sources/page");

    const html = renderToStaticMarkup(await SourcesPage({ searchParams: Promise.resolve({ belief: "B-001" }) }));
    const manualRunSection = html.slice(html.indexOf("运行来源"), html.indexOf('id="evidence-loop"'));
    const dryRunSection = manualRunSection.slice(manualRunSection.indexOf("Dry-run 来源"));
    const loopSection = html.slice(html.indexOf('id="evidence-loop"'), html.indexOf('id="source-list"'));
    const sourceListSection = html.slice(html.indexOf('id="source-list"'));

    expect(manualRunSection).toContain('name="returnPath" value="/admin/world-model/sources?belief=B-001"');
    expect(dryRunSection).toContain('name="returnPath" value="/admin/world-model/sources?belief=B-001"');
    expect(loopSection).toContain('name="returnPath" value="/admin/world-model/sources?belief=B-001#evidence-loop"');
    expect(sourceListSection).toContain('name="returnPath" value="/admin/world-model/sources?belief=B-001"');
  });

  it("does not prefill source dry-run forms with demo observation text", async () => {
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      beliefs: [activeBeliefWithHypothesis()],
      sources: [
        {
          id: "source_github",
          name: "GitHub Search",
          kind: "GITHUB",
          url: undefined,
          adapter: "github",
          credentialRef: undefined,
          credibility: 0.7,
          enabled: true,
          autoConfirm: false,
          autoConfirmThreshold: 0.85,
          createdAt: new Date("2026-06-11T00:02:00.000Z"),
          updatedAt: new Date("2026-06-11T00:02:00.000Z")
        }
      ]
    });
    const { default: SourcesPage } = await import("@/app/admin/world-model/sources/page");

    const html = renderToStaticMarkup(await SourcesPage({ searchParams: Promise.resolve({}) }));
    const dryRunSection = html.slice(html.indexOf("Dry-run 来源"), html.indexOf('id="evidence-loop"'));

    expect(dryRunSection).not.toContain("AI source sample");
    expect(dryRunSection).not.toContain("Sample observation content");
  });

  it("does not offer the one-click auto-apply loop when no hypothesis is currently effective", async () => {
    const upcomingBelief = activeBeliefWithHypothesis();
    upcomingBelief.hypotheses = upcomingBelief.hypotheses.map((hypothesis) => ({
      ...hypothesis,
      startsAt: new Date("2099-01-01T00:00:00.000Z")
    }));
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      beliefs: [upcomingBelief]
    });
    const { default: SourcesPage } = await import("@/app/admin/world-model/sources/page");

    const html = renderToStaticMarkup(await SourcesPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("没有当前有效假设");
    expect(html).not.toContain("立即自动闭环");
    expect(html).not.toContain('name="forceAutoApply" value="true"');
  });

  it("defaults the worker startup form to guarded auto-apply mode", async () => {
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      beliefs: [activeBeliefWithHypothesis()]
    });
    const { default: SourcesPage } = await import("@/app/admin/world-model/sources/page");

    const html = renderToStaticMarkup(await SourcesPage({ searchParams: Promise.resolve({}) }));
    const workerSection = html.slice(html.indexOf('id="automation-worker"'), html.indexOf('id="source-list"'));

    expect(workerSection).not.toContain('type="checkbox" name="reviewOnly" checked=""');
    expect(workerSection).toContain('type="checkbox" name="forceAutoApply" checked=""');
  });

  it("surfaces when the periodic evidence worker is not running despite ready prerequisites", async () => {
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      beliefs: [activeBeliefWithHypothesis()],
      sources: [
        {
          id: "source_github",
          name: "GitHub Search",
          kind: "GITHUB",
          url: undefined,
          adapter: "github",
          credentialRef: undefined,
          credibility: 0.7,
          enabled: true,
          autoConfirm: false,
          autoConfirmThreshold: 0.85,
          createdAt: new Date("2026-06-11T00:02:00.000Z"),
          updatedAt: new Date("2026-06-11T00:02:00.000Z")
        }
      ],
      workerRuntime: [],
      heartbeats: []
    });
    const { default: SourcesPage } = await import("@/app/admin/world-model/sources/page");

    const html = renderToStaticMarkup(await SourcesPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("守护进程未开启");
    expect(html).toContain("基础条件已满足，但本地守护进程没有运行");
    expect(html).toContain('href="/admin/world-model/sources#automation-worker"');
  });

  it("hides advanced auto-apply controls when no hypothesis is currently effective", async () => {
    const upcomingBelief = activeBeliefWithHypothesis();
    upcomingBelief.hypotheses = upcomingBelief.hypotheses.map((hypothesis) => ({
      ...hypothesis,
      startsAt: new Date("2099-01-01T00:00:00.000Z")
    }));
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      beliefs: [upcomingBelief]
    });
    const { default: SourcesPage } = await import("@/app/admin/world-model/sources/page");

    const html = renderToStaticMarkup(await SourcesPage({ searchParams: Promise.resolve({}) }));
    const loopSection = html.slice(html.indexOf("自动证据闭环"), html.indexOf('id="automation-worker"'));

    expect(loopSection).toContain("没有当前有效假设");
    expect(loopSection).not.toContain('name="forceAutoApply"');
    expect(loopSection).not.toContain("本次自动应用");
  });

  it("hides worker auto-apply controls when no hypothesis is currently effective", async () => {
    const upcomingBelief = activeBeliefWithHypothesis();
    upcomingBelief.hypotheses = upcomingBelief.hypotheses.map((hypothesis) => ({
      ...hypothesis,
      startsAt: new Date("2099-01-01T00:00:00.000Z")
    }));
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      beliefs: [upcomingBelief],
      workerConfigs: [
        {
          id: "nightly",
          enabled: true,
          intervalMs: 600_000,
          failureBackoffMultiplier: 3,
          maxIntervalMs: 3_600_000,
          reviewOnly: false,
          maxQueries: 4,
          maxSources: 2,
          beliefIds: ["belief_ai_agents"],
          sourceIds: undefined,
          maxObservations: 12,
          candidateThreshold: 0.3,
          autoConfirmThreshold: 0.82,
          bootstrapDefaultSources: true,
          forceAutoApply: true,
          createdAt: new Date("2026-06-12T00:00:00.000Z"),
          updatedAt: new Date("2026-06-12T00:00:00.000Z")
        }
      ]
    });
    const { default: SourcesPage } = await import("@/app/admin/world-model/sources/page");

    const html = renderToStaticMarkup(await SourcesPage({ searchParams: Promise.resolve({}) }));
    const workerSection = html.slice(html.indexOf('id="automation-worker"'), html.indexOf('id="source-list"'));

    expect(workerSection).not.toContain('name="forceAutoApply"');
    expect(workerSection).not.toContain("自动应用");
  });

  it("renders evidence loop query and source bounds in the advanced run form", async () => {
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      beliefs: [
        {
          id: "belief_ai_agents",
          title: "AI agents",
          category: "AI_TREND",
          description: "",
          probabilityMode: "INDEPENDENT",
          status: "ACTIVE",
          createdAt: new Date("2026-06-11T00:00:00.000Z"),
          updatedAt: new Date("2026-06-11T00:00:00.000Z"),
          hypotheses: []
        }
      ],
      sources: [
        {
          id: "source_github",
          name: "GitHub Search",
          kind: "GITHUB",
          url: undefined,
          adapter: "github",
          credentialRef: undefined,
          credibility: 0.7,
          enabled: true,
          autoConfirm: false,
          autoConfirmThreshold: 0.85,
          createdAt: new Date("2026-06-11T00:01:00.000Z"),
          updatedAt: new Date("2026-06-11T00:01:00.000Z")
        }
      ]
    });
    const { default: SourcesPage } = await import("@/app/admin/world-model/sources/page");

    const html = renderToStaticMarkup(await SourcesPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain('name="beliefIds"');
    expect(html).toContain('value="belief_ai_agents"');
    expect(html).toContain('name="sourceIds"');
    expect(html).toContain('value="source_github"');
    expect(html).toContain("限定信念");
    expect(html).toContain("限定来源");
    expect(html).toContain('name="maxQueries"');
    expect(html).toContain('name="maxSources"');
    expect(html).toContain("单次最大查询");
    expect(html).toContain("单次最大来源");
    expect(html).toContain('data-pending-label="运行中"');
  });

  it("uses the persisted source code when a run references a deleted source", async () => {
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      runs: [
        {
          id: "observation_run_deleted_source",
          sourceId: "source_3d6953b9-93f3-4121-8cb5-b53cb30af9d7",
          sourceCode: "S-042",
          status: "SUCCESS",
          startedAt: new Date("2026-06-11T00:00:00.000Z"),
          finishedAt: new Date("2026-06-11T00:00:01.000Z"),
          itemCount: 1,
          reprocessedObservationCount: 0,
          deduplicatedCount: 0,
          candidateCount: 0,
          autoAppliedCount: 0,
          reviewCount: 0,
          lowImpactCount: 0,
          unmatchedCount: 0,
          queryCount: 0,
          querySummary: []
        }
      ]
    });
    const { default: SourcesPage } = await import("@/app/admin/world-model/sources/page");

    const html = renderToStaticMarkup(await SourcesPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("S-042");
    expect(html).not.toContain("source_3d6953b9-93f3-4121-8cb5-b53cb30af9d7");
  });

  it("renders query and source bounds in the worker configuration form", async () => {
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      beliefs: [
        {
          id: "belief_ai_agents",
          title: "AI agents",
          category: "AI_TREND",
          description: "",
          probabilityMode: "INDEPENDENT",
          status: "ACTIVE",
          createdAt: new Date("2026-06-11T00:00:00.000Z"),
          updatedAt: new Date("2026-06-11T00:00:00.000Z"),
          hypotheses: []
        }
      ],
      sources: [
        {
          id: "source_github",
          name: "GitHub Search",
          kind: "GITHUB",
          url: undefined,
          adapter: "github",
          credentialRef: undefined,
          credibility: 0.7,
          enabled: true,
          autoConfirm: false,
          autoConfirmThreshold: 0.85,
          createdAt: new Date("2026-06-11T00:01:00.000Z"),
          updatedAt: new Date("2026-06-11T00:01:00.000Z")
        }
      ],
      workerConfigs: [
        {
          id: "nightly",
          enabled: true,
          intervalMs: 600_000,
          failureBackoffMultiplier: 3,
          maxIntervalMs: 3_600_000,
          reviewOnly: false,
          maxQueries: 4,
          maxSources: 2,
          beliefIds: ["belief_ai_agents"],
          sourceIds: ["source_github"],
          maxObservations: 12,
          candidateThreshold: 0.3,
          autoConfirmThreshold: 0.82,
          bootstrapDefaultSources: true,
          forceAutoApply: true,
          createdAt: new Date("2026-06-12T00:00:00.000Z"),
          updatedAt: new Date("2026-06-12T00:00:00.000Z")
        }
      ]
    });
    const { default: SourcesPage } = await import("@/app/admin/world-model/sources/page");

    const html = renderToStaticMarkup(await SourcesPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("最大查询");
    expect(html).toContain("最大来源");
    expect(html).toContain("Worker 信念");
    expect(html).toContain("Worker 来源");
    expect(html).toMatch(/<input type="number"[^>]*name="maxQueries"[^>]*value="4"/);
    expect(html).toMatch(/<input type="number"[^>]*name="maxSources"[^>]*value="2"/);
    expect(html).toMatch(/<option value="belief_ai_agents" selected="">/);
    expect(html).toMatch(/<option value="source_github" selected="">/);
  });

  it("prefills the worker form from the running worker config when multiple configs exist", async () => {
    const createdAt = new Date("2026-06-11T00:00:00.000Z");
    const otherBelief = {
      ...activeBeliefWithHypothesis(),
      id: "belief_career",
      title: "Career",
      hypotheses: [
        {
          ...activeBeliefWithHypothesis().hypotheses[0],
          id: "hypothesis_career",
          beliefId: "belief_career",
          proposition: "Career signal"
        }
      ]
    };
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      beliefs: [activeBeliefWithHypothesis(), otherBelief],
      sources: [
        {
          id: "source_github",
          name: "GitHub Search",
          kind: "GITHUB",
          url: undefined,
          adapter: "github",
          credentialRef: undefined,
          credibility: 0.7,
          enabled: true,
          autoConfirm: false,
          autoConfirmThreshold: 0.85,
          createdAt,
          updatedAt: createdAt
        },
        {
          id: "source_hf",
          name: "Hugging Face",
          kind: "HUGGING_FACE",
          url: undefined,
          adapter: "huggingface",
          credentialRef: undefined,
          credibility: 0.72,
          enabled: true,
          autoConfirm: false,
          autoConfirmThreshold: 0.85,
          createdAt: new Date("2026-06-11T00:01:00.000Z"),
          updatedAt: new Date("2026-06-11T00:01:00.000Z")
        }
      ],
      workerConfigs: [
        {
          id: "default",
          enabled: true,
          intervalMs: 900_000,
          failureBackoffMultiplier: 2,
          maxIntervalMs: 3_600_000,
          reviewOnly: true,
          maxQueries: 2,
          maxSources: 1,
          beliefIds: ["belief_ai_agents"],
          sourceIds: ["source_github"],
          maxObservations: 10,
          candidateThreshold: 0.25,
          autoConfirmThreshold: 0.85,
          bootstrapDefaultSources: true,
          forceAutoApply: false,
          createdAt,
          updatedAt: createdAt
        },
        {
          id: "nightly",
          enabled: true,
          intervalMs: 600_000,
          failureBackoffMultiplier: 3,
          maxIntervalMs: 1_800_000,
          reviewOnly: false,
          maxQueries: 5,
          maxSources: 2,
          beliefIds: ["belief_career"],
          sourceIds: ["source_hf"],
          maxObservations: 18,
          candidateThreshold: 0.35,
          autoConfirmThreshold: 0.9,
          bootstrapDefaultSources: false,
          forceAutoApply: true,
          createdAt: new Date("2026-06-12T00:00:00.000Z"),
          updatedAt: new Date("2026-06-12T00:00:00.000Z")
        }
      ],
      workerRuntime: [{ workerId: "nightly", running: true, nextRunAt: new Date("2026-06-12T00:10:00.000Z"), consecutiveFailureCount: 0 }]
    });
    const { default: SourcesPage } = await import("@/app/admin/world-model/sources/page");

    const html = renderToStaticMarkup(await SourcesPage({ searchParams: Promise.resolve({}) }));
    const workerSection = html.slice(html.indexOf('id="automation-worker"'), html.indexOf('id="source-list"'));

    expect(workerSection).toMatch(/<input[^>]*name="workerId"[^>]*value="nightly"/);
    expect(workerSection).toMatch(/<input type="number"[^>]*name="maxQueries"[^>]*value="5"/);
    expect(workerSection).toMatch(/<option value="belief_career" selected="">/);
    expect(workerSection).toMatch(/<option value="source_hf" selected="">/);
  });

  it("shows reprocessed observation runs in automation history", async () => {
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      runs: [
        {
          id: "run_reprocessed",
          status: "SUCCESS",
          startedAt: new Date("2026-06-11T06:00:00.000Z"),
          finishedAt: new Date("2026-06-11T06:00:02.000Z"),
          itemCount: 0,
          reprocessedObservationCount: 2,
          deduplicatedCount: 0,
          queryCount: 0,
          querySummary: [],
          candidateCount: 2,
          autoAppliedCount: 1,
          reviewCount: 1,
          lowImpactCount: 0,
          unmatchedCount: 0
        }
      ]
    });
    const { default: SourcesPage } = await import("@/app/admin/world-model/sources/page");

    const html = renderToStaticMarkup(await SourcesPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("旧观察重试");
    expect(html).toContain("<td class=\"px-3 py-2\">2</td>");
  });

  it("renders editable source configuration rows", async () => {
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      sources: [
        {
          id: "source_signal",
          name: "Signal RSS",
          kind: "RSS",
          url: "https://example.com/feed.xml",
          adapter: "rss",
          credentialRef: "signal-feed",
          credibility: 0.7,
          enabled: true,
          autoConfirm: false,
          autoConfirmThreshold: 0.85,
          createdAt: new Date("2026-06-11T00:00:00.000Z"),
          updatedAt: new Date("2026-06-11T00:00:00.000Z")
        }
      ]
    });
    const { default: SourcesPage } = await import("@/app/admin/world-model/sources/page");

    const html = renderToStaticMarkup(await SourcesPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain('type="hidden" name="sourceId" value="source_signal"');
    expect(html).toMatch(/<input type="text"[^>]*name="name" value="Signal RSS"/);
    expect(html).toMatch(/<input type="url"[^>]*name="url" value="https:\/\/example.com\/feed.xml"/);
    expect(html).toMatch(/<input type="number"[^>]*name="credibility" value="0.7"/);
    expect(html).toContain("保存来源");
  });

  it("renders source evidence quality warnings from rejected and rolled-back evidence", async () => {
    const createdAt = new Date("2026-06-11T00:00:00.000Z");
    const confirmedAt = new Date("2026-06-11T08:00:00.000Z");
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      sources: [
        {
          id: "source_signal",
          name: "Signal RSS",
          kind: "RSS",
          url: "https://example.com/feed.xml",
          adapter: "rss",
          credentialRef: "signal-feed",
          credibility: 0.7,
          enabled: true,
          autoConfirm: true,
          autoConfirmThreshold: 0.85,
          createdAt,
          updatedAt: createdAt
        }
      ],
      observations: [
        {
          id: "observation_active",
          sourceId: "source_signal",
          title: "Active source signal",
          content: "Active source signal content",
          observedAt: confirmedAt,
          status: "CONFIRMED",
          credibility: 0.8,
          metadata: {}
        },
        {
          id: "observation_rejected",
          sourceId: "source_signal",
          title: "Rejected source signal",
          content: "Rejected source signal content",
          observedAt: new Date("2026-06-11T08:05:00.000Z"),
          status: "CONFIRMED",
          credibility: 0.8,
          metadata: {}
        },
        {
          id: "observation_rolled",
          sourceId: "source_signal",
          title: "Rolled source signal",
          content: "Rolled source signal content",
          observedAt: new Date("2026-06-11T08:10:00.000Z"),
          status: "CONFIRMED",
          credibility: 0.8,
          metadata: {}
        }
      ],
      evidence: [
        {
          id: "evidence_active",
          observationId: "observation_active",
          title: "Active evidence",
          content: "Active evidence content",
          confirmedAt,
          confirmationMode: "AUTO",
          credibility: 0.8,
          status: "ACTIVE",
          metadata: {},
          links: []
        },
        {
          id: "evidence_rejected",
          observationId: "observation_rejected",
          title: "Rejected evidence",
          content: "Rejected evidence content",
          confirmedAt: new Date("2026-06-11T08:05:00.000Z"),
          confirmationMode: "AUTO",
          credibility: 0.8,
          status: "REJECTED",
          metadata: {},
          links: []
        },
        {
          id: "evidence_rolled",
          observationId: "observation_rolled",
          title: "Rolled evidence",
          content: "Rolled evidence content",
          confirmedAt: new Date("2026-06-11T08:10:00.000Z"),
          confirmationMode: "AUTO",
          credibility: 0.8,
          status: "ACTIVE",
          metadata: {},
          links: []
        }
      ],
      updates: [
        {
          id: "update_rolled",
          beliefId: "belief_signal",
          evidenceId: "evidence_rolled",
          priorSnapshot: { hypothesis_signal: 0.7 },
          posteriorSnapshot: { hypothesis_signal: 0.42 },
          mode: "APPLIED",
          status: "ROLLED_BACK",
          confidence: 0.7,
          explanations: [],
          createdAt: new Date("2026-06-11T09:00:00.000Z"),
          rolledBackAt: new Date("2026-06-11T10:00:00.000Z")
        }
      ]
    });
    const { default: SourcesPage } = await import("@/app/admin/world-model/sources/page");

    const html = renderToStaticMarkup(await SourcesPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("证据质量警告：2/3 条证据出现拒绝或回滚");
    expect(html).toContain("回滚 1，拒绝 1");
    expect(html).toContain("建议提高自动确认阈值或暂时停用");
    expect(html).toContain("建议将来源可信度从 0.70 降到 0.53，并将自动确认阈值从 0.85 提高到 0.92。");
    expect(html).toContain("应用建议");
    expect(html).toContain('name="suggestedCredibility" value="0.53"');
    expect(html).toContain('name="suggestedAutoConfirmThreshold" value="0.92"');
  });

  it("does not offer repeated source calibration when the current source already meets the target", async () => {
    const createdAt = new Date("2026-06-11T00:00:00.000Z");
    const confirmedAt = new Date("2026-06-11T08:00:00.000Z");
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      sources: [
        {
          id: "source_signal",
          name: "Signal RSS",
          kind: "RSS",
          url: "https://example.com/feed.xml",
          adapter: "rss",
          credentialRef: "signal-feed",
          credibility: 0.53,
          enabled: true,
          autoConfirm: true,
          autoConfirmThreshold: 0.92,
          createdAt,
          updatedAt: createdAt
        }
      ],
      observations: [
        {
          id: "observation_active",
          sourceId: "source_signal",
          title: "Active source signal",
          content: "Active source signal content",
          observedAt: confirmedAt,
          status: "CONFIRMED",
          credibility: 0.8,
          metadata: {}
        },
        {
          id: "observation_rejected",
          sourceId: "source_signal",
          title: "Rejected source signal",
          content: "Rejected source signal content",
          observedAt: new Date("2026-06-11T08:05:00.000Z"),
          status: "CONFIRMED",
          credibility: 0.8,
          metadata: {}
        },
        {
          id: "observation_rolled",
          sourceId: "source_signal",
          title: "Rolled source signal",
          content: "Rolled source signal content",
          observedAt: new Date("2026-06-11T08:10:00.000Z"),
          status: "CONFIRMED",
          credibility: 0.8,
          metadata: {}
        }
      ],
      evidence: [
        {
          id: "evidence_active",
          observationId: "observation_active",
          title: "Active evidence",
          content: "Active evidence content",
          confirmedAt,
          confirmationMode: "AUTO",
          credibility: 0.8,
          status: "ACTIVE",
          metadata: {},
          links: []
        },
        {
          id: "evidence_rejected",
          observationId: "observation_rejected",
          title: "Rejected evidence",
          content: "Rejected evidence content",
          confirmedAt: new Date("2026-06-11T08:05:00.000Z"),
          confirmationMode: "AUTO",
          credibility: 0.8,
          status: "REJECTED",
          metadata: {},
          links: []
        },
        {
          id: "evidence_rolled",
          observationId: "observation_rolled",
          title: "Rolled evidence",
          content: "Rolled evidence content",
          confirmedAt: new Date("2026-06-11T08:10:00.000Z"),
          confirmationMode: "AUTO",
          credibility: 0.8,
          status: "ACTIVE",
          metadata: {},
          links: []
        }
      ],
      updates: [
        {
          id: "update_rolled",
          beliefId: "belief_signal",
          evidenceId: "evidence_rolled",
          priorSnapshot: { hypothesis_signal: 0.7 },
          posteriorSnapshot: { hypothesis_signal: 0.42 },
          mode: "APPLIED",
          status: "ROLLED_BACK",
          confidence: 0.7,
          explanations: [],
          createdAt: new Date("2026-06-11T09:00:00.000Z"),
          rolledBackAt: new Date("2026-06-11T10:00:00.000Z")
        }
      ]
    });
    const { default: SourcesPage } = await import("@/app/admin/world-model/sources/page");

    const html = renderToStaticMarkup(await SourcesPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("来源已达到当前证据质量建议：可信度不高于 0.53，自动确认阈值不低于 0.92。");
    expect(html).not.toContain("应用建议");
  });

  it("shows concrete observation follow-up samples in automation status", async () => {
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      observations: [
        {
          id: "observation_review",
          title: "Review candidate from source",
          content: "Review candidate content",
          observedAt: new Date("2026-06-11T08:00:00.000Z"),
          status: "PENDING",
          credibility: 0.8,
          metadata: {
            recommendedLinks: [
              {
                hypothesisId: "hypothesis_signal",
                direction: "SUPPORTS",
                relevance: 0.8,
                likelihoodRatio: 1.8,
                confidence: 0.7,
                rationale: "Source supports the hypothesis."
              }
            ]
          }
        },
        {
          id: "observation_unmatched",
          title: "Observation needs new hypothesis",
          content: "Unmatched observation content",
          observedAt: new Date("2026-06-11T08:05:00.000Z"),
          status: "UNKNOWN",
          credibility: 0.7,
          metadata: { ignoredReason: "UNMATCHED" }
        }
      ]
    });
    const { default: SourcesPage } = await import("@/app/admin/world-model/sources/page");

    const html = renderToStaticMarkup(await SourcesPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("待处理样本");
    expect(html).toContain("Review candidate from source");
    expect(html).toContain("Observation needs new hypothesis");
    expect(html).toContain('href="/admin/world-model/observations#review-candidates"');
    expect(html).toContain('href="/admin/world-model/beliefs?sourceObservation=O-002#recommendations"');
  });

  it("shows duplicate candidate follow-up samples in automation status", async () => {
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      observations: [
        {
          id: "observation_original",
          title: "Original source signal",
          content: "Original source signal content",
          observedAt: new Date("2026-06-11T08:00:00.000Z"),
          status: "PENDING",
          credibility: 0.8,
          metadata: {}
        },
        {
          id: "observation_duplicate",
          title: "Repeated source signal",
          content: "Repeated source signal content",
          observedAt: new Date("2026-06-11T08:05:00.000Z"),
          status: "DUPLICATE",
          duplicateOfId: "observation_original",
          credibility: 0.7,
          metadata: {}
        }
      ]
    });
    const { default: SourcesPage } = await import("@/app/admin/world-model/sources/page");

    const html = renderToStaticMarkup(await SourcesPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("重复候选");
    expect(html).toContain("Repeated source signal");
    expect(html).toContain("可能重复于 O-001，需要核对后拒绝或调整来源。");
    expect(html).toContain('href="/admin/world-model/observations#duplicate-candidates"');
  });

  it("links unmatched run records to a concrete source observation recommendation", async () => {
    loadWorldModelData.mockResolvedValue({
      ...emptyWorldModelData(),
      observations: [
        {
          id: "observation_unmatched",
          title: "Run unmatched observation",
          content: "Run unmatched observation content",
          observedAt: new Date("2026-06-11T08:05:00.000Z"),
          status: "UNKNOWN",
          credibility: 0.7,
          metadata: { ignoredReason: "UNMATCHED" }
        }
      ],
      runs: [
        {
          id: "run_unmatched",
          sourceId: "source_signal",
          status: "SUCCESS",
          startedAt: new Date("2026-06-11T08:10:00.000Z"),
          finishedAt: new Date("2026-06-11T08:10:02.000Z"),
          itemCount: 1,
          reprocessedObservationCount: 0,
          deduplicatedCount: 0,
          queryCount: 1,
          querySummary: [],
          candidateCount: 0,
          autoAppliedCount: 0,
          reviewCount: 0,
          lowImpactCount: 0,
          unmatchedCount: 1
        }
      ]
    });
    const { default: SourcesPage } = await import("@/app/admin/world-model/sources/page");

    const html = renderToStaticMarkup(await SourcesPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("补充假设");
    expect((html.match(/href="\/admin\/world-model\/beliefs\?sourceObservation=O-001#recommendations"/g) ?? [])).toHaveLength(3);
  });
});
