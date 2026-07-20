# DATA-07 — `field.props` under `exactOptionalPropertyTypes`

area: packages/rati/src/data — field.ts (+ reference.md if the shape is mentioned)
needs: nothing
disposition: cut 2026-07-20 from the DATA-03 findings (gap 4)

## Problem

`FieldProps.errorMessage` is `string | undefined` — the key is always present, its
value possibly `undefined`. Under `exactOptionalPropertyTypes` (which rati itself and
jnana both compile with), spreading that into a component whose prop is declared
`errorMessage?: string` is a type error: a `?:` prop rejects a *present* key holding
`undefined`. jnana's migration had to widen `TextFieldProps.errorMessage` by hand,
with a comment explaining rati's shape — every RAC-wrapping consumer would repeat
that.

## Scope

Make `errorMessage` genuinely optional: `errorMessage?: string` on `FieldProps`, and
the `props` getter omits the key when the field has no errors. Absent key and
`undefined` are indistinguishable to React; consumers that already widened stay
compatible.

## Boundaries

- `value`/`onChange`/`isInvalid` stay required — they are always meaningful.
- No behavior change; this is the binding shape only.

## Verify

- A type-level test: `{...field.props}` spreads into a target with
  `errorMessage?: string` under rati's own strictest config.
- Runtime: the key is absent when clean, present when invalid.
