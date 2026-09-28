# Architecture

See `docs/index.md` for the documentation set overview.

## Stack

- Runtime: Cloudflare Workers, `nodejs_compat` flag (`wrangler.jsonc:6`).
- Framework: Hono 4 (`package.json:16`).
- Database: Cloudflare D1 (SQLite), binding `DB`, database name `florai` (`wrangler.jsonc:10-17`).
- Object storage: Cloudflare R2, binding `BUCKET`, bucket name `florai` (`wrangler.jsonc:18-23`).
- AI: `@anthropic-ai/sdk` (`package.json:15`), model `claude-haiku-4-5` (`src/lib/identify.ts:6`).
- Validation/schema: Zod 4 (`package.json:17`), used for the AI structured-output schema in `src/lib/identify.ts`.
- Language/build: TypeScript 7 (`package.json:21`), no test framework or bundler config present beyond `tsc --noEmit` (`package.json:9`).
- Deploy tool: Wrangler 4 (`package.json:22`); `npm run deploy` runs `wrangler deploy` (`package.json:8`).

## Folder Structure

- `src/index.ts` — app entry: Hono instance, global middleware, route mounting, error handlers.
- `src/lib/crypto.ts` — IDs, tokens, hashing (SHA-256, PBKDF2), base64 helpers.
- `src/lib/errors.ts` — `ApiError` class and error-code constructors.
- `src/lib/http.ts` — request/date helpers (`readJson`, `parseTzOffset`, `localDay`, `normalizeIso`, `publicOrigin`).
- `src/lib/identify.ts` — Anthropic call and plant-identification schema/normalization.
- `src/lib/plans.ts` — plan list, per-plan limits, `getPlan` lookup.
- `src/lib/serialize.ts` — DB row types and row-to-JSON mappers for every entity.
- `src/middleware/auth.ts` — `requireAuth` bearer-token session middleware.
- `src/routes/*.ts` — one Hono sub-app per resource (see `docs/endpoints.md`).
- `src/types/env.ts` — `Bindings`, `Variables`, `AppEnv`, `UserRow` types.
- `migrations/0001_init.sql` — full D1 schema (only migration present).

## Request Flow

1. `src/index.ts:20-29` — global middleware: `logger()`, then `cors()` with `origin: "*"`, allowed methods `GET/POST/PUT/PATCH/DELETE/OPTIONS`, allowed headers `Authorization, Content-Type, Accept, X-Timezone-Offset`, `maxAge` 86400.
2. `src/index.ts:33-35` — public routes mounted first: `/health`, `/images`, `/auth`.
3. `src/index.ts:37-40` — `requireAuth` (`src/middleware/auth.ts`) is applied to `/me`, `/identifications`, `/collections`, `/plants`, `/subscription`, `/usage`, `/reminders` and each of their sub-paths (`<path>/*`), before those routers are mounted.
4. `src/index.ts:41-47` — protected routers mounted: `me`, `identifications`, `collections`, `plants`, `subscription`, `usage`, `reminders`.
5. `src/index.ts:49` — unmatched routes return `404 { error: { code: "not_found", ... } }`.
6. `src/index.ts:51-61` — global `onError`: `ApiError` instances are serialized via `toJSON()` at their own `status`; a Hono `HTTPException` with `status < 500` becomes `400 validation_error`; anything else is logged with `console.error` and returned as `500 internal_error`.

Note: `POST /auth/logout` applies `requireAuth` directly on that single route (`src/routes/auth.ts:100`), separately from the path-list middleware in `src/index.ts:37-40`; the rest of `/auth` (`signup`, `login`) is public.

## Middleware

`requireAuth` (`src/middleware/auth.ts:8-33`):

- Requires header `Authorization: Bearer <token>`; otherwise `401 unauthorized`.
- Hashes the token with SHA-256 and looks up a non-expired session joined to its user (`sessions.token_hash`, `sessions.expires_at > now`).
- No matching session/user → `401 unauthorized`.
- If header `X-Timezone-Offset` parses to a valid offset (`src/lib/http.ts:24-29`, minutes, range ±14h) and differs from the stored `tz_offset`, updates `users.tz_offset` in place.
- Sets Hono context variables `user`, `tokenHash`, `tzOffset` for downstream handlers.

## Bindings and Environment Variables

From `wrangler.jsonc` and `src/types/env.ts:1-10` (names only, no values):

