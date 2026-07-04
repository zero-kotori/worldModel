# Public Beliefs Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a public `/beliefs` workbench using active external worldModel belief data while keeping internal belief data private.

**Architecture:** `worldModel` adds signed GET support to `/api/public-beliefs` and returns a sanitized DTO. `myWeb` adds a signed GET helper and renders the DTO above the existing public submission form. The public page resembles the admin belief architecture without exposing evidence, source, model, update, or automation data.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, server-side HMAC fetch, existing worldModel services.

---

## Task 1: worldModel Public Read DTO

**Files:**
- Modify: `src/app/api/public-beliefs/route.ts`
- Modify: `tests/api/public-beliefs-route.test.ts`

- [ ] Write a failing test that signed GET returns only `origin: "EXTERNAL"` and `status: "ACTIVE"` beliefs.
- [ ] Write a failing test that unsigned GET returns 401 in proxy mode.
- [ ] Implement GET by verifying the API request, loading beliefs, filtering external active records and active hypotheses, and returning a limited DTO.
- [ ] Run `npx vitest run tests/api/public-beliefs-route.test.ts`.

## Task 2: myWeb Signed GET Helper

**Files:**
- Modify: `../myWeb/src/lib/world-model-proxy.ts`
- Modify: `../myWeb/tests/world-model-proxy.test.ts`

- [ ] Write a failing helper test for GET headers using an empty body hash.
- [ ] Implement `getWorldModelJson<T>(path: string)`.
- [ ] Run `npx tsx tests/world-model-proxy.test.ts`.

## Task 3: myWeb Public Workbench UI

**Files:**
- Modify: `../myWeb/src/app/beliefs/page.tsx`

- [ ] Add public DTO types local to the page.
- [ ] Fetch public beliefs with `getWorldModelJson`.
- [ ] Render overview metrics, belief cards, hypothesis tables, lightweight graph rows, and the existing submit form.
- [ ] Keep empty states concise and avoid implementation-facing copy.
- [ ] Run `npm run typecheck`, `npm run lint`, and `npm run build` in `../myWeb`.

## Task 4: Verification, Commits, Deploy

**Files:**
- Changed worldModel and myWeb files from previous tasks.

- [ ] Run worldModel focused test, typecheck, lint, build, and dry-run observe.
- [ ] Commit worldModel changes.
- [ ] Run myWeb helper test, typecheck, lint, and build.
- [ ] Commit myWeb changes.
- [ ] Rebuild both Docker Compose stacks and verify `/beliefs` returns 200 and direct unsigned worldModel access returns 401.

## Self-Review

- Spec coverage: public workbench, data boundary, signed API, UI sections, and no internal belief exposure are covered.
- Placeholder scan: no task contains deferred implementation placeholders.
- Type consistency: the public endpoint stays `/api/public-beliefs`; the public route stays `/beliefs`; public data is active external only.
