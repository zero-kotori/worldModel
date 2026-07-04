# myWeb Public Beliefs Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public `myWeb /beliefs` page that submits complete external belief tables into `worldModel`, while keeping admin views internal-only by default.

**Architecture:** `worldModel` remains the data owner and adds `Belief.origin`. `myWeb` adds a public form and signs server-side API requests to `worldModel` with the existing HMAC protocol. Admin UI naming changes to `信念`, while `/admin/world-model` stays as the stable proxy path.

**Tech Stack:** Next.js App Router, Server Actions, Prisma, TypeScript, Vitest, existing HMAC proxy utilities.

---

## File Map

worldModel:

- Modify: `prisma/schema.prisma` — add `BeliefOrigin` and `Belief.origin`.
- Create: `prisma/migrations/20260705090000_add_belief_origin/migration.sql` — add enum and defaulted column.
- Modify: `src/server/services/types.ts` — add `BeliefOrigin` and carry `origin` through record/input types.
- Modify: `src/server/services/internal/schemas.ts` — validate optional `origin`.
- Modify: `src/server/services/internal/belief-workflow.ts` — default internal creation and preserve requested origin.
- Modify: `src/server/services/prisma-store.ts` — map `origin` to/from Prisma.
- Modify: `src/server/services/in-memory-store.ts` — clone and preserve `origin`.
- Create: `src/app/api/public-beliefs/route.ts` — signed public creation endpoint that forces `EXTERNAL`.
- Modify: `src/app/admin/world-model/data.ts` — support `includeExternalBeliefs`.
- Modify: `src/app/admin/world-model/beliefs/page.tsx` — add external toggle and source marker.
- Modify: `src/app/admin/world-model/layout.tsx` — rename shell heading to `信念`.
- Test: `tests/server/world-model-services.test.ts` — origin persistence behavior.
- Test: `tests/api/public-beliefs-route.test.ts` — signed external creation and unsigned rejection.
- Test: `tests/app/world-model-data.test.ts` or `tests/ui/beliefs-page.test.ts` — admin filtering.

myWeb:

- Create: `src/lib/world-model-proxy.ts` — shared server-side HMAC request helper.
- Create: `src/app/beliefs/actions.ts` — public form submission action.
- Create: `src/app/beliefs/page.tsx` — public belief form.
- Modify: `src/components/Nav.tsx` — add public `信念` link.
- Modify: `src/components/AdminNav.tsx` — rename admin `世界模型` link to `信念`.
- Create or use local checks for action helper behavior if no test harness exists.

## Task 1: Add Belief Origin To worldModel Data Layer

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260705090000_add_belief_origin/migration.sql`
- Modify: `src/server/services/types.ts`
- Modify: `src/server/services/internal/schemas.ts`
- Modify: `src/server/services/internal/belief-workflow.ts`
- Modify: `src/server/services/prisma-store.ts`
- Modify: `src/server/services/in-memory-store.ts`
- Test: `tests/server/world-model-services.test.ts`

- [ ] **Step 1: Write failing service test**

Add tests that create a default belief and an external belief through `services.beliefs.createBelief()`, then assert `origin`.

Run: `npx vitest run tests/server/world-model-services.test.ts -t "belief origin"`

Expected: fail because `origin` does not exist on `BeliefRecord`.

- [ ] **Step 2: Add Prisma schema and migration**

Add:

```prisma
enum BeliefOrigin {
  INTERNAL
  EXTERNAL
}

model Belief {
  origin BeliefOrigin @default(INTERNAL)
}
```

Migration SQL:

```sql
CREATE TYPE "BeliefOrigin" AS ENUM ('INTERNAL', 'EXTERNAL');
ALTER TABLE "Belief" ADD COLUMN "origin" "BeliefOrigin" NOT NULL DEFAULT 'INTERNAL';
CREATE INDEX "Belief_origin_status_idx" ON "Belief"("origin", "status");
```

- [ ] **Step 3: Update TypeScript service types**

Add:

```ts
export type BeliefOrigin = "INTERNAL" | "EXTERNAL";

export type BeliefRecord = {
  origin: BeliefOrigin;
};

export type CreateBeliefInput = {
  origin?: BeliefOrigin;
};
```

Keep `UpdateBeliefInput` without origin unless implementation finds an existing admin edit path needs it.

- [ ] **Step 4: Update service validation and creation**

Allow optional origin in `createBeliefSchema` and default to `INTERNAL` inside `createBelief`.

Implementation rule:

```ts
origin: parsed.origin ?? "INTERNAL"
```

- [ ] **Step 5: Update stores**

Prisma mapping:

```ts
origin: record.origin
```

Prisma create data:

```ts
origin: input.origin
```

In-memory store clones can preserve origin through object spread once the record type includes it.

- [ ] **Step 6: Verify service test passes**

Run: `npx vitest run tests/server/world-model-services.test.ts -t "belief origin"`

Expected: pass.

## Task 2: Add Signed Public worldModel Creation Endpoint

**Files:**
- Create: `src/app/api/public-beliefs/route.ts`
- Test: `tests/api/public-beliefs-route.test.ts`

- [ ] **Step 1: Write failing route tests**

Test behaviors:

- unsigned POST in proxy mode returns 401.
- signed POST creates a belief with `origin: "EXTERNAL"` even if body omits or overrides origin.
- response includes only minimal created identity.

Run: `npx vitest run tests/api/public-beliefs-route.test.ts`

Expected: fail because route does not exist.

- [ ] **Step 2: Implement route**

Create `POST` route that:

```ts
const input = await readJson<CreateBeliefInput>(request);
const services = getWorldModelServices();
const belief = await services.beliefs.createBelief({ ...input, origin: "EXTERNAL" });
return jsonOk({ id: belief.id }, { status: 201 });
```

Use `readJson` so proxy signature verification remains consistent.

- [ ] **Step 3: Verify route tests pass**

Run: `npx vitest run tests/api/public-beliefs-route.test.ts`

Expected: pass.

## Task 3: Add Admin External Filtering And Rename worldModel Shell

**Files:**
- Modify: `src/app/admin/world-model/data.ts`
- Modify: `src/app/admin/world-model/beliefs/page.tsx`
- Modify: `src/app/admin/world-model/layout.tsx`
- Test: `tests/app/world-model-data.test.ts`
- Test: `tests/ui/beliefs-page.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests for:

