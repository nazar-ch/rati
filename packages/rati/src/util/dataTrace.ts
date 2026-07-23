/*
    Data-resolution tracing, gated on `globalThis.__DEBUG__?.data` — the data-side sibling
    of navTrace (util/navTrace.ts) and built the same way: one cheap flag read per call
    site, console formatting, nothing allocated when off. Toggle live:
    `window.__DEBUG__.data = true`.

    Where navTrace stamps one navigation's phases onto a single timeline, the data log is
    per *island run* — a mandala's inner-tree generation (the initial mount, an inputs
    change, an error-slot retry). A run gets a `DataTrace` alongside its bucket cache, or
    `undefined` when tracing is off; every hook in the resolver hands that straight back
    here and the call returns immediately.

        [data] Island(Prefs) +0.0ms level 0 start (initial) [userId]
        [data] Island(Prefs) +0.2ms level 1 start [user,prefs]
        [data] Island(Prefs) +0.3ms (Δ0.1ms) level 1 prefs ready
        [data] Island(Prefs) +12.4ms (Δ12.2ms) level 1 user ready
        [data] Island(Prefs) +12.6ms level 2 start [tree]
        [data] Island(Prefs) +41.0ms (Δ28.4ms) level 2 tree error not-available — gone
        [data] Island(Prefs) +41.2ms (Δ41.2ms) resolved — component renders

    Level 0 is the scope's inputs head (they arrive with the run, so they get no settle
    lines); the `.load()` levels follow, numbered as the resolver numbers them — the same
    indices navTrace's source-attach marks use.

    `+` is since the run started: the waterfall's cumulative cost, which is the number the
    "which level do I declare this prop on" decision turns on. `Δ` is since the cell's own
    mark — its level's start, its last refresh, or its previous transition — i.e. what that
    one load cost. The island label leads (navTrace's numbers lead) because several islands
    resolve concurrently into one console: the label is what you scan by.
*/

import { asSourceError } from '../scope/source';

interface DataTraceGlobal {
    // The shared `__DEBUG__` bag — navTrace reads `.nav` off the same object.
    __DEBUG__?: { data?: boolean } | undefined;
}

function store(): DataTraceGlobal {
    return globalThis as unknown as DataTraceGlobal;
}

export function dataTraceEnabled(): boolean {
    return store().__DEBUG__?.data === true;
}

/** Why a generation exists — the run's opening line says so. */
export type DataTraceCause = 'initial' | 'inputs' | 'retry';

/** A cell's reported state; the same three a `Source` snapshot carries. */
export type DataTraceStatus = 'pending' | 'ready' | 'error';

/** One island run's timeline. Created per inner-tree generation; never on the hot path. */
export interface DataTrace {
    label: string;
    cause: DataTraceCause;
    t0: number;
    /** `${level}:${key}` → when that cell last started its clock. */
    marks: Map<string, number>;
    /** `${level}:${key}` → last reported status — the guard that keeps a re-read silent. */
    status: Map<string, DataTraceStatus>;
    /** Promises this run already timed — see {@link traceCellPromise}. */
    timed: WeakSet<Promise<unknown>>;
    resolved: boolean;
}

/** Begin a run's timeline, or return undefined when tracing is off (the usual case). */
export function startDataTrace(label: string, cause: DataTraceCause): DataTrace | undefined {
    if (!dataTraceEnabled()) return undefined;
    return {
        label,
        cause,
        t0: performance.now(),
        marks: new Map(),
        status: new Map(),
        timed: new WeakSet(),
        resolved: false,
    };
}

