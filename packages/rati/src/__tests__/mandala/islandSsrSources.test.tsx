import { describe, test, expect, afterEach } from 'vite-plus/test';
import { prerender } from 'react-dom/static';
import { hydrateRoot } from 'react-dom/client';
import { act, cleanup } from '@testing-library/react';
import type { ReactElement } from 'react';
import { scope, input } from '../../scope/scope';
import { SourceSymbol, type Source, type SourceSSR, type SourceState } from '../../scope/source';
import { island } from '../../island/island';
import { createHydrationCollector, HydrationProvider } from '../../mandala/hydration';

afterEach(cleanup);

async function prerenderToString(element: ReactElement): Promise<string> {
    const { prelude } = await prerender(element);
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
function liveSource(log: string[]): Source<{ n: number }> & { set: (n: number) => void } {
    let state: SourceState<{ n: number }> = { status: 'pending' };
    const listeners = new Set<() => void>();
    const emit = () => {
        for (const listener of listeners) listener();
    };
    const ssr: SourceSSR<{ n: number }> = {
        dehydrate: (value) => value.n,
        hydrate: (data) => {
            log.push(`hydrate:${String(data)}`);
            state = { status: 'ready', value: { n: data as number } };
        },
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
        await act(async () => {
            hydrateRoot(
                container,
                <HydrationProvider data={collector.data} seeds={collector.seeds}>
                    <Island id="ssr" />
                </HydrationProvider>,
            );
        });

        // Short-circuited to the dehydrated value: no second instance, no client attach.
        expect(created).toBe(1);
        expect(log).toEqual(['attach', 'detach']);
        expect(container.textContent).toContain('hello 1');
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
        await act(async () => {
            hydrateRoot(
                container,
                <HydrationProvider data={collector.data} seeds={collector.seeds}>
                    <Island id="ssr" />
                </HydrationProvider>,
            );
        });

        // The client created its own instance, seeded it before attaching (hydrate
        // precedes attach in the log), and rendered ready HTML with no loading flash.
        expect(created).toBe(2);
        expect(clientLog).toEqual(['hydrate:1', 'attach']);
        expect(container.textContent).toContain('n is 1');

        // Still fully live: a later transition updates the content.
        instances[1]!.set(5);
        expect(container.textContent).toContain('n is 5');
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
