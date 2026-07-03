# Service Layer Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `src/server/services/world-model-services.ts` into the eight service modules required by `AGENTS.md` while preserving the public `createWorldModelServices()` API and all existing behavior.

**Architecture:** `world-model-services.ts` remains the composition root. Stateful service logic moves into per-domain factories, and shared orchestration helpers move into `src/server/services/internal/` modules that accept explicit dependencies instead of importing sibling services at runtime.

**Tech Stack:** TypeScript, Vitest, Zod, Next.js service layer, existing `WorldModelStore` interface.

---

## File Map

- Create: `tests/server/service-layer-split.test.ts` — architecture guard for service module files and composition-root size.
- Create: `src/server/services/internal/service-context.ts` — shared `store`, `options`, and auto-apply policy context.
- Create: `src/server/services/internal/update-workflow.ts` — reusable update preview, apply, rollback, and rebase workflows.
- Create: `src/server/services/internal/evidence-workflow.ts` — reusable observation-to-evidence and evidence reapplication workflows.
- Create: `src/server/services/internal/observation-workflow.ts` — reusable observation ingestion, dedupe, and settlement workflows.
- Create: `src/server/services/internal/belief-workflow.ts` — reusable belief and hypothesis mutation workflows.
- Create: `src/server/services/internal/source-workflow.ts` — reusable source run, candidate recommendation, and evidence-loop workflows.
- Create: `src/server/services/belief-service.ts` — `WorldModelServices["beliefs"]` factory.
- Create: `src/server/services/observation-service.ts` — `WorldModelServices["observations"]` factory.
- Create: `src/server/services/evidence-service.ts` — `WorldModelServices["evidence"]` factory.
- Create: `src/server/services/likelihood-service.ts` — `WorldModelServices["likelihood"]` factory.
- Create: `src/server/services/update-service.ts` — `WorldModelServices["updates"]` factory.
- Create: `src/server/services/source-service.ts` — `WorldModelServices["sources"]` factory.
- Create: `src/server/services/automation-service.ts` — `WorldModelServices["automation"]` factory.
- Create: `src/server/services/model-service.ts` — `WorldModelServices["models"]` factory.
- Modify: `src/server/services/world-model-services.ts` — reduce to composition root and re-export option types.
- Modify: `AGENTS.md` — replace the stale current-state note with the new module status after implementation.

## Dependency Rules For This Refactor

- Service modules import `WorldModelServiceContext` and workflow modules.
- Workflow modules accept dependencies through parameters and must not import public service factories.
- `src/server/services/world-model-services.ts` is the only module that wires factories together.
- `WorldModelStore` remains the only persistence dependency used by business service code.
- Public imports of `WorldModelServiceOptions` from `@/server/services/world-model-services` continue to work through a type re-export.

## Task 1: Add Architecture Guard

**Files:**
- Create: `tests/server/service-layer-split.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readProjectFile(relativePath: string) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

describe("service layer split", () => {
  it("keeps each service aggregate in its own module", () => {
    const serviceModules = [
      "src/server/services/belief-service.ts",
      "src/server/services/observation-service.ts",
      "src/server/services/evidence-service.ts",
      "src/server/services/likelihood-service.ts",
      "src/server/services/update-service.ts",
      "src/server/services/source-service.ts",
      "src/server/services/automation-service.ts",
      "src/server/services/model-service.ts"
    ];

    expect(serviceModules.filter((file) => !existsSync(path.join(root, file)))).toEqual([]);
  });

  it("keeps world-model-services as a small composition root", () => {
    const source = readProjectFile("src/server/services/world-model-services.ts");
    const lines = source.split(/\r?\n/).filter((line) => line.trim()).length;

    expect(lines).toBeLessThanOrEqual(180);
    expect(source).toContain("createBeliefService");
    expect(source).toContain("createObservationService");
    expect(source).toContain("createEvidenceService");
    expect(source).toContain("createLikelihoodService");
    expect(source).toContain("createUpdateService");
    expect(source).toContain("createSourceService");
    expect(source).toContain("createAutomationService");
    expect(source).toContain("createModelService");
    expect(source).not.toContain("async function runSource(");
    expect(source).not.toContain("async function confirmObservation(");
    expect(source).not.toContain("async function createPreview(");
    expect(source).not.toContain("async function runEvidenceLoop(");
  });
});
```

