/*
    The router's reference model — the routing contract's semantics as plain JS, plus the
    vocabulary the harness and the property share (the table spec, the redirect forms).
    No React, no router imports: the file's empty import list is the altitude rule made
    structural, as in the mandala model next door (docs/archive/mandala-testing.md
    §"The altitude rule"). If a rule here needed router code to express, it would not be
    a contract.

    THE INDEPENDENCE RULE. Where the engine uses a regex, the model walks segments. The
    engine compiles each route to `^/x/(?<id>[^/]+?)/{0,1}$` (`buildPathRe`) and
    interpolates with a `PARAM_RE` replace (`getPath`); the model splits on `/` and maps.
    Same contract — "a `:param` is one non-empty path segment", "a trailing slash is
    optional", "values are percent-encoded on the way out and decoded on the way back" —
    reached by a different mechanism, so a bug in the engine's pattern machinery cannot
    hide behind a model that shares it. (This is the same reason the mandala model refuses
    the engine's `deepEqual`.) `encodeURIComponent`/`decodeURIComponent` are platform
    primitives, not router code: naming them *is* stating the codec RF-01 decided.

    What the model deliberately does not do:
      - Mid-segment params (`/p/x:id`). `PARAM_RE` accepts them; the arbitrary never
        generates them, so the model's segment walk needn't. Not a contract claim either
        way — just this suite's ground.
      - Predict which route survives a redirect cycle *long enough to cap*. See `oneOf`
        below. A cycle of length one is exact, and is stated.
*/

/** Mirrors the store's documented cap. The model's own follow uses it only to decide when
 * to stop and go weak (`oneOf`), never to predict a winner — so the exact value is not
 * something this model pins. */
const MAX_REDIRECT_DEPTH = 10;

// ---------------------------------------------------------------------------------------
// The declared table: what the *test* said the app's routes are. The harness builds a real
// route table from it; the model reads the same declaration. The spec is the plumbing, the
// router is the subject.

/** A param on a redirect's target: a value fixed on the route definition, or one taken from
 * the redirect route's own matched params (the legacy-path shape, `/old/:id` → `/new/:id`). */
export type ParamSource = { literal: string } | { fromMatch: string };

/**
 * The four shapes `RouteRedirect.to` accepts, each a different resolution path in the store:
 *
 *   string     `to: '/users/7'`                     — used verbatim
 *   object     `to: { name: 'user', userId: '7' }`  — resolved through the table by getPath
 *   fn-string  `to: (p) => '/users/' + p.id`        — called with the matched params
 *   fn-object  `to: (p) => ({ name: 'user', … })`   — called, then resolved through the table
 *
 * The distinction that matters downstream: an object target goes through `getPath`, so it is
 * basename-aware and the current search/hash ride along; a string target is a literal, so it
 * carries whatever it says and nothing more.
 */
export type RedirectForm = 'string' | 'object' | 'fn-string' | 'fn-object';

export type RedirectSpec = {
    form: RedirectForm;
    targetName: string;
    /** Params for the *target* route. `fromMatch` is only legal for the `fn-*` forms — the
     * literal forms are fixed on the route definition, with no match to read. */
    params: Record<string, ParamSource>;
    permanent: boolean;
};

export type RouteSpec = {
    name: string;
    /** `/x/:id`, or `*` for the catch-all. Never a trailing slash (the root is just `/`). */
    path: string;
    redirect?: RedirectSpec;
};

export type RouteTable = {
    /** `''` when the app is mounted at the root. */
    basename: string;
    /** Match order is first-wins, so this is ordered. The catch-all is last. */
    routes: RouteSpec[];
};

// ---------------------------------------------------------------------------------------
// The contract's pure functions.

/** `getPath`'s half of the round-trip: interpolate at the path's `:param` boundaries,
 * percent-encoding each value, and prepend the basename. */
export function buildPath(
    basename: string,
    routePath: string,
    params: Record<string, string>,
): string {
    const path = routePath
        .split('/')
        .map((segment) =>
            segment.startsWith(':') ? encodeURIComponent(params[segment.slice(1)] ?? '') : segment,
        )
        .join('/');
    return basename + path;
}

