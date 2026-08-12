---
area: docs/current/public/guide.md (a "with React Aria Components" section)
needs: wave 2 (rides the same guide surface as DATA-17); the traps are mined from jnana, readable now
status: done
disposition: cut 2026-07-25 from the second-round migration feedback
---

# DATA-18 — document against the real consumer stack: "with React Aria Components"

## Problem

Three of the four expensive integration facts accumulated across both migration waves are
React-Aria-specific, and two independent agents hit the identical form trap in one session. A
framework with one production consumer (on RAC) should carry a "with React Aria Components" section
rather than leaving each consumer to rediscover the traps.

The headline trap: `form.submit()` is action-compatible by design (never rejects, so
`useFormStatus().pending` agrees by construction) — but wired as a RAC `<Form action={…}>`, a
*failed* submit still completes the action, and React's action-completion form reset destroys the
user's input.

## Scope

1. Mine the actual traps from jnana — do not write from memory:
   - `~/jnana/frontend/.claude/frontend-architecture.md` (integration facts were recorded there per
     the DATA-03 findings: RAC render props run outside `observer`; `validationBehavior="native"`
     blocks submit before field validators run; reactive producers' synchronous-prefix rule;
     API-client-from-closure).
   - The migrated form/dialog code and PR history (nazar-ch/jnana#822 and the second-wave PRs) for
     the submit-as-action input-destruction trap and its chosen fix (onSubmit + preventDefault vs
     action; controlled fields via `field.props`).
2. Write the guide section: each trap as symptom → cause → the working pattern, with a short
   RAC-flavored code sample per trap. Lead with the form/action one.
3. State the stance explicitly: rati stays headless/stack-neutral; this section is field notes for
   the stack the framework is actually developed against, not an endorsement or an adapter.
4. Cross-link from the form/field reference sections.

## Boundaries

- Docs only — no rati API changes ride this (the form success-state decision is DATA-19, deferred;
  the never-rejects contract itself stays).
- No RAC dependency, no adapter code, not even in examples/ — samples are inline in the guide.

## Verify

- `vp check` green.
- Every documented trap cites real jnana code/history (file or PR) in the item's closing notes —
  none invented.

## Closing notes (2026-07-25)

Landed as `docs/current/public/guide.md` §"With React Aria Components", after the `rati/data`
section: stance paragraph (headless, stack-neutral, field notes — not an adapter), then four traps
as symptom → cause → pattern, then two non-RAC facts from the same app. The guide's own form
example, which taught `<form action={dialog.save}>`, was rewritten to `onSubmit` + `preventDefault`;
`reference.md`'s forms paragraph and the `form`/`field` table row were corrected the same way, and
so was the header comment in `packages/rati/src/data/form.ts` (comment only — the never-rejects
contract is unchanged, per Boundaries). That retraction is what jnana's FND-130 left open upstream.

**Citations — every trap has a receipt.** Paths are in `~/jnana` unless noted.

1. *A function `action` erases the draft.*
   `docs/backlog/findings/issues/FND-130-react19-form-action-resets-rati-fields.md` (mechanism:
   React's reset is a native `form.reset()`, the value tracker turns it into a synthetic `change`,
   RAC's `TextField` forwards it to `onChange`; the two failing paths; "still open upstream: rati's
   reference and guide both recommend the wiring"). Fix in code:
   `frontend/src/common/ui/jnana/Form.tsx` (the `submit` prop — `onSubmit` + `preventDefault`; the
   doc comment names `useFormReset`). Commits `795c4672` (the prop), `3ffdc3f6` ("it reproduces with
   a plain useState and no MobX, so it is React 19 x React Aria, not rati"), `6df98ab1` (why a prop
   beat a helper: "a call site cannot forget it"). PR nazar-ch/jnana#863
   ("`<Form action={form.submit}>` wipes the user's draft… both form legs hit it independently").
   Regression test: `frontend/test/features/spaces-management/dialogs/createSpaceDialog.test.tsx`
   ("keeps the typed title when the create fails"). The no-`useFormStatus` consequence:
   `rg useFormStatus` over `frontend/src` returns nothing — pending is read as `form.isSubmitting`
   (e.g. `frontend/src/features/auth/pages/LoginPage.tsx`).
2. *`validationBehavior="native"` blocks submit first.* PR nazar-ch/jnana#822 ("RAC's `Form`
   defaults to `validationBehavior="native"`, so the browser blocked submit on
   `<input type="email">` before the field validators ever ran"), commit `5583f2bf`, and all eleven
   `<Form>` call sites carrying `validationBehavior="aria"` with the same two-line comment
   (`LoginPage.tsx`, `SignupPage.tsx`, `TwoFactorPage.tsx`, `ResetPasswordPage.tsx`,
   `ForgotPasswordPage.tsx`, `AccountPage.tsx`, `ChangePasswordPage.tsx`, `TotpVerifyForm.tsx`,
   `PasswordConfirmForm.tsx`, `CreateSpaceDialog.tsx`, `InviteMemberDialog.tsx`). The `noValidate`
   cost, and the validator having to carry what the markup promised: `docs/current/data-fetching.md`
   §"React Aria seams" + `frontend/src/features/auth/forms/SignupForm.ts`.
3. *Render props run outside the `observer`.* PR nazar-ch/jnana#822 ("the first submit created a
   space titled `"e"` (the last keystroke)"), commit `5583f2bf` ("Keep the dialog bodies inside
   their observer") whose diff is the before/after, and the surviving comments in
   `frontend/src/features/spaces-management/dialogs/CreateSpaceDialog.tsx` and
   `InviteMemberDialog.tsx` (children as an element; Cancel closes through the component's own
   `isOpen`).
4. *`field.props` fits a text field, not every widget.* `InviteMemberDialog.tsx` (the `Select`
   bridge — "a Select's onChange yields a Key, not the field's own type"), `LoginPage.tsx` (the
   `Checkbox` bridge — `isSelected={rememberMe.value} onChange={rememberMe.setValue}`),
   `docs/feedback/2026-07-21-mac-data-auth-forms.md` ("a `Checkbox` does too… two of the three
   widgets these pages use"). The missing `name`: commit `83ef1b73` ("Keep the name attributes the
   field spreads don't carry" — password managers and autofill).
5. *The two non-RAC facts.* API client from the producer closure:
   `frontend/src/features/admin/stores/JobsListStore.ts` ("The endpoint is reached through the
   closure, never at construction: the store is built during boot, ahead of any apiClient use") and
   `frontend/src/features/history/stores/BlockHistoryStore.ts` (the same rule for a different reason
   — constructor params are assigned after field initializers). Synchronous prefix: the same
   `JobsListStore` comment, plus `docs/current/data-fetching.md`.

Deliberately not documented here: the per-call `isPending` gap (jnana◊FND-127, held back by the
2026-07-25 maintainer call), the missing settled-success signal and the `form.error`/`form.reset()`
coupling (DATA-19 and the "what the primitives don't own" list in
`jnana:///docs/current/data-fetching.md`) — those are gaps to close, not seams to teach. The stale
`<form action={store.save}>` line in `docs/research/field-gap-analysis.md` and in the archived
design record was left alone: both are historical/analysis, not the public station.
