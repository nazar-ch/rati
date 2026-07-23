# Router extensions: directions for `group` and beyond

Forward-looking, intentionally **not built** — each waits for a real need so the shape is
pinned by a concrete use case. What ships today: `route()` and `group()` (see
[`router/group.tsx`](packages/rati/src/router/group.tsx) and
[the public guide](docs/current/public/guide.md)).

## The invariant everything here preserves

`routes` is a **flat tuple of literal route objects**. The type machinery — `Link`'s `to`,
`useRouteContext(name)`, `RouteContextNames` — reads `RatiUserTypes['routes'][number]`, so
the tuple must stay flat and literal. `group()` already respects this: it returns its input
tuple unchanged at the type level and is pure authoring sugar. Every direction below keeps
the same rule — **paths stay absolute, the tuple stays flat** — and reaches for nesting only
as sugar that still spreads to one flat list. Anything requiring a runtime/dynamic route
table is out: it would trade away the static literal types that are the point.

## Near-term, already designed

### Nested wrapper stacks (sketched)

Nested groups compose wrappers into an ordered stack (outer→inner), folded by the Router
(`wrappers.reduceRight(...)`). This is Next.js / Remix nested layouts **without `<Outlet/>`**,
and it preserves each layer's instance across sibling navigations — the shared outer wrapper
stays mounted while only the inner segment swaps. Today `group` keeps a single wrapper
(innermost wins); the field would become `readonly ComponentType[]`.

```ts
...group({ wrapper: AppLayout }, [
    route('/home/', 'home', Home),
    ...group({ wrapper: SettingsPane }, [           // child wrappers → [AppLayout, SettingsPane]
        route('/home/settings', 'home-settings', HomeSettings),
    ]),
])
```

Deferred until a route actually needs two layout levels (jnana has none today).

### Layout-level scope (idea)

A group that resolves shared data once for all its children — Remix's "loader on a layout
route." e.g. `AppLayout` needs the resolved space; today each page scope re-resolves it. A
`group({ wrapper, scope }, …)` would build a layout mandala whose value the children read via
`useRouteContext`. Open questions: caching/identity of the shared resolution across child
navigations, and how it composes with per-route scopes (the `.extend()` question in
[undecided/deferred-scope-features.md](undecided/deferred-scope-features.md)).

## Django-inspired directions

rati's router is a typed descendant of Django's URLconf: `urlpatterns` ↔ the `routes` tuple,
`path(route, view, name=…)` ↔ `route(path, name, component)`, `reverse('name', kwargs)` ↔
`Link`'s `to` / `router.getPath`. Both matchers are ordered first-match. The pieces Django
has that rati doesn't yet, and what they'd buy:

### `include()` — modular route fragments (idea)

Django composes a URLconf from per-app fragments: `path('blog/', include('blog.urls'))`.
rati's routes live in one central file; as features grow, each could own a route fragment
aggregated at the root — exactly how the backend builds `crontab.ts` from per-domain
fragments. `group()` already returns a spliceable tuple, so a fragment is just an exported
tuple `...`spread into the root. An `include(prefix, fragment)` variant could also factor a
shared path prefix — the prefix-DRY we deliberately skipped for the central file is more
defensible per-fragment, where the prefix *is* the fragment's identity. Constraint: the type
machinery must still see one flat literal tuple, so fragments stay `as const` and the root
spreads them — no lazy/dynamic registration without losing the literal types.

### Namespaced route names (idea)

Django's `app_name` + `namespace` scope reverse lookups: `reverse('blog:detail')`. rati names
are a flat string union (`'settings-account'`), already collision-checked by the union. A
`group`/`include` could **derive** namespaced names (`settings:account`) at the type level,
so a fragment needn't hand-prefix every name and two fragments can reuse a leaf name.
Trade-off: the flat string union and `to={{ name: '…' }}` autocomplete are simple and good
today; namespacing adds a mapping layer for a collision problem jnana doesn't have. Defer
until fragments make leaf-name collisions real.

### Typed path converters (sketched — the strongest fit)

