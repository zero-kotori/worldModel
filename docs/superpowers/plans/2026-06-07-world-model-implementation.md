# World Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a private world-model application that records beliefs, hypotheses, observations, evidence, likelihood estimates, and Bayesian updates, with a full UI accessible through the existing personal website admin area.

**Architecture:** `worldModel` is an independent Next.js full-stack app with its own Prisma schema and Postgres database. `myWeb` exposes `/admin/world-model/*` as an admin-only same-domain proxy to the complete `worldModel` UI, using an internal signed request header so `worldModel` is not directly accessible without the proxy.

**Tech Stack:** Next.js, React, TypeScript, Prisma, Postgres, Tailwind CSS, Vitest, Python training scripts, OpenAI-compatible LLM adapters, cron/systemd-triggered observation scripts.

---

## Scope And Decisions

- The app is private admin-only software, not a public prediction page.
- The first domain categories are AI technology trends, investment judgments, other technology trends, career-direction judgments, and information-source reliability.
- A belief is a container for related hypotheses. A hypothesis is the probability-bearing unit with proposition, time horizon or expiry condition, current strength, status, and audit history.
- A belief can use either mutually exclusive hypotheses, where probabilities normalize to 1, or independent hypotheses, where each hypothesis updates separately.
- Observations are raw items from manual entry or external sources. Evidence is an observation that has been confirmed manually or by an allowed auto-confirm policy.
- One evidence item can affect multiple hypotheses. Each evidence-hypothesis relation stores relevance, direction, source credibility, likelihood output, update impact, and rationale.
- Likelihood estimation uses an ensemble of three estimator families: explainable lightweight model, LLM scorer, and external deep-model adapter. Any estimator can abstain.
- Training does not rely on the user manually labeling large datasets. Cold-start data comes from public historical and forecasting sources; settled personal hypotheses are used later for calibration.
- Social or platform credentials are stored in environment variables or local secret files, never in Git and not in the application database.

## Repository Layout

- Create `worldModel` app files in the current directory:
  - `src/domain`: pure TypeScript domain logic for beliefs, hypotheses, evidence, likelihoods, and Bayesian updates.
  - `src/server`: Prisma access, server-side services, proxy-auth verification, source runners, and model loading.
  - `src/app`: Next.js routes and admin UI.
  - `src/components`: UI components shared across world-model pages.
  - `src/lib`: common utilities, formatting, validation, and environment parsing.
  - `prisma/schema.prisma`: independent world-model database schema.
  - `scripts`: observation, training, and model-import commands.
  - `tests`: unit and integration tests.
- Modify `../myWeb` only for integration:
  - `../myWeb/src/components/AdminNav.tsx`: add the world-model admin entry.
  - `../myWeb/src/app/admin/world-model/[...path]/route.ts`: same-domain proxy guarded by `requireAdmin()`.
  - `../myWeb/.env.example`: add non-secret proxy configuration placeholders.

## Data Model

Implement these Prisma concepts in `worldModel`:

- `Belief`
  - `id`, `title`, `category`, `description`, `probabilityMode`, `status`, `createdAt`, `updatedAt`.
  - `probabilityMode`: `MUTUALLY_EXCLUSIVE` or `INDEPENDENT`.
- `Hypothesis`
  - `id`, `beliefId`, `proposition`, `notes`, `priorProbability`, `currentProbability`, `strength`, `status`, `startsAt`, `expiresAt`, `expiryCondition`, `resolvedOutcome`, `createdAt`, `updatedAt`.
- `ObservationSource`
  - `id`, `name`, `kind`, `url`, `adapter`, `credentialRef`, `credibility`, `enabled`, `autoConfirm`, `autoConfirmThreshold`, `createdAt`, `updatedAt`.
- `Observation`
  - `id`, `sourceId`, `title`, `content`, `url`, `author`, `publishedAt`, `observedAt`, `normalizedHash`, `semanticKey`, `status`, `duplicateOfId`, `credibility`, `metadata`.
- `Evidence`
  - `id`, `observationId`, `title`, `content`, `url`, `confirmedAt`, `confirmationMode`, `credibility`, `status`, `metadata`.
- `EvidenceHypothesisLink`
  - `id`, `evidenceId`, `hypothesisId`, `direction`, `relevance`, `likelihoodRatio`, `confidence`, `rationale`, `createdAt`.
- `LikelihoodRun`
  - `id`, `evidenceId`, `hypothesisId`, `ensembleLikelihoodRatio`, `ensembleConfidence`, `estimatorOutputs`, `modelVersion`, `createdAt`.