- [ ] **Step 2: Run the test and observe the expected failure**

Run: `npx vitest run tests/server/service-layer-split.test.ts`

Expected: failure because the eight service module files do not exist and `world-model-services.ts` is larger than 180 non-empty lines.

## Task 2: Extract Shared Context, Model Service, And Likelihood Service

**Files:**
- Create: `src/server/services/internal/service-context.ts`
- Create: `src/server/services/model-service.ts`
- Create: `src/server/services/likelihood-service.ts`
- Modify: `src/server/services/world-model-services.ts`
- Test: `tests/server/world-model-services.test.ts`

- [ ] **Step 1: Add shared service context**

Move `AutoApplyPolicyInput` and `WorldModelServiceOptions` out of `world-model-services.ts` into `service-context.ts` with this public surface:

```ts
import type { LikelihoodEstimator } from "@/server/models/estimators";
import type { AdapterDependencies } from "@/server/sources/adapters";
import type { HypothesisRecommendationGenerator, WorldModelStore } from "@/server/services/types";

export type AutoApplyPolicyInput = {
  reviewOnly?: boolean;
  autoConfirm: boolean;
  beliefIds?: string[];
  sourceIds?: string[];
  reviewReason?: string;
};

export type WorldModelServiceOptions = {
  sourceAdapterDependencies?: AdapterDependencies;
  likelihoodEstimator?: LikelihoodEstimator;
  hypothesisRecommendationGenerator?: HypothesisRecommendationGenerator;
  autoApplyPolicy?: (input: AutoApplyPolicyInput) => AutoApplyPolicyInput | Promise<AutoApplyPolicyInput>;
};

export type WorldModelServiceContext = {
  store: WorldModelStore;
  options: WorldModelServiceOptions;
  applyAutoApplyPolicy(input: AutoApplyPolicyInput): Promise<AutoApplyPolicyInput>;
};

export function createWorldModelServiceContext(
  store: WorldModelStore,
  options: WorldModelServiceOptions = {}
): WorldModelServiceContext {
  return {
    store,
    options,
    async applyAutoApplyPolicy(input) {
      return options.autoApplyPolicy ? options.autoApplyPolicy(input) : input;
    }
  };
}
```

- [ ] **Step 2: Move model import logic**

Create `createModelService(context)` returning `WorldModelServices["models"]`. Move `importModelArtifact` unchanged except that it reads `store` from `context`.

- [ ] **Step 3: Move likelihood run logic**

Create `createLikelihoodService(context)` returning `WorldModelServices["likelihood"]`. Move `runLikelihood` unchanged except that it reads `store` from `context`.

- [ ] **Step 4: Wire the two factories in the composition root**

In `world-model-services.ts`, import the new factories and keep these exports:

```ts
export type { AutoApplyPolicyInput, WorldModelServiceOptions } from "@/server/services/internal/service-context";
```

The returned object must use `likelihood: createLikelihoodService(context)` and `models: createModelService(context)`.

- [ ] **Step 5: Run focused verification**

Run: `npx vitest run tests/server/world-model-services.test.ts tests/server/service-layer-split.test.ts`

Expected: `world-model-services.test.ts` passes; `service-layer-split.test.ts` still fails only because the remaining service files are not split and the composition root is still larger than 180 lines.

## Task 3: Extract Update Workflow And Update Service

**Files:**
- Create: `src/server/services/internal/update-workflow.ts`
- Create: `src/server/services/update-service.ts`
- Modify: `src/server/services/world-model-services.ts`
- Test: `tests/server/world-model-services.test.ts`

- [ ] **Step 1: Move update helper functions**

Move these helpers from `world-model-services.ts` to `update-workflow.ts`: `evidenceLinkToPreviewLink`, `resolveHypothesesForLinks`, `evidenceLinksForBelief`, `createEvidencePreviews`, `baseProbabilitySnapshot`, and `createBeliefForSnapshotPreview`.