/** The inbound half: a matched segment is percent-decoded, and a malformed escape is handed
 * through raw rather than throwing out of a navigation (RF-01's decision). Generated values
 * are always well-formed, so the fallback states the rule rather than covering a case. */
function decodeParam(raw: string): string {
    try {
        return decodeURIComponent(raw);
    } catch {
        return raw;
    }
}

/** The `:param` names a route path declares, in path order. */
export function paramNamesOf(routePath: string): string[] {
    return routePath
        .split('/')
        .filter((segment) => segment.startsWith(':'))
        .map((segment) => segment.slice(1));
}

/** One route's pattern against a pathname → its decoded params, or `null` for no match. */
export function matchPath(routePath: string, pathname: string): Record<string, string> | null {
    // The catch-all has no pattern at all: it matches whatever reached it.
    if (routePath === '*') return {};

    // Every compiled pattern ends `/{0,1}$` — a trailing slash is optional.
    const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
    const routeSegments = routePath.split('/');
    const pathSegments = path.split('/');
    if (routeSegments.length !== pathSegments.length) return null;

    const params: Record<string, string> = {};
    for (let i = 0; i < routeSegments.length; i++) {
        const routeSegment = routeSegments[i]!;
        const pathSegment = pathSegments[i]!;
        if (routeSegment.startsWith(':')) {
            // `[^/]+?` needs at least one character: `/users/` does not match `/users/:id`.
            if (pathSegment === '') return null;
            params[routeSegment.slice(1)] = decodeParam(pathSegment);
        } else if (routeSegment !== pathSegment) {
            return null;
        }
    }
    return params;
}

/** The store's basename strip, mirrored branch for branch. The last one — a pathname that
 * doesn't live under the basename is handed to the matcher as-is — is unreachable from this
 * suite's generated URLs (every one of them is built with the basename on) and is kept only
 * so the model states the whole rule. */
function stripBasename(pathname: string, basename: string): string {
    if (!basename) return pathname;
    if (pathname === basename) return '/';
    if (pathname.startsWith(basename + '/')) return pathname.slice(basename.length);
    return pathname;
}

/** The store's `shallowEqualState`: per-entry `state` is flat UI-local context, and POP
 * hands it back freshly deserialized, so identity is the wrong question. */
function shallowEqualState(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(
        (key) => (a as Record<string, unknown>)[key] === (b as Record<string, unknown>)[key],
    );
}

function splitUrl(url: string): { pathname: string; search: string; hash: string } {
    const hashAt = url.indexOf('#');
    const hash = hashAt === -1 ? '' : url.slice(hashAt);
    const withoutHash = hashAt === -1 ? url : url.slice(0, hashAt);
    const searchAt = withoutHash.indexOf('?');
    return {
        pathname: searchAt === -1 ? withoutHash : withoutHash.slice(0, searchAt),
        search: searchAt === -1 ? '' : withoutHash.slice(searchAt),
        hash,
    };
}

// ---------------------------------------------------------------------------------------

/**
 * A history entry, as the model keeps it.
 *
 * `mark` is the suppression stamp a *shallow* navigation (`{ keepCurrentRoute: true }`)
 * puts on the entry it creates. The model gives it an opaque identity of its own rather
 * than mirroring the engine's spelling — the string the store writes embeds a counter and
 * a session id, which is exactly the mechanics the altitude rule keeps out of here. What
 * the model states is the two contract facts the stamp carries:
 *
 *   - it is **one-shot** — honored by the resolution its own navigation triggers, and by
 *     no other, so a later arrival at the entry (a POP back onto it) resolves normally;
 *   - it makes the entry **distinguishable from every other entry**, because the store
 *     keeps it *inside* the entry's `state` and compares whole states to decide whether a
 *     resolution is needed.
 *
 * The second fact is a filed finding, not a design the model would choose (README,
 * 2026-07-16 (RF-03)): it is why two entries that agree on URL *and* on the user's own
 * state can still re-resolve when a traversal steps between them. It is modelled rather
 * than stepped around because the alphabet cannot avoid it — and because the re-resolve it
 * produces is the behavior the shallow design wants (the route on screen is not the one
 * the URL names, so resolving it is right); only the way it is achieved is the finding.
 */
