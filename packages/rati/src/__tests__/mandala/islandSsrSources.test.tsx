import { describe, test, expect, afterEach, vi } from 'vite-plus/test';
import { prerender } from 'react-dom/static';
import { hydrateRoot } from 'react-dom/client';
import { act, cleanup } from '@testing-library/react';
import type { ReactElement } from 'react';
import { scope, input } from '../../scope/scope';
import {
    SourceSymbol,
    type Source,
    type SourceError,
    type SourceSSR,
    type SourceState,
} from '../../scope/source';
import { island } from '../../island/island';
import { createHydrationCollector, HydrationProvider } from '../../mandala/hydration';

afterEach(cleanup);

async function prerenderToString(
    element: ReactElement,
    options?: { onError?: () => void },
): Promise<string> {
    const { prelude } = await prerender(element, options);
    const reader = prelude.getReader();
    const decoder = new TextDecoder();
    let html = '';
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        html += decoder.decode(value, { stream: true });
    }
    return html;
}

// A source whose attach starts an async "load" that settles with `value` — the loader
// shape (`ssr: true`): a promise in source clothing. Logs attach/detach.
function loaderSource<T>(value: T, log: string[]): Source<T> {
    let state: SourceState<T> = { status: 'pending' };
    const listeners = new Set<() => void>();
    return {
        [SourceSymbol]: true,
        getSnapshot: () => state,
        subscribe(onChange) {
            listeners.add(onChange);
            return () => {
                listeners.delete(onChange);
            };
        },
        attach() {
            log.push('attach');
            queueMicrotask(() => {
                state = { status: 'ready', value };
                for (const listener of listeners) listener();
            });
            return () => log.push('detach');
        },
        ssr: true,
    };
}

// A live, seedable source over a tiny mutable store — the query-backed shape
// (`ssr: { dehydrate, hydrate }`). `hydrate` seeds the store so the first snapshot is
// already ready; `set` drives live transitions after hydration.
function liveSource(
    log: string[],
    // Replaces the default seeding — the drifted-store case (a `hydrate` that throws).
    hydrate?: (data: unknown) => void,
): Source<{ n: number }> & { set: (n: number) => void } {
    let state: SourceState<{ n: number }> = { status: 'pending' };
    const listeners = new Set<() => void>();
    const emit = () => {
        for (const listener of listeners) listener();
    };
    const ssr: SourceSSR<{ n: number }> = {
        dehydrate: (value) => value.n,
        hydrate:
            hydrate ??
            ((data) => {
                log.push(`hydrate:${String(data)}`);
                state = { status: 'ready', value: { n: data as number } };
            }),
    };
    return {
        [SourceSymbol]: true,
        getSnapshot: () => state,
        subscribe(onChange) {
            listeners.add(onChange);
            return () => {
                listeners.delete(onChange);
            };
        },
        attach() {
            log.push('attach');
            // A real store would skip the load when already seeded; mirror that.
            if (state.status === 'pending') {
                queueMicrotask(() => {
                    state = { status: 'ready', value: { n: 1 } };
                    emit();
                });
            }
            return () => log.push('detach');
        },
        ssr,
        set: (n: number) =>
            act(() => {
                state = { status: 'ready', value: { n } };
                emit();
            }),
    };
}

describe('SSR sources — loader (ssr: true)', () => {
    test('resolves server-side through the promise path and dehydrates the value', async () => {
        const log: string[] = [];
        const Island = island({
            scope: scope({ id: input<string>() }).load({
                greeting: () => loaderSource('hello ssr-source', log),
            }),
            component: ({ greeting }) => <div>{greeting}</div>,
            loading: () => <div>loading slot</div>,
        });

        const collector = createHydrationCollector();
        const html = await prerenderToString(
            <HydrationProvider collect={collector.collect}>
                <Island id="ssr" />
            </HydrationProvider>,
        );

        expect(html).toContain('hello ssr-source');
        expect(html).not.toContain('loading slot');
        // Attached during render (the marker's authorization), detached once settled.
        expect(log).toEqual(['attach', 'detach']);
        // Dehydrated as a plain value — promise semantics on the wire.
        expect(Object.values(collector.data)).toEqual([{ greeting: 'hello ssr-source' }]);
        expect(Object.keys(collector.seeds)).toHaveLength(0);
    });

    test('hydrates as a plain value — the loader never runs client-side', async () => {
        const log: string[] = [];
        let created = 0;
        const Island = island({
            scope: scope({ id: input<string>() }).load({
                greeting: () => {
                    created++;
                    return loaderSource(`hello ${created}`, log);
                },
            }),
            component: ({ greeting }) => <div>{greeting}</div>,
            loading: () => <div>loading slot</div>,
        });

        const collector = createHydrationCollector();
        const html = await prerenderToString(
            <HydrationProvider collect={collector.collect}>
                <Island id="ssr" />
            </HydrationProvider>,
        );
        expect(created).toBe(1);

        const container = document.createElement('div');
        container.innerHTML = html;
        document.body.appendChild(container);
        const recovered = vi.fn();
        await act(async () => {
            hydrateRoot(
                container,
                <HydrationProvider data={collector.data} seeds={collector.seeds}>
                    <Island id="ssr" />
                </HydrationProvider>,
                { onRecoverableError: recovered },
            );
        });

        // Short-circuited to the dehydrated value: no second instance, no client attach.
        expect(created).toBe(1);
        expect(log).toEqual(['attach', 'detach']);
        expect(container.textContent).toContain('hello 1');
        // …and the short-circuit was seamless: rendering the value the server rendered
        // means React had no mismatch to recover from. The pins below are the contrast —
        // there, a recovery is the degradation itself.
        expect(recovered).not.toHaveBeenCalled();
    });
});

