import { describe, test, expect, afterEach, vi } from 'vite-plus/test';
import { act, type FC } from 'react';
import { scope, input } from '../../scope/scope';
import { NotAvailableError } from '../../scope/source';
import { island } from '../../island/island';
import { useScopeControls, type ScopeControls } from '../../mandala/controls';
import { dataTrace } from '../../debug';
import { controllableSource, deferred, flush, renderIsland, cleanup } from '../../testing';

/*
    `dataTrace` (the rati/debug entry) — the emitted lines' shape.

    The tracer reads one flag off `globalThis.__DEBUG__` and writes with `console.log`, so
    the suite drives both ends: flag on, console captured, both restored per test. Timings
    are the point of the tool but not assertable, so `shape()` normalizes every duration to
    `+Nms` / `ΔNms` and the assertions are on the line *structure* — which run, which level,
    which cell, which outcome, and in what order.
*/

type DebugGlobal = { __DEBUG__?: { data?: boolean } };

const Loading: FC = () => <div>loading…</div>;

function traceLog(enabled = true) {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    if (enabled) (globalThis as DebugGlobal).__DEBUG__ = { data: true };
    return {
        /** Every `[data]` line so far, durations normalized. */
        lines: (): string[] =>
            spy.mock.calls
                .map((call) => String(call[0]))
                .filter((line) => line.startsWith('[data]'))
                .map((line) =>
                    line.replace(/\+[\d.]+ms/, '+Nms').replace(/\(Δ[\d.]+ms\)/, '(ΔNms)'),
                ),
    };
}

afterEach(() => {
    cleanup();
    delete (globalThis as DebugGlobal).__DEBUG__;
    vi.restoreAllMocks();
});

describe('dataTrace — the resolution timeline', () => {
    // The canonical read: one line per level start, one per cell settle, one for the run.
    // Level 0 is the scope's inputs head (no settle lines — inputs arrive with the run);
    // the sync `prefs` settles inside the level's build, the awaited `user` when it lands,
    // and `tree` only after the level above resolved — the waterfall, in the log.
    test('a waterfall logs level starts, cell settles, and the run total', async () => {
        const user = deferred<string>();
        const log = traceLog();
        const Page = island({
            scope: scope({ id: input<string>() })
                .load({ user: () => user.promise, prefs: () => 'dark' })
                .load({ tree: async ({ user: name }) => `${name}-tree` }),
            component: function Page({ tree }) {
                return <div>{tree}</div>;
            },
            loading: Loading,
        });

        const handle = await renderIsland(Page, { props: { id: 'a1' } });
        user.resolve('nazar');
        await flush(2);

        expect(handle.container.textContent).toBe('nazar-tree');
        expect(log.lines()).toEqual([
            '[data] Island(Page) +Nms level 0 start (initial) [id]',
            '[data] Island(Page) +Nms level 1 start [user,prefs]',
            '[data] Island(Page) +Nms (ΔNms) level 1 prefs ready',
            '[data] Island(Page) +Nms (ΔNms) level 1 user ready',
            '[data] Island(Page) +Nms level 2 start [tree]',
            '[data] Island(Page) +Nms (ΔNms) level 2 tree ready',
            '[data] Island(Page) +Nms (ΔNms) resolved — component renders',
        ]);
    });

    // The whole tool is one flag read: with it off, nothing is emitted and nothing is built.
    test('silent when the flag is off', async () => {
        const log = traceLog(false);
        const Page = island({
            scope: scope().load({ page: async () => 'home' }),
            component: function Page({ page }) {
                return <div>{page}</div>;
            },
            loading: Loading,
        });

        await renderIsland(Page);
        await flush();
        dataTrace('an ad-hoc mark');

        expect(log.lines()).toEqual([]);
    });

    // A failed load reports the code the error slot switches on, not the raw rejection —
    // and the empty inputs head of an input-less scope still opens the run with its cause.
    test('a failed load settles as error, with the unified code', async () => {
        const log = traceLog();
        const Page = island({
            scope: scope().load({
                page: async (): Promise<string> => {
                    throw new NotAvailableError('gone', { code: 'not-available' });
                },
            }),
            component: function Page({ page }) {
                return <div>{page}</div>;
            },
            loading: Loading,
            error: ({ error }) => <div>error {error.code}</div>,
        });

        await renderIsland(Page);
        await flush(2);

        expect(log.lines()).toEqual([
            '[data] Island(Page) +Nms level 0 start (initial)',
            '[data] Island(Page) +Nms level 1 start [page]',
            '[data] Island(Page) +Nms (ΔNms) level 1 page error not-available — gone',
        ]);
    });

    // A selective refresh is its own cause on the cell's own clock: the re-run opens with a
    // `refresh` line and the settle that follows is timed from it, not from the level start.
    test('a refresh re-opens the cell and times the re-run', async () => {
        const log = traceLog();
        let count = 0;
        const testScope = scope().load({ page: async () => `v${++count}` });
        let controls: ScopeControls<typeof testScope> | null = null;
        const Page = island({
            scope: testScope,
            component: function Page({ page }) {
                controls = useScopeControls(testScope);
                return <div>{page}</div>;
            },
            loading: Loading,
        });

        const handle = await renderIsland(Page);
        await flush();
        await act(async () => {
            await controls!.refresh('page');
        });
        await flush();

        expect(handle.container.textContent).toBe('v2');
        expect(log.lines()).toEqual([
            '[data] Island(Page) +Nms level 0 start (initial)',
            '[data] Island(Page) +Nms level 1 start [page]',
            '[data] Island(Page) +Nms (ΔNms) level 1 page ready',
            '[data] Island(Page) +Nms (ΔNms) resolved — component renders',
            '[data] Island(Page) +Nms level 1 page refresh',
            '[data] Island(Page) +Nms (ΔNms) level 1 page ready',
        ]);
    });

    // A source is read every render; only its *transitions* are events. So a re-ready on a
    // new value is silent (the cell never left `ready`) while a drop back to pending is not.
    test('a source logs its transitions, not its reads', async () => {
        const log = traceLog();
        const feed = controllableSource<string>();
        const Live = island({
            scope: scope().load({ feed: () => feed }),
            component: function Live({ feed: value }) {
                return <div>{value}</div>;
            },
            loading: Loading,
            error: ({ error }) => <div>error {error.code}</div>,
        });

        const handle = await renderIsland(Live);
        await act(async () => feed.setReady('one'));
        await act(async () => feed.setReady('two'));
        await act(async () => feed.setPending());
        await act(async () => feed.setError('failed'));

        expect(handle.container.textContent).toBe('error failed');
        expect(log.lines()).toEqual([
            '[data] Island(Live) +Nms level 0 start (initial)',
            '[data] Island(Live) +Nms level 1 start [feed]',
            '[data] Island(Live) +Nms (ΔNms) level 1 feed ready',
            '[data] Island(Live) +Nms (ΔNms) resolved — component renders',
            '[data] Island(Live) +Nms (ΔNms) level 1 feed pending',
            '[data] Island(Live) +Nms (ΔNms) level 1 feed error failed',
        ]);
    });

    // The one public emitter: your own mark, interleaved with the island's lines.
    test('dataTrace() adds an ad-hoc mark', async () => {
        const log = traceLog();
        dataTrace('fetchUsers → network done');

        expect(log.lines()).toEqual(['[data] fetchUsers → network done']);
    });
});