type Entry = {
    pathname: string;
    search: string;
    hash: string;
    /** The caller's own `{ state }`, or `null` — what `router.state` documents itself as. */
    userState: Record<string, unknown> | null;
    /** The shallow stamp, or `null` on an ordinary entry. */
    mark: string | null;
};

/**
 * What the store's `_state` actually holds for an entry — the caller's state with the
 * shallow stamp merged in, mirroring `pushOrReplace`'s `{ ...skip, ...options.state }`.
 * Only the *comparisons* use this; what the property may assert `router.state` against is
 * `Step.state` (the user's half) plus `Step.stateHasMark`.
 */
function fullState(entry: Entry): unknown {
    if (entry.mark === null) return entry.userState ?? null;
    return { skip: entry.mark, ...entry.userState };
}

/** What the Router must be showing: the route's name and the params handed to its component. */
export type Rendered = { name: string; params: Record<string, string> };

export type Hop = { from: string; to: string; permanent: boolean };

/**
 * The model's answer after one command — everything the property is allowed to look at.
 *
 * `rendered` is `{ oneOf }` when a redirect cycle ran to the depth cap. The follow *is*
 * deterministic (the cap's parity decides the winner), but which route that leaves on
 * screen is not something the router promises — the deterministic suite makes the same
 * call (`redirect.test.tsx`: "a redirect cycle stops at the depth guard and renders
 * instead" asserts `['a','b']` contains the name). The contract is: following stops, an
 * error is reported, and one of the cycle's routes renders. Pinning the parity here would
 * make a legitimate change to the cap read as a regression.
 *
 * A cycle of *length one* is not weakened that way: no parity is involved, so the route
 * that declared the self-redirect is named exactly (RF-06).
 */
export type Step = {
    /** `null` when nothing matched and the table has no catch-all: the Router renders
     * nothing at all. */
    rendered: Rendered | { oneOf: string[] } | null;
    /** Whether this command re-keyed the active route — i.e. whether the route component
     * must have remounted. Observed through mount effects, never through counters. */
    remounted: boolean;
    /** The URL bar: what `history.location` must read (basename included). */
    url: string;
    /** `router.path` — basename stripped. */
    path: string;
    search: string;
    hash: string;
    /**
     * The caller's own per-entry state — `router.state`'s documented contents ("user state
     * attached to the current history entry via `navigate`/`replace` `{ state }`, or
     * `null`").
     *
     * On an entry a shallow navigation created, the store's getter also carries its
     * internal stamp (`stateHasMark`) — a filed finding rather than something the model
     * blesses by predicting a marker string it would have to reach into the engine to know.
     */
    state: Record<string, unknown> | null;
    /** Whether the store's `state` additionally carries the shallow stamp. See `Entry`. */
    stateHasMark: boolean;
    /**
     * Whether this command's resolution was suppressed by a shallow navigation's stamp —
     * the URL moved, the mounted route deliberately did not.
     */
    suppressed: boolean;
    /**
     * Whether this command resolved *at* an entry carrying a stamp that was no longer
     * armed: the stale-marker arrival (a POP back onto a shallowly-created entry), which
     * must re-resolve rather than keep the kept route. Carries no assertion of its own —
     * `remounted` holds the contract — and exists so the property can count the shape.
     */
    staleShallowPop: boolean;
    /** `router.redirectHops` — the trail this navigation followed. */
    hops: Hop[];
    /**
     * Whether *this command's* resolution stopped at one of the two redirect guards — the
     * depth cap, or a target that resolved back to the route declaring it — and so must
     * have reported the loop it refused to follow.
     *
     * Distinct from `rendered` being `{ oneOf }`, which says what is on screen and outlives
     * the command that put it there: re-navigating to the URL a capped cycle settled on is
     * a no-op (same path, equal state), so the cycle's route stays rendered while nothing
     * resolves and nothing is reported.
     */
    reportedLoop: boolean;
    /**
     * Whether the guard that stopped it was the cycle-of-length-one check. Carries no
     * assertion of its own — `reportedLoop` and `rendered` hold the whole contract — and
     * exists so the property can count the shape RF-06 lifted the exclusion for, rather
     * than let the pool quietly stop generating it.
     */
    selfRedirect: boolean;
};