- [ ] **Step 2: Create the update workflow interface**

Expose these functions from `createUpdateWorkflow(context)`:

```ts
export type UpdateWorkflow = {
  resolveHypothesesForLinks(links: Array<{ hypothesisId: string }>): Promise<HypothesisRecord[]>;
  createEvidencePreviews(evidence: EvidenceRecord): Promise<UpdatePreview[]>;
  createPreview(evidenceId: string): Promise<UpdatePreview>;
  createPreviews(evidenceId: string): Promise<UpdatePreview[]>;
  createCandidatePreview(input: ConfirmEvidenceInput): Promise<UpdatePreview>;
  applyEvidenceUpdates(evidenceId: string): Promise<BayesianUpdateEventRecord[]>;
  rollbackAppliedEvidenceEvents(evidenceId: string): Promise<void>;
  rebaseActiveUpdatesForBelief(beliefId: string): Promise<void>;
  rollbackEvent(eventId: string): Promise<BayesianUpdateEventRecord>;
};
```

- [ ] **Step 3: Move public update methods**

Create `createUpdateService(updateWorkflow)` returning:

```ts
{
  preview: updateWorkflow.createPreview,
  previews: updateWorkflow.createPreviews,
  apply: updateWorkflow.applyEvidenceUpdates,
  rollback: updateWorkflow.rollbackEvent
}
```

- [ ] **Step 4: Run focused verification**

Run: `npx vitest run tests/server/world-model-services.test.ts tests/server/service-layer-split.test.ts`

Expected: behavior tests pass; architecture test still fails for remaining service modules and composition-root size.

## Task 4: Extract Evidence And Observation Workflows

**Files:**
- Create: `src/server/services/internal/evidence-workflow.ts`
- Create: `src/server/services/internal/observation-workflow.ts`
- Create: `src/server/services/evidence-service.ts`
- Create: `src/server/services/observation-service.ts`
- Modify: `src/server/services/world-model-services.ts`
- Test: `tests/server/world-model-services.test.ts`

- [ ] **Step 1: Move evidence workflows**

Move evidence confirmation, link editing, rejection, soft deletion, and reapply logic into `createEvidenceWorkflow(context, updateWorkflow, likelihoodWorkflow)`. The workflow exposes `confirmObservation`, `confirmAndApplyObservation`, `updateAndReapplyEvidence`, `connectEvidenceHypothesis`, `disconnectEvidenceHypothesis`, `rejectEvidence`, `deleteEvidence`, and `listVisibleEvidence`.

- [ ] **Step 2: Move observation workflows**

Move `toDedupeObservation`, `metadataText`, `createObservation`, `updateObservation`, `rejectObservation`, and `settleObservation` into `createObservationWorkflow(context, evidenceWorkflow, beliefWorkflowAccess)`. `beliefWorkflowAccess` is a callback object with `updateHypothesisRecord(input)` and `recommendedEvidenceLinks(observation, options)` so observation code does not import belief or source service modules.

- [ ] **Step 3: Create public service factories**

Create `createEvidenceService(evidenceWorkflow)` and `createObservationService(observationWorkflow)` returning the corresponding slices of `WorldModelServices`.

- [ ] **Step 4: Run focused verification**

Run: `npx vitest run tests/server/world-model-services.test.ts tests/server/service-layer-split.test.ts`

Expected: behavior tests pass; architecture test still fails for belief, source, automation, and final composition-root size.

## Task 5: Extract Belief Workflow And Belief Service

**Files:**
- Create: `src/server/services/internal/belief-workflow.ts`
- Create: `src/server/services/belief-service.ts`
- Modify: `src/server/services/world-model-services.ts`
- Test: `tests/server/world-model-services.test.ts`

- [ ] **Step 1: Move belief helpers**

Move `createHypotheses`, belief update, hypothesis update, mutually exclusive renormalization, active-evidence lookup, and recommendation logic into `createBeliefWorkflow(context, dependencies)`.

- [ ] **Step 2: Expose workflow methods used by other domains**

