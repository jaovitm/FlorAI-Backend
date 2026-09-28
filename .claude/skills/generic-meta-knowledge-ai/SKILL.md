---
name: generic-meta-knowledge-ai
description: Guidelines for authoring AI-optimized skills and technical documentation with minimal tokens, mandatory explicit references, searchable structure, correct knowledge placement, and mandatory approval for modifications.
---

## Purpose

Use when creating or modifying skills or technical documentation.

## Layout

Standard Claude Code project structure. Skill naming: `generic-<name>` for skills reusable across projects, `specific-<name>` for skills tied to this project. The prefix is the sole classifier; there is no separate directory split.

- `.claude/skills/<name>/SKILL.md` — skills, auto-discovered by the harness from their `description`.
- `.claude/skills/<name>/references/` — supporting files for that skill.
- `.claude/agents/<name>.md` — subagent definitions, auto-discovered by the harness.
- `CLAUDE.md` — project-level instructions, loaded automatically.
- `docs/` (if present) — project documentation, referenced by explicit path.

## Cross-References — Mandatory

Every skill, doc, and reference file must be reachable by explicit `name` and full path (`.claude/skills/<name>/SKILL.md`, `.claude/skills/<name>/references/<file>.md`, `.claude/docs/<file>.md`, `.claude/agents/<name>.md`). Never reference a skill, doc, or agent by name alone, by description, or by an implied/assumed path.

Rules:

- Every `SKILL.md` must have a `## Related` section listing every related skill by name and full path.
- Every `SKILL.md` must have a `## References` section listing every file under its own `references/` by full path, with a one-line description of its content.
- A skill, doc, or reference file with no inbound reference from at least one other file (or from an agent definition) is unreachable and must not be created; add the reference at creation time.
- When an agent or skill instructs to "apply" or "use" another skill, state that skill's exact name and full path in the same sentence — never rely on the harness auto-discovering it from context, since auto-discovery can fail to match and leaves the agent guessing.
- When adding a new skill, doc, or reference file, update every existing file that should point to it in the same change. A reference obligation is not satisfied by the new file alone.

This eliminates any path where an agent has to guess a name, infer a location, or search broadly for a file that should have been pointed to directly.

## Writing

- Write all generated skill and documentation content in English.
- Optimize for AI comprehension, not human presentation.
- Use direct rules, explicit conditions, and unambiguous terminology.
- Minimize tokens without losing meaning.
- Remove redundancy, filler, repetition, and unnecessary prose.
- Do not use emojis or decorative formatting.
- Avoid presentation-oriented tables.
- Prefer searchable headings, rules, constraints, procedures, and concise examples.
- Do not explain generic concepts already known by the model.

## Structure

- Divide files into explicit, descriptive top-level topics.
- Keep topics self-contained and searchable.
- Use shallow structure unless deeper nesting improves retrieval.
- Structure files so relevant content can be located without reading the entire file.

Preferred headings: Architecture, Data Flow, Business Rules, Validation Rules, Security Constraints, Common Errors, References, Related.

## References

- Every non-trivial domain, repository, implementation, or business rule must have a traceable source.
- Prefer authoritative local sources.
- Sources may be:
  - `references/` files;
  - official documentation;
  - repository files;
  - code;
  - configuration;
  - other authoritative sources.
- Reference sources at the point of use when practical, by full path (see Cross-References — Mandatory).
- Never fabricate sources or unsupported facts.

## Knowledge Placement

Classify knowledge before adding it:

1. Skill: reusable rules, procedures, and conventions that guide how a task is performed. Reusable across projects → `generic-<name>`; tied to this project → `specific-<name>`.
2. Documentation: business rules, technical specifications, architecture decisions, workflows, constraints, or project knowledge.

Place knowledge in the lowest appropriate layer. Do not duplicate knowledge across a skill and a doc; place it once and reference it from the other by full path.

## Skill and Agent Location

