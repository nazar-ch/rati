# Dependency graphs for islands — exploration

> **Exploratory / future feature.** Not implemented and not committed to. The
> shipping model is the **scope chain** (`scope()` / `.load()`) over reactive sources
> — see [the public guide](../public/guide.md). This doc explores the
> *generalization* of the chain into a free dependency graph, focused on what the
> **types** would look like, so we can decide if/when it's worth adding. Nothing
> here changes current behavior.

## Why even consider it

The scope chain we ship is a **depth-layered DAG**: the `scope({...})` head is layer 0
and each `.load({...})` is one more layer, props inside a layer resolve in parallel, and
a layer sees the resolved values of all earlier layers. That already expresses fan-out and
diamonds — you just bucket nodes by depth:

```ts
scope({ spaceId: prop<Uuid>(), pageId: prop<Uuid>() })            // layer 0 (the head)
    .load({ tree: ({ spaceId }) => loadTree(spaceId) })              // layer 1
    .load({ members: ({ spaceId }) => loadMembers(spaceId) })        // layer 1 (could merge)
    .load({ page: ({ spaceId, pageId }) => loadPage(spaceId, pageId) }); // layer 2
```

A **free graph** drops the layer boundary: a node depends directly on the nodes it
reads, and scheduling follows the data, not the depth. The only *behavioral* gain
over depth-layering is **finer scheduling**: if `tree` is slow and `page` needs only
`spaceId`, a free graph starts `page` as soon as `spaceId` is ready, while the chain
makes layer 2 wait for all of layer 1 (`tree` included). For most UI waterfalls that
doesn't matter — which is why the chain is the default. The graph is interesting for
(a) wide fan-out where one slow branch shouldn't gate the rest, and (b) as the
conceptual model the chain is a special case of.

