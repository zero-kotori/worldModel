## Core Workflow

WorldModel models belief updates as an auditable evidence pipeline:

```mermaid
flowchart LR
  Belief["Belief<br/>What do I currently think?"]
  Hypothesis["Hypothesis<br/>What concrete claim can change?"]
  Observation["Observation<br/>What did a source produce?"]
  Evidence["Evidence<br/>What has been confirmed?"]
  Likelihood["Likelihood Scoring<br/>How strongly does it support or oppose?"]
  Update["Bayesian Update<br/>How should probability move?"]
  Audit["Audit / Rollback<br/>Why did it move, and can it be undone?"]

  Belief --> Hypothesis
  Hypothesis --> Observation
  Observation --> Evidence
  Evidence --> Likelihood
  Likelihood --> Update
  Update --> Audit
  Audit -.review.-> Evidence
```

The important boundary is that observations do not directly change probabilities. An item collected from RSS, GitHub, Hugging Face, GDELT, Polymarket, or manual input first enters the observation pool. It only affects a hypothesis after it is confirmed as evidence, linked to one or more hypotheses, scored for relevance and likelihood, and applied through a Bayesian update event.

Each update stores prior snapshots, posterior snapshots, evidence links, likelihood outputs, confidence, explanations, and rollback state. This makes the system useful for answering the interview-style question: "Why did this probability change, and how would you safely undo it?"

## Technical Highlights

- **Evidence graph data model**: beliefs, hypotheses, sources, observations, evidence, evidence-hypothesis links, likelihood runs, and Bayesian update events form a traceable graph.
- **Bayesian update core**: pure TypeScript domain functions handle independent and mutually exclusive probability updates without framework or database dependencies.
- **Automated evidence loop**: active hypotheses generate search plans, enabled sources collect observations, duplicate and low-impact observations are routed into queues, and strong candidates can be auto-confirmed only after safety checks.
- **Query Planner**: manual `evidenceSearchQuery` wins when present; comparison-style hypotheses generate benchmark/comparison/prediction-market queries; uncovered cases fall back to deterministic cleaned base queries.
- **LLM-assisted scoring with conservative guards**: LLM scoring produces direction, relevance, likelihood ratio, confidence, rationale, and review flags. Auto-apply is downgraded to review-only when quality or hypothesis coverage is risky.
- **Operator cleanup controls**: duplicate candidates default to rejection; unknown and low-impact observations can be kept, rejected, or soft-deleted per run or worker config.
- **Graph workspace**: the UI can focus on a selected node, show only related entities, edit graph-side records, and hide archived, rejected, or deleted entities by default.
- **Auditable automation**: observation runs track item counts, deduplication, candidates, auto-applies, review items, low-impact items, unmatched items, query summaries, and errors.
- **Production-style testing**: the project has coverage across domain logic, service workflows, API routes, UI rendering, scripts, source adapters, worker behavior, auth, and migration safety.

## Architecture

The codebase is intentionally layered so the probability engine and business rules remain testable outside the UI and database:

```text
app / components
  Next.js routes, Server Actions, React UI
        |
        v
server
  services, Prisma store, source adapters, automation workers, model integration
        |
        v
lib
  UI-facing pure helpers, graph layout, display models, routing helpers
        |
        v
domain
  pure Bayesian updates, likelihood ensemble, dedupe, update previews
```

Key implementation areas:

```text
src/domain/
  bayes.ts, likelihood.ts, dedupe.ts, updates.ts

src/server/services/
  belief-service.ts
  observation-service.ts
  evidence-service.ts
  likelihood-service.ts
  update-service.ts
  source-service.ts
  automation-service.ts
  model-service.ts
  prisma-store.ts
  in-memory-store.ts

src/server/services/internal/
  query-planner.ts
  evidence-queries.ts
  recommendations.ts
  schemas.ts
  shared.ts

src/components/world-model/
  WorldModelGraphView.tsx
  WorldModelNav.tsx
  Field.tsx
  PendingSubmitButton.tsx
```

Database access is constrained behind `WorldModelStore`. Service code depends on the store interface rather than importing Prisma directly, which keeps the in-memory test implementation and Prisma implementation aligned.

## UI Walkthrough

The admin UI is available under `/admin/world-model/*`.

- `/admin/world-model`: dashboard summary, automation health, review entry points, and recent updates.
- `/admin/world-model/graph`: primary relationship graph workspace for sources, beliefs, hypotheses, observations, evidence, and update events.
- `/admin/world-model/beliefs`: belief tables, hypotheses, probability structures, status changes, and hypothesis recommendations.
- `/admin/world-model/observations`: pending candidates, unknown evidence queue, duplicate candidates, bulk cleanup, manual observation entry, and confirmation paths.
- `/admin/world-model/evidence`: evidence library, evidence-hypothesis links, update previews, apply/reapply, reject/delete, and rollback workflows.
- `/admin/world-model/sources`: source presets, source configuration, dry-runs, automated evidence loop, cleanup policies, and worker configuration.
- `/admin/world-model/models`: LLM configuration, evaluation results, training sample fetches, lightweight model training, model artifact import, and likelihood audit.

## Local Development

Use standalone mode when the host does not run `myWeb`.

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the bundled Docker Postgres:

   ```bash
   docker compose up -d postgres
   ```

3. Create local env:

   ```bash
   cp .env.example .env.local
   ```

   The default `.env.example` is ready for Docker Postgres:

   ```env
   WORLDMODEL_DATABASE_URL="postgresql://postgres:postgres@localhost:5433/worldmodel?schema=public"
   WORLDMODEL_ACCESS_MODE="standalone"
   ```

4. Apply database migrations:

   ```bash
   set -a
   . ./.env.local
   set +a
   npx prisma migrate deploy
   ```

5. Start the app:

   ```bash
   npm run dev
   ```

6. Open:

   ```text
   http://localhost:3100/admin/world-model
   ```

For a Docker-managed app process instead of `npm run dev`, use:

```bash
docker compose up -d --build
```

## myWeb Proxy Mode

Use this mode when `myWeb` provides the protected admin entry.

In `worldModel/.env.local`:

```env
WORLDMODEL_ACCESS_MODE="proxy"
WORLDMODEL_PROXY_SECRET="same-random-secret-as-myWeb"
```

In `myWeb/.env.local`:

```env
WORLDMODEL_BASE_URL="http://127.0.0.1:3100"
WORLDMODEL_PROXY_SECRET="same-random-secret-as-worldModel"
```

In proxy mode, unsigned direct requests to `worldModel` return `401`.

## Verification

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run observe -- --dry-run
```

For browser checks, start the app first, then run:

```bash
npm run test:browser
```

Current regression coverage includes 700+ tests across domain logic, services, API routes, UI pages, source adapters, automation workers, scripts, auth, and migration checks.

## Documentation

- [Product requirements](docs/ai/world-model-requirements.md)
- [Technical design](docs/ai/world-model-technical-design.md)
- [UI guide](docs/ai/world-model-ui-guide.md)
- [Rollout notes](docs/ai/world-model-rollout.md)
