---
area: rati releases, cross-repo work items
needs:
needs-human: Whether a rati fix a jnana change depends on releases first with jnana following, or the jnana change waits merge-blocked on a `rati-dev` alias until that release.
status: open
disposition: —
---

# ASK-01 — Which side lands first when a rati fix is what a jnana change needs

## Product framing

Some work in jnana cannot be finished honestly without a change in rati — jnana hits a limit in the framework, and the good fix belongs on rati's side. Whoever picks that work up today has to invent the order themselves: ship rati and wait for a release before the jnana half can merge, or open the jnana half now against an unreleased rati and leave it sitting. Both have been done, so a reader of either repo cannot tell whether an open cross-repo PR is stalled or working as intended. What is at risk is a jnana branch that rots against its own main while it waits, or a jnana main that only installs against a rati version nobody has published.

## Problems to solve

- A session that finds the fix belongs in the other repo knows, without asking, which repo merges first and what the second one waits for.
- jnana's main stays installable from published packages at every moment, whichever order is chosen.

## The options

1. **rati releases first, jnana follows.** The rati fix lands and ships in a release; the jnana change is written against the released version and merges after it. Cost: the jnana half waits on rati's release cadence, and an urgent consumer fix forces a release it would not otherwise justify.
2. **The jnana PR waits merge-blocked on a `rati-dev` alias.** The jnana half is written and reviewed immediately against the local rati source, and merges once the release exists. Cost: a long-lived open PR that rebases against a moving main, and a review whose result is only true of unreleased rati.

**Recommendation: option 1**, with the rider that a fix jnana is actually blocked on justifies its own release rather than an alias. It keeps jnana's main installable at all times, and the cost it pays — a wait — is bounded and visible, where option 2's cost is an open PR nobody can date.

## Provenance

Raised by DX-09 and left explicitly undecided: docs/archive/efforts/testing-and-dx/README.md §"2026-07-20 — DX-09 (the DX-06 frictions addressed)", whose closing note asks for the rule and names the next release as the moment to state one. DX-09 is itself an instance — the fix landed in rati, unreleased, with a jnana leg (`anonymousShell.browser`'s router partial) waiting on it. The consumer-side ask is jnana's own feedback record, jnana:///docs/feedback/2026-07-20-lima-dx-06-rati-adoption.md.