describe('SSR sources — live (ssr: { dehydrate, hydrate })', () => {
    test('dehydrates a seed; the client seeds before attach and stays live', async () => {
        const serverLog: string[] = [];
        const clientLog: string[] = [];
        const logs = [serverLog, clientLog];
        const instances: ReturnType<typeof liveSource>[] = [];
        let created = 0;
        const Island = island({
            scope: scope({ id: input<string>() }).load({
                counter: () => {
                    const source = liveSource(logs[created++]!);
                    instances.push(source);
                    return source;
                },
            }),
            component: ({ counter }) => <div>{`n is ${counter.n}`}</div>,
            loading: () => <div>loading slot</div>,
        });

        const collector = createHydrationCollector();
        const html = await prerenderToString(
            <HydrationProvider collect={collector.collect}>
                <Island id="ssr" />
            </HydrationProvider>,
        );
        expect(html).toContain('n is 1');
        // Dehydrated through `dehydrate` into the seeds section, not as a value.
        expect(Object.values(collector.seeds)).toEqual([{ counter: 1 }]);
        expect(Object.keys(collector.data)).toHaveLength(0);

        const container = document.createElement('div');
        container.innerHTML = html;
        document.body.appendChild(container);
        const recovered = vi.fn();
        await act(async () => {
            hydrateRoot(
                container,
                <HydrationProvider data={collector.data} seeds={collector.seeds}>
                    <Island id="ssr" />
                </HydrationProvider>,
                { onRecoverableError: recovered },
            );
        });

        // The client created its own instance, seeded it before attaching (hydrate
        // precedes attach in the log), and rendered ready HTML with no loading flash.
        expect(created).toBe(2);
        expect(clientLog).toEqual(['hydrate:1', 'attach']);
        expect(container.textContent).toContain('n is 1');
        // The seed's whole purpose, asserted where it shows: seeding *before* attach is
        // what makes the first client render match the server's. Pin 7b below is the
        // same source with a failing seed, and it mismatches.
        expect(recovered).not.toHaveBeenCalled();

        // Still fully live: a later transition updates the content.
        instances[1]!.set(5);
        expect(container.textContent).toContain('n is 5');
    });
});

/*
    Pin 7 (MF-05; docs/research/mandala-testing.md §"Deterministic pins"): what the two
    SSR-source failure modes do. Both pin the *degraded* behavior on purpose — an SSR
    source that fails must cost the server render, never the page.
*/

// The loader shape's error path: attach starts work that fails instead of resolving.
function failingLoaderSource(log: string[], error: SourceError): Source<string> {
    let state: SourceState<string> = { status: 'pending' };
    const listeners = new Set<() => void>();
    return {
        [SourceSymbol]: true,
        getSnapshot: () => state,
        subscribe(onChange) {
            listeners.add(onChange);
            return () => {
                listeners.delete(onChange);
            };
        },
        attach() {
            log.push('attach');
            queueMicrotask(() => {
                state = { status: 'error', error };
                for (const listener of listeners) listener();
            });
            return () => log.push('detach');
        },
        ssr: true,
    };
}

