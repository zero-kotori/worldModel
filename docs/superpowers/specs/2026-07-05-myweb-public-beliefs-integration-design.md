# myWeb Public Beliefs Integration Design

## Goal

Expose a public `myWeb` page named `信念` where visitors can submit a complete belief table, while keeping `worldModel` as the only system of record. Submitted public beliefs are stored in `worldModel` with an explicit external origin and can be hidden or shown in the private admin UI.

## Scope

- Add public `myWeb` route `/beliefs`.
- Add a public navigation item named `信念`.
- Rename the `myWeb` admin navigation entry from `世界模型` to `信念`.
- Rename the `worldModel` admin shell heading from `世界模型` to `信念`.
- Keep the existing admin proxy route `/admin/world-model`.
- Add `INTERNAL` and `EXTERNAL` belief origin support in `worldModel`.
- Store public form submissions as `Belief.origin = EXTERNAL`.
- Add an admin toggle/filter that includes or hides external beliefs.
- Preserve the existing proxy-mode security model.

Out of scope:

- Merging `worldModel` into `myWeb`.
- Moving `worldModel` tables into the `myWeb` database.
- Publishing private admin evidence, observations, sources, updates, or model data.
- Adding async moderation workflow before creation.

## Architecture

The integration remains a two-service setup:

1. A visitor opens `myWeb /beliefs`.
2. The page posts to a `myWeb` server action or route handler.
3. `myWeb` validates and normalizes the submitted belief payload.
4. `myWeb` signs a server-side request using the existing `WORLDMODEL_PROXY_SECRET`.
5. `myWeb` sends the payload to a `worldModel` API endpoint through `WORLDMODEL_BASE_URL`.
6. `worldModel` verifies the HMAC request in proxy mode.
7. `worldModel` creates the belief through the existing service layer with `origin = EXTERNAL`.
8. Admin pages continue to load data through `worldModel` services and decide whether to include external beliefs.

No browser request contains the proxy secret. Public browser traffic never calls `worldModel` directly.

## Data Model

Add a Prisma enum:

```prisma
enum BeliefOrigin {
  INTERNAL
  EXTERNAL
}
```

Add to `Belief`:

```prisma
origin BeliefOrigin @default(INTERNAL)
```

Update all service records and store adapters:

- `BeliefRecord.origin`
- `CreateBeliefInput.origin?`
- `UpdateBeliefInput.origin?` only if admin editing needs it; otherwise origin stays create-only.
- Prisma store mapping and writes.
- In-memory store cloning and writes.

Existing beliefs default to `INTERNAL` through the migration.

## worldModel API

Use the existing `/api/beliefs` POST endpoint if it can safely accept an optional `origin`, or add a narrow `/api/public-beliefs` endpoint if a separate validation surface is clearer.

The public submission path must:

- Require the existing proxy signature in proxy mode.
- Use the same service-layer validation as admin creation.
- Force `origin = EXTERNAL` for public submissions, ignoring any client-provided origin.
- Keep probability validation unchanged.
- Return only a minimal response such as `{ id }`.

The admin `/api/beliefs` path can continue to create internal beliefs by default.

## myWeb Public Page

Add `/beliefs` as a public page using existing `PageShell` and site styling. The page should provide a compact form for:

- Belief title.
- Description.
- Category.
- Probability mode.
- Two hypotheses.
- Initial probability for each hypothesis.
- Hypothesis stance for each hypothesis.

Submission behavior:

- The server side validates required fields and probability ranges before forwarding.
- The server side builds a `CreateBeliefInput` payload with `origin = EXTERNAL`.
- The server side signs and forwards to `worldModel`.
- On success, the page shows a concise state change through redirect/query state or a small status region.
- On failure, the page reports a generic failure without exposing internal service configuration.

The page must not contain implementation notes, admin-only explanations, placeholder copy, or instructions aimed at the repository owner.

## Admin UI

Naming:

- `myWeb` admin nav entry becomes `信念`.
- `worldModel` shell heading becomes `信念`.
- The URL remains `/admin/world-model` to avoid breaking proxy, redirects, and internal links.

Filtering:

- Admin belief data defaults to internal beliefs only.
- A query toggle such as `?external=1` includes external beliefs.
- The beliefs list shows a compact source marker for external records.
- Related pages that aggregate beliefs should either default to internal-only where user-facing decisions could be polluted, or explicitly include external records only when the same toggle is active.

Automation:

- Evidence loops and source automation should continue to use existing service behavior unless explicitly scoped by the admin. This avoids external public submissions silently changing automation scope.

## Security

- `worldModel` stays in `WORLDMODEL_ACCESS_MODE=proxy`.
- `myWeb` is the only public entrypoint for public submissions.
- The proxy secret stays server-side.
- Public submissions must be length-limited.
- Public submissions should be rate-limited at the `myWeb` route level using the existing request headers where practical.
- `worldModel` must reject unsigned direct API calls in proxy mode.

## Testing

worldModel:

- Migration adds `Belief.origin` with `INTERNAL` default.
- Service creates internal beliefs by default.
- Service creates external beliefs when requested by the public endpoint path.
- Prisma store and in-memory store preserve `origin`.
- API rejects unsigned direct public belief creation in proxy mode.
- Admin data filtering hides external beliefs by default and includes them when requested.

myWeb:

- Public `/beliefs` page renders the form.
- Public form submission signs the forwarded request.
- Forwarded payload forces `origin = EXTERNAL`.
- Navigation contains public `信念`.
- Admin navigation labels the existing `/admin/world-model` entry as `信念`.

End-to-end smoke:

- Start `worldModel` on port `3100` in proxy mode.
- Start `myWeb` on port `3000`.
- Submit a public belief through `/beliefs`.
- Confirm direct unsigned access to `worldModel` is rejected.
- Confirm the admin view hides external beliefs by default and shows them when the external toggle is enabled.

## Risks

- Public direct creation can add low-quality beliefs to the same database. The default internal-only admin filter reduces this risk, but it does not replace moderation.
- Adding a schema field requires migration and Prisma client regeneration.
- Any public form copy must be concise and product-facing, not implementation-facing.
