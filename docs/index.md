# FlorAI Backend Documentation

Entry point for project documentation. FlorAI Backend is a Hono application on Cloudflare Workers, using D1 (SQLite) and R2, that identifies plants from photos via the Anthropic API and lets users manage saved plants, collections, and watering reminders.

## Topics

- `docs/architecture.md` — stack, folder structure, request flow, middleware, bindings, data model, error handling, external integrations.
- `docs/endpoints.md` — every HTTP route: method, path, auth requirement, request shape, response shape, error codes.
- `docs/features.md` — user-facing capabilities as implemented.
- `docs/business-rules.md` — plan limits, ownership/authorization checks, validation rules, state transitions, with file:line references.

## Source Authority

Per `.claude/skills/generic-meta-navigation/SKILL.md`: code is authoritative over these docs. If the source changes, re-derive the relevant section from `src/` and `migrations/` rather than trusting a stale doc.

## Related

- `.claude/skills/generic-meta-knowledge-ai/SKILL.md` — authoring rules and file placement followed when writing these docs.
- `.claude/agents/general-dev.md` — agent that produced this documentation set.