- `loadWorldModelData()` hides `EXTERNAL` beliefs by default.
- `loadWorldModelData({ includeExternalBeliefs: true })` includes them.
- beliefs page renders a link or toggle to include external beliefs.

Run: `npx vitest run tests/app/world-model-data.test.ts tests/ui/beliefs-page.test.ts -t "external"`

Expected: fail because filtering does not exist.

- [ ] **Step 2: Add data loader option**

Change signature:

```ts
export async function loadWorldModelData(options: { includeExternalBeliefs?: boolean } = {})
```

Filter:

```ts
const visibleBeliefs = options.includeExternalBeliefs ? beliefs : beliefs.filter((belief) => belief.origin !== "EXTERNAL");
```

- [ ] **Step 3: Wire page query toggle**

Read `external=1` from search params, call:

```ts
const data = await loadWorldModelData({ includeExternalBeliefs: firstParam(params.external) === "1" });
```

Render a compact link between internal-only and include-external states. External cards show a source marker.

- [ ] **Step 4: Rename shell**

Change heading text from `世界模型` to `信念`. Keep route and component names unchanged.

- [ ] **Step 5: Verify admin tests pass**

Run: `npx vitest run tests/app/world-model-data.test.ts tests/ui/beliefs-page.test.ts -t "external"`

Expected: pass.

## Task 4: Add myWeb HMAC Helper And Public Submission Action

**Files:**
- Create: `../myWeb/src/lib/world-model-proxy.ts`
- Create: `../myWeb/src/app/beliefs/actions.ts`

- [ ] **Step 1: Create server helper**

Add a server-only helper that reads `WORLDMODEL_BASE_URL` and `WORLDMODEL_PROXY_SECRET`, computes the same body hash and signature as the existing admin proxy, and posts JSON to a target path.

Required signature payload:

```ts
[method.toUpperCase(), path, timestamp, hash].join("\n")
```

- [ ] **Step 2: Create submit action**

`submitPublicBeliefAction(formData)` should parse fields, construct:

```ts
{
  title,
  description,
  category,
  probabilityMode,
  origin: "EXTERNAL",
  hypotheses: [
    { proposition, priorProbability, stance, notes: "", evidenceSearchQuery: "" },
    { proposition, priorProbability, stance, notes: "", evidenceSearchQuery: "" }
  ]
}
```

Forward to `/api/public-beliefs` and redirect to `/beliefs?submitted=1` on success.

- [ ] **Step 3: Run typecheck for new helper/action**

Run: `npm run typecheck`

Expected: pass or fail only on pre-existing unrelated project state.

## Task 5: Add myWeb Public Page And Navigation Labels

**Files:**
- Create: `../myWeb/src/app/beliefs/page.tsx`
- Modify: `../myWeb/src/components/Nav.tsx`
- Modify: `../myWeb/src/components/AdminNav.tsx`

- [ ] **Step 1: Add public page**

Use `PageShell` with title `信念`. Render a compact form with stable field names consumed by `submitPublicBeliefAction`.

Fields:

- `title`
- `description`
- `category`
- `probabilityMode`
- `proposition1`
- `priorProbability1`
- `stance1`
- `proposition2`
- `priorProbability2`
- `stance2`

- [ ] **Step 2: Add navigation label**

Public nav gains `["信念", "/beliefs"]`.

Admin nav changes `["世界模型", "/admin/world-model"]` to `["信念", "/admin/world-model"]`.

- [ ] **Step 3: Verify myWeb typecheck**

Run in `../myWeb`: `npm run typecheck`

Expected: pass or fail only on existing unrelated state.

## Task 6: Full Verification And Commits

**Files:**
- worldModel changed files from Tasks 1-3.
- myWeb changed files from Tasks 4-5.

- [ ] **Step 1: worldModel focused verification**

Run:

```bash
npx vitest run tests/server/world-model-services.test.ts -t "belief origin"
npx vitest run tests/api/public-beliefs-route.test.ts
npx vitest run tests/app/world-model-data.test.ts tests/ui/beliefs-page.test.ts -t "external"
npm run typecheck
```

Expected: pass.

- [ ] **Step 2: myWeb focused verification**

Run in `../myWeb`:

```bash
npm run typecheck
```

Expected: pass.

- [ ] **Step 3: Commit worldModel changes**

Run:

```bash
git status --short
git add prisma/schema.prisma prisma/migrations/20260705090000_add_belief_origin/migration.sql src tests
git commit -m "feat: support external public beliefs"
```

- [ ] **Step 4: Commit myWeb changes**

Run in `../myWeb`:

```bash
git status --short
git add src
git commit -m "feat: add public beliefs submission"
```

## Self-Review

- Spec coverage: the plan covers public page, admin naming, external origin persistence, admin filtering, signed proxy submission, security preservation, and focused verification.
- Placeholder scan: no task depends on unspecified later work.
- Type consistency: the canonical field is `origin`, with values `INTERNAL` and `EXTERNAL`; the public endpoint is `/api/public-beliefs`; the public route is `/beliefs`; the admin route remains `/admin/world-model`.