Django's `<int:id>`, `<uuid:id>`, `<slug:slug>`, and custom converters **validate and coerce**
a segment at match time (`to_python` / `to_url`). rati types params — and brands them via
`prop<Base64Uuid>()` — but matches every segment as a permissive `[^/]+` string, so a
malformed `:pageId` still matches and renders, failing later inside the scope. A converter on
a param would: (1) tighten the match regex, so a non-uuid `pageId` falls through to the `*`
404 instead of rendering broken; (2) parse the segment to its branded type before the
component sees it; and (3) format it back in `getPath` / `Link`, so a typed param round-trips.
This closes the gap between the raw URL string and the branded prop the component already
expects — the most type-first idea here.

```ts
route('/~:space/:pageId', 'page', PageBody, {
    params: { pageId: uuid },   // validated + parsed to Base64Uuid; bad segment → 404
    scope: pageScope,
})
```

Open questions: declaration site (inline `<uuid:pageId>` in the path string vs a `params`
option), interaction with `ExtractRouteParams`, and custom-converter registration.

### Route / group guards (`@login_required` → `beforeEnter`) (idea)

Django guards views with decorators (`@login_required`); Vue Router has navigation guards.
jnana's **backend** already partitions routers into public / authed / admin
(`createAuthedApp` / `createAdminApp`). The frontend mirror: a per-group `guard` run before
the route resolves that can redirect (`/auth/login`) or block. A group is the natural carrier
— `group({ wrapper: AdminLayout, guard: requireAdmin }, [...])` declares "everything here
needs admin" once, matching the backend partition. Open questions: where the guard runs in
the resolve / SSR pipeline (before mandala attach), and how a redirect composes with the
deferred-route Suspense in the Router.

### Group-injected context / shared kwargs (idea)

Django's `include(..., {'extra': v})` passes kwargs to every included view. The light version:
a group injecting static props/context into its children without a full scope resolution.
Likely subsumed by layout-level scope if that lands; noted for completeness.

### `re_path()` — regex routes (idea)

Django splits `path()` (converter syntax) from `re_path()` (raw regex). rati's `buildPathRe`
already carries a TODO to allow regex paths (with manually typed params). Mostly relevant as
the escape hatch under typed converters above.

## What *not* to borrow from Django

- **Layouts aren't Django's job.** Django templates own layout (`{% extends %}`), so its
  URLconf has no layout concept — `group`'s wrapper is the piece Django *doesn't* give us; it
  comes from the JS-router lineage. Keep the two axes separate: `group` = wrapper + shared
  options; `include` = modular composition + prefix.
- **No runtime URLconf.** Django loads URLconfs dynamically and reverses by string at runtime.
  rati's value is the literal tuple and compile-time `to`/params — keep registration static
  (`as const`); never a runtime route table.

## Resolution & navigation state (from the July 2026 improvements review §3)

Router-side items from the same review, none built. Of the Django directions above, **guards**
and **typed path converters** are the two with visible Jnana pull today (the auth/admin wrappers
re-implement guarding ad hoc; `input<Base64Uuid>()` params arrive unvalidated).

### Typed search params

Path params are typed end-to-end; the query string is stringly (`setSearchParams({ q })`).
A per-route search schema would give `?q=&page=` the same treatment as `:pageId`:

```ts
route('/admin/jobs', 'admin-jobs', AdminJobsPage, {
    search: { name: str.optional(), limit: int.default(100) },   // converter vocabulary
});

const [{ name, limit }, setSearch] = useSearchParams('admin-jobs');  // typed both ways
<Link to={{ name: 'admin-jobs', search: { limit: 500 } }} />          // typed in links too
```

Reuses the converter vocabulary from typed path converters (parse + format round-trip), so
the two features should be designed together. Open questions: whether unknown params pass
through untouched (they should), and whether a search change re-resolves the route's scope
(probably not by default — search is view state; an opt-in `resolveOnSearch` could cover
scopes that read it).

### Navigation status & blocking

- **Pending navigation indicator**: with route scopes resolving on navigation, a global
  `useNavigationStatus()` (`idle | resolving`) enables a top progress bar without app
  bookkeeping. Needs the router to know when the destination island reached ready — a small
  mandala→router signal.
- **Navigation blocking** (`useBlocker` / `beforeLeave`): "unsaved changes" guarding.
  Jnana's CRDT editor mostly saves continuously, so no pull yet; noted for form-heavy apps.
- **View Transitions API**: a `viewTransition` option on `navigate` wrapping the route swap
  in `document.startViewTransition`. One-liner-sized, cosmetic, wait for need.