export class RouterModel {
    private readonly table: RouteTable;
    private entries: Entry[];
    private index: number;

    // The store's observable surface, mirrored.
    private path = '';
    private search = '';
    private hash = '';
    private state: unknown = null;
    private rendered: Rendered | { oneOf: string[] } | null = null;
    private hops: Hop[] = [];
    /** Reset per command; set when this command's follow stopped at either guard. */
    private loopNow = false;
    /** Reset per command; set when the guard that stopped it was the 1-cycle check. */
    private selfLoopNow = false;
    /** Reset per command; see `Step.suppressed` / `Step.staleShallowPop`. */
    private suppressedNow = false;
    private staleMarkNow = false;

    /** Bumped by every resolution that re-keys the active route. The property compares it
     * against the probes' mount log. */
    private mounts = 0;

    /**
     * The stamp the *next* resolution is allowed to honor — armed by a shallow navigation,
     * consumed by the very next `setPath` whether or not it got that far. One-shot: see
     * `Entry`.
     */
    private armedMark: string | null = null;
    private markCounter = 0;

    constructor(table: RouteTable, initialUrl: string) {
        this.table = table;
        this.entries = [{ ...splitUrl(initialUrl), userState: null, mark: null }];
        this.index = 0;
        // The store resolves in its constructor, from the history's opening location.
        this.setPath(0);
    }

    /** The initial resolution, as a Step — the mount the property starts from. */
    initialStep(): Step {
        return this.step(this.mounts > 0);
    }

    navigate(url: string, state: Record<string, unknown> | null, shallow = false): Step {
        const before = this.mounts;
        // A push from anywhere but the tip drops the forward tail: those entries are no
        // longer reachable, in the model exactly as in the browser.
        this.entries = this.entries.slice(0, this.index + 1);
        this.entries.push(this.newEntry(url, state, shallow));
        this.index = this.entries.length - 1;
        this.setPath(0);
        return this.step(this.mounts > before);
    }

    replace(url: string, state: Record<string, unknown> | null, shallow = false): Step {
        const before = this.mounts;
        // Swap in place: the stack neither grows nor loses its forward tail.
        this.entries[this.index] = this.newEntry(url, state, shallow);
        this.setPath(0);
        return this.step(this.mounts > before);
    }

    /**
     * Traverse the entry stack — `go`/`back`/`forward`.
     *
     * `null` is the whole answer for a traversal that had nowhere to go: out of range does
     * nothing rather than clamping to the ends, and `go(0)` is the host's reload, which a
     * memory history has no document for. Nothing happens means *nothing* — no resolution,
     * and so not even a notification, which is a fact the property asserts (a store that
     * quietly re-emitted here would make every consumer re-read for no reason).
     */
    go(delta: number): Step | null {
        const target = this.index + delta;
        if (delta === 0 || target < 0 || target >= this.entries.length) return null;
        const before = this.mounts;
        this.index = target;
        this.setPath(0);
        return this.step(this.mounts > before);
    }

    canGo(delta: number): boolean {
        const target = this.index + delta;
        return delta !== 0 && target >= 0 && target < this.entries.length;
    }