- `BayesianUpdateEvent`
  - `id`, `beliefId`, `evidenceId`, `likelihoodRunId`, `priorSnapshot`, `posteriorSnapshot`, `mode`, `status`, `createdAt`, `rolledBackAt`.
- `ObservationRun`
  - `id`, `sourceId`, `status`, `startedAt`, `finishedAt`, `itemCount`, `deduplicatedCount`, `errorMessage`.
- `ModelArtifact`
  - `id`, `name`, `kind`, `version`, `path`, `metrics`, `enabled`, `createdAt`.

## Domain Interfaces

Implement the core domain as pure functions first, then wire database services around them:

- `normalizeMutuallyExclusive(probabilities: number[]): number[]`
- `updateIndependentHypothesis(prior: number, likelihoodRatio: number, credibility: number): number`
- `updateMutuallyExclusiveHypotheses(priors: number[], likelihoodRatios: number[], credibility: number): number[]`
- `combineEstimatorOutputs(outputs): EnsembleLikelihood`
- `deduplicateObservation(candidate, existing): DuplicateDecision`
- `createUpdatePreview(belief, evidenceLinks): UpdatePreview`
- `applyUpdate(preview): BayesianUpdateEvent`
- `rollbackUpdate(event): RollbackResult`

The Bayesian update uses odds form for independent hypotheses and normalized posterior mass for mutually exclusive hypotheses. Credibility discounts likelihood ratios toward neutral `1.0`.

## Phase 1: Project Scaffold

- [ ] Create a Next.js app in `/home/ubuntu/worldModel` using TypeScript, app router, Tailwind, ESLint, and Vitest.
- [ ] Add Prisma and configure `WORLDMODEL_DATABASE_URL`.
- [ ] Add `.env.example` with only non-secret placeholders.
- [ ] Add scripts:
  - `dev`: run Next.js locally.
  - `build`: generate Prisma client and build Next.js.
  - `lint`: run ESLint.
  - `typecheck`: run TypeScript checks.
  - `test`: run Vitest.
  - `prisma:generate`: generate Prisma client.
  - `prisma:migrate`: run Prisma migrations.
  - `observe`: run observation ingestion.
  - `train:prepare`: prepare public training data.
  - `train:light`: train lightweight model.
  - `model:import`: import model artifacts.
- [ ] Verify scaffold with `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build`.

## Phase 2: Core Domain Logic

- [ ] Write failing tests for independent Bayesian updates:
  - neutral likelihood leaves probability unchanged.
  - positive likelihood increases probability.
  - credibility below 1 discounts the update.
- [ ] Implement independent update logic.
- [ ] Write failing tests for mutually exclusive updates:
  - posterior probabilities sum to 1.
  - hypothesis with stronger likelihood gains mass.
  - neutral evidence keeps distribution stable.
- [ ] Implement mutually exclusive update logic.
- [ ] Write failing tests for estimator ensemble:
  - combines weighted estimator outputs.
  - ignores abstained estimators.
  - returns review-required when all estimators abstain.
- [ ] Implement estimator ensemble logic.
- [ ] Write failing tests for duplicate decisions:
  - exact URL duplicate.
  - normalized content hash duplicate.
  - near-duplicate semantic key within time window.
- [ ] Implement deterministic deduplication logic.

## Phase 3: Database And Services

- [ ] Add Prisma enums and models from the Data Model section.
- [ ] Generate migration for independent Postgres schema.
- [ ] Create service modules for beliefs, hypotheses, observations, evidence, likelihood runs, update events, and model artifacts.
- [ ] Ensure service methods validate inputs with Zod or equivalent schema validation.
- [ ] Add integration tests against a test database or isolated transaction strategy for:
  - creating a belief and hypotheses.
  - ingesting an observation.
  - confirming observation as evidence.
  - linking evidence to multiple hypotheses.
  - applying and rolling back a Bayesian update.

## Phase 4: worldModel UI

- [ ] Build `/admin/world-model` dashboard with metrics for beliefs, active hypotheses, pending observations, confirmed evidence, and recent update events.
- [ ] Build `/admin/world-model/beliefs` for belief and hypothesis creation/editing.
- [ ] Build `/admin/world-model/observations` for observation pool review, duplicate display, unknown evidence handling, and manual confirmation.
- [ ] Build `/admin/world-model/evidence` for evidence-hypothesis linking and update preview.
- [ ] Build `/admin/world-model/sources` for source configuration, credibility, adapter type, auto-confirm settings, and manual run button.
- [ ] Build `/admin/world-model/models` for estimator weights, model artifacts, model version status, and estimator health.
- [ ] Keep UI dense and operational, matching admin-tool conventions rather than marketing layout.

