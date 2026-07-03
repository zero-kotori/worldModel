# Polymarket, X, and External Deep Model Automation Design

## Goal

This design upgrades the current automation loop in three focused areas:

- Strengthen Polymarket as the primary prediction-market source.
- Add credential-based X/Twitter recent-search collection.
- Turn the external deep-model estimator from a registration stub into a real HTTP estimator.

Reddit and Telegram remain out of scope for this phase.

## Current Context

The existing system already has:

- Query-driven source collection through `src/server/sources/adapters.ts`.
- A public `PREDICTION_MARKET` adapter backed by `https://gamma-api.polymarket.com/markets?search={query}`.
- A generic `SOCIAL` adapter that only works for public URL templates and returns no observations when only `credentialRef` is supplied.
- `createExternalModelEstimator()` in `src/server/models/estimators.ts`, but it always abstains even when an endpoint is configured.
- Service composition in `src/server/services/world-model-services.ts`, with `source` and `automation` behavior still coupled in the composition root.

## External API Facts

Polymarket official documentation describes Gamma API, Data API, and public CLOB endpoints as read-oriented endpoints that do not require authentication. The market-data overview lists Gamma endpoints such as `/events`, `/markets`, and `/public-search`, and rate-limit documentation lists separate public limits for Gamma, Data, and CLOB APIs.

For this project, Polymarket does not require the user to apply for an API key because this phase only reads public market data. Polymarket authenticated APIs, wallet signing, trading, order management, and private position data are out of scope. If a later phase adds trading or private account analytics, that later phase must introduce a separate credential and signing design.

X official documentation describes recent search as `GET https://api.x.com/2/tweets/search/recent` and requires a Bearer Token. The endpoint returns recent posts matching a query, with parameters such as `query`, `max_results`, `tweet.fields`, `expansions`, and pagination tokens.

X/Twitter does require a developer account, an approved app, and a Bearer Token for recent-search access. The token is not a Polymarket key and is not the same as the DeepSeek key used by the main LLM scorer.

The external deep model will use an OpenAI-compatible chat-completions contract so the project can support DeepSeek-compatible, OpenAI-compatible, or local inference servers without introducing a provider-specific SDK.

The external deep-model estimator requires a separate model endpoint contract. It can point to an OpenAI-compatible hosted model, a local inference server, or a DeepSeek-compatible endpoint, but it is configured independently from the existing `LLM_*` main scorer so it can be disabled, weighted, and audited separately.

## Phase Boundary Decisions

This phase implements three user-approved areas:

1. Polymarket public market-data collection, with Polymarket as the priority prediction-market source.
2. X/Twitter recent-search collection through a Bearer Token referenced by `credentialRef`.
3. External deep-model HTTP estimation through a separately configured OpenAI-compatible endpoint.

The following items are intentionally deferred:

- Reddit adapter.
- Telegram adapter.
- Browser/cookie scraping for X/Twitter.
- Polymarket trading, wallet signing, private portfolio, and order-management APIs.
- Production process-manager packaging such as systemd units, Windows Task Scheduler XML, PM2, or supervisor configs.
- Full split of all eight service groups into separate service files.

The implementation may still perform a minimal `source-service.ts` / `automation-service.ts` extraction if needed to keep new source and automation code from further growing the composition root, but that extraction is a support task, not a full service-layer rewrite.

## Scope

### Included

- Add a focused Polymarket client inside the source adapter layer.
- Parse Polymarket markets and events into richer `RawObservation` metadata.
- Add optional price/orderbook enrichment for Polymarket market observations when token IDs are available.
- Add X/Twitter Bearer Token collection through `credentialRef`.
- Add an external deep-model HTTP estimator with safe timeout, parsing, abstention, and test coverage.
- Add a light service extraction boundary for source and automation logic only where needed to keep new changes out of the already-large composition root.

### Excluded

- Trading, order placement, wallet signing, positions, or private Polymarket account APIs.
- Browser automation or cookie-based X scraping.
- Reddit and Telegram adapters.
- Production worker deployment packaging.
- Storing API keys, bearer tokens, cookies, or local secret file contents in the database.
- Full rewrite of all service modules in one pass.

## Security Model

