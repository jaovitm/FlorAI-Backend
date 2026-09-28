# Endpoints

See `docs/index.md` for the documentation set overview and `docs/architecture.md` for the global request flow, middleware, and error-handling model these endpoints rely on.

All JSON error bodies follow `{ error: { code, message, feature?, plan? } }` (`src/lib/errors.ts:25-27`). "Auth" below means the route requires `Authorization: Bearer <token>` via `requireAuth` (`src/middleware/auth.ts`); "Public" means no token is required.

## Root

- `GET /` — Public. No params. Response `200 { name: "FlorAI API", status: "running" }` (`src/index.ts:31`).

## Health — `src/routes/health.ts`

- `GET /health` — Public. Checks `DB` (`SELECT 1`) and `BUCKET` (`list({ limit: 1 })`) in parallel. Response `200 { status: "ok", database: "connected", storage: "connected" }` or `503 { status: "error", database, storage }` with either value `"unreachable"` on failure (`src/routes/health.ts:6-25`).

## Auth — `src/routes/auth.ts`

- `POST /auth/signup` — Public. Body: `name` (string, trimmed, required, ≤80 chars), `email` (trimmed, lowercased, must match `^[^\s@]+@[^\s@]+\.[^\s@]+$`, ≤254 chars), `password` (string, ≥6 chars). Header `X-Timezone-Offset` optional, sets initial `tz_offset` (default 0). Creates `users` + `subscriptions` (plan `free`) rows and a session. Response `201 { token, user }`. Errors: `400 validation_error` (missing/invalid fields), `409 email_taken` (existing email, checked pre-insert and on unique-constraint race) (`src/routes/auth.ts:24-75`).
- `POST /auth/login` — Public. Body: `email`, `password`. Verifies password via PBKDF2 constant-time compare. Response `200 { token, user }`. Errors: `401 invalid_credentials` (unknown email or wrong password — same message for both) (`src/routes/auth.ts:77-98`).
- `POST /auth/logout` — Auth. No body. Deletes the current session row. Response `204 No Content` (`src/routes/auth.ts:100-103`).

`user` in responses is `{ id, name, email, displayName, hasCompletedOnboarding, createdAt }` (`src/lib/serialize.ts:50-57`); `token` is an opaque bearer token, valid 90 days from issuance (`src/routes/auth.ts:9,14-22`).

## Me — `src/routes/me.ts` (Auth)

- `GET /me` — No params. Response `200 <user>` (current user) (`src/routes/me.ts:9`).
- `PATCH /me` — Body (all fields optional, only present keys are applied): `name` (string, trimmed, required if key present, ≤80 chars), `displayName` (string or `null`, ≤40 chars when non-empty), `hasCompletedOnboarding` (boolean). Response `200 <user>` updated. Errors: `400 validation_error` per invalid field (`src/routes/me.ts:11-47`).

## Identifications — `src/routes/identifications.ts` (Auth)

- `POST /identifications` — `multipart/form-data` with field `image` (file). Order of operations: (1) checks the plan's daily identification quota for the caller's local day; (2) parses/validates the uploaded file; (3) calls the Anthropic identification model; (4) on success, stores the photo in R2 and inserts `identifications` + increments `daily_usage`. Validations: file must be present and a `File`; MIME type after normalizing `image/jpg`→`image/jpeg` must be `image/jpeg`, `image/png`, or `image/webp`; size > 0 and ≤ 5 MB. Response `201 <identification>`. Errors: `403 plan_limit` (`feature: "dailyIdentifications"`) before any upload is read; `400 validation_error` for a bad/missing/oversized/wrong-type file; `422 identification_failed` when the model cannot identify a plant in the photo (nothing is stored, quota not consumed); `502 internal_error` if the Anthropic call itself throws (`src/routes/identifications.ts:19-126`).
- `GET /identifications` — Query `limit` (optional positive integer, default 50, capped at 200; non-integer or ≤0 falls back to 50). Response `200 { items: [<identification>] }`, most recent first (`src/routes/identifications.ts:128-137`).

`<identification>` shape: `{ id, plantName, scientificName, family, category, confidence, imageUrl, description, careInstructions, curiosities, identifiedAt }` (`src/lib/serialize.ts:59-71`); `careInstructions` and `curiosities` are parsed from stored JSON text.

## Collections — `src/routes/collections.ts` (Auth)

- `GET /collections` — No params. Response `200 { items: [<collection>] }`, ordered by `created_at ASC, id ASC` (`src/routes/collections.ts:20-27`).
- `POST /collections` — Body: `name` (string, trimmed, required, ≤30 chars). Enforces per-plan collection count limit. Response `201 <collection>`. Errors: `400 validation_error`; `403 plan_limit` (`feature: "collections"`) (`src/routes/collections.ts:29-51`).
- `PATCH /collections/:id` — Body: `name` (same rule as create). Scoped to the caller's own collection. Response `200 <collection>`. Errors: `400 validation_error`; `404 not_found` if the id doesn't exist or isn't owned by the caller (`src/routes/collections.ts:53-60`).
- `DELETE /collections/:id` — No body. Deletes the caller's collection and, explicitly in the same batch, its reminders and plants. Response `204`. Errors: `404 not_found` (`src/routes/collections.ts:62-79`).

