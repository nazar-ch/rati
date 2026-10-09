import { useEffect } from 'react';

import { render } from '@testing-library/react';
import * as fc from 'fast-check';

import { byLevel } from './arbitraries.js';
import {
    buildPath,
    paramNamesOf,
    type ParamSource,
    type RedirectSpec,
    type RouteSpec,
    type RouteTable,
} from './routerModel.js';

import { createMemoryHistory } from '../../router/history.js';
import { route, type GenericRouteType, type RouteRedirect } from '../../router/route.js';
import { RouterOutlet } from '../../router/RouterOutlet.js';
import { RouterProvider, useRouter } from '../../router/RouterProvider.js';
import { RouterStore } from '../../router/store.js';

/*
    The router fuzz harness: an arbitrary over route TABLES, and the builder turning one into a
    real RouterStore with instrumented route components; routerModel.ts reads the same declared
    table. Route components carry no scope — data under navigation is the mandala suite's.
*/

/**
 * long:2
 * The value pool — the codec under fuzz. Every entry survives the whole round trip (`getPath`
 * encodes, the URL parser re-reads, the pattern matches, the match decodes), so the model
 * expects it back verbatim:
 *
 *   'a b' → %20 · 'a/b' → %2F, ONE segment · '100%' → %25 · 'a?b' 'a#b' → %3F/%23
 *   'ä' → %C3%A4 · "a'b" untouched · 'a.b' '..x' dots inside a value, untouched
 *   'new' collides with the static half of the shadow pair, on purpose
 *
 * Absent: '.' and '..', path operators getPath refuses (routeParams.test.ts), and '', which
 * builds a URL no longer naming the route.
 */
const PARAM_VALUES = [
    'a b',
    'a/b',
    '100%',
    'a?b',
    'a#b',
    'ä',
    "a'b",
    'a.b',
    '..x',
    'new',
    '7',
    'abc',
];

const paramValueArb = () => fc.constantFrom(...PARAM_VALUES);

/** Names drawn so prefix collisions are frequent: `getPath` must substitute at the param
 * boundary, never find `id` inside `idx`. */
const PARAM_NAMES = ['id', 'idx', 'i', 'slug'];

/** Paths are derived from the route's index, so names and paths are unique by construction:
 * two routes with the same path would just make the second dead, which is a table-authoring
 * mistake rather than a router behavior worth generating. */
type PathShape =
    | { kind: 'static' }
    | { kind: 'param'; names: [string] }
    | { kind: 'param2'; names: [string, string] };

function pathShapeArb(): fc.Arbitrary<PathShape> {
    return fc.oneof(
        fc.constant<PathShape>({ kind: 'static' }),
        fc
            .constantFrom(...PARAM_NAMES)
            .map<PathShape>((name) => ({ kind: 'param', names: [name] })),
        // Distinct names within one path: duplicate named groups are a RegExp syntax error,
        // so `/x/:id/:id` is not a table a router could ever be handed.
        fc
            .uniqueArray(fc.constantFrom(...PARAM_NAMES), { minLength: 2, maxLength: 2 })
            .map<PathShape>((names) => ({ kind: 'param2', names: [names[0]!, names[1]!] })),
    );
}

function pathFor(shape: PathShape, index: number): string {
    switch (shape.kind) {
        case 'static':
            return `/s${index}`;
        case 'param':
            return `/p${index}/:${shape.names[0]}`;
        case 'param2':
            return `/q${index}/:${shape.names[0]}/:${shape.names[1]}`;
    }
}

/** The redirect target's params: literals, except that a `fn-*` form on a redirect route
 * that has a param of its own may carry it through — the legacy-path shape. */
function targetParamsArb(
    targetPath: string,
    form: RedirectSpec['form'],
    carrySource: string | null,
): fc.Arbitrary<Record<string, ParamSource>> {
    const names = paramNamesOf(targetPath);
    if (names.length === 0) return fc.constant({});
    return fc
        .record({
            values: fc.array(paramValueArb(), { minLength: names.length, maxLength: names.length }),
            carry: fc.boolean(),
        })
        .map(({ values, carry }) => {
            const params: Record<string, ParamSource> = {};
            names.forEach((name, i) => {
                params[name] = { literal: values[i]! };
            });
            // Only the function forms are called with the match, so only they can read it.
            const canCarry = carrySource !== null && (form === 'fn-string' || form === 'fn-object');
            if (canCarry && carry) params[names[0]!] = { fromMatch: carrySource };
            return params;
        });
}

export type TableCase = {
    table: RouteTable;
    /** Names that can be navigated to by reference. Excludes the catch-all, whose `*` is
     * not a URL `getPath` could build. */
    navigable: string[];
};

