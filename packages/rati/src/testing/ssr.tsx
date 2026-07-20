import type { ReactNode } from 'react';
import { prerender } from 'react-dom/static';
import type { PrerenderOptions } from 'react-dom/static';
import {
    createHydrationCollector,
    HydrationProvider,
    type HydrationData,
    type HydrationError,
    type HydrationErrors,
} from '../mandala/hydration';
import { hydrateTree, visibleText, type MountedTree } from './dom';

/*
    The SSR round-trip kit — the drain-loop + collector/provider + hydrateRoot dance
    hand-rolled across rati's islandSsr*, router/hydration, and ssr/* suites (~20 files), and
    the one thing a public SSR consumer had no way to test at all: does my page hydrate from
    the server's data without re-running its loads?

    Three pieces, layered:

      - `prerenderToString(node, options?)` — the bare drain loop over `react-dom/static`
        `prerender` (the reference impl at islandSsr*.test.tsx). No dehydration wiring: what a
        server-only render or a "marked source stays pending without a collector" test wants.
        Its one addition over the hand-rolls: an opt-in `settleTimeout`, so a render that
        never settles fails saying *what* was still pending instead of running out the
        runner's clock (see startSettleWatchdog).
      - `ssrRender(node, options?)` — a collected server render: wraps `node` in a
        HydrationProvider carrying a fresh collector, drains it, and returns the HTML plus the
        dehydrated `data` / `seeds` / `errors` / `dehydratedErrors`. The server half.
      - `.hydrate(clientNode?, options?)` — feeds that payload back through a client-side
        HydrationProvider and `hydrateRoot`s the HTML. The client half. By default a
        recoverable hydration error (React client-rendering over markup that didn't match)
        *throws*, naming the mismatch — the loud version of the "it silently refetched" bug;
        `{ allowMismatch: true }` collects them on the handle for deliberate-degradation tests.

    jsdom-environment only (where every existing SSR test runs); no streaming (the engine's
    non-goal); no whole-`document` hydration or HTTP-level rendering — `renderApp` / the server
    kit keep their own setups. The route-level round-trip is a documented composition: build a
    server (memory-history) and client (browser-history) router, `prepareRoute` between them,
    and pass the two trees to `ssrRender` / `.hydrate` — see the reference docs.
*/

// Keep every resolved Suspense boundary inline (no hidden-div outlining + swap script), so
// the HTML hydrates cleanly — the same budget `rati/ssr`'s `renderToHtml` picks, for the same
// reason. Test HTML is tiny enough never to reach the default budget, but a round-trip must
// not depend on that.
const NO_OUTLINING = Number.MAX_SAFE_INTEGER;

/** Options for {@link prerenderToString} (and, extended, {@link ssrRender}). */
export interface PrerenderToStringOptions {
    /**
     * Forwarded to `prerender`. Fires for errors inside Suspense boundaries too, where React
     * degrades to the loading slot and the render still resolves — pass `() => {}` to swallow
     * an expected server-side throw (a load that rejects on purpose) so it doesn't surface as
     * an unhandled rejection. Defaults to React's own logging.
     */
    onError?: (error: unknown) => void;
    /** Override the outlining budget. Defaults to never outlining (everything inline). */
    progressiveChunkSize?: number;
    /**
     * Milliseconds to give the render before the drain fails instead of hanging: the
     * diagnostic for a load whose promise never settles, or an `ssr`-marked source nobody
     * drove to ready. Off by default — a budget rati picks would either sit above the
     * runner's own timeout (useless) or below a legitimately slow load (a false failure),
     * and rati can't know which. The value is the *message*: which budget ran out, how many
     * Suspense boundaries were still pending, and where they were — instead of the runner's
     * generic "test timed out".
     *
     * A real `setTimeout`, so under fake timers it fires only when the test advances them.
     */
    settleTimeout?: number;
}

/**
 * Drain `react-dom/static` `prerender` into one HTML string. `prerender` — not
 * `renderToString` — because it awaits Suspense, so an island's promise loads resolve during
 * the render and the HTML carries the content, not the loading slot. The reader loop nobody
 * should hand-write in a test again.
 */
