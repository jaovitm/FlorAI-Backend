# Business Rules

See `docs/index.md` for the documentation set overview, `docs/endpoints.md` for the endpoints these rules attach to, and `docs/features.md` for the user-facing framing.

## Plan Limits

Defined in `PLAN_LIMITS`, `src/lib/plans.ts:14-19`:

| Plan | dailyIdentifications | collections | plants | wateringAlerts | aiDoctor |
|---|---|---|---|---|---|
| free | 3 | 1 | 3 | false | false |
| basic | 5 | ∞ | 20 | true | false |
| pro | 15 | ∞ | ∞ | true | false |
| premium | 40 | ∞ | ∞ | true | true |

`getPlan(db, userId)` (`src/lib/plans.ts:24-30`) reads `subscriptions.plan` for the user; if there is no row or the stored value isn't one of `free|basic|pro|premium`, the user is treated as `free`.

`aiDoctor` is defined but not consumed by any route or logic in `src/` — flagged as unimplemented.

## Quota Enforcement

- Daily identification quota (`src/routes/identifications.ts:19-32`): before parsing the upload, reads the caller's plan and `daily_usage.identifications` for the caller's local day (`localDay(tzOffset)`, `src/lib/http.ts:32-33`); if the count is already `>= PLAN_LIMITS[plan].dailyIdentifications`, throws `planLimit("dailyIdentifications", plan, ...)` → `403 plan_limit`.
- The identification counter is only incremented after a successful AI identification and DB insert, in the same batch as the `identifications` insert (`src/routes/identifications.ts:99-123`) — a photo that fails to identify does not consume quota.
- Collection count limit (`src/routes/collections.ts:33-44`): counts existing `collections` rows for the user; `>= PLAN_LIMITS[plan].collections` → `403 plan_limit` (`feature: "collections"`).
- Plant count limit (`src/routes/plants.ts:43-50`): counts existing `plants` rows for the user; `>= PLAN_LIMITS[plan].plants` → `403 plan_limit` (`feature: "plants"`).
- Watering reminders gate (`src/routes/reminders.ts:43-46`): `PLAN_LIMITS[plan].wateringAlerts` must be `true`, else `403 plan_limit` (`feature: "wateringAlerts"`), checked on every `PUT /reminders/:id` (both create and update).

## Ownership / Authorization

- Every collection, plant, reminder, and identification read/update/delete query is scoped by `user_id = ?` in SQL — there is no separate "is this mine" check layered after a lookup; the lookup itself excludes other users' rows.
- Accessing another user's resource (wrong id, or an id that exists but belongs to someone else) returns `404 not_found`, never `403`, so as not to confirm the resource exists. Made explicit in a comment for reminders: "Id already used by another user: doesn't reveal it exists" (`src/routes/reminders.ts:55-56`), and structurally true for collections (`src/routes/collections.ts:53-60`, `62-68`) and plants (`src/routes/plants.ts:96-99`, `111-118`).
- `POST /plants` additionally requires both `identificationId` and `collectionId` to belong to the caller before creating the plant (`src/routes/plants.ts:34-41`).
- `PUT /reminders/:id` additionally requires `plantId` to belong to the caller (`src/routes/reminders.ts:48-54`).

## State Transitions and Cascades