/**
 * long:2
 * A generated route table, whose fixed rows keep the property's ground off the draw:
 *
 *   `/`                  the root — under a basename, the strip mapping a pathname to '/'
 *   `/collide/:idx/:id`  `:id` inside `:idx`
 *   `/u/new` + `/u/:id`  a shadow pair in generated order: the first match wins
 *   `/cy-a` ⇄ `/cy-b`    the cycle pair, for the depth guard
 *   `/cy-self`           the cycle of length one, fixed so its coverage rests on no draw
 *   `*`                  the catch-all, last
 */
export function tableArb(): fc.Arbitrary<TableCase> {
    const generatedCount = { minLength: 1, maxLength: byLevel(4, 2) };

    return fc
        .record({
            basename: fc.constantFrom('', '/admin', '/a/b'),
            shapes: fc.array(pathShapeArb(), generatedCount),
            redirectCount: fc.integer({ min: 0, max: byLevel(2, 1) }),
            forms: fc.array(
                fc.constantFrom<RedirectSpec['form']>('string', 'object', 'fn-string', 'fn-object'),
                { minLength: 3, maxLength: 3 },
            ),
            permanents: fc.array(fc.boolean(), { minLength: 3, maxLength: 3 }),
            cycleForm: fc.constantFrom<RedirectSpec['form']>('string', 'object'),
            selfForm: fc.constantFrom<RedirectSpec['form']>('string', 'object'),
            shadowFirst: fc.boolean(),
            // Sort keys, kept small so `key * 1000 + i` stays an exact integer. One per
            // route the body can hold, so every route's place is its own draw.
            order: fc.array(fc.nat({ max: 99 }), { minLength: 13, maxLength: 13 }),
        })
        .chain((draw) => {
            const plain: RouteSpec[] = [
                { name: 'root', path: '/' },
                { name: 'collide', path: '/collide/:idx/:id' },
                { name: 'uNew', path: '/u/new' },
                { name: 'uById', path: '/u/:id' },
                ...draw.shapes.map((shape, i) => ({
                    name: `g${i}`,
                    path: pathFor(shape, i),
                })),
            ];

            // Redirect routes: a `fn-*` form needs a param of its own to carry through, so
            // those routes get one.
            const redirects = Array.from({ length: draw.redirectCount }, (_, i) => {
                const form = draw.forms[i % draw.forms.length]!;
                const isFn = form === 'fn-string' || form === 'fn-object';
                return {
                    name: `r${i}`,
                    path: isFn ? `/r${i}/:id` : `/r${i}`,
                    form,
                    permanent: draw.permanents[i % draw.permanents.length]!,
                };
            });

            // Targets may be any route, redirect routes included, so chains form — and a
            // route may name ITSELF, a cycle of length one. A drawn self-target reaches what
            // the fixed `/cy-self` cannot: one on a param path, or partway down a chain.
            const targetPool = [...plain.map((r) => r.name), ...redirects.map((r) => r.name)];

            return fc
                .tuple(
                    ...redirects.map((redirect) =>
                        fc.constantFrom(...targetPool).chain((targetName) => {
                            const targetPath = [...plain, ...redirects].find(
                                (r) => r.name === targetName,
                            )!.path;
                            const isFn =
                                redirect.form === 'fn-string' || redirect.form === 'fn-object';
                            return targetParamsArb(
                                targetPath,
                                redirect.form,
                                isFn ? 'id' : null,
                            ).map<RouteSpec>((params) => ({
                                name: redirect.name,
                                path: redirect.path,
                                redirect: {
                                    form: redirect.form,
                                    targetName,
                                    params,
                                    permanent: redirect.permanent,
                                },
                            }));
                        }),
                    ),
                )
                .map((redirectSpecs): TableCase => {
                    const cycles: RouteSpec[] = [
                        {
                            name: 'cyA',
                            path: '/cy-a',
                            redirect: {
                                form: draw.cycleForm,
                                targetName: 'cyB',
                                params: {},
                                permanent: false,
                            },
                        },
                        {
                            name: 'cyB',
                            path: '/cy-b',
                            redirect: {
                                form: draw.cycleForm,
                                targetName: 'cyA',
                                params: {},
                                permanent: false,
                            },
                        },
                        // The two guards differ in what they can promise, so both are kept
                        // in every table: the pair runs to the depth cap and the model goes
                        // weak on which of them survives; this one is refused on sight and
                        // the model names the route exactly.
                        {
                            name: 'cySelf',
                            path: '/cy-self',
                            redirect: {
                                form: draw.selfForm,
                                targetName: 'cySelf',
                                params: {},
                                permanent: false,
                            },
                        },
                    ];

                    // Shuffle everything but the catch-all: match order is the contract,
                    // and it is what decides the shadow pair.
                    const body = [...plain, ...redirectSpecs, ...cycles];
                    const ordered = body
                        .map((spec, i) => ({
                            spec,
                            key: draw.order[i % draw.order.length]! * 1000 + i,
                        }))
                        .sort((a, b) => a.key - b.key)
                        .map((entry) => entry.spec);
                    if (draw.shadowFirst) {
                        // Force the shadow the other way round for half the cases, so the
                        // ordering that makes `/u/new` unreachable is reliably generated
                        // rather than left to the shuffle.
                        const byName = (name: string) => ordered.findIndex((r) => r.name === name);
                        const [a, b] = [byName('uNew'), byName('uById')];
                        if (a > b) {
                            const swap = ordered[a]!;
                            ordered[a] = ordered[b]!;
                            ordered[b] = swap;
                        }
                    }

                    const routes = [...ordered, { name: 'catchAll', path: '*' }];
                    return {
                        table: { basename: draw.basename, routes },
                        navigable: routes
                            .filter((spec) => spec.path !== '*')
                            .map((spec) => spec.name),
                    };
                });
        });
}