Credentials stay outside the database and Git.

`credentialRef` remains a reference name only. Runtime code resolves values from environment variables:

- `X_MAIN_BEARER_TOKEN` for an X source with `credentialRef = "X_MAIN"`.
- `EXTERNAL_MODEL_ENDPOINT`, `EXTERNAL_MODEL_API_KEY`, `EXTERNAL_MODEL_MODEL`, and optional `EXTERNAL_MODEL_VERSION` for the external deep model.
- Existing `LLM_*` variables remain the main LLM scorer configuration. They are not automatically reused by `external-deep-model`.

Logs and observation metadata must not include raw tokens, authorization headers, or secret-bearing URLs. Error messages should include platform, status code, and non-sensitive response summaries only.

## Polymarket Design

### Adapter Mode

Keep `kind = "PREDICTION_MARKET"` and branch by adapter name:

- `polymarket_markets`: search/list markets through Gamma `/markets`.
- `polymarket_events`: search/list events through Gamma `/events`.
- `polymarket_public_search`: use Gamma `/public-search` when configured.

Existing sources that use `polymarket_markets` continue to work.

### Fetch Strategy

For each generated evidence query:

1. Build a Gamma URL from the source template or default template.
2. Fetch JSON with the existing timeout and fallback mechanism.
3. Parse market or event records into observations.
4. For markets with token IDs and enabled enrichment, optionally fetch public CLOB price history or orderbook data.
5. Emit observations with stable URLs, readable titles, concise content, and structured metadata.

### Observation Shape

Polymarket observations should use:

- `title`: `Polymarket: <question or event title>`.
- `content`: question/title, outcomes, outcome prices, active/closed status, volume, liquidity, end date, and category tags when present.
- `url`: canonical Polymarket event or market URL when slug is present.
- `publishedAt`: close/end date only when it represents the market lifecycle timestamp; otherwise leave undefined.
- `sourceMetadata`: include `adapter`, `query`, `source`, `marketId`, `eventId`, `slug`, `conditionId`, `questionId`, `outcomes`, `outcomePrices`, `volume`, `liquidity`, `active`, `closed`, `archived`, `endDate`, and enrichment fields when available.

### Error Handling

- If one query fails and others succeed, keep successful observations.
- If all query requests fail, create a failed observation run with the sanitized platform error.
- If enrichment fails, keep the base market observation and add a non-secret `enrichmentError` field.

## X/Twitter Design

### Adapter Mode

Use `kind = "SOCIAL"` with adapter name `x_recent_search`, or add `kind = "SEARCH"` support for the same adapter name if the source is already modeled as search. The implementation should prefer adapter name over broad source kind so future social platforms can be added without changing the database enum.

### Credential Resolution

For a source with `credentialRef = "X_MAIN"`, resolve:

- `X_MAIN_BEARER_TOKEN`

If no bearer token exists, the adapter returns an empty observation list with a metadata-free abstention behavior for dry-run-like safety. It should not attempt scraping or browser login.

### Request

Use `GET https://api.x.com/2/tweets/search/recent` with:

- `query`: generated evidence query, optionally combined with safe source-level filters from the configured URL query string.
- `max_results`: default 10, bounded by X endpoint constraints.
- `tweet.fields`: `created_at,author_id,lang,public_metrics,possibly_sensitive`.
- `expansions`: `author_id`.
- `user.fields`: `username,name,verified`.

### Observation Shape

X observations should use:

- `title`: `X: <first sentence or truncated post text>`.
- `content`: post text plus public metrics and author handle when available.
- `url`: `https://x.com/<username>/status/<tweetId>` when username is available, otherwise `https://x.com/i/web/status/<tweetId>`.
- `author`: username or author ID.
- `publishedAt`: tweet `created_at`.
- `sourceMetadata`: include `adapter`, `query`, `source`, `tweetId`, `authorId`, `username`, `lang`, `publicMetrics`, and `possiblySensitive`.

### Failure Modes

- `401` or `403`: failed run with a sanitized credential/configuration message.
- `429`: failed run with rate-limit message and no token leakage.
- Partial errors from the X response: keep valid posts and record a summarized non-secret warning in metadata.

## External Deep-Model Estimator Design

### Configuration