describe('SSR sources — error paths', () => {
    // Pin 7a. A marked source erroring during `firstSettle` is a rejecting promise load
    // by any other name, so it lands in the behavior islandSsrErrors.test.tsx pinned by
    // experiment: `prerender` resolves, React emits the loading slot behind its
    // "switched to client rendering" marker, and the error slot never participates
    // server-side. What rati adds is the `collectError` record (the server's 404/5xx
    // signal) — reached here through a *source*, and the client then makes its own
    // attempt against a fresh instance.
    //
    // NB: the strategy doc's pin list and suspense-situations.md §S10 both predicted an
    // error slot in the HTML. That is not what React does — both are corrected in this
    // commit; this test is the pin.
    //
    // Kill: ssrSource.ts `firstSettle()` — `reject(state.error)` → `reject(new
    // Error('source failed'))`, the wrapper the comment there warns about → the code is
    // erased, 'not-available' arrives as 'failed', and the 404 signal is gone.
    test('a marked source erroring server-side degrades to the loading slot and records the error', async () => {
        const serverLog: string[] = [];
        const clientLog: string[] = [];
        let created = 0;
        const Island = island({
            scope: scope({ id: input<string>() }).load({
                feed: () => {
                    created++;
                    // The server's instance fails; the client's own attempt succeeds.
                    return created === 1
                        ? failingLoaderSource(serverLog, {
                              code: 'not-available',
                              message: 'no feed',
                          })
                        : loaderSource('feed live', clientLog);
                },
            }),
            component: ({ feed }) => <div>content: {feed}</div>,
            loading: () => <div>LOADING-SLOT</div>,
            error: ({ error }) => <div>ERROR-SLOT: {error.code}</div>,
        });

        const collector = createHydrationCollector();
        const html = await prerenderToString(
            <HydrationProvider collect={collector.collect} collectError={collector.collectError}>
                <Island id="ssr" />
            </HydrationProvider>,
            { onError: () => {} },
        );

        expect(html).toContain('LOADING-SLOT');
        expect(html).not.toContain('ERROR-SLOT');
        // Attached during render and released once settled — the error settles it too.
        expect(serverLog).toEqual(['attach', 'detach']);
        // Nothing on the wire: no value to dehydrate, no seed.
        expect(collector.data).toEqual({});
        expect(collector.seeds).toEqual({});
        // The source's own code survives to the server's status decision — a marked
        // source is a 404 signal exactly like a rejecting promise load.
        expect(collector.errors).toHaveLength(1);
        expect(collector.errors[0]!.key).toBe('feed');
        expect(collector.errors[0]!.error.code).toBe('not-available');

        const container = document.createElement('div');
        container.innerHTML = html;
        document.body.appendChild(container);
        await act(async () => {
            hydrateRoot(
                container,
                <HydrationProvider data={collector.data} seeds={collector.seeds}>
                    <Island id="ssr" />
                </HydrationProvider>,
                // The server's boundary errored, so its HTML carries React's
                // client-retry marker and hydration reports the switch as a recoverable
                // error. That report *is* the degradation being visible; swallowed here
                // so it doesn't leak out of the run as an unhandled error.
                { onRecoverableError: () => {} },
            );
        });

        // The failure did not travel: the client created and attached its own instance
        // and resolved it live.
        expect(created).toBe(2);
        expect(clientLog).toEqual(['attach']);
        expect(container.textContent).toContain('feed live');
    });

    // Pin 7b. A seed the client cannot apply (a `hydrate()` that throws — a store shape
    // that drifted from the server's) is logged and dropped, and the source resolves
    // live from its own attach: degraded, not broken. The page's cost is the pending
    // window the seed was there to skip.
    //
    // Kill: resolver.tsx `buildCell()`, the seed branch — replace the catch body's
    // `console.error(...)` with `throw error` → a seed it cannot apply takes the
    // hydration render down instead of degrading to a live resolve.
    test('a seed whose hydrate() throws is logged, and the source resolves live anyway', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const serverLog: string[] = [];
        const clientLog: string[] = [];
        let created = 0;
        const Island = island({
            scope: scope({ id: input<string>() }).load({
                counter: () => {
                    created++;
                    // The client's instance cannot take the server's seed.
                    return created === 1
                        ? liveSource(serverLog)
                        : liveSource(clientLog, () => {
                              throw new Error('seed shape drifted');
                          });
                },
            }),
            component: ({ counter }) => <div>{`n is ${counter.n}`}</div>,
            loading: () => <div>loading slot</div>,
        });

        const collector = createHydrationCollector();
        const html = await prerenderToString(
            <HydrationProvider collect={collector.collect}>
                <Island id="ssr" />
            </HydrationProvider>,
        );
        expect(Object.values(collector.seeds)).toEqual([{ counter: 1 }]);

        const container = document.createElement('div');
        container.innerHTML = html;
        document.body.appendChild(container);
        await act(async () => {
            hydrateRoot(
                container,
                <HydrationProvider data={collector.data} seeds={collector.seeds}>
                    <Island id="ssr" />
                </HydrationProvider>,
                // A seed that fails to apply *guarantees* a hydration mismatch: the
                // server shipped ready HTML over a source the client now renders
                // pending. React recovers by client-rendering the boundary — the second
                // half of this degradation's cost, and the reason a seedable source's
                // `hydrate` must be total.
                { onRecoverableError: () => {} },
            );
        });

        expect(
            errorSpy.mock.calls.some((args) =>
                String(args[0]).includes("hydration seed for 'counter' failed to apply"),
            ),
        ).toBe(true);
        // Unseeded, so it went through its own pending window and attached as usual —
        // the page still arrives at live content.
        expect(clientLog).toEqual(['attach']);
        expect(container.textContent).toContain('n is 1');
        errorSpy.mockRestore();
    });
});

describe('SSR sources — gating', () => {
    test('without a hydration collector a marked source stays pending (no way to carry it)', async () => {
        const log: string[] = [];
        const Island = island({
            scope: scope({ id: input<string>() }).load({
                greeting: () => loaderSource('hello', log),
            }),
            component: ({ greeting }) => <div>{greeting}</div>,
            loading: () => <div>loading slot</div>,
        });

        const html = await prerenderToString(<Island id="ssr" />);

        // Server-resolving without dehydration would mismatch on the client — the
        // marker only engages under a HydrationProvider.
        expect(html).toContain('loading slot');
        expect(html).not.toContain('hello');
        expect(log).toHaveLength(0);
    });
});
