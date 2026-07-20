# What the scope model uniquely enables

Status: research record (2026-07-20), the output of the improvement-review effort's
[IMP-02 session](../planned/improvement-review/issues/IMP-02-model-native-capabilities.md).
The premise, taken whole: a scope is a *declarative, typed, inspectable* description of a
page's data — which props, which levels, which kinds — as a plain value, before anything
runs. Hook-based peers cannot have this by construction; rati has it and exploits almost
none of it. This record is the end-to-end walk of what "the spec is data" buys, grounded
in the source at session time ([scope.ts](../../packages/rati/src/scope/scope.ts),
[resolver.tsx](../../packages/rati/src/mandala/resolver.tsx),
[mandala.tsx](../../packages/rati/src/mandala/mandala.tsx),
[channel.ts](../../packages/rati/src/mandala/channel.ts),
[store.ts](../../packages/rati/src/router/store.ts)) rather than in the docs' claims.

Neighbors it engages rather than restates: the
[field gap analysis](./field-gap-analysis.md) (its D1 prefetch and D3 devtools proposals
border two sections here), [dependency-graphs.md](./undecided/dependency-graphs.md)
(`derive()`, the `PartialProps` note),
[deferred-scope-features.md](./undecided/deferred-scope-features.md) (`.live()`,
`.extend()`), [ssg-and-rsc.md](./ssg-and-rsc.md),
[ssr-streaming.md](./undecided/ssr-streaming.md) (the shell-line idea),
[router-extensions.md](./router-extensions.md), and the executed
[testing-and-dx](../planned/testing-and-dx/README.md) /
[scope-and-island](../planned/scope-and-island/README.md) efforts.

## The inventory — what the value actually exposes

What is knowable from a scope value at module load, with nothing rendered and no load run
(all of it used internally today, none of it a supported surface):

- **The levels.** A scope is a linked list — each node one level's `definition`, the head
  the `input()` markers — and `flattenLevels` walks `prevScope` into ordered levels. Depth,
  keys per level, key order: free.
- **The kind of every entry.** The resolver's `classifyEntry` distinguishes inputs
  (`InputSymbol`), hook loads (`HookSymbol` via `isHookLoad`), option-carrying data loads
  (`DataSymbol`), static promises, `Source` values (`SourceSymbol`), classes, plain
  functions, and inline values — all by inspecting the entry, before running anything.
- **The provide step.** `provideDef` says whether the chain ends in `.provide()` and
  whether it bridges into an app context.
- **The route binding.** A route object carries its `scope` — so route → waterfall is one
  property read, which is what `useRouteContext`'s types already lean on.

What is *not* knowable statically — the two honest limits every idea below must respect:

- **What a function load returns.** Value, promise, or `Source` is classified from the
  *result* (`classifyResult`), at run time. The declaration says "a producer", not what it
  produces.
- **What a load reads.** The dependency edges inside the waterfall are observed, not
  declared: `trackReads` proxies the resolved-so-far bag and records which keys a producer
  actually touched — the read-sets the refresh cascade runs on. They exist only after a
  run (and under-report conditional reads, the caveat
  [dependency-graphs.md](./undecided/dependency-graphs.md) already records for the same
  trick).

So the model holds *two* graphs no hook-based peer has: the **declared shape** (levels,
keys, kinds — free at module load) and the **observed dependency graph** (read-sets —
free after every resolution, kept fresh by the cascade machinery). The field's loaders
are one opaque async function per route — a router can *run* them ahead of time but
cannot see inside one (the [field gap analysis §7](./field-gap-analysis.md) cites the
current crop); a TanStack Query spec exists only once a component renders its hook. The
proposals below are the four cheapest things these two graphs buy, plus the defense the
fifth direction asked for.

A boundary fact worth recording: the raw walk is *half* public today. `Scope` exposes
`definition`/`prevScope`, and `InputSymbol`/`ScopeSymbol` are exported from the barrel —
but `HookSymbol`/`DataSymbol` and the classification helpers are not, so an external tool
can walk the chain yet cannot classify what it finds without re-implementing internals.
That half-open door is an argument for M1 (a small sanctioned read) rather than for
exporting more symbols.

