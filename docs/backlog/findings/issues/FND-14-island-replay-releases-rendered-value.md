---
area: packages/rati/src/mandala/mandala.tsx, packages/rati/src/mandala/resolver.tsx
needs:
status: open
approved: the user, in jnana's block-content release session, on the drag-reorder replay: "add a new item to the rati station. don't frame your proposal as fix - name it as possible approach to solve" (2026-11-06)
---

# FND-14 — An island releases what its committed subtree still renders when React replays its effects

## Product framing

A consumer whose island holds a counted resource — jnana's block row holds a grab on its block document through a source — logs a use-after-release error each time React replays the island's effects. In a development build that happens on every keyed move of an island, since React 19 replays a moved child's effects under StrictMode: a jnana developer who reorders blocks by drag gets the errors on every drop. Production React replays no effect on a move, so production logs nothing there.

## Problems to solve

- An island never releases a value its committed subtree still renders.
- An effect replay leaves the island's subtree reading live values from the replayed cleanup to the setup that follows.

## The mechanism

1. React 19.2.7's `placeChild` flags a keyed child it moves with `PlacementDEV`, and under StrictMode the commit's dev pass replays that fiber's effects through `doubleInvokeEffectsOnFiber`: each effect's cleanup, then its setup.
2. On the replayed cleanup, the mandala's unmount effect in packages/rati/src/mandala/mandala.tsx tears the run down through `teardownRun`, detaching every bucket's sources — a jnana `ResourcePool` source releases its grab in that detach. The setup that follows finds the cache gone and forces the rebuild of a fresh run, with new sources and new values. The comment above the effect states the choice: "Drops the cache on unmount, so a StrictMode remount rebuilds a fresh run".
3. Until the rebuild renders, the island's subtree holds the values the torn-down run handed it. Its own replayed effects run over them, and its renders before the rebuild read them, after their release.

## Measured in jnana, 2026-11-06

- **The count** — jnana's dev app in Chrome, one block dragged to a new place on a page by a real OS drag: 14 errors per drop at jnana commit `a13499c2c4`, and 8 to 10 on the branch of jnana PR 3218, each "Resource … (block-content) of type blocks accessed after releasing", on the row React moved.
- **The release** — the stack runs the source's `detach`, `teardownRun` (bundled as `pt`), `commitHookPassiveUnmountEffects` and `doubleInvokeEffectsOnFiber`.
- **The readers** — the editor's build in a replayed ref callback, through jnana:///frontend/src/features/pages/components/blocks/useBlockEditor.ts and jnana:///frontend/src/features/pages/components/blocks/rowBlockEditor.ts; the island's component writing its value into a context in a replayed effect, jnana:///frontend/src/features/pages/components/blocks/BlockContent.tsx; and the renders reading that context before the rebuild.

## A possible approach to solve

- **Keep the run across a replay** — the unmount half schedules the teardown for after the commit, and a mount half in the same commit cancels it, so the run, its attached sources and its values stand through the replay. A real unmount tears down one task later.
- **What it changes** — a StrictMode remount stops rebuilding a fresh run, the choice the comment above the effect states; and a real unmount's sources detach after the commit rather than inside it, which docs/current/internals.md's dispose-before-detach order has to keep holding through.
- **Unread** — whether React's `Activity` hides and shows a subtree through the same disconnect and reconnect in production, which would put a hidden island in the same window; jnana renders no `Activity`.
- **Related** — REV-07's StrictMode question asks whether sources attach, detach and re-attach cleanly; this is a case where the values do not.
