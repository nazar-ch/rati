# Deferred scope features

Designed (or sketched) but intentionally **not built** — each waits for a real need so the
shape can be pinned by a concrete use case rather than guessed. See
[the public guide](docs/current/public/guide.md) for what ships today.

## `.live({ … })` — a progressive prop (designed)

The one sanctioned exception to resolved-by-default. Where `.load()` unwraps a `Source<T>` to
`T` (the component never sees pending), `.live()` would hand the component the `Source<T>`
**itself**, so it renders that one prop's `pending | ready | error` on its own:

```ts
scope({ id: prop<Uuid>() })
    .load({ user: ({ id }) => users.source(id) })   // resolved → User
    .live({ comments: ({ id }) => comments.source(id) }); // stays Source<Comment[]>
```

Terminal for that key (a live prop is never fed to downstream loads) and it bypasses the
pending aggregation for just that key, so the rest of the scope can be ready while one slow
prop streams in. Name provisional; deferred until a real progressive-prop need.

## Scope composition — sharing a common head (`.extend()`)

Many scopes share a prefix (resolve the space, grab the stores, …). Today that dedup happens
in the loader/source tier, not the scope — two scopes with the same head resolve it twice
unless the underlying source is shared/ref-counted. A scope-level `.extend(baseScope)` (or a
shared-head primitive) that lets one scope build on another's resolved levels is unspecified.
Open questions: identity/caching across instances, how `prop()` inputs compose, and whether
the value channel keys by the composed scope or the base.

## Bare-hook guard (dev-time)

A function load that calls a React hook without `hook()` is a silent bug: the resolver treats
it as cached data, so the hook runs once and never updates. A dev-only guard could detect it
(e.g. a hook-dispatcher trip during a cached data load) and throw a pointed error. Low cost,
purely diagnostic; not yet built.