`<collection>` shape: `{ id, name, createdAt }` (`src/lib/serialize.ts:73`).

## Plants — `src/routes/plants.ts` (Auth)

- `GET /plants` — No params. Response `200 { items: [<plant>] }`, ordered by `created_at ASC, id ASC` (`src/routes/plants.ts:19-26`).
- `POST /plants` — Body: `identificationId` (string, required), `collectionId` (string, required). Both must reference rows owned by the caller. Enforces per-plan plant count limit. Copies the identification's display fields into the new plant row. Response `201 <plant>`. Errors: `400 validation_error` (missing ids); `404 not_found` (identification or collection not found/not owned); `403 plan_limit` (`feature: "plants"`) (`src/routes/plants.ts:28-89`).
- `PATCH /plants/:id` — Body: `collectionId` (string, required) — moves the plant to another of the caller's collections. Response `200 <plant>`. Errors: `400 validation_error`; `404 not_found` (plant or target collection not found/not owned) (`src/routes/plants.ts:91-109`).
- `DELETE /plants/:id` — No body. Deletes the caller's plant and its reminder (if any) in the same batch. Response `204`. Errors: `404 not_found` (`src/routes/plants.ts:111-120`).

`<plant>` shape: `{ id, collectionId, identificationId, plantName, scientificName, family, category, imageUrl, description, careInstructions, curiosities, createdAt }` (`src/lib/serialize.ts:75-88`).

## Subscription — `src/routes/subscription.ts` (Auth)

- `GET /subscription` — No params. Response `200 <subscription>`; if no row exists yet, synthesizes `{ plan: "free", startedAt: user.createdAt, renewsAt: null }` without writing it (`src/routes/subscription.ts:10-19`).
- `POST /subscription` — Body: `plan` (one of `free`, `basic`, `pro`, `premium`). Upserts the caller's subscription; `renewsAt` is set to now + 30 days unless `plan` is `free` (then `null`). No payment/billing check — comment marks this "test mode: switches the plan instantly, no charge" (`src/routes/subscription.ts:21-37`). Response `200 <subscription>`. Errors: `400 validation_error` (invalid plan).

`<subscription>` shape: `{ plan, startedAt, renewsAt }` (`src/lib/serialize.ts:90-94`).

## Usage — `src/routes/subscription.ts` (Auth)

- `GET /usage/today` — No params. Computes the caller's local day from `tzOffset`. Response `200 { day, identifications }` (`0` if no usage row for today) (`src/routes/subscription.ts:41-49`).

## Reminders — `src/routes/reminders.ts` (Auth)

- `GET /reminders` — No params. Response `200 { items: [<reminder>] }`, ordered by `created_at ASC, id ASC` (`src/routes/reminders.ts:17-24`).
- `PUT /reminders/:id` — Upsert; `:id` is client-generated (non-empty, ≤100 chars). Body: `plantId` (string, required, must be caller's own plant), `intervalDays` (integer 1–60), `hour` (integer 0–23), `minute` (integer 0–59), `lastWateredAt` (optional ISO-parseable date or `null`), `createdAt` (optional, only used to seed `created_at` on first insert). Requires the plan's `wateringAlerts` feature. Enforces at most one reminder per plant by deleting any other reminder row for the same `plantId` before the upsert. If `:id` already exists but belongs to another user, responds `404 not_found` (does not reveal it exists). Response `200 <reminder>`. Errors: `400 validation_error`; `403 plan_limit` (`feature: "wateringAlerts"`); `404 not_found` (plant not owned, or id owned by another user) (`src/routes/reminders.ts:27-76`).
- `DELETE /reminders/:id` — No body. Scoped to the caller. Response `204`. Errors: `404 not_found` (`src/routes/reminders.ts:78-84`).

`<reminder>` shape: `{ id, plantId, intervalDays, hour, minute, lastWateredAt, createdAt }` (`src/lib/serialize.ts:96-104`).

## Images — `src/routes/images.ts`

- `GET /images/:file` — Public (no bearer token; access control is an unguessable random filename, not per-user auth). `:file` must match `idn_[0-9a-f]+\.(?:jpg|png|webp)`; anything else 404s via Hono's route matching. Serves the R2 object at `identifications/<file>` with its stored `Content-Type`/metadata, an `ETag`, and `Cache-Control: public, max-age=31536000, immutable` (only set if R2 metadata didn't already set one). Errors: `404 not_found` if the object doesn't exist (`src/routes/images.ts:8-17`).

## 404 / Unmatched Routes

Any unmatched path returns `404 { error: { code: "not_found", message: "Rota não encontrada." } }` (`src/index.ts:49`).

## Related

- `docs/index.md` — documentation set overview.
- `docs/architecture.md` — auth middleware, CORS, error-handler wiring these endpoints share.
- `docs/business-rules.md` — plan limits, ownership checks, and validation constraints referenced above.