This doc assumes the [source model](../internals.md#sources-scopesourcets): every node is a
`Source<T>` — a live `pending | ready | error` machine — and the island aggregates.

## Two construction styles

### G1 — sources as first-class values (combinator)

Each node is a `Source<T>` value; you build dependents with a combinator over the
upstream **ready values**:

```ts
const spaceId = resolveSpace(slug);                          // Source<Uuid>
const tree    = derive([spaceId], ([id]) => loadTree(id));   // Source<Tree>
const members  = derive([spaceId], ([id]) => loadMembers(id)); // Source<Member[]>
const page    = derive([spaceId, pageId], ([id, pid]) => loadPage(id, pid)); // Source<Doc>
```

The combinator owns propagation — the user's `fn` is **total over ready values**,
never seeing pending/error:

```ts
type SourceValue<S> = S extends Source<infer T> ? T : never;

function derive<const Deps extends readonly Source<any>[], T>(
    deps: Deps,
    fn: (values: { [K in keyof Deps]: SourceValue<Deps[K]> }) => T | Promise<T> | Source<T>,
): Source<T>;
```

- any dep `pending` → the derived source is `pending`;
- any dep `error` → the derived source is `error` (forwarded, same `SourceError`);
- all deps `ready` → run `fn` with the tuple of ready values.

`{ [K in keyof Deps]: SourceValue<Deps[K]> }` maps the dep **tuple** to a tuple of
its value types, so `([id, pid]) => …` is typed `[Uuid, Uuid]`. The `const` on `Deps`
preserves the tuple (positions), not a widened `Source<any>[]`.

**Why the types are clean:** each `derive` is its own inference boundary. Deps are
already-typed `Source` values; `SourceValue` extracts `T`; nothing references the
graph-as-a-whole. It composes and unit-tests trivially (`derive` is a pure function
of sources). The cost is ergonomic: the dependency structure lives in the wiring
(which variable you pass), not in one readable declaration.

### G2 — flat declarative record (deps inferred from what you read)

The nicest to read — pure declaration; the dependency of a node is *which sibling
keys its function destructures*; the framework topologically sorts:

```ts
const graph = sources({
    space:   prop<string>(),
    pageId:  prop<Uuid>(),
    spaceId: ({ space })           => resolveSpace(space),
    tree:    ({ spaceId })         => loadTree(spaceId),
    members: ({ spaceId })         => loadMembers(spaceId),
    page:    ({ spaceId, pageId }) => loadPage(spaceId, pageId),
});
```

But the types fight back. The resolved shape and the per-node parameter type are
mutually recursive:

```ts
type UnwrapSource<T> = T extends Source<infer U> ? U : T;

type Resolved<G> = {
    [K in keyof G]: G[K] extends Prop<infer T>      ? T
                  : G[K] extends (d: any) => infer R ? UnwrapSource<Awaited<R>>
                  : G[K] extends Source<infer T>     ? T
                  : G[K];
};

type GraphDef<G> = {
    // each node may read every *other* node's resolved value
    [K in keyof G]:
        | Prop<any>
        | ((deps: Omit<Resolved<G>, K>) => unknown | Promise<unknown> | Source<unknown>)
        | Source<any>;
};

declare function sources<G extends GraphDef<G>>(graph: G): GraphSource<Resolved<G>>;
```

Two type problems live here:

1. **Self-reference during inference.** A node's parameter type is `Omit<Resolved<G>, K>`,
   and `Resolved<G>` is computed *from the same object literal `G`* that is still
   being inferred. TypeScript can sometimes resolve `G extends GraphDef<G>`
   (F-bounded), but contextual typing of the function parameters through it is the
   fragile case — exactly what `.load()` sidesteps by making each layer's input a
   **closed, already-known** type (`ResolveScopeDefinition<PrevDefs>`), never the
   in-progress whole.
2. **No cycle prevention at the type level.** `Omit<Resolved<G>, K>` forbids the
   trivial self-edge (`spaceId` can't read `spaceId`), but it cannot express "only
   your topological predecessors." A → B → A typechecks; you'd catch it at runtime.

So G2 reads best and types worst.

## Conclusion: the chain is the graph's typeable normal form

A scope chain is a topological *pre-sort* of the graph into depth layers. That pre-sort
is what makes the dependency types expressible: every node's input is the resolved
type of a closed set of earlier nodes, so there's no self-referential `Resolved<G>`
and no cycle question. The chain we ship is therefore the graph, minus the typing
hazard, minus the finer scheduling.

Practical recommendation if we ever want graph-like power:

- Keep the chain as the default surface.
- Add **G1 `derive`** as an *escape hatch within a `.load()` level* for the occasional
  cross-branch dependency that shouldn't spawn a whole new layer. It types cleanly,
  needs no new inference machinery, and is opt-in:

  ```ts
  .load({
      tree: ({ spaceId }) => loadTree(spaceId),
      // page only needs spaceId, not tree — don't gate it behind a tree layer
      page: ({ spaceId, pageId }) => loadPage(spaceId, pageId),
  })
  ```

  (In the chain this is already parallel-within-layer; `derive` matters when the
  dependency crosses an existing layer boundary.)

## Worked example: the diamond

`a → b`, `a → c`, `(b, c) → d`.

**Chain (depth-layered):**

```ts
scope()
    .load({ a: () => loadA() })                  // layer 0 (first data level)
    .load({ b: ({ a }) => loadB(a),
            c: ({ a }) => loadC(a) })            // layer 1 (b, c in parallel)
    .load({ d: ({ b, c }) => combine(b, c) });   // layer 2
```

`d` waits for *both* `b` and `c` (same layer) — correct here, since `d` needs both.

**Graph (G1), same wiring, finer scheduling shows up only when it differs:**

```ts
const a = loadA();
const b = derive([a], ([a]) => loadB(a));
const c = derive([a], ([a]) => loadC(a));
const d = derive([b, c], ([b, c]) => combine(b, c));
// if a sibling `e = derive([c], …)` existed, it'd start when c is ready,
// regardless of b — the chain would make it wait for b too if they shared a layer.
```

Resolved type both ways: `{ a: A; b: B; c: C; d: D }` (and `e: E`). The graph buys
nothing on *this* diamond; it buys on the asymmetric branch (`e` needing only `c`).

## Types when nodes are live (re-derivation)

Because sources are live, `derive` returns a live source, which raises a semantic
axis the types don't capture but the runtime must pick:

- **Epoch re-run:** `fn` runs once per "ready epoch" — re-runs only when a dependency
  goes `pending → ready` again (e.g. a resource reconnects). Right for nodes whose
  value is a *stable live store* (don't rebuild the store when its contents mutate).
- **Mapping re-run:** `fn` re-runs on every upstream *value* change, like a MobX
  `computed`. Right for derived scalars (`fullName = derive([first, last], …)`).

Same `Source<T>` type, different recompute policy. A per-node hint (`derive(deps, fn,
{ recompute: 'epoch' | 'value' })`) or inferring it from whether `fn` returns a
`Source`/store vs a plain value is a design question. For the resource case in jnana,
epoch is what we want — the grabbed store is stable across edits.

## Errors and partial rendering in a graph

The island stays **all-or-nothing** (any node error → island error; one
`SourceError`, switch on `code`). That keeps the resolved props plain `T`s — errors
never enter the prop types. The graph *enables* but does not require per-node
fallback; if we ever wanted "render the page even though the members widget errored,"
that's the **progressive/partial** feature, and it is what would force a per-node
`SourceState<T>` into the props:

```ts
// only if/when partial rendering lands — opt-in, never the default
type PartialProps<G> = { [K in keyof Resolved<G>]: SourceState<Resolved<G>[K]> };
```

i.e. the component would receive `{ page: ready(Doc); members: error(SourceError) }`
and branch. Deliberately out of scope — noted so the all-or-nothing decision is seen
as *what keeps props clean*, not an accident.

## Runtime dependency detection (if we ever do G2)

To topologically sort a flat record we must know each node's deps. Options:

- **Explicit deps** (G1): you pass the dep list. No detection needed; types clean.
- **Destructure inference** (G2): call each node's `fn` once with a recording
  `Proxy` as `deps`; the keys it reads are its dependencies (the same trick MobX/Vue
  use for reactive tracking, or Angular-style DI introspection). Then build the real
  graph. Caveats: the dry-run must be side-effect-free, and conditional reads
  (`cond ? deps.x : deps.y`) under-report — so this stays a convenience with an
  explicit-deps fallback.

The type side (`Omit<Resolved<G>, K>`) is independent of which detection we pick; it
just can't prevent cycles, so runtime detection would also run a cycle check.

## Strawman API surface (if pursued)

```ts
// G1 combinator — the escape hatch, types cleanly, candidate to ship first
function derive<const Deps extends readonly Source<any>[], T>(
    deps: Deps,
    fn: (values: { [K in keyof Deps]: SourceValue<Deps[K]> }) => T | Promise<T> | Source<T>,
    options?: { recompute?: 'epoch' | 'value' },
): Source<T>;

// G2 flat graph — nicer surface, deferred until/unless the inference proves robust
function sources<G extends GraphDef<G>>(graph: G): GraphSource<Resolved<G>>;
```

## Open questions

- Is the finer scheduling ever worth it in real jnana screens, or is depth-layering
  always fine? (Decides whether we bother.)
- Ship `derive` (G1) inside chains first as a low-risk escape hatch? Its types are
  already sound.
- `recompute: 'epoch' | 'value'` — inferable, or always explicit?
- If G2 is ever attempted: proxy-based dep detection vs explicit deps; and a runtime
  cycle check since the type system won't give one.
- Interaction with explicit `attach`/`detach` lifetime: a shared upstream node (the
  `a` of the diamond) is attached once and ref-counted across dependents — the graph
  must dedupe shared nodes, where the chain dedupes by position.
