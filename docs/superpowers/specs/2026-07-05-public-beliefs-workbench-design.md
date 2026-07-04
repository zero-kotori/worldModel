# Public Beliefs Workbench Design

## Goal

Turn `myWeb /beliefs` into a public-facing belief workbench that resembles the private `worldModel` belief architecture while excluding personal/internal belief data.

## Scope

- Keep `worldModel` as the source of truth.
- Keep `/admin/world-model` private and unchanged as the admin proxy route.
- Expose only active external beliefs on the public page.
- Keep the existing public submission form.
- Do not expose observations, evidence, sources, model data, update events, automation state, credentials, or internal recommendations.

## Data Boundary

The public dataset is:

- `Belief.origin = EXTERNAL`
- `Belief.status = ACTIVE`
- `Hypothesis.status = ACTIVE`

Returned fields are limited to:

- belief: title, category, description, probability mode, origin, status, timestamps
- hypothesis: proposition, stance, prior probability, current probability, status, timestamps

Personal/internal beliefs stay private even if active.

## Architecture

1. `myWeb /beliefs` renders a server page.
2. The server page calls `myWeb` HMAC helper.
3. The helper sends a signed GET request to `worldModel /api/public-beliefs`.
4. `worldModel` verifies the signature, reads beliefs from the service layer, filters to active external records, projects a public DTO, and returns JSON.
5. `myWeb` renders a public workbench from the DTO and keeps the existing submit form below it.

## UI Shape

The page uses a public version of the admin belief architecture:

- Overview metrics: public belief count, active hypothesis count, average confidence.
- Belief cards: title, category, probability mode, source marker, description.
- Hypothesis table: proposition, stance, prior probability, current probability, status.
- Lightweight graph section: belief-to-hypothesis rows with no private evidence or update data.
- Submission form: the existing external belief form.

When no public beliefs exist, the public sections render empty states and the submission form remains available.

## Tests

- `worldModel` API rejects unsigned GET in proxy mode.
- `worldModel` API returns only active external beliefs and active hypotheses.
- `myWeb` GET helper signs the same canonical payload as the POST helper.
- `myWeb /beliefs` renders public belief data and keeps the submission form.

## Risks

- External submissions are public after creation. This follows the chosen direct external-belief workflow.
- The public page intentionally does not show internal beliefs; if a curated public subset of internal beliefs is needed later, add an explicit `publicVisible` field instead of overloading `origin`.