export type NavTarget =
    | { kind: 'route'; name: string; params: Record<string, string>; keyOrder: number[] }
    | { kind: 'unmatched' };

export type Nav = {
    mode: 'navigate' | 'replace';
    target: NavTarget;
    /** A reference (`{ name, …params }`) or a literal URL, the two shapes `navigate` accepts;
     * only the string carries a search or hash. The string is always absolute: a relative one
     * is refused, which the deterministic suites pin. */
    form: 'reference' | 'string';
    search: string;
    hash: string;
    state: Record<string, unknown> | undefined;
};

/** A URL no generated route answers — the only way to reach the catch-all, since `*` is
 * not a path `getPath` can build a URL from. */
export const UNMATCHED_PATH = '/zz-nothing-here';

/** Kept simple and pre-encoded: the URL parser would re-encode anything else, and the
 * model splits the string rather than re-implementing that. */
export const SEARCH_VALUES = ['', '?tab=a', '?a=1&b=2'];
export const HASH_VALUES = ['', '#top', '#sec-1'];

export function navTargetArb(table: TableCase): fc.Arbitrary<NavTarget> {
    return fc.oneof(
        { weight: 9, arbitrary: routeTargetArb(table) },
        { weight: 1, arbitrary: fc.constant<NavTarget>({ kind: 'unmatched' }) },
    );
}

function routeTargetArb(table: TableCase): fc.Arbitrary<NavTarget> {
    return fc.constantFrom(...table.navigable).chain((name) => {
        const spec = table.table.routes.find((route) => route.name === name)!;
        const names = paramNamesOf(spec.path);
        return fc
            .tuple(
                fc.array(paramValueArb(), { minLength: names.length, maxLength: names.length }),
                // The order the caller's object lists its params in: `Object.entries` is
                // insertion-ordered, so the arbitrary never assumes path order.
                fc.array(fc.nat({ max: 99 }), { minLength: names.length, maxLength: names.length }),
            )
            .map(([values, keyOrder]) => {
                const params: Record<string, string> = {};
                names.forEach((paramName, i) => {
                    params[paramName] = values[i]!;
                });
                return { kind: 'route' as const, name, params, keyOrder };
            });
    });
}

export function navArb(table: TableCase): fc.Arbitrary<Nav> {
    return fc
        .record({
            mode: fc.constantFrom<Nav['mode']>('navigate', 'replace'),
            target: navTargetArb(table),
            form: fc.constantFrom<Nav['form']>('reference', 'string'),
            search: fc.constantFrom(...SEARCH_VALUES),
            hash: fc.constantFrom(...HASH_VALUES),
            state: fc.option(
                fc.record({ panelId: fc.constantFrom('p0', 'p1') }) as fc.Arbitrary<
                    Record<string, unknown>
                >,
                { nil: undefined },
            ),
        })
        .map((nav) =>
            // The reference form alone goes through `getPath`, which builds no query or
            // fragment, so the pairing resolves here: a reference carries neither, anything
            // else is a string URL. Independent draws starve getPath of navigations.
            nav.form === 'reference' && nav.target.kind === 'route'
                ? { ...nav, search: '', hash: '' }
                : { ...nav, form: 'string' as const },
        );
}

export type RouterCase = {
    table: RouteTable;
    initialUrl: string;
    navs: Nav[];
};

