/*
    Navigation-timeline tracing, gated on `globalThis.__DEBUG__?.nav`.

    A navigation runs as a sequence of phases — click → pushState → setPath →
    router render (the deferred-value flip) → scope resolution (loading slot,
    source attach, leaf built) → the route's own URL canonicalization. Each phase
    calls `navTrace(label)`, which stamps it with a `performance.now()` delta from
    the navigation's start (`+Nms`) and from the previous mark (`ΔNms`), so the slow
    hop is obvious in the console.

    `navTraceStart()` (called at the click/navigate entry) resets the timeline and
    schedules a single `requestAnimationFrame` "next-paint" probe: its delta from
    the click is roughly how long the main thread stayed busy before the browser
    could paint — i.e. when the URL bar visually updates. A large gap there means a
    blocking synchronous task, not a slow network.

    Off by default — every call is one cheap flag read, so the marks can live
    permanently on the navigation path. Toggle live: `window.__DEBUG__.nav = true`.
*/

interface NavTraceGlobal {
    __DEBUG__?: { nav?: boolean } | undefined;
    __navTrace__?: { t0: number; last: number } | undefined;
}

function store(): NavTraceGlobal {
    return globalThis as unknown as NavTraceGlobal;
}

export function navTraceEnabled(): boolean {
    return store().__DEBUG__?.nav === true;
}

/** Begin a fresh navigation timeline and probe the next paint. */
export function navTraceStart(label: string): void {
    if (!navTraceEnabled()) return;
    const now = performance.now();
    store().__navTrace__ = { t0: now, last: now };
    log(label, now, now);
    // rAF runs just before the next paint; its delta from here ≈ how long the main
    // thread blocked before the browser could repaint (URL bar + first frame).
    requestAnimationFrame(() => navTrace('next-paint (rAF)'));
}

/** Stamp a phase on the current navigation timeline. */
export function navTrace(label: string): void {
    if (!navTraceEnabled()) return;
    const now = performance.now();
    const s = (store().__navTrace__ ??= { t0: now, last: now });
    log(label, now, s.t0, s.last);
    s.last = now;
}

function log(label: string, now: number, t0: number, last: number = t0): void {
    const since = (now - t0).toFixed(1);
    const delta = (now - last).toFixed(1);
    console.log(`[nav] +${since}ms (Δ${delta}ms) ${label}`);
}
