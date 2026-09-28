# Common Errors — generic-behavior

Referenced by `.claude/skills/generic-behavior/SKILL.md`.

- **Scope creep**: fixing or refactoring code adjacent to the requested change without authorization. Correction: suggest it, do not perform it.
- **Silent extra edits**: modifying a file "while already there" that was not part of the request. Correction: ask first, even for trivial or obviously-related files.
- **Unsolicited alternative**: replacing the explicitly requested approach with a "better" one the user did not ask for. Correction: implement what was requested; propose the alternative separately.
- **Over-gathering context**: reading the whole repository or unrelated modules before acting. Correction: read only what is required per `.claude/skills/generic-meta-navigation/SKILL.md`.
- **Assuming missing requirements**: inventing defaults for unspecified behavior instead of stating what is missing. Correction: state the gap explicitly and ask, or state the assumption made and why.
- **Bundling approvals**: treating approval of one suggested change as approval for related follow-up changes. Correction: each suggestion requires its own explicit approval.