---

## M1 — a supported way to read a scope's shape

**Problem.** Four recorded directions each need to read the declared shape, and each
would otherwise reach into internals: the devtools panel
([field gap analysis D3](./field-gap-analysis.md)) wants to render the declared waterfall
before lighting it up with trace events; the data-prefetch walker (D1) needs the
hook-free prefix; a route → data manifest (this effort's cut names it; the SSG walker in
[ssg-and-rsc.md](./ssg-and-rsc.md) is adjacent); and tests that assert on scope structure.
The improvement-review boundary is explicit — a proposal must not publicize `mandala`
internals — and the shape read is exactly the minimal seam that keeps them internal: the
panel and the walker consume a *description*, not the resolver.

**Sketch.** One read-only function in the main barrel, returning plain data:

```ts
scopeShape(pageScope);
// {
//   levels: [
//     { keys: [{ key: 'space', kind: 'input' }, { key: 'pageId', kind: 'input' }] },
//     { keys: [{ key: 'spaceId', kind: 'load' }] },
//     { keys: [{ key: 'tree', kind: 'load' }, { key: 'members', kind: 'load' }] },
//   ],
//   provides: 'value',   // 'props' when there is no `.provide()`
// }
```

Kinds stay coarse on purpose — `input`, `hook`, `load` (function/class/promise/value),
`source` — mirroring the split the resolver's `compileLevel` already makes (hook keys vs
data keys) plus the two kinds with different lifecycles. What a function load *returns*
is not in the description, because it is not in the declaration (the inventory's first
limit); a shape consumer that needs it (the prefetch walker) discovers it by running,
which is M2's business. No cells, no buckets, no `Step` — nothing about *how* resolution
happens, so the resolver stays free to change. Naming is the usual rule (plain English,
no coined terms): `scopeShape` reads honestly; deciding it is part of building it.

**Precedent.** None needed in the field — this is the "no peer can do this" kind: a
react-query/SWR app has no value to describe, and a TanStack Router route has one opaque
`loader`. The closest neighbor is rati's own internal `describeScope` (error labels),
which this generalizes.

**Cost.** Small: a walk over `flattenLevels` + the existing classifiers, a frozen return
shape, tests. The real cost is contractual — a public shape is a public promise, so it
must stay coarse enough that resolver changes don't churn it (the kinds above deliberately
encode nothing SI-01…06 touched).

**Trigger.** The first consumer among D3's panel, M2's walker, or a docs/manifest
generator. Not worth landing bare — it should arrive with whichever consumer goes first,
shaped by what that consumer actually reads.

## M2 — run the plain-data prefix of a scope outside React