export async function prerenderToString(
    node: ReactNode,
    options: PrerenderToStringOptions = {},
): Promise<string> {
    const watchdog =
        options.settleTimeout === undefined
            ? undefined
            : startSettleWatchdog(options.settleTimeout, options.onError);
    const prerenderOptions: PrerenderOptions = {
        progressiveChunkSize: options.progressiveChunkSize ?? NO_OUTLINING,
    };
    if (watchdog) {
        prerenderOptions.signal = watchdog.signal;
        prerenderOptions.onError = watchdog.onError;
    } else if (options.onError) {
        prerenderOptions.onError = options.onError;
    }

    let result;
    try {
        result = await prerender(node, prerenderOptions);
    } catch (error) {
        // The abort resolves the prerender rather than rejecting it (pinned below), so this
        // is a genuine render failure — unless the budget expired, in which case the better
        // message wins.
        throw watchdog?.expired() ? watchdog.failure() : error;
    } finally {
        // Armed for the render only; the drain below is bounded by the stream React closed.
        watchdog?.stop();
    }

    const reader = result.prelude.getReader();
    const decoder = new TextDecoder();
    let html = '';
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        html += decoder.decode(value, { stream: true });
    }
    // Flush the decoder: a multibyte sequence held back at the final chunk boundary would
    // otherwise be dropped. Unreachable for React's always-valid UTF-8, but free insurance.
    html += decoder.decode();

    // `postponed` is React's own "this prerender did not complete" flag — null on a clean
    // drain. Gating on it (not on the timer alone) keeps a budget that expired during the
    // *drain* of an already-finished render from failing a good test.
    if (watchdog?.expired() && result.postponed !== null) throw watchdog.failure();
    return html;
}

/*
    The settle budget, over `prerender`'s own `signal`. Aborting is what turns a hung render
    into a reportable one: React resolves the prerender (it does not reject), closes the
    stream, and calls `onError` once per still-pending task — with the abort reason and that
    task's component stack. So the abort reason is both the release valve and the census.

    Racing a timer instead would leave the render running and report nothing but the elapsed
    budget.
*/
function startSettleWatchdog(budget: number, forward: ((error: unknown) => void) | undefined) {
    const controller = new AbortController();
    // Identity, not message matching, is how the abort is told apart from the app's own
    // errors below — React hands this exact object back.
    const reason = new Error(`rati/testing settle budget of ${budget}ms expired`);
    let expired = false;
    let stillPending = 0;
    let firstStack: string | undefined;
    const timer = setTimeout(() => {
        expired = true;
        controller.abort(reason);
    }, budget);

    return {
        signal: controller.signal,
        onError(error: unknown, errorInfo?: { componentStack?: string }): void {
            if (error === reason) {
                // Ours: counted into the failure below, never reported twice.
                stillPending++;
                firstStack ??= errorInfo?.componentStack;
                return;
            }
            // Everything else is the render's own error, and must land where it would have
            // without a budget — the caller's handler, or React's default (which is this
            // exact call: see `defaultErrorHandler` in react-dom's server build).
            if (forward) forward(error);
            else console.error(error);
        },
        stop: () => clearTimeout(timer),
        expired: () => expired,
        failure: () => new Error(settleTimeoutMessage(budget, stillPending, firstStack)),
    };
}

function settleTimeoutMessage(
    budget: number,
    stillPending: number,
    componentStack: string | undefined,
): string {
    const boundaries =
        stillPending === 1 ? '1 Suspense boundary was' : `${stillPending} Suspense boundaries were`;
    // The innermost frames name the level; a deep app tree's outer frames are noise.
    const frames = (componentStack ?? '').split('\n').filter(Boolean).slice(0, 8);
    const where = frames.length ? `\nStill pending at:\n${frames.join('\n')}` : '';
    return (
        `The server render did not settle within its ${budget}ms \`settleTimeout\` — ` +
        `${boundaries} still pending when the budget ran out. The usual causes are a load ` +
        `whose promise never settles and an \`ssr\`-marked source nobody drove to ready (a ` +
        `\`controllableSource({ ssr: true })\` with no \`loads\`). Raise \`settleTimeout\` ` +
        `if the render is merely slow.${where}`
    );
}

/** Options for {@link ssrRender} — the server render (same shape as a bare prerender). */
export interface SsrRenderOptions extends PrerenderToStringOptions {}

/** Options for {@link ServerRender.hydrate} — the client render. */
export interface HydrateOptions {
    /**
     * Opt out of the mismatch-to-failure guard: collect React's recoverable hydration errors
     * on {@link HydratedTree.recovered} instead of throwing. For deliberate-degradation tests
     * (an SSR-error baseline whose loading slot the client re-renders through), where a
     * recovery *is* the behavior under assertion.
     */
    allowMismatch?: boolean;
    /**
     * Runs at unmount, after React tears the tree down — dispose a router (or other resource)
     * built for the client tree here. The route round-trip's `clientRouter.dispose()`.
     */
    onDispose?: () => void;
}