    /**
     * `setSearchParams` — the query rewritten on the current URL, defaulting to `replace`.
     *
     * Built from the store's *own* `path`/`hash` rather than the entry's, which is the same
     * thing everywhere except after a shallow navigation (where `_path` has moved on and
     * the mounted route hasn't). Carries no state, so the entry it writes has none: on an
     * entry that had some, that is a change, and the route re-resolves because of it — a
     * filed finding (README, 2026-07-16 (RF-03)), stated here rather than smoothed over.
     */
    setSearchParams(search: string, mode: 'push' | 'replace'): Step {
        const url = this.table.basename + this.path + (search ? '?' + search : '') + this.hash;
        return mode === 'push' ? this.navigate(url, null) : this.replace(url, null);
    }

    /** The current expectation, without issuing a command. */
    current(): Step {
        return this.step(false);
    }

    mountCount(): number {
        return this.mounts;
    }

    /** `router.path` — what the *store* reads, which after a shallow navigation is the URL's
     * path rather than the mounted route's. */
    currentPath(): string {
        return this.path;
    }

    /** The URL of the entry the model is on, basename included. */
    currentUrl(): string {
        const entry = this.entries[this.index]!;
        return entry.pathname + entry.search + entry.hash;
    }

    /** Names that can be navigated to by reference — the catch-all's `*` is not a URL. */
    navigable(): string[] {
        return this.table.routes.filter((spec) => spec.path !== '*').map((spec) => spec.name);
    }

    /** The redirect routes, so the alphabet can aim at one on purpose. */
    redirectNames(): string[] {
        return this.table.routes.filter((spec) => spec.redirect).map((spec) => spec.name);
    }

    /** The `:param` names a route's path declares, in path order. */
    paramNamesFor(name: string): string[] {
        return paramNamesOf(this.routeByName(name).path);
    }

    /** A URL for a route in this table, as an app would build it. */
    url(name: string, params: Record<string, string>, search = '', hash = ''): string {
        return buildPath(this.table.basename, this.routeByName(name).path, params) + search + hash;
    }

    private newEntry(url: string, state: Record<string, unknown> | null, shallow: boolean): Entry {
        const mark = shallow ? `m${this.markCounter++}` : null;
        if (mark) this.armedMark = mark;
        return { ...splitUrl(url), userState: state ?? null, mark };
    }

    private step(remounted: boolean): Step {
        const entry = this.entries[this.index]!;
        return {
            rendered: this.rendered,
            remounted,
            url: entry.pathname + entry.search + entry.hash,
            path: this.path,
            search: this.search,
            hash: this.hash,
            state: entry.userState,
            stateHasMark: entry.mark !== null,
            suppressed: this.suppressedNow,
            staleShallowPop: this.staleMarkNow,
            hops: this.hops,
            reportedLoop: this.loopNow,
            selfRedirect: this.selfLoopNow,
        };
    }

    private routeByName(name: string): RouteSpec {
        const found = this.table.routes.find((route) => route.name === name);
        if (!found) throw new Error(`model: no route named "${name}"`);
        return found;
    }

    private match(pathname: string): { spec: RouteSpec; params: Record<string, string> } | null {
        for (const spec of this.table.routes) {
            const params = matchPath(spec.path, pathname);
            if (params) return { spec, params };
        }
        return null;
    }

