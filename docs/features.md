# Features

See `docs/index.md` for the documentation set overview, `docs/endpoints.md` for the exact request/response contracts, and `docs/business-rules.md` for the limits and validations backing each feature.

## Account and Session

- Sign up, log in, log out with email + password (`src/routes/auth.ts`). Passwords are never stored in plaintext (PBKDF2-SHA256, `src/lib/crypto.ts:26-36`).
- Sessions are long-lived bearer tokens (90 days, `src/routes/auth.ts:9`) rather than short-lived + refresh tokens.
- Profile management: display name, full name, and an onboarding-completed flag (`src/routes/me.ts`).
- Per-user timezone tracking via the `X-Timezone-Offset` request header, persisted server-side and used to compute the user's "local day" for daily quota resets (`src/middleware/auth.ts:22-27`, `src/lib/http.ts:32-33`).

## Plant Identification (core feature)

- User uploads a photo (`POST /identifications`); the backend calls the Anthropic API (model `claude-haiku-4-5`) acting as a "FlorAI botanist" that must answer in Brazilian Portuguese (`src/lib/identify.ts:38-43`).
- Returned data per identification: common name, scientific name, family, category (e.g. "indoor plant", "succulent"), confidence score, a short description, and structured care instructions — light, water, difficulty (each a short label + optional detail), ideal temperature range, soil, fertilizer, suggested watering interval in days (1–60), toxicity note — plus up to 6 curiosities (`src/lib/identify.ts:8-34`, normalized at `src/lib/identify.ts:86-96`).
- If the photo doesn't show a recognizable plant, or the model refuses/hits `max_tokens`, the request fails with `422 identification_failed` and nothing is persisted or counted against quota (`src/routes/identifications.ts:65-72`).
- Successful identifications are stored with their photo (uploaded to R2) and appear in a per-user history (`GET /identifications`), most recent first.

## Photo Storage and Serving

- Identification photos are stored in the `BUCKET` R2 bucket and served back through a public, unauthenticated endpoint (`GET /images/:file`), gated only by an unguessable random id in the filename (`src/routes/images.ts`).

## Collections

- Users can group saved plants into named collections (folders), e.g. "Living room", "Balcony" (`src/routes/collections.ts`). Rename and delete supported; deleting a collection also deletes the plants and reminders inside it.
- Number of collections a user may create is plan-limited (`feature: "collections"`).

## Saved Plants

- A user can save a past identification into a collection, creating a "plant" record that copies the identification's display data at the time of saving (`src/routes/plants.ts:52-66`) — later edits to the identification (there are none exposed) would not retroactively update saved plants.
- A saved plant can be moved between the user's own collections (`PATCH /plants/:id`).
- Number of plants a user may save is plan-limited (`feature: "plants"`).

## Watering Reminders

- Each saved plant can have at most one watering reminder: interval in days, a daily time-of-day (hour/minute), and an optional "last watered" timestamp (`src/routes/reminders.ts`).
- Reminder creation/update requires the plan's `wateringAlerts` feature; not available on the `free` plan (`src/lib/plans.ts:15`).
- Note: this endpoint only stores reminder data (an upsert). No push-notification, scheduling, or cron-based delivery mechanism is implemented in this repository — flagged as not implemented here (delivery is presumably a client-side or separate-service responsibility, not confirmed in this codebase).

## Subscription / Plans

- Four tiers: `free`, `basic`, `pro`, `premium`, with limits on daily identifications, collections, plants, watering alerts, and an `aiDoctor` flag (`src/lib/plans.ts:14-19`; see `docs/business-rules.md` for exact numbers).
- `POST /subscription` switches the caller's plan immediately with no payment step — the code comment explicitly calls this "test mode: switches the plan instantly, no charge" (`src/routes/subscription.ts:21`). No billing/payment-provider integration exists in this codebase.
- `aiDoctor` is defined as a plan feature flag (`src/lib/plans.ts:4,18-19`) but no route or business logic in `src/` reads or enforces it — flagged as an unimplemented/reserved feature.

## Usage Tracking

- `GET /usage/today` reports how many identifications the caller has used on their current local day, backing client-side quota UI (`src/routes/subscription.ts:41-49`).

## Health Check

- `GET /health` reports D1 and R2 connectivity for operational monitoring (`src/routes/health.ts`).

## Related

- `docs/index.md` — documentation set overview.
- `docs/endpoints.md` — exact endpoint contracts for every feature above.
- `docs/business-rules.md` — plan limits and validation rules enforcing these features.