export function routerCaseArb(): fc.Arbitrary<RouterCase> {
    return tableArb().chain((tableCase) =>
        fc
            .record({
                initial: navTargetArb(tableCase),
                navs: fc.array(
                    fc.record({
                        nav: navArb(tableCase),
                        // Re-aim a quarter of the navigations at the previous destination:
                        // independent draws almost never collide, and the SKIPPED navigation —
                        // same URL, equal state, no re-key — needs reaching on purpose.
                        repeat: fc.constantFrom(true, false, false, false),
                    }),
                    { minLength: 1, maxLength: byLevel(6, 4) },
                ),
            })
            .map(({ initial, navs }) => ({
                table: tableCase.table,
                initialUrl: urlFor(tableCase.table, initial, '', ''),
                navs: navs.reduce<Nav[]>((acc, { nav, repeat }) => {
                    const previous = acc[acc.length - 1];
                    // Repeat the whole destination, form included — a half-copy builds a
                    // reference carrying a query. `mode` and `state` stay as drawn: an equal
                    // state is a no-op, a different one re-resolves the same URL.
                    acc.push(
                        repeat && previous
                            ? {
                                  ...nav,
                                  target: previous.target,
                                  form: previous.form,
                                  search: previous.search,
                                  hash: previous.hash,
                              }
                            : nav,
                    );
                    return acc;
                }, []),
            })),
    );
}

export type CommandCase = { table: RouteTable; navigable: string[]; initialUrl: string };

/**
 * The ground for the command property: a generated table and the URL the app opens at. The
 * commands pick their targets against the model at run time (routerCommands.ts), so the
 * alphabet knows nothing about the table.
 */
export function commandCaseArb(): fc.Arbitrary<CommandCase> {
    return tableArb().chain((tableCase) =>
        navTargetArb(tableCase).map((initial) => ({
            table: tableCase.table,
            navigable: tableCase.navigable,
            initialUrl: urlFor(tableCase.table, initial, '', ''),
        })),
    );
}

/** The value pool, for the commands' param picks. */
export const paramValues = (): readonly string[] => PARAM_VALUES;

/** The URL a target names, as an app would build it — the basename included, since that is
 * what `getPath` does and what a server would have served. */
export function urlFor(table: RouteTable, target: NavTarget, search: string, hash: string): string {
    if (target.kind === 'unmatched') return table.basename + UNMATCHED_PATH + search + hash;
    const spec = table.routes.find((route) => route.name === target.name)!;
    return buildPath(table.basename, spec.path, target.params) + search + hash;
}

export type Mount = { name: string; params: Record<string, string> };

export type Harness = {
    router: RouterStore<GenericRouteType[]>;
    view: ReturnType<typeof render>;
    /** Every route component mount, in order — the remount ledger. */
    mounts: Mount[];
    /** What is on screen right now, or null when the Router rendered nothing. */
    rendered(): Mount | null;
    /** What an ordinary consumer subscribed through `useRouter` last rendered. */
    consumer(): Consumed;
    dispose(): void;
};

const RENDERED_ID = 'rendered-route';
const CONSUMER_ID = 'router-consumer';

/** The router values a subscribed component read on its last render. */
export type Consumed = { path: string; search: string; hash: string };

/**
 * An ordinary app component reading the router through `useRouter`, the whole notification
 * contract from outside: a store changing `search` without notifying leaves a stale value
 * HERE. It sits beside the `<Router>`, so a remount cannot satisfy "the consumer re-read".
 */
function RouterConsumer() {
    const router = useRouter();
    const consumed: Consumed = { path: router.path, search: router.search, hash: router.hash };
    return <div data-testid={CONSUMER_ID}>{JSON.stringify(consumed)}</div>;
}

/** One probe per route: the route component the Router mounts, closed over its own name
 * (the component is handed the params, never the name). It logs its mount rather than its
 * renders — remount discipline is a lifecycle fact, and a render counter would fail the
 * moment React legitimately re-rendered. */
function makeProbe(name: string, mounts: Mount[]) {
    return function Probe(params: Record<string, string>) {
        // Mount-only: the Router re-keys the route on every resolution, so a new set of
        // params IS a new mount; re-running on `params` logs renders instead.
        useEffect(() => {
            mounts.push({ name, params: { ...params } });
            // eslint-disable-next-line react-hooks/exhaustive-deps -- mounts, not renders
        }, []);
        return <div data-testid={RENDERED_ID}>{JSON.stringify({ name, params })}</div>;
    };
}

