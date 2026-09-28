---
name: generic-meta-navigation
description: Defines context retrieval order, source authority, and stopping conditions for gathering context on a task in this project.
---

## Purpose

Use when retrieving context required to execute a task.

## Layout

Standard Claude Code project structure. Skill naming: `generic-<name>` for skills reusable across projects, `specific-<name>` for skills tied to this project. The prefix is the sole classifier; there is no separate directory split.

- `.claude/skills/<name>/SKILL.md` — skills, auto-discovered by the harness from their `description`.
- `.claude/skills/<name>/references/` — supporting files for that skill (cautions, examples, common errors, topic detail).
- `.claude/agents/<name>.md` — subagents, auto-discovered by the harness.
- `CLAUDE.md` — project-level instructions and conventions, loaded automatically.
- `docs/` (if present) — project documentation, referenced by explicit path from a skill, agent, or doc.

## Search Order

For a requested topic, search in this order:

1. `CLAUDE.md`.
2. Matching skill under `.claude/skills/` (check `specific-` skills before `generic-` ones for project-specific topics).
3. `references/` files of the chosen skill.
4. Project documentation under `docs/`.
5. Code exploration.

Prefer the narrowest matching source. Do not start with code when a higher-level source can provide the required context. Search order does not change source authority (see Source Authority).

## Topic Search

Skills and docs are structured by searchable topics. Before reading a file:

1. Identify the relevant skill or doc by its full name and path (see `.claude/skills/generic-meta-knowledge-ai/SKILL.md` for the referencing rule).
2. Search matching topic headings/terms.
3. Read only the relevant section.
4. Follow referenced files only when required, using the explicit path given.

Do not read an entire file unless necessary. Prefer exact topic names, domain terms, class/method/config names, and task-specific identifiers as search keys.

## References

When a skill references `references/` files:

- Follow only references relevant to the task.
- Search referenced files by topic before reading.
- Do not load unrelated references.
- Do not recursively explore references without a specific need.

## Code Exploration

Explore code only when skills and documentation are insufficient. When required:

- Start from the explicitly requested file/class/method/resource.
- Follow only dependencies required to understand/perform the task.
- Prefer direct references over broad repository searches.
- Do not explore unrelated layers or files.
- Do not infer more context is needed merely because it exists.

## Context Sufficiency

Stop navigation immediately once there is enough context to: understand the requested change, identify the affected resource, determine required constraints, and perform the task. Do not continue exploring past that point.

## Scope

Navigation exists to obtain context for the current task. Do not: explore unrelated topics, inspect files merely because they may be interesting, map the entire repository, search for potential future improvements, or expand task scope. If further investigation could be useful but isn't required, stop and proceed.

## Source Authority

Truth hierarchy: Code > Skills > Documentation. Search order (see Search Order) does not change this authority.

On conflict between sources:

1. Verify the relevant code; code behavior is authoritative.
2. If code does not resolve the conflict, skills outrank documentation.
3. Treat documentation as authoritative only when neither code nor skills contradict it.

Do not silently choose between conflicting sources. State the conflict when it affects the task.

## Related

- `.claude/skills/generic-meta-knowledge-ai/SKILL.md` — authoring rules, file placement, and the mandatory referencing rule.
- `.claude/skills/generic-behavior/SKILL.md` — response, scope, and permission rules.
