# worldModel

Private world-model workspace for beliefs, hypotheses, observations, evidence, likelihood estimates, and Bayesian update events.

## Standalone Local Start

Use this mode when the host does not run `myWeb`.

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
