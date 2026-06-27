# World Model Rollout Notes

## Runtime Setup

`worldModel` runs as an independent Next.js application on port `3100` by default.

Required local or deployment environment:

```env
WORLDMODEL_DATABASE_URL="postgresql://postgres:postgres@localhost:5433/worldmodel?schema=public"
WORLDMODEL_ACCESS_MODE="standalone"
WORLDMODEL_PROXY_SECRET="replace-with-a-long-random-secret"
WORLDMODEL_PUBLIC_BASE_PATH="/admin/world-model"
LLM_PROVIDER="deepseek"
LLM_BASE_URL="https://api.deepseek.com"
LLM_API_KEY=""
LLM_MODEL="deepseek-chat"
MODEL_ARTIFACT_DIR="./model-artifacts"
```

DeepSeek is the default v1 scorer. For a standard DeepSeek setup, `LLM_API_KEY` is sufficient; `LLM_PROVIDER`, `LLM_BASE_URL`, and `LLM_MODEL` only need to be set when overriding the default provider, endpoint, or model.

For `myWeb` proxy hosting, set `WORLDMODEL_ACCESS_MODE="proxy"` in `worldModel` and use the same proxy secret in both apps:

```env
WORLDMODEL_BASE_URL="http://127.0.0.1:3100"
WORLDMODEL_PROXY_SECRET="same-secret-as-worldmodel"
```

## Database

Start the local database and apply migrations:

```bash
docker compose up -d postgres
WORLDMODEL_DATABASE_URL="postgresql://postgres:postgres@localhost:5433/worldmodel?schema=public" npx prisma migrate deploy
```

The world-model schema is independent from `myWeb`; no world-model tables are added to the `myWeb` Prisma schema.

## Access Path

In proxy mode, direct unsigned requests to `worldModel` return `401`. The intended access path is:

1. Admin opens `myWeb` `/admin/world-model`.
2. `myWeb` runs `requireAdmin()`.
3. `myWeb` proxies the request to `worldModel` with timestamp, body hash, and HMAC signature headers.
4. `worldModel` validates the internal signature before serving pages or APIs.

For a host that does not run `myWeb`, use standalone mode:

```env
WORLDMODEL_ACCESS_MODE="standalone"
```

Then `worldModel` can be opened directly at `http://localhost:3100/admin/world-model`.

## Verification Commands

Run these before deployment:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
WORLDMODEL_PROXY_SECRET="browser-check-secret-32-characters" npm run test:browser
npm run observe -- --dry-run
```

For `myWeb` after proxy changes:

```bash
npm run typecheck
npm run build
```

## Operational Notes

- Source credentials are referenced by `credentialRef` only; real cookies, API keys, and tokens stay in environment variables or local secret files.
- Social adapters are dry-run stubs until a platform-specific credential profile is configured.
- LLM and external deep-model estimators abstain when provider credentials or endpoints are missing.
- Source evidence quality warnings are calibration hints. Review rejected evidence and rolled-back updates, then apply the suggested credibility and auto-confirm threshold from the source row when appropriate; v1 does not rewrite source configuration without that operator action.
- `npm run train:fetch -- --sources github,hugging_face --limit 20` refreshes only real platform samples for a faster LLM evaluation data update.
- `npm run train:fetch -- --sources manifold --limit 20` refreshes resolved prediction-market samples for calibration-oriented LLM evaluation.
- `npm run train:evaluate` evaluates 30 samples by default so the auto-apply readiness gate has enough evidence; pass `-- --limit 5` only for a quick smoke run.
- Lightweight training scripts write portable artifacts under `model-artifacts/`, which is ignored by Git.