/** A level begins resolving — its cells start their clocks here. */
export function traceLevelStart(
    trace: DataTrace | undefined,
    index: number,
    keys: readonly string[],
): void {
    if (!trace) return;
    const now = performance.now();
    for (const key of keys) {
        trace.marks.set(`${index}:${key}`, now);
        trace.status.set(`${index}:${key}`, 'pending');
    }
    // Level 0 starts when the run does, so it carries the run's cause; a deeper level
    // starts when the one above it resolved — that *is* the waterfall. (Level 0 is the
    // scope's inputs head, which is empty for an input-less scope — then the line is just
    // the run's opening.)
    const cause = index === 0 ? ` (${trace.cause})` : '';
    const listed = keys.length ? ` [${keys.join(',')}]` : '';
    log(trace, `level ${index} start${cause}${listed}`, now);
}

/**
 * A cell reached a state. Logged once per *transition*, so the re-reads (a source's
 * snapshot every render, a hook load's value every render) are silent while a live
 * source's flips are not. The mark moves with each transition, so the next Δ measures
 * how long the cell spent in the state it just left.
 */
export function traceCellStatus(
    trace: DataTrace | undefined,
    index: number,
    key: string,
    status: DataTraceStatus,
    detail?: string,
): void {
    if (!trace) return;
    const id = `${index}:${key}`;
    if (trace.status.get(id) === status) return;
    trace.status.set(id, status);
    const now = performance.now();
    const mark = trace.marks.get(id);
    trace.marks.set(id, now);
    log(trace, `level ${index} ${key} ${status}${detail ? ` ${detail}` : ''}`, now, mark);
}

/**
 * A cell that resolves through a promise — timed from here to its settle.
 *
 * Settle handlers attach once per promise *per run*: a suspended level re-renders on resume
 * and its cached cell (same promise identity) passes through again — the same guard the SSR
 * rejection recording keeps, on an equally run-scoped ledger, for the same reason. Two runs
 * sharing one promise instance — a module-level load, or a retry rebuilding a static promise
 * cell — each get their own settle line rather than the second silently going without. A
 * hook load handing back a fresh promise each render is traced each time, honestly: it re-ran.
 */
export function traceCellPromise(
    trace: DataTrace | undefined,
    index: number,
    key: string,
    promise: Promise<unknown>,
): void {
    if (!trace || trace.timed.has(promise)) return;
    trace.timed.add(promise);
    const id = `${index}:${key}`;
    trace.marks.set(id, performance.now());
    trace.status.set(id, 'pending');
    void promise.then(
        () => {
            traceCellStatus(trace, index, key, 'ready');
        },
        (error: unknown) => {
            traceCellStatus(trace, index, key, 'error', errorLabel(error));
        },
    );
}

/** A cell re-runs — `useScopeControls().refresh(key)`, or a cascade off one. */
export function traceCellRefresh(trace: DataTrace | undefined, index: number, key: string): void {
    if (!trace) return;
    const now = performance.now();
    trace.marks.set(`${index}:${key}`, now);
    trace.status.set(`${index}:${key}`, 'pending');
    log(trace, `level ${index} ${key} refresh`, now);
}

/** Every level resolved: the run's total, once. */
export function traceResolved(trace: DataTrace | undefined): void {
    if (!trace || trace.resolved) return;
    trace.resolved = true;
    log(trace, 'resolved — component renders', performance.now(), trace.t0);
}

/**
 * Add your own mark to the data log — inside a load, say, between an island's own lines.
 * Carries no timings: the island lines' clocks are per-run and a free mark belongs to no
 * run. Off by default, like everything here.
 */
export function dataTrace(label: string): void {
    if (!dataTraceEnabled()) return;
    console.log(`[data] ${label}`);
}

/**
 * A failure's short form, through the same mapping the error slot sees — so a traced
 * `error` line and the `SourceError` the island renders name the same thing.
 */
export function errorLabel(error: unknown): string {
    const { code, message } = asSourceError(error);
    return message ? `${code} — ${message}` : code;
}

function log(trace: DataTrace, message: string, now: number, mark?: number): void {
    const since = (now - trace.t0).toFixed(1);
    const delta = mark === undefined ? '' : ` (Δ${(now - mark).toFixed(1)}ms)`;
    console.log(`[data] ${trace.label} +${since}ms${delta} ${message}`);
}