- Deleting a collection (`DELETE /collections/:id`) explicitly deletes, in one batch: reminders for plants in that collection, then plants in that collection, then the collection itself (`src/routes/collections.ts:71-77`) — in addition to the DB-level `ON DELETE CASCADE` on `plants.collection_id` and `reminders.plant_id` (`migrations/0001_init.sql:67,85`).
- Deleting a plant (`DELETE /plants/:id`) explicitly deletes its reminder first, then the plant, in one batch (`src/routes/plants.ts:114-117`); zero rows changed on the plant delete → `404 not_found`.
- One reminder per plant is enforced twice: a DB `UNIQUE` constraint on `reminders.plant_id` (`migrations/0001_init.sql:85`), and application logic that deletes any other reminder row for the same `plant_id` before upserting the new/updated one, inside the same batch (`src/routes/reminders.ts:60-74`).
- Subscription plan change (`POST /subscription`) is an upsert with no state machine beyond: `renewsAt` = now + 30 days for any non-`free` plan, `null` for `free` (`src/routes/subscription.ts:26-27`). There is no explicit handling of what happens once `renewsAt` passes (no downgrade job in this codebase) — flagged as not implemented here.
- `daily_usage` rows are upserted per `(user_id, day)` with `identifications = identifications + 1` on conflict (`src/routes/identifications.ts:119-122`); there is no scheduled reset — a new `day` value (per the user's `tz_offset`) simply has no existing row, so it starts at 0 implicitly.

## Validation Rules

- Signup: `name` required, trimmed, ≤80 chars; `email` must match `^[^\s@]+@[^\s@]+\.[^\s@]+$` and be ≤254 chars; `password` ≥6 chars (`src/routes/auth.ts:26-33`).
- Profile update (`PATCH /me`): `name` (if present) required non-empty, ≤80 chars; `displayName` (if present) `null` or string ≤40 chars; `hasCompletedOnboarding` (if present) must be boolean (`src/routes/me.ts:15-38`).
- Collection name: required, trimmed, ≤30 chars (`src/routes/collections.ts:13-18`).
- Identification upload: `image` must be a `File`; MIME type normalized (`image/jpg`→`image/jpeg`) and must be one of `image/jpeg`, `image/png`, `image/webp`; size must be `> 0` and `<= 5 MB` (`src/routes/identifications.ts:10-15,41-46`).
- Reminder fields: `intervalDays` integer 1–60; `hour` integer 0–23; `minute` integer 0–59; `id` path param non-empty and ≤100 chars; `lastWateredAt`/`createdAt`, when provided, must parse as a valid date (`normalizeIso`, `src/lib/http.ts:36-39`) or the request is rejected (`src/routes/reminders.ts:10-41`).
- `X-Timezone-Offset` header: must parse to an integer between -840 and 840 (minutes, ±14h) to be accepted; otherwise ignored and the previously stored offset is kept (`src/lib/http.ts:24-29`).

## Security Constraints

- Passwords: PBKDF2-SHA256, 100,000 iterations (`PBKDF2_ITERATIONS`, `src/lib/crypto.ts:4`), random 16-byte salt per user, constant-time hash comparison (`src/lib/crypto.ts:38-48`).
- Session tokens: 32 random bytes, base64url-encoded, sent to the client once; only the SHA-256 hash of the token is stored in `sessions.token_hash` (`src/lib/crypto.ts:17-24`, `src/routes/auth.ts:14-22`). Sessions expire 90 days after creation (`SESSION_DAYS`, `src/routes/auth.ts:9`) and are looked up with `expires_at > now` (`src/middleware/auth.ts:14-17`) — there is no server-side revocation other than deleting the row on logout, and no sliding/renewal of `expires_at` observed.
- Login error message is identical for "no such email" and "wrong password" (`src/routes/auth.ts:92-94`) to avoid confirming account existence.
- CORS is fully open (`origin: "*"`, `src/index.ts:23`) — any origin may call the API; there is no additional origin allowlist.
- `GET /images/:file` is public and unauthenticated; access control is solely the unguessable random identification id embedded in the filename, constrained by regex `idn_[0-9a-f]+\.(?:jpg|png|webp)` (`src/routes/images.ts:8`) — there is no per-user ownership check on image reads.

## Common Errors (as implemented)

- `403 plan_limit` always carries `{ feature, plan }` in the JSON body so the client can render an upgrade prompt (`src/lib/errors.ts:37-38`).
- `422 identification_failed` is distinct from `400 validation_error`: the former means the upload was well-formed but the AI could not identify a plant in it; the latter means the request itself was malformed.
- `502` is used (with code `internal_error`, not a dedicated code) when the Anthropic API call throws, e.g. timeout or network failure (`src/routes/identifications.ts:57-63`).

## Related

- `docs/index.md` — documentation set overview.
- `docs/endpoints.md` — endpoints these rules are enforced on.
- `docs/architecture.md` — schema, cascade constraints, and error-handling wiring referenced above.