Add environment-driven configuration:

- `EXTERNAL_MODEL_ENDPOINT`: full chat-completions endpoint or base URL.
- `EXTERNAL_MODEL_API_KEY`: optional bearer token.
- `EXTERNAL_MODEL_MODEL`: model name sent in the request.
- `EXTERNAL_MODEL_VERSION`: optional model version label stored in estimator output.
- `EXTERNAL_MODEL_TIMEOUT_MS`: optional timeout.

The estimator remains disabled and abstains when endpoint or model is missing.

### Request Contract

Send an OpenAI-compatible chat-completions request:

```json
{
  "model": "configured-model",
  "temperature": 0,
  "max_tokens": 500,
  "response_format": { "type": "json_object" },
  "messages": [
    { "role": "system", "content": "Score one evidence item against one hypothesis. Return JSON only." },
    { "role": "user", "content": "same likelihood prompt shape as the LLM estimator" }
  ]
}
```

Expected model JSON:

```json
{
  "direction": "SUPPORTS",
  "relevance": 0.8,
  "likelihoodRatio": 2.1,
  "confidence": 0.7,
  "reviewRequired": false,
  "rationale": "The evidence directly supports the hypothesis."
}
```

The estimator should reuse the LLM estimator's normalization rules where practical: bounded likelihood ratio, direction aliases, confidence clamping, neutral handling, malformed-output abstention, and non-secret error messages.

### Output

Return `EstimatorOutput` with:

- `estimator = "external-deep-model"`.
- `weight = 2` by default.
- `modelVersion = EXTERNAL_MODEL_VERSION` or a model-derived fallback.
- `abstain = true` for missing config, HTTP failure, timeout, invalid JSON, or invalid score fields.

## Service Boundary Design

This phase should avoid a risky all-at-once service rewrite. The target is a minimal extraction only if it is needed to stop new automation/source complexity from entering `world-model-services.ts`:

- Create `src/server/services/source-service.ts` for source preset creation, source CRUD, dry-run, and source run orchestration.
- Create `src/server/services/automation-service.ts` for evidence loop orchestration, heartbeat, and worker config.
- Keep shared stateful helpers in `world-model-services.ts` only when extraction would require a broad cross-service rewrite.
- Move pure source/automation helper functions out first, then move stateful functions when their dependencies can be passed through a small context object.

This preserves the current public `WorldModelServices` interface.

The full target architecture still expects the eight service groups listed in `AGENTS.md`, but completing that full split is a later refactor after the Polymarket, X/Twitter, and external deep-model behavior is in place and verified.

## Testing Strategy

Use TDD for each behavior:

- Polymarket parser tests for markets, events, malformed JSON, partial failures, and enrichment failure.
- X adapter tests for bearer-token resolution, URL construction, response parsing, 401/429 handling, and token redaction.
- External estimator tests for missing config abstention, successful OpenAI-compatible scoring, invalid JSON abstention, timeout abstention, and sanitized HTTP failure.
- Service extraction tests that assert existing automation and source tests still pass with the same public service API.

Run the smallest relevant test after each change, then run:

```bash
npm run lint
npm run typecheck
npm run test
npm run observe -- --dry-run
```

Run `npm run build` before the implementation commit if the preceding checks pass.

## Rollout

1. Implement external estimator config and tests without enabling it by default.
2. Implement Polymarket parsing/enrichment under existing source kind and adapter names.
3. Implement X recent search using bearer-token credential references.
4. Extract source and automation service modules enough to keep the new implementation scoped.
5. Update `.env.example` with non-secret variable names only.
6. Update rollout notes with source setup examples and credential safety notes.

## References

- Polymarket API introduction: `https://docs.polymarket.com/api-reference/introduction`
- Polymarket market-data overview: `https://docs.polymarket.com/market-data/overview`
- Polymarket rate limits: `https://docs.polymarket.com/api-reference/rate-limits`
- X recent search quickstart: `https://docs.x.com/x-api/posts/search/quickstart/recent-search`
- X recent search reference: `https://docs.x.com/x-api/posts/search-recent-posts`
- X bearer token documentation: `https://docs.x.com/fundamentals/authentication/oauth-2-0/bearer-tokens`