    /**
     * `RouterStore.setPath`, mirrored: the route resolution one history update triggers,
     * including the redirect it may follow (which replaces the entry and re-enters here,
     * exactly as the store's nested `replace` → listener → `setPath` does).
     *
     * `trail` carries the redirect routes matched so far, so a cycle can name its members.
     */
    private setPath(depth: number, trail: string[] = []): void {
        const entry = this.entries[this.index]!;
        const pathname = stripBasename(entry.pathname, this.table.basename);
        // A fresh navigation clears the previous trail; a followed redirect appends to it.
        if (depth === 0) {
            this.hops = [];
            this.loopNow = false;
            this.selfLoopNow = false;
            this.suppressedNow = false;
            this.staleMarkNow = false;
        }

        // Disarm before anything can return: the stamp is spent by the resolution it was
        // armed for, whether or not that resolution got as far as reading it.
        const armed = this.armedMark;
        this.armedMark = null;

        const nextState = fullState(entry);
        const stateChanged = !shallowEqualState(this.state, nextState);

        // Search, hash and state always update — even on a navigation that resolves
        // nothing — so consumers reading them see the entry they are on.
        this.search = entry.search;
        this.hash = entry.hash;
        this.state = nextState;

        // Nothing to resolve: same URL, equal per-entry state, and a route already on
        // screen. The state clause is what makes stepping between two entries that share
        // a URL re-key the route.
        if (this.path === pathname && this.rendered !== null && !stateChanged) return;
        this.path = pathname;

        // The shallow navigation's own resolution: the URL is already updated above (and
        // `router.path` with it), and the mounted route is deliberately left where it is.
        // Nothing below runs — including the redirect follow, so a shallow navigation onto
        // a redirect route lands on that route's URL without following it anywhere.
        if (entry.mark !== null && entry.mark === armed) {
            this.suppressedNow = true;
            return;
        }
        // Reached the entry's stamp with it no longer armed — a later arrival, which
        // resolves like any other. Counted, not asserted: see `Step.staleShallowPop`.
        if (entry.mark !== null) this.staleMarkNow = true;

        const matched = this.match(pathname);

        if (matched?.spec.redirect && depth < MAX_REDIRECT_DEPTH) {
            const redirect = matched.spec.redirect;
            const target = this.resolveTarget(redirect, matched.params);
            this.hops.push({ from: pathname, to: target, permanent: redirect.permanent });

            // A target naming the pathname being resolved is a cycle of length one, and is
            // refused rather than followed: following it could only re-enter the same path,
            // resolve nothing, and leave the previous route stranded on screen. Search and
            // hash are not part of the question — a target differing from its own route
            // only in query re-enters exactly the same way.
            if (stripBasename(splitUrl(target).pathname, this.table.basename) === pathname) {
                // No parity to be coy about, unlike a capped cycle: the route that declared
                // the redirect is the one left rendering its own component.
                this.rendered = { name: matched.spec.name, params: matched.params };
                this.loopNow = true;
                this.selfLoopNow = true;
                this.mounts++;
                return;
            }

            // The store follows a redirect with `replace`, so the entry is swapped rather
            // than stacked — the redirect route is not reachable by a back step. `replace`
            // passes no state and no `keepCurrentRoute`, so the target entry carries
            // neither the previous entry's state nor a stamp.
            this.entries[this.index] = { ...splitUrl(target), userState: null, mark: null };
            this.setPath(depth + 1, [...trail, matched.spec.name]);
            return;
        }

        if (matched?.spec.redirect) {
            // Following stopped at the cap. Name the cycle's members: the routes the trail
            // visited more than once. (A chain long enough to cap without repeating would
            // need more redirect routes than the arbitrary builds, but fall back to the
            // whole trail rather than claim an empty set.)
            const visited = [...trail, matched.spec.name];
            const repeated = [...new Set(visited.filter((n, i) => visited.indexOf(n) !== i))];
            this.rendered = { oneOf: repeated.length > 0 ? repeated : [...new Set(visited)] };
            this.loopNow = true;
            this.mounts++;
            return;
        }

        this.rendered = matched ? { name: matched.spec.name, params: matched.params } : null;
        // Nothing matched means the Router renders nothing, so there is no component to
        // mount — the route that *was* on screen just unmounts.
        if (matched) this.mounts++;
    }

    /** What the store computes as the redirect's target URL, per form. */
    private resolveTarget(redirect: RedirectSpec, matchedParams: Record<string, string>): string {
        const params: Record<string, string> = {};
        for (const [key, source] of Object.entries(redirect.params)) {
            params[key] =
                'literal' in source ? source.literal : (matchedParams[source.fromMatch] ?? '');
        }
        const target = this.routeByName(redirect.targetName);
        const path = buildPath(this.table.basename, target.path, params);

        // A literal target is used exactly as written, so it carries no search or hash of
        // the location being left. An object target is resolved through the table, and the
        // current search and hash ride along — the alias-route expectation.
        return redirect.form === 'string' || redirect.form === 'fn-string'
            ? path
            : path + this.search + this.hash;
    }
}
