---
area: packages/rati/src/router/router.ts — ActiveRoute; check NameToRoute/RouteContextValueOf for the same
needs: nothing
status: open
disposition: —
---

# FND-06 — `ActiveRoute` stays deferred, so `activeRoute.name === 'x'` narrows nothing

## Problem

`Router.activeRoute` is `ActiveRoute | null`, and `ActiveRoute` reaches the app's table
through `UserRoutes` (route.tsx:29), which `infer`s it out of the augmentation:

```ts
export type UserRoutes = RatiUserTypes extends { routes: infer R } ? R : never;

export type ActiveRoute = [UserRoutes] extends [never]
    ? GenericActiveRoute
    : UserRoutes extends readonly GenericRouteType[]
      ? ActiveRouteOf<UserRoutes>
      : GenericActiveRoute;
```

Two conditionals over an `infer`ed `UserRoutes` leave the result **deferred** — TypeScript
never resolves it into the per-route union `ActiveRouteOf` describes, so none of the
discriminated-union machinery applies. `name` is the right literal union and `routeParams`
is the union of every route's params, but the guard filters neither.

## Reproduction

A two-route table registered through the augmentation, compiled by the package's own
tsconfig (`src/`, not `src/__tests__` — that path is excluded, so a probe placed there is
silently not compiled and reports nothing):

```ts
const probeRoutes = [route('/p/:pageId', 'page', Comp), route('/s/:space', 'space', Comp)] as const;
declare module './router/route' {
    interface RatiUserTypes { routes: typeof probeRoutes }
}
declare const viaAugmentation: ActiveRoute;
declare const viaIndexed: ActiveRouteOf<RatiUserTypes['routes']>;

if (viaAugmentation.name === 'page') viaAugmentation.routeParams.pageId; // TS2339
if (viaIndexed.name === 'page') viaIndexed.routeParams.pageId;           // clean
```

> `Property 'pageId' does not exist on type '{ pageId: string; } | { space: string; }'`

Same table, same guard — only the path to it differs. The union in the error message is
the giveaway: it is right there, unnarrowed.

jnana measured the same four expressions against its 32-route table:
`ActiveRouteOf<typeof routes>` narrows, `ActiveRouteOf<RatiUserTypes['routes']>` narrows,
`ActiveRoute` does not, and `Extract<ActiveRoute, { name: 'page' }>` filters nothing.
`ActiveRoute` is not even assignable to the expanded union it stands for (TS2322), so an
app cannot annotate its way out.

## Why it matters

Reading the active route's params is the ordinary case — jnana has three (the page
canonicalizer, the search scope, the sync foreground election) — and the
name-discriminated `activeRoute` union is a headline of the router-owned surface this
release shipped. Today it types as documented and does not behave as documented, and the
failure surfaces as an index error pointing at the app's property access, far from the
cause.

Only the augmentation path is affected; a table handed to `ActiveRouteOf` directly is
fine. That is what makes the workaround cheap — and the fix look local.

## Suggested fix

Resolve the table by indexed access instead of through the `infer` conditional — the form
the probe above shows already narrowing:

```ts
export type ActiveRoute = [UserRoutes] extends [never]
    ? GenericActiveRoute
    : ActiveRouteOf<RatiUserTypes['routes'] & readonly GenericRouteType[]>;
```

**Check `NameToRoute<UserRoutes>` (`navigate` / `getPath` / `Link`'s `to`) and
`RouteContextValueOf` for the same defect** — they route through `UserRoutes` too. A
deferred `ActiveRoute` fails loudly at the read; a deferred `to` fails *open*, accepting
targets that should not typecheck, which is worse and silent.

## Scope

1. Fix `ActiveRoute`'s resolution; audit the sibling types above and fix what shares it.
2. `test-d` coverage over a multi-route augmented table: `name === 'page'` narrows
   `routeParams`, and `Extract<ActiveRoute, { name: 'page' }>` filters. Put it where the
   type gate actually compiles it — `src/__tests__` is excluded from the package tsconfig.

## Boundaries

- No change to `ActiveRouteOf` (it is correct); this is only how `ActiveRoute` reaches it.

## Verify

- `yarn ci` green, with the new `test-d` cases failing before the fix and passing after.
- Downstream: jnana deletes `frontend/src/common/activeRoute.ts` — a seam that exists only
  for this, re-deriving the union off `RatiUserTypes['routes']` behind one cast — and
  inlines `router.activeRoute` at its three call sites (`jnana:FND-235`).