- Skill: `.claude/skills/<name>/SKILL.md`, where `<name>` starts with `generic-` or `specific-`.
- Agent definition: `.claude/agents/<name>.md`, with YAML frontmatter defining the subagent (`name`, `description`, `model`, `tools`, etc.), per Claude Code's subagent definition format.
- Every skill has YAML frontmatter (`name`, `description`). `name` must equal the directory name exactly. The `description` drives auto-discovery, so it must state precisely when the skill applies — but every explicit invocation from an agent or another skill must still also state the full path (see Cross-References — Mandatory).
- Do not place skill or agent definitions outside `.claude/`.

## Skill Structure

Use:

```
generic-<specialization>/          (or specific-<specialization>/)
├── SKILL.md
└── references/
    ├── examples.md
    ├── common-errors.md
    └── <topic>.md
```

placed under `.claude/skills/`.

Naming:

- Lowercase.
- Hyphen-separated.
- First segment is the classifier: `generic` (reusable across projects) or `specific` (this project only).
- Remaining segment(s) = capability name.

Every skill directory must contain `SKILL.md`. Every skill directory should contain `references/examples.md` and `references/common-errors.md` when the skill defines behavioral rules or procedures (add topic-specific files as needed); omit only when the skill is purely descriptive and has no rules to illustrate or errors to record.

## References Directory

Use `references/` for detailed supporting knowledge that should not be loaded directly into `SKILL.md`.

- Prefer one file per distinct topic; always include `examples.md` (applied, concrete examples of the skill's rules) and `common-errors.md` (recurring mistakes and their correction) when applicable.
- Reference each file from `SKILL.md`'s `## References` section by full path (see Cross-References — Mandatory).
- Keep detailed examples, constraints, errors, architecture, and troubleshooting in separate reference files when useful.

`SKILL.md` defines capability, rules, procedures, and references. `references/` contains supporting knowledge.

## Skill Authoring

When creating a skill:

1. Identify the capability.
2. Classify it `generic-` or `specific-`.
3. Define searchable topics.
4. Keep `SKILL.md` minimal.
5. Move detailed knowledge to `references/`, including `examples.md` and `common-errors.md`.
6. Add references for non-trivial claims, by full path.
7. Add the skill to the `## Related` section of every other skill that should point to it.
8. Remove generic or redundant knowledge.
9. Ensure every section affects behavior, retrieval, or decision-making.
10. Do not duplicate knowledge available from referenced sources.

## Documentation Authoring

Project documentation lives under `docs/` (or the project's established documentation location).

Documentation must:

- Use the same AI-optimized format.
- Use searchable topics.
- Contain relevant business rules, technical specifications, architecture, constraints, workflows, decisions, or repository-specific behavior.
- Reference authoritative sources by full path.
- Exclude generic technology explanations unless required for project-specific behavior.
- Prefer factual rules over explanatory prose.

## Generic Knowledge

Do not document basic programming or technology concepts unless they are causing repeated agent errors.

Examples normally excluded:

- Classes and object instantiation.
- Dependency injection.
- HTTP fundamentals.
- Basic language syntax.

When such knowledge is required to correct repeated agent errors, place the specific correction in `references/common-errors.md` and reference it from the relevant skill's `## References` section.

## Scope

- Create only what was requested.
- Do not expand scope autonomously.
- Do not add unrelated domains, patterns, examples, or documentation.
- Suggestions are allowed but must not be implemented automatically.

## Modification Approval

Never create, modify, delete, rename, or move files without explicit user authorization for that specific modification.

Allowed without authorization:

- Inspecting.
- Searching.
- Analyzing.
- Designing.
- Proposing changes.
- Presenting diffs or planned contents.

When modification is proposed:

1. Describe the change.
2. Wait for explicit approval.
3. Modify only the approved scope.

Previous approval does not authorize unrelated or subsequent modifications.

## Related

- `.claude/skills/generic-meta-navigation/SKILL.md` — context retrieval order and source authority.
- `.claude/skills/generic-behavior/SKILL.md` — response, scope, and permission rules.

## Source Integrity

- Never fabricate sources.
- Never invent repository behavior.
- Never convert assumptions into facts.
- Preserve uncertainty when evidence is insufficient.
- When sources conflict, identify the conflict and prefer the authoritative source.
