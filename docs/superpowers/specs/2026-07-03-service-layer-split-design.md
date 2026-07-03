# Service Layer Split Design

## Goal

Split `src/server/services/world-model-services.ts` into focused per-service modules while preserving the existing `WorldModelServices` public API, persistence behavior, automation behavior, and test expectations.

The split completes the service-layer structure already required by `AGENTS.md`: `belief-service.ts`, `observation-service.ts`, `evidence-service.ts`, `likelihood-service.ts`, `update-service.ts`, `source-service.ts`, `automation-service.ts`, and `model-service.ts`.

## Scope

In scope:

- Move service method implementations out of `world-model-services.ts` into per-domain factory modules.
- Keep `world-model-services.ts` as the composition root for `createWorldModelServices(store, options)`.
- Extract shared service context and cross-service internal operations into `src/server/services/internal/`.
- Preserve all external method names and return types in `WorldModelServices`.
- Preserve all existing validation, review-first automation defaults, evidence update behavior, likelihood run creation, rollback, rebase, source collection, and model import behavior.
- Add architecture-level tests that verify the intended split exists and the composition root stays focused.

Out of scope:

- Prisma schema changes.
- Public API route changes.
- UI changes.
- Changing automation policy semantics.
- Changing source adapter behavior.
- Implementing Linux process supervision.
- Splitting `WorldModelStore`.
- Rewriting the service layer with classes or dependency injection framework.

## Current State

`src/server/services/world-model-services.ts` is roughly 2400 lines and currently contains:

- Composition root.
- Belief and hypothesis mutations.
- Observation lifecycle methods.
- Evidence confirmation, edit, reject, delete, connect, disconnect, and reapply logic.
- Bayesian update preview, apply, rollback, and rebase logic.
- Likelihood run creation.
- Source preset creation, source dry-run, source execution, and evidence-loop orchestration.
- Automation heartbeat and worker config persistence.
- Model artifact import.
- Many shared helpers used across those closures.

This works functionally but violates the project target that service methods live in per-service modules. The main implementation challenge is that many closures share internal operations, especially around evidence application and automation candidate processing.

## Recommended Architecture

Use factory modules instead of classes:

```ts
export function createBeliefService(context: WorldModelServiceContext): WorldModelServices["beliefs"] {
  return { ... };
}
```

The composition root will build a single context object and pass it to each factory:

```ts
export function createWorldModelServices(store: WorldModelStore, options: WorldModelServiceOptions = {}): WorldModelServices {
  const context = createWorldModelServiceContext(store, options);
  return {
    beliefs: createBeliefService(context),
    observations: createObservationService(context),
    evidence: createEvidenceService(context),
    likelihood: createLikelihoodService(context),
    updates: createUpdateService(context),
    sources: createSourceService(context),
    automation: createAutomationService(context),
    models: createModelService(context)
  };
}
```

The factories keep the current object-based API and avoid introducing a new runtime abstraction style. This matches the current service shape and keeps API routes unchanged.

## Module Responsibilities

`src/server/services/world-model-services.ts`

- Export `WorldModelServiceOptions`.
- Export `createWorldModelServices(store, options)`.
- Construct shared context.
- Compose the eight service factories.
- Contain no domain workflow implementation.

`src/server/services/internal/context.ts`

- Define `WorldModelServiceContext`.
- Define `WorldModelServiceOptions`.
- Provide `createWorldModelServiceContext(store, options)`.
- Hold shared internal actions after all service factories are created.

`src/server/services/internal/update-workflow.ts`

- Evidence-to-preview helpers.
- `applyPreview`.
- `applyEvidenceUpdates`.
- `rollbackEvent`.
- `rollbackAppliedEvidenceEvents`.
- `rebaseActiveUpdatesForBelief`.
- Probability snapshot helpers needed by update and evidence workflows.

`src/server/services/internal/evidence-workflow.ts`

- `confirmObservation`.
- `confirmAndApplyObservation`.
- `updateAndReapplyEvidence`.
- `connectEvidenceHypothesis`.
- `disconnectEvidenceHypothesis`.
- `rejectEvidence`.
- `deleteEvidence`.
- `listVisibleEvidence`.
- Link validation and likelihood-run creation for confirmed links.

`src/server/services/internal/source-workflow.ts`

- Candidate observation processing.
- Recommended evidence links.
- Generated evidence-loop queries.
- Source run execution.
- Evidence-loop execution.
- Source suppression and duplicate-only suppression helpers.
- Preset bootstrap helpers.

`src/server/services/belief-service.ts`

- `createBelief`.
- `updateBelief`.
- `createHypothesis`.
- `updateHypothesis`.
- `recommendHypotheses`.
- `listBeliefs`.
- `getBelief`.
- Calls internal requeue helpers through context actions after belief/hypothesis creation.

`src/server/services/observation-service.ts`

- `createObservation`.
- `updateObservation`.
- `rejectObservation`.
- `settleObservation`.
- `listObservations`.

`src/server/services/evidence-service.ts`