/** The client half of an SSR round-trip: the hydrated container and what React reported. */
export interface HydratedTree extends MountedTree {
    /** What the hydrated container says — see {@link visibleText}. */
    text(): string | null;
    /**
     * The recoverable errors React reported while hydrating. Empty on a clean round-trip;
     * populated only under `allowMismatch` (otherwise `.hydrate()` throws before returning).
     */
    readonly recovered: readonly unknown[];
}

/** The server half of an SSR round-trip: the HTML + dehydrated payload, and `.hydrate()`. */
export interface ServerRender {
    /** The server-rendered HTML string (pre-hydration) — assert on it with `toContain`. */
    readonly html: string;
    /** Dehydrated resolved values (promise loads, `ssr: true` loaders): `mandalaId → key → value`. */
    readonly data: HydrationData;
    /** Dehydrated live-source seeds (`ssr: { dehydrate, hydrate }`). */
    readonly seeds: HydrationData;
    /** Loads that rejected during the render — the server's 404/5xx signal. */
    readonly errors: HydrationError[];
    /** The wire's `errors` section: the failures `ssrErrors: 'dehydrate'` islands carry
     *  to the client, which `.hydrate()` feeds back. Empty in the default mode. */
    readonly dehydratedErrors: HydrationErrors;
    /**
     * Hydrate the server HTML on the client, feeding the collected payload back through a
     * HydrationProvider, and return a handle. Pass `clientNode` when the client tree must
     * differ from the server's — a route round-trip renders the server under memory history
     * and the client under browser history; it defaults to the server node (the island case:
     * one tree, rendered on both sides). A recoverable hydration error throws by default
     * (naming the mismatch); `{ allowMismatch: true }` collects them on the handle instead.
     */
    hydrate(clientNode?: ReactNode, options?: HydrateOptions): Promise<HydratedTree>;
}

/**
 * Render `node` on the server, collecting its dehydration payload — the server half of an
 * SSR round-trip. Wraps `node` in a {@link HydrationProvider} with a fresh collector, drains
 * the prerender to HTML, and hands back the HTML plus the dehydrated `data` / `seeds` /
 * `errors` and a `.hydrate()` to run the client half.
 *
 * ```ts
 * const server = await ssrRender(<Page />);
 * expect(server.html).toContain('Ada');   // resolved server-side, in the HTML
 * const client = await server.hydrate();
 * expect(client.text()).toContain('Ada');  // hydrated from the payload
 * expect(fetches).toBe(1);                 // the load did not re-run — and a mismatch would have thrown
 * ```
 */
export async function ssrRender(
    node: ReactNode,
    options: SsrRenderOptions = {},
): Promise<ServerRender> {
    const collector = createHydrationCollector();
    const html = await prerenderToString(
        <HydrationProvider collect={collector.collect} collectError={collector.collectError}>
            {node}
        </HydrationProvider>,
        options,
    );

    return {
        html,
        data: collector.data,
        seeds: collector.seeds,
        errors: collector.errors,
        dehydratedErrors: collector.dehydratedErrors,
        async hydrate(clientNode = node, hydrateOptions = {}) {
            const recovered: unknown[] = [];
            const provider = (
                <HydrationProvider
                    data={collector.data}
                    seeds={collector.seeds}
                    errors={collector.dehydratedErrors}
                >
                    {clientNode}
                </HydrationProvider>
            );
            const mount = await hydrateTree(html, provider, {
                onRecoverableError: (error) => recovered.push(error),
                ...(hydrateOptions.onDispose ? { onDispose: hydrateOptions.onDispose } : {}),
            });
            if (!hydrateOptions.allowMismatch && recovered.length > 0) {
                // Tear the failed mount down before reporting, so a thrown round-trip leaves
                // nothing mounted for the next test (cleanup would catch it regardless).
                mount.unmount();
                throw new Error(mismatchMessage(recovered));
            }
            return {
                ...mount,
                text: () => visibleText(mount.container),
                recovered,
            };
        },
    };
}

function mismatchMessage(recovered: readonly unknown[]): string {
    const first = recovered[0];
    const detail = first instanceof Error ? first.message : String(first);
    const plural = recovered.length === 1 ? '' : 's';
    return (
        `ssrRender.hydrate: React reported ${recovered.length} recoverable error${plural} ` +
        `during hydration — the client render did not match the server HTML (a load that ` +
        `re-ran and re-suspended on its loading slot is the usual cause). Pass ` +
        `{ allowMismatch: true } to assert a deliberate degradation instead. First: ${detail}`
    );
}
