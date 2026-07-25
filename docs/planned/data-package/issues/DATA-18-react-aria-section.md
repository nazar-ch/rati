---
area: docs/current/public/guide.md (a "with React Aria Components" section)
needs: wave 2 (rides the same guide surface as DATA-17); the traps are mined from jnana, readable now
status: open
disposition: cut 2026-07-25 from the second-round migration feedback
---

# DATA-18 — document against the real consumer stack: "with React Aria Components"

## Problem

Three of the four expensive integration facts accumulated across both migration waves
are React-Aria-specific, and two independent agents hit the identical form trap in one
session. A framework with one production consumer (on RAC) should carry a "with React
Aria Components" section rather than leaving each consumer to rediscover the traps.

The headline trap: `form.submit()` is action-compatible by design (never rejects, so
`useFormStatus().pending` agrees by construction) — but wired as a RAC
`<Form action={…}>`, a *failed* submit still completes the action, and React's
action-completion form reset destroys the user's input.

## Scope

1. Mine the actual traps from jnana — do not write from memory:
   - `~/jnana/frontend/.claude/frontend-architecture.md` (integration facts were
     recorded there per the DATA-03 findings: RAC render props run outside
     `observer`; `validationBehavior="native"` blocks submit before field validators
     run; reactive producers' synchronous-prefix rule; API-client-from-closure).
   - The migrated form/dialog code and PR history (nazar-ch/jnana#822 and the
     second-wave PRs) for the submit-as-action input-destruction trap and its chosen
     fix (onSubmit + preventDefault vs action; controlled fields via `field.props`).
2. Write the guide section: each trap as symptom → cause → the working pattern, with
   a short RAC-flavored code sample per trap. Lead with the form/action one.
3. State the stance explicitly: rati stays headless/stack-neutral; this section is
   field notes for the stack the framework is actually developed against, not an
   endorsement or an adapter.
4. Cross-link from the form/field reference sections.

## Boundaries

- Docs only — no rati API changes ride this (the form success-state decision is
  DATA-19, deferred; the never-rejects contract itself stays).
- No RAC dependency, no adapter code, not even in examples/ — samples are inline in
  the guide.

## Verify

- `vp check` green.
- Every documented trap cites real jnana code/history (file or PR) in the item's
  closing notes — none invented.
