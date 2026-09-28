# Examples — generic-behavior

Referenced by `.claude/skills/generic-behavior/SKILL.md`.

## Scope control

Request: "Fix the null check in `UserService.Validate`."
Correct: edit only `UserService.Validate`. If `UserService.Save` has the same bug, state it as a suggestion, do not fix it.
Incorrect: fixing both methods, or refactoring `UserService` for readability while there.

## Instruction adherence

Request: "Rename `CalcTotal` to `CalculateTotal` in `OrderService`."
Correct: rename only that method, only in that class, exactly as named.
Incorrect: renaming other similarly-named methods "for consistency" without being asked.

## Minimal context gathering

Request: "Why does `POST /orders` return 500 when the cart is empty?"
Correct: read `OrdersController`, the order-creation service it calls, and the empty-cart branch. Stop once the cause is identified.
Incorrect: reading the entire orders module, unrelated controllers, and the full test suite before answering.

## Permission handling

Suggestion made: "The same validation bug likely affects `EditOrder`. I can fix it there too — same one-line null check, low risk."
Correct: wait for explicit "yes, do it" before touching `EditOrder`.
Incorrect: fixing `EditOrder` immediately after stating the suggestion.