- Exposes evidence lifecycle API by delegating to evidence workflow helpers.

`src/server/services/likelihood-service.ts`

- `runLikelihood`.
- `listRuns`.

`src/server/services/update-service.ts`

- `listEvents`.
- `createPreview`.
- `createPreviews`.
- `applyPreview`.
- `applyEvidence`.
- `rollback`.

`src/server/services/source-service.ts`

- `listSources`.
- `listRuns`.
- `listPresets`.
- `createPreset`.
- `createMissingPresets`.
- `createSource`.
- `updateSource`.
- `runDryRun`.
- `runSource`.

`src/server/services/automation-service.ts`

- `runEvidenceLoop`.
- `recordHeartbeat`.
- `listHeartbeats`.
- `saveWorkerConfig`.
- `listWorkerConfigs`.

`src/server/services/model-service.ts`

- `listArtifacts`.
- `importArtifact`.

## Internal Dependency Rules

Per-service modules depend on:

- `WorldModelServiceContext`.
- Existing schemas from `src/server/services/internal/schemas.ts`.
- Existing pure helpers from `internal/`.
- Domain functions from `src/domain`.
- Lib pure helpers already allowed by project rules.

Per-service modules must not:

- Import API route, app, or component modules.
- Import Prisma or `@/server/prisma`.
- Import each other directly in ways that create cycles.
- Instantiate their own stores.

Cross-domain operations are exposed through `context.actions`, not direct service imports. For example, `belief-service.ts` can call `context.actions.requeueSourceObservationForRecommendedHypotheses(...)`, while `evidence-service.ts` can call `context.actions.applyEvidenceUpdates(...)`.

## Data Flow

The public data flow stays unchanged:

1. API routes and server actions call `getWorldModelServices()`.
2. `getWorldModelServices()` creates the Prisma-backed `WorldModelStore` and calls `createWorldModelServices(store, options)`.
3. `createWorldModelServices()` creates a context containing the store, options, clock/id helpers, and internal workflow actions.
4. Each per-service factory returns the same service methods that currently exist.
5. Service methods call the store only through `WorldModelStore`.
6. Evidence confirmation still creates evidence, creates likelihood runs when estimator outputs exist, applies Bayesian updates, and records rollback-capable update events.
7. Source runs and evidence loops still process observations through the same dedupe, recommendation, review-only, auto-confirm, and failure-suppression paths.

## Error Handling

Error behavior must remain unchanged:

- Missing records still throw the same `Belief not found`, `Hypothesis not found`, `Observation not found`, `Evidence not found`, `Source not found`, and `Update event not found` errors.
- Validation still uses the existing Zod schemas.
- Source run partial-failure behavior remains unchanged: query sources keep successful observations and fail only when all query fetches fail.
- Automation downgrade reasons remain unchanged.
- Credential and external service error redaction behavior remains unchanged.

## Testing Strategy

Use existing behavior tests as the main safety net:

- `tests/server/world-model-services.test.ts`
- `tests/server/configured-services.test.ts`
- `tests/server/source-adapters.test.ts`
- API route tests that exercise service composition.
- `npm run test` as the final behavior gate.

Add one architecture test:

- Verify the eight expected service module files exist.
- Verify `world-model-services.ts` imports the eight service factories.
- Verify `world-model-services.ts` is below a focused composition-root threshold.

The architecture test is intentionally file-structure based because this refactor has no intended user-visible behavior change.

## Implementation Strategy

Do this as incremental refactor tasks:

1. Add architecture test first and watch it fail.
2. Add shared context and move option types without changing behavior.
3. Extract low-risk leaf services first: model, likelihood, update facade.
4. Extract observation service.
5. Extract evidence/update workflow helpers.
6. Extract belief service.
7. Extract source and automation services last because they have the most closure coupling.
8. Keep `world-model-services.ts` compiling after each task.
9. Commit each stage after focused tests pass.

## Success Criteria

- `WorldModelServices` public type remains unchanged.
- API routes and UI code require no changes.
- `src/server/services/world-model-services.ts` becomes a composition root instead of a business workflow file.
- The eight per-service modules exist and return their corresponding `WorldModelServices[...]` object.
- No direct Prisma imports are introduced outside allowed files.
- Existing behavior test suite passes.
- Required verification passes:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run observe -- --dry-run`
  - `npm run build`

## Risks And Mitigations

- Risk: circular dependencies between services.
  - Mitigation: keep cross-domain operations in internal workflow modules and expose them through context actions.

- Risk: behavior changes during mechanical moves.
  - Mitigation: move code in small stages and run focused tests after each stage.

- Risk: source/automation split is too large for one edit.
  - Mitigation: extract helper workflows before extracting public service factories.

- Risk: type exports drift between modules.
  - Mitigation: keep public service types in `src/server/services/types.ts` and infer factory return types from `WorldModelServices[...]`.

## Non-Goals

- This refactor will not solve Linux deployment supervision.
- This refactor will not implement Reddit or Telegram.
- This refactor will not change auto-settlement policy.
- This refactor will not change model scoring behavior.