- `DB` — D1 binding, database `florai`, migrations directory `migrations`.
- `BUCKET` — R2 binding, bucket `florai`.
- `ANTHROPIC_API_KEY` — secret, required, used by `src/lib/identify.ts` (set via `wrangler secret put` per `.dev.vars.example:2`).
- `ANTHROPIC_WORKSPACE_ID` — optional secret, sent as `anthropic-workspace-id` header when the API key is not bound to a workspace (`src/lib/identify.ts:58-59`).
- `PUBLIC_BASE_URL` — optional; overrides the request's own origin when building `imageUrl` values (`src/lib/http.ts:42-43`). Falls back to the request origin.

Local development variables are copied from `.dev.vars.example` into an untracked `.dev.vars` file.

## Data Model

Schema source: `migrations/0001_init.sql`. All dates are ISO-8601 UTC strings with trailing `Z` (file header comment, line 2).

- `users` — id, name, email (unique), display_name, has_completed_onboarding, password_hash/salt/iterations, tz_offset, created_at.
- `sessions` — token_hash (PK), user_id (FK → users, cascade delete), created_at, expires_at. Indexed by user_id.
- `subscriptions` — user_id (PK, FK → users, cascade delete), plan (CHECK in `free|basic|pro|premium`), started_at, renews_at (nullable).
- `daily_usage` — (user_id, day) composite PK, FK → users cascade delete, identifications counter.
- `identifications` — id (PK), user_id (FK cascade delete), plant_name, scientific_name, family, category, confidence, image_key, image_url, description, care_instructions (JSON text), curiosities (JSON text), identified_at. Indexed by (user_id, identified_at DESC).
- `collections` — id (PK), user_id (FK cascade delete), name, created_at. Indexed by (user_id, created_at).
- `plants` — id (PK), user_id (FK cascade delete), collection_id (FK → collections, cascade delete), identification_id (no FK constraint declared, stored as plain TEXT), plant_name/scientific_name/family/category/image_url/description/care_instructions/curiosities (denormalized copy of the source identification), created_at. Indexed by (user_id, created_at) and by collection_id.
- `reminders` — id (PK), user_id (FK cascade delete), plant_id (FK → plants cascade delete, UNIQUE — enforces at most one reminder per plant at the DB level), interval_days, hour, minute, last_watered_at (nullable), created_at. Indexed by user_id.

Database-level `ON DELETE CASCADE` exists for `sessions`, `subscriptions`, `daily_usage`, `identifications`, `collections`, `plants`, `reminders` via their `user_id`/`collection_id`/`plant_id` foreign keys. The application additionally performs explicit multi-statement cascades in `collections.delete` (`src/routes/collections.ts:71-77`) and `plants.delete` (`src/routes/plants.ts:114-117`) rather than relying solely on the DB cascade.

## Error Handling

- `ApiError` (`src/lib/errors.ts:15-28`): carries `status`, a fixed `code` union, `message`, and optional `extra` (`feature`, `plan`) surfaced to the client as `{ error: { code, message, feature?, plan? } }`.
- Error codes: `validation_error`, `invalid_credentials`, `unauthorized`, `plan_limit`, `not_found`, `email_taken`, `identification_failed`, `rate_limited`, `internal_error` (`src/lib/errors.ts:4-13`). `rate_limited` is declared in the type but not constructed/thrown anywhere in `src/` — flagged as unimplemented/reserved.
- Handled centrally in `src/index.ts:51-61` (see Request Flow above).

## External Integrations

- Anthropic API (`src/lib/identify.ts`): single call per identification request, model `claude-haiku-4-5`, `max_tokens: 4096`, structured output via `zodOutputFormat(IdentificationSchema)`, `timeout: 25_000`ms, `maxRetries: 1` (comment: designed to fit within a 60s client budget across up to 2 attempts, `src/lib/identify.ts:56`). Returns `null` (treated as "could not identify") when `stop_reason` is `refusal` or `max_tokens`, or when the model reports `identified: false` or empty name fields.
- Cloudflare R2: identification photos stored under key `identifications/<id>.<ext>` (`src/routes/identifications.ts:75-81`) and served back publicly and unauthenticated via `GET /images/:file` (`src/routes/images.ts`), restricted to filenames matching `idn_[0-9a-f]+\.(jpg|png|webp)`.

## Related

- `docs/index.md` — documentation set overview.
- `docs/endpoints.md` — route-by-route contract built on this request flow.
- `docs/business-rules.md` — limits and validation enforced along this flow.