The workflow exposes `createBelief`, `updateBelief`, `createHypothesis`, `updateHypothesisRecord`, `recommendHypotheses`, `recommendedEvidenceLinks`, and `requeueAfterHypothesisChange`.

- [ ] **Step 3: Create public service factory**

Create `createBeliefService(beliefWorkflow)` returning the `beliefs` slice.

- [ ] **Step 4: Run focused verification**

Run: `npx vitest run tests/server/world-model-services.test.ts tests/server/service-layer-split.test.ts`

Expected: behavior tests pass; architecture test still fails for source, automation, and final composition-root size.

## Task 6: Extract Source Workflow, Source Service, And Automation Service

**Files:**
- Create: `src/server/services/internal/source-workflow.ts`
- Create: `src/server/services/source-service.ts`
- Create: `src/server/services/automation-service.ts`
- Modify: `src/server/services/world-model-services.ts`
- Test: `tests/server/world-model-services.test.ts`

- [ ] **Step 1: Move candidate and source helpers**

Move source query generation, candidate scoring, recommendation metadata, source run persistence, retry suppression, and loop diagnostics into `source-workflow.ts`.

- [ ] **Step 2: Create source workflow interface**

Expose these methods from `createSourceWorkflow(context, dependencies)`:

```ts
export type SourceWorkflow = {
  runSource(sourceId: string, options?: RunSourceOptions): Promise<ObservationRunRecord>;
  runEvidenceLoop(options?: EvidenceLoopOptions): Promise<ObservationRunRecord[]>;
  generateEvidenceLoopQueries(options?: EvidenceLoopOptions): Promise<EvidenceLoopQuery[]>;
  createObservationRunRecord(input: {
    sourceId: string;
    status: ObservationRunRecord["status"];
    startedAt: Date;
    completedAt?: Date;
    fetchedCount?: number;
    createdObservationIds?: string[];
    error?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ObservationRunRecord>;
  requeueUnmatchedObservationsForHypothesis(hypothesis: HypothesisRecord): Promise<number>;
  requeueSourceObservationForRecommendedHypotheses(input: {
    sourceObservationId: string;
    hypotheses: HypothesisRecord[];
    confidence: number;
  }): Promise<void>;
  requeueSourceObservationForRecommendedHypothesis(input: {
    sourceObservationId: string;
    hypothesis: HypothesisRecord;
    confidence: number;
  }): Promise<void>;
  reprocessRetryableUnmatchedObservations(options: CandidateObservationProcessingOptions): Promise<CandidateObservationProcessingResult>;
};
```

- [ ] **Step 3: Create public service factories**

Create `createSourceService(context, sourceWorkflow)` for source CRUD, presets, dry runs, and source execution. Create `createAutomationService(context, sourceWorkflow)` for evidence-loop execution, heartbeat, and worker configuration.

- [ ] **Step 4: Run focused verification**

Run: `npx vitest run tests/server/world-model-services.test.ts tests/server/service-layer-split.test.ts`

Expected: both test files pass, including the architecture guard.

## Task 7: Update Project Guidance And Run Full Verification

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Update service-layer status in `AGENTS.md`**

Replace the current-state note that says per-service modules remain future work with a note that the eight service modules are present and `world-model-services.ts` is the composition root.

- [ ] **Step 2: Run full verification**

Run these commands:

```bash
npm run lint
npm run typecheck
npm run test
npm run observe -- --dry-run
npm run build
```

Expected: all commands exit with code 0.

- [ ] **Step 3: Commit the implementation**

```bash
git status --short
git add AGENTS.md src/server/services tests/server/service-layer-split.test.ts
git commit -m "refactor: split world model service layer"
```

The status check before commit must show only files touched by this refactor.

## Self-Review

- Spec coverage: the plan creates all eight service files, keeps the composition root API, moves shared workflows under `internal/`, preserves `WorldModelStore` boundaries, and updates project guidance.
- Test coverage: the new architecture guard verifies the split shape; existing service tests verify behavior across belief, observation, evidence, source, automation, likelihood, update, and model flows.
- Type consistency: public option types remain available from `world-model-services.ts`; workflow interfaces use existing record and input types from `src/server/services/types.ts`.