function buildRedirect(table: RouteTable, spec: RedirectSpec): RouteRedirect {
    const target = table.routes.find((route) => route.name === spec.targetName)!;

    const literals = (): Record<string, string> => {
        const params: Record<string, string> = {};
        for (const [key, source] of Object.entries(spec.params)) {
            params[key] = 'literal' in source ? source.literal : '';
        }
        return params;
    };
    const fromMatch = (matched: Record<string, string>): Record<string, string> => {
        const params: Record<string, string> = {};
        for (const [key, source] of Object.entries(spec.params)) {
            params[key] = 'literal' in source ? source.literal : (matched[source.fromMatch] ?? '');
        }
        return params;
    };

    switch (spec.form) {
        // `buildPath` writes the basename in: a string target is used verbatim, so under a
        // basename the author includes it (`RouteRedirect`), and `to: '/b'` under `/admin`
        // is a table bug.
        case 'string':
            return {
                to: buildPath(table.basename, target.path, literals()),
                permanent: spec.permanent,
            };
        case 'object':
            return { to: { name: spec.targetName, ...literals() }, permanent: spec.permanent };
        case 'fn-string':
            return {
                to: (matched: Record<string, string>) =>
                    buildPath(table.basename, target.path, fromMatch(matched)),
                permanent: spec.permanent,
            };
        case 'fn-object':
            return {
                to: (matched: Record<string, string>) => ({
                    name: spec.targetName,
                    ...fromMatch(matched),
                }),
                permanent: spec.permanent,
            };
    }
}

export function buildHarness(table: RouteTable, initialUrl: string): Harness {
    const mounts: Mount[] = [];
    const routes = table.routes.map((spec) =>
        // Two calls rather than one with a spread-in option: `redirect: undefined` is not
        // the same as an absent `redirect` to a route definition.
        spec.redirect
            ? route(spec.path, spec.name, makeProbe(spec.name, mounts), {
                  redirect: buildRedirect(table, spec.redirect),
              })
            : route(spec.path, spec.name, makeProbe(spec.name, mounts)),
    ) as unknown as GenericRouteType[];

    const router = new RouterStore(routes, {
        history: createMemoryHistory({ url: initialUrl }),
        ...(table.basename ? { basename: table.basename } : {}),
        // Off: scroll restoration fires a double rAF and a window.scrollTo per navigation, and
        // jsdom has no layout to restore.
        scrollRestoration: false,
    });

    const view = render(
        <RouterProvider router={router}>
            <RouterOutlet />
            <RouterConsumer />
        </RouterProvider>,
    );

    return {
        router,
        view,
        mounts,
        rendered() {
            const el = view.container.querySelector(`[data-testid="${RENDERED_ID}"]`);
            return el ? (JSON.parse(el.textContent!) as Mount) : null;
        },
        consumer() {
            const el = view.container.querySelector(`[data-testid="${CONSUMER_ID}"]`);
            return JSON.parse(el!.textContent!) as Consumed;
        },
        dispose() {
            view.unmount();
            router.dispose();
        },
    };
}

/**
 * A URL resolving to SOMETHING other than where the router is — the probe the teardown tail
 * drives a disposed store with. Every table has a root and a catch-all, so a still-listening
 * store re-keys, and the tripwire is never vacuous.
 */
export function awayUrl(table: RouteTable, currentPath: string): string {
    return table.basename + (currentPath === UNMATCHED_PATH ? '/' : UNMATCHED_PATH);
}

/** Apply one generated navigation to the real router, in the shape it declared. */
export function applyNav(router: RouterStore<GenericRouteType[]>, table: RouteTable, nav: Nav) {
    const options = nav.state ? { state: nav.state } : {};
    // `navArb` guarantees the pairing: a reference always names a route and carries no
    // search or hash.
    const to =
        nav.form === 'reference' && nav.target.kind === 'route'
            ? referenceFor(nav.target.name, nav.target.params, nav.target.keyOrder)
            : urlFor(table, nav.target, nav.search, nav.hash);
    if (nav.mode === 'navigate') {
        router.navigate(to as never, options);
    } else {
        router.replace(to as never, options);
    }
}

/**
 * `{ name, …params }` with the params in the caller's generated order, so a `getPath`
 * substituting by substring corrupts `/x/:idx/:id` when the caller lists `id` before `idx`.
 */
export function referenceFor(
    name: string,
    params: Record<string, string>,
    keyOrder: readonly number[],
): Record<string, string> {
    const names = Object.keys(params);
    const ordered = names
        .map((paramName, i) => ({ paramName, key: (keyOrder[i] ?? 0) * 1000 + i }))
        .sort((a, b) => a.key - b.key);
    const reference: Record<string, string> = { name };
    for (const { paramName } of ordered) reference[paramName] = params[paramName]!;
    return reference;
}