## Phase 5: Proxy Auth And myWeb Integration

- [ ] In `worldModel`, add middleware or server guard that requires an internal proxy signature for all app and API routes.
- [ ] Signature input should include method, path, timestamp, and body hash where applicable.
- [ ] Reject missing, expired, or invalid signatures with 401.
- [ ] In `../myWeb`, add `/admin/world-model/[...path]/route.ts`.
- [ ] The route must call `requireAdmin()` before proxying.
- [ ] The route signs requests using `WORLDMODEL_PROXY_SECRET`.
- [ ] Add `WORLDMODEL_BASE_URL` and `WORLDMODEL_PROXY_SECRET` placeholders to `../myWeb/.env.example`, without real secrets.
- [ ] Add “世界模型” to `AdminNav`.
- [ ] Verify unauthenticated requests are redirected or rejected by myWeb, and direct unsigned requests to worldModel are rejected.

## Phase 6: Observation Sources

- [ ] Implement source adapters with a common output shape:
  - manual input.
  - RSS.
  - generic web page.
  - web search.
  - GitHub trend/events.
  - Hugging Face models/datasets.
  - GDELT/news event streams.
  - prediction market APIs.
  - social platform adapters using CLI/cookie-based credentials where available.
- [x] Store adapter configuration in `ObservationSource`.
- [x] Store credentials only as `credentialRef`.
- [x] Add `npm run observe -- --dry-run` to fetch and deduplicate without writing evidence.
- [x] Add observation run logs for success, failure, item count, and duplicate count.
- [x] Keep all fetched items as observations until confirmation or allowed auto-confirm policy.

## Phase 7: Likelihood Models And Training

- [x] Define estimator interface in TypeScript:
  - input: evidence text, hypothesis proposition, category, source credibility, optional context.
  - output: likelihood ratio, confidence, rationale, model version, or abstain.
- [x] Implement explainable lightweight fallback estimator using trained artifacts and transparent features.
- [x] Implement LLM estimator adapter with provider abstraction:
  - DeepSeek.
  - OpenAI.
  - local OpenAI-compatible endpoint.
- [ ] Implement external deep-model adapter that loads precomputed model artifacts or calls an internal endpoint.
- [x] Add data preparation scripts for validated external samples and locally confirmed evidence links.
- [x] Add Python lightweight training script that exports versioned model artifacts.
- [x] Add model import command that registers artifacts in `ModelArtifact`.
- [ ] If local server compute is insufficient, run training on the user's local computer and import exported artifacts.

## Phase 8: Acceptance And Verification

- [x] Unit checks:
  - Bayesian updates.
  - estimator ensemble.
  - deduplication.
  - source credibility discounting.
  - update rollback.
- [x] Integration checks:
  - full manual belief-to-update workflow.
  - observation source dry run.
  - observation confirmation.
  - multi-hypothesis evidence link.
  - model artifact import.
  - worldModel-side signed proxy access.
- [x] Browser checks:
  - desktop and mobile render of dashboard, beliefs, observations, evidence, sources, and models pages.
  - no blank pages.
  - no incoherent overlap in dense admin views.
- [ ] Final commands before completion:
  - in `D:\working\worldModel`: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, `npm run observe -- --dry-run`.
  - in `D:\working\myWeb`: `npm run typecheck`, `npm run build`, and existing browser/acceptance checks if affected by proxy changes.

## Risks And Mitigations

- Public data quality may not map cleanly to personal hypothesis likelihoods. Mitigate by keeping estimator rationales, confidence, abstention, and manual review.
- Social platforms may require cookies or have unstable access. Mitigate by adapter boundaries and treating social ingestion as optional source modules.
- Automatic confirmation can corrupt belief probabilities. Mitigate with per-source thresholds, audit events, and rollback.
- Proxy misconfiguration can expose private data. Mitigate with myWeb admin gate plus worldModel internal signature verification.
- Training may exceed server resources. Mitigate by making model artifacts portable and importable after local training.

## Implementation Order

1. Scaffold `worldModel` and establish verification commands.
2. Implement pure domain logic with tests.
3. Add Prisma data model and services.
4. Build the worldModel admin UI.
5. Add signed proxy integration in `myWeb`.
6. Add observation source runners and deduplication workflows.
7. Add likelihood estimator ensemble and training artifact pipeline.
8. Run full verification and document any remaining operational setup.