**Problem.** Resolution is deliberately React-run (Step tree, `use()`, Suspense — see
[internals.md §The resolver](../current/internals.md)), which means *nothing* can start a
scope's loads without mounting its island. The
[field gap analysis](./field-gap-analysis.md) hit this from the outside — its D1
(intent-based data prefetch, the one axis where all four neighbors are ahead) and its §2
back/forward note both stall on the same missing piece: some way to run the front of a
scope's waterfall before/outside the island. This effort's cut names the general form
("server-side scope execution outside React — the resolver as a plain async function —
what would consume it?"). The honest answer from the code: the *full* resolver cannot
leave React (hook loads run hooks; sources attach from effects and their lifetime is the
island's), but a well-defined prefix can — and that prefix is all the recorded consumers
need.

**Sketch.** Define the **plain-data prefix**: the longest run of levels, from the head,
in which every entry is an input, a function/class load, a static promise, or an inline
value — no `hook()` (needs a tree), no `Source` entry (needs an attach lifecycle). That
prefix is computable from the shape (M1); by the inventory's first limit it is
*provisional* — a function load may still hand back a `Source` at run time, at which
point the executor stops before that level's dependents, discards the source unattached,
and keeps whatever it already settled.

The executor itself is a small plain-async loop, internal to the package: given a scope
and its inputs (for a route: the params matched from the href — `preloadRoute` already
does the matching), build the level's cells with the existing `classifyEntry`, await the
promises, feed the resolved bag forward, stop at the prefix's end. Its output is a
per-key value bag — exactly the shape of hydration's `data` slice, which is why
consumption is nearly free: `buildCell` already short-circuits a key found in a carried
bag to a value cell. D1's handoff store (per-route, latest-wins, short TTL, claimed once)
is the carrier; this proposal is the first implementation slice of D1, named as its own
piece, not a competitor to it.

Consumers, in pull order:

1. **Intent prefetch** (D1's headline): `<Link prefetch>` runs the destination scope's
   prefix on hover/viewport; the island claims the bag on mount. All policy questions
   (TTL, abort via the existing per-bucket `AbortController` shape, one slot per route)
   are D1's and stay there.
2. **The back/forward second act** (the field gap analysis §2): a retained-run cache is
   the same carrier filled from the *outgoing* run instead of a fresh prefix run —
   recorded here only as shape-sharing evidence, not proposed.
3. **Script-land resolution**: a smoke test or CLI that runs a route's data with no DOM
   and no render — `await` the prefix, assert on the bag. Pairs with M4 (substitute the
   hook loads out, and the prefix *is* the whole scope).

The DI reality check, honestly: jnana's scopes commonly head with
`hook(() => useStores())`, and a hook at level 1 makes the prefix just the inputs —
prefetch degrades to today's chunk-only behavior, which D1 already accepts. The lever is
M4's substitution mechanism: an executor call that supplies values for named hook keys
(`{ substitute: { stores } }`) extends the prefix past DI hooks for callers that have the
values in hand — the router does, it lives beside the stores. That option is the bridge
between this proposal and M4, and it is opt-in per call site, never a change to the
scope.

**Precedent.** TanStack Router preloads route loaders on intent, React Router fetches
data + modules, Next auto-prefetches — all cited with versions in the
[field gap analysis §7](./field-gap-analysis.md). None of them can *see* how much of the
work is startable — a loader is one opaque function — where rati's prefix is read off the
declaration. The field's hard dynamic problem ("what is safe to run early?") has a static
answer here; that asymmetry is the model earning its keep.

**Cost.** The executor loop (small — it reuses `classifyEntry` and the abort shape
SI-01 landed), the provisional-prefix stop rule, the handoff carrier (D1's cost, already
budgeted there), and the race matrix tests (prefetch vs navigate vs second hover — D1
names them). Risk: semantic drift between the executor and the Step tree — one
classification path must serve both, which the shared `classifyEntry` enforces; a second
implementation of "what does this entry mean" would be the mistake.

**Trigger.** D1's: the first consumer with visible navigation latency on promise-load
routes (jnana's page switches). If D1 graduates, this is its first slice; if it never
does, nothing here lands either.

## M3 — a level-placement advisor in the data trace

**Problem.** "Where a prop is declared is its scheduling" is the model's performance
knob, and the docs sell it as such — but nothing tells an author the knob is set wrong. A
load declared at level 3 that only reads level-0 keys waits for two levels it doesn't
need; the waterfall resolves correctly and slowly, and only a human reading `dataTrace`
timings might notice. The declared shape can't catch it (read-sets aren't declared — the
inventory's second limit), but the runtime records exactly the needed fact on every
resolution: `cell.reads`.

**Sketch.** A dev-only diagnostic riding `dataTrace` (the
[DX-07](../planned/testing-and-dx/issues/DX-07-observability.md) tracer): when a run
resolves, for each produced cell compare the levels of the keys it read against the level
it lives on. If every read key resolves at or above level *L*, the load could be declared
at level *L*+1; if it sits deeper, say so:

```
[data] Route(Page) advisor: level 3 'members' read only [spaceId] (level 1) — could start at level 2
```

Same channel, same zero-cost-when-off rule (the advisor runs only when the trace exists).
Honest caveats printed with the advice, not hidden: read-sets under-report conditional
reads (moving the load might break the branch not taken this run), hook loads have no
read-set at all (they receive the bag unproxied, every render), and a load kept deep *on
purpose* (to serialize against a side effect) is a false positive — which is why this is
an advisor line in a debug trace, not a lint error. The same pass can note an input no
load ever read (it still reaches the component, so that too is advisory only).

**Precedent.** None in the field — a hook-based peer has no levels to misplace; TanStack
Query's docs instead teach *hoisting out of components entirely* (the waterfall tension
the [field gap analysis §1](./field-gap-analysis.md) quotes). The closest relative is
rati's own trace, which shows the cost but not the diagnosis.

**Cost.** Small: bookkeeping of key → level during the run (the trace already keys marks
by `level:key`), one comparison pass at `traceResolved`, tests. No public surface, no
behavior change.

**Trigger.** Low bar — the first time a real waterfall is hand-tuned with `dataTrace`
timings (the act this automates). Natural rider on any future devtools work (D3's
structured sink would carry the same advice as data).

## M4 — derive a test double of a scope by substituting loads

**Problem.** Testing a component that renders under an island means resolving the scope,
which means either running real loads or faking at the transport layer. The field mocks
the network (MSW) or seeds a cache (`queryClient.setQueryData`) because a hook call site
cannot be swapped from outside. A scope can: it is a plain value, so a test can derive a
*new* scope with named loads replaced — same levels, same keys, same resolved types —
and mount the same component against it. `rati/testing` (DX-01…04) gives harnesses for
rendering and controllable sources but nothing scope-shaped; today a test hand-builds a
parallel scope and hopes it matches.

**Sketch.** A helper in `rati/testing` (not core — it is a test affordance):

```ts
const testScope = substituteLoads(pageScope, {
    tree: () => fakeTree,                        // sync value: resolves without suspending
    members: deferred.promise,                   // a Deferred walks the phases
    stores: () => testStores,                    // a hook() key replaced by a plain load
});
renderIsland(island({ scope: testScope, component: PageBody }));
```

Mechanically trivial — walk `prevScope`, copy each level, replace the named entries — the
work is in the types: the substitute for key `K` must produce `ScopeProps<S>[K]` (the
resolved type, however the original produced it), so the derived scope keeps the exact
`Scope` type and the component contract is enforced, not re-declared. Replacing a
`hook()` key with a plain load is explicitly sanctioned (a test has no context to read
from — this is the DI seam inverted), and it is the same substitution M2's executor wants
at run time, so the two proposals share their one nontrivial design question.

One consequence to document rather than fix: channels are keyed by scope identity
(§Scope identity below), so the derived scope has its own `useScope`/`useScopeControls`
channel — correct for the mounted island under test (the subtree reads the nearest
provider of the *derived* scope's channel via the island being built from it), but a
component hard-importing the original scope to call `useScope(pageScope)` reads the
original channel and finds no provider. The helper's docs must say so; the deeper fix, if
ever wanted, is `.extend()`'s recorded identity question, not this helper's.

**Precedent.** No peer equivalent at this layer (declaration-level, per-key, typed);
MSW/`setQueryData` cited above are the field's substitutes one layer down and remain
usable with rati too (a load's `fetch` is intercepted like anyone's).

**Cost.** Small runtime, medium types (the mapped substitute type over `ScopeProps`),
plus the channel-identity documentation. No core change.

**Trigger.** The first jnana test that hand-builds a parallel scope for a component
already covered by a real one — DX-06's adoption item is where that will surface, and
this helper is the recorded answer when it does.

---

## The all-or-nothing dial — a defense of level-granular *islands*, not level-granular commits

The fifth direction asked whether principled partial shapes exist between all-or-nothing
and hook-soup, or whether the right output is a written defense of why not. The answer is
both: the partial shapes exist, they are already in the model, and the one shape that
must stay out is level-granular *commits*. The argument, from the code:

1. **Type honesty is the product.** `ScopeProps` — every key present, fully resolved —
   is the contract the whole model exists to deliver. A component receiving a
   half-committed bag needs per-key state in its props, which is exactly the
   `PartialProps` sketch [dependency-graphs.md](./undecided/dependency-graphs.md) records
   and rules out of scope: the moment `{ page: ready(Doc); members: pending }` enters the
   prop types, the framework has re-invented the loading-state juggling it was built to
   delete.
2. **The phase model has no honest answer for a mixed screen.** SI-03/SI-05 settled that
   `phase` means "which slot is on screen" — one slot, reported by whatever renders
   (internals.md §The island's phase). A level-granular commit puts content *and* loading
   on screen for one island at once; `phase`, `isStale`, the retry policy's "accepted
   failure is not an error state" logic, and `keepStale`'s kept-run swap all assume the
   island is one coherent thing. That machinery was hard-won this month; a partial-commit
   mode forks all of it.
3. **The dial already has positions**, each keeping every rendered state complete:
   - *spatial* — the designed `.live()` hands one prop's `Source` through, marked,
     opt-in ([deferred-scope-features.md](./undecided/deferred-scope-features.md));
   - *temporal* — `keepStale`/`loadingDelayMs` trade a complete old state for the
     complete new one (never a mixed one — the scope-and-island effort's records);
   - *SSR* — `ssr: false` and the streaming record's "scope levels as the shell line"
     ([ssr-streaming.md](./undecided/ssr-streaming.md)) move whole islands or whole
     level-prefixes across the server/client line;
   - *structural* — the position this defense adds: **nested islands are level-granular
     commits, spelled as composition.** Split the slow tail into a child island rendered
     by the parent's component, feeding the parent's resolved props in as the child's
     inputs (island inputs are just props). The parent commits when its levels are done
     and is fully coherent; the child shows its own loading slot inside real content;
     each island stays all-or-nothing; the *page* is progressive. This works today, needs
     no new API, keeps `useScopeControls` honest per unit, and composes with every option
     shipped this month. What it costs is a component boundary at the split — which is
     the model saying the quiet part out loud: a piece of UI that should appear
     independently *is* a separate unit, and deserves its own error slot too.

So the recommendation is a documentation move, not a feature: the guide should teach
"split the island" as the answer to "my page commits too late", next to the existing
"move the load a level earlier". If a future consumer produces a case nested islands
genuinely cannot express (the candidate: a child that must *share* the parent's
in-flight resolution rather than its resolved props), that case lands on the recorded
sharing directions — `.extend()`, layout-level scope
([router-extensions.md](./router-extensions.md)), `ResourceContainer`
([scope-and-island-directions.md §3](./scope-and-island-directions.md)) — not on a
partial-commit mode.

## Scope identity is the composition unit — a note for the `.extend()` design

A fact the composition directions should inherit explicitly: **the scope object's
identity is the keying unit of the runtime.** The value channel, the controls channel,
and the scope label are all `WeakMap`-keyed by the scope value
([channel.ts](../../packages/rati/src/mandala/channel.ts), controls.ts); mandalas built
from the same scope share channels ("nearest wins"), and `useScope(scope)` is a lookup by
that identity. Three consequences:

- **Parameterized scope factories already work** — a scope is a plain value, so
  `makePageScope(options)` is just a function — but each call mints a fresh identity,
  so consumers must read the *returned* value (`useScope` of the factory result, threaded
  to them), never a shared import. A pattern to document, not a feature to build.
- **`.extend()`'s open question** ("whether the value channel keys by the composed scope
  or the base", [deferred-scope-features.md](./undecided/deferred-scope-features.md)) is
  exactly this fact surfacing: extension must decide which identities exist and which
  channels they own before anything else about it is designed.
- **M4's test doubles** get their own channels by construction — right for the island
  under test, documented as a caveat for hard-imported originals (above).

---

## Top-3

If only three things are read out of this session:

1. **M2 (the plain-data prefix executor)** — the model's signature asymmetry (the field
   guesses what is safe to run early; rati reads it off the declaration) turned into the
   one piece of machinery the field-gap analysis's top proposal (D1) and its back/forward
   note both need. If D1 graduates, build this first.
2. **M4 (scope test doubles)** — the cheapest genuinely model-native capability: per-key,
   typed substitution at the declaration, impossible for hook call sites; direct jnana
   pull through DX-06, and it shares its one hard design question (hook-key substitution)
   with M2.
3. **The all-or-nothing defense** — nested islands *are* the principled partial shape,
   available today; write it into the guide and let the partial-commit question stay
   closed on the record instead of reopening with each new consumer.
