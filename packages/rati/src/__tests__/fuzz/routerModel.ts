/*
    The router's reference model — the routing contract's semantics as plain JS, importing nothing
    from the router: where the engine compiles a regex, the model walks segments
    (docs/current/internals.md). Mid-segment params are outside its ground.
*/

/** Mirrors the store's documented cap. The model's own follow uses it only to decide when
 * to stop and go weak (`oneOf`), never to predict a winner — so the exact value is not
 * something this model pins. */
const MAX_REDIRECT_DEPTH = 10;

// The declared table: what the TEST said the app's routes are. The harness builds a real
// route table from it, and the model reads the same declaration.

/** A param on a redirect's target: a value fixed on the route definition, or one taken from
 * the redirect route's own matched params (the legacy-path shape, `/old/:id` → `/new/:id`). */
export type ParamSource = { literal: string } | { fromMatch: string };

/**
 * The shapes `RouteRedirect.to` accepts, each a different resolution path in the store:
 * `string` and `fn-string` are literals, used verbatim; `object` and `fn-object` resolve
 * through the table by getPath, so they are basename-aware and keep the search and hash.
 */
export type RedirectForm = 'string' | 'object' | 'fn-string' | 'fn-object';

export type RedirectSpec = {
    form: RedirectForm;
    targetName: string;
    /** Params for the TARGET route. `fromMatch` is only legal for the `fn-*` forms — the
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
 * through raw rather than throwing out of a navigation. Generated values are always
 * well-formed, so the fallback states the rule rather than covering a case. */
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

/** The store's basename strip, mirrored branch for branch. The last — a pathname outside the
 * basename goes to the matcher as-is — is unreachable from the generated URLs, and kept so the
 * model states the whole rule. */
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

/**
 * long:2
 * A history entry, as the model keeps it. `mark` is the stamp a SHALLOW navigation
 * (`{ keepCurrentRoute: true }`) puts on the entry it creates, given an opaque identity rather
 * than the engine's spelling. The model states the stamp's two contract facts:
 *
 *   - it is ONE-SHOT — honored by the resolution its own navigation triggers and no other,
 *     so a POP back onto the entry resolves normally;
 *   - it makes the entry DISTINGUISHABLE from every other, since the store keeps it inside
 *     the entry's `state` and compares whole states — so two entries agreeing on URL and
 *     user state still re-resolve when a traversal steps between them.
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
 * What the store's `_state` holds for an entry — the caller's state with the shallow stamp
 * merged in, as `pushOrReplace` merges it. Only the COMPARISONS use this; the property
 * asserts `router.state` against `Step.state` and `Step.stateHasMark`.
 */
function fullState(entry: Entry): unknown {
    if (entry.mark === null) return entry.userState ?? null;
    return { skip: entry.mark, ...entry.userState };
}

/** What the Router must be showing: the route's name and the params handed to its component. */
export type Rendered = { name: string; params: Record<string, string> };

export type Hop = { from: string; to: string; permanent: boolean };

/**
 * The model's answer after one command — everything the property may look at. `rendered`
 * is `{ oneOf }` when a redirect cycle ran to the depth cap: the router promises that one of
 * the cycle's routes renders, never which. A cycle of LENGTH ONE names its route exactly.
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
     * The caller's own per-entry state, `router.state`'s documented contents. On an entry a
     * shallow navigation created, the store's getter also carries its internal stamp
     * (`stateHasMark`), which the model never predicts.
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
     * Whether this command resolved AT an entry whose stamp was no longer armed — a POP back
     * onto a shallowly-created entry, which re-resolves. No assertion of its own; the property
     * counts the shape.
     */
    staleShallowPop: boolean;
    /** `router.redirectHops` — the trail this navigation followed. */
    hops: Hop[];
    /**
     * Whether THIS command's resolution stopped at a redirect guard — the depth cap, or a
     * target resolving back to its route — and so reported the loop. `rendered` being
     * `{ oneOf }` outlives the command: re-navigating to a capped cycle's URL is a no-op.
     */
    reportedLoop: boolean;
    /**
     * Whether the guard that stopped it was the cycle-of-length-one check. No assertion of its
     * own — `reportedLoop` and `rendered` hold the contract — so the property can count the
     * shape the pool generates.
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
     * The stamp the NEXT resolution is allowed to honor — armed by a shallow navigation,
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
     * Traverses the entry stack — `go`/`back`/`forward`. `null` answers a traversal with
     * nowhere to go: out of range never clamps, and `go(0)` has no document in memory. NOTHING
     * happens — no resolution and no notification, which the property asserts.
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
     * `setSearchParams` — the query rewritten on the current URL, `replace` by default, built
     * from the store's OWN `path`/`hash`, which differ from the entry's after a shallow
     * navigation. It writes no state, so an entry that had some re-resolves.
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

    /** `router.path` — what the STORE reads, which after a shallow navigation is the URL's
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
     * `RouterStore.setPath`, mirrored: the resolution one history update triggers, a followed
     * redirect replacing the entry and re-entering here as the store's nested `replace` does.
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

        // The shallow navigation's own resolution: the URL is updated above, the mounted route
        // stays, and nothing below runs — a shallow navigation onto a redirect route lands on
        // its URL without following it.
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

            // A target naming the pathname being resolved is a 1-cycle, refused: following it
            // re-enters the same path and strands the previous route on screen. Search and
            // hash stay out of the question.
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
            // Following stopped at the cap: the cycle's members are the routes the trail
            // visited more than once, else the whole trail rather than an empty set.
            const visited = [...trail, matched.spec.name];
            const repeated = [...new Set(visited.filter((n, i) => visited.indexOf(n) !== i))];
            this.rendered = { oneOf: repeated.length > 0 ? repeated : [...new Set(visited)] };
            this.loopNow = true;
            this.mounts++;
            return;
        }

        this.rendered = matched ? { name: matched.spec.name, params: matched.params } : null;
        // Nothing matched means the Router renders nothing, so there is no component to
        // mount — the route that WAS on screen unmounts.
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
