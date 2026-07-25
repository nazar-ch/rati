/*
    `retry` — the island's automatic second (and third) go at a failed resolution.

    One per mandala instance, driving the retry counter the boundary already had: a caught
    error that qualifies is not shown as an error at all, it is treated as "still resolving"
    — the island keeps showing what it shows while resolving (the loading slot, or the kept
    run under `keepStale`) and re-resolves from scratch once the backoff elapses. Only when
    the budget runs out does the `error` slot come up, with its manual `retry` armed as
    always.

    **Default-on** since DATA-11: every island has a policy unless it opts out, because the
    two-level `SourceError` (DATA-10) is what makes that safe — the gate reads `retryable`,
    so it can tell a transient fault from an answer instead of hammering a 403. What the
    island's option changes is only the policy's *reach*, see `resolveRetry`.

    Two halves, the same split `LoadingDelay` uses and for the same reason. `accept` is
    render-time — the boundary's render is where the error is seen, and the decision has to
    be made *there* or the error slot mounts for a frame (its effects with it) before
    anything could take it back. `arm` is commit-time, so it starts no timer during a server
    render: the server has no commit phase, which is the whole of "the policy is
    client-only" — one attempt per request, no machinery needed to enforce it.
*/

import type { SourceError } from '../scope/source';

/** The `retry` option's configured form — see {@link MandalaConfig.retry}. */
export type RetryOptions = {
    /** How many automatic attempts after the first failure. `0` disables the policy. */
    count: number;
    /**
     * The first backoff's ceiling, in milliseconds (default {@link DEFAULT_BACKOFF_MS}).
     * Each further attempt doubles it — and each wait is a *full-jitter* draw from
     * `[0, ceiling]`, so `{ count: 3, backoffMs: 500 }` waits somewhere under 500ms, then
     * under 1s, then under 2s.
     */
    backoffMs?: number;
};

/** The `retry` option as an island writes it: absent = the default policy, `false` = off. */
export type RetryOption = RetryOptions | false;

/** The default policy's budget — enough to ride out a blip, not enough to be a hammer. */
export const DEFAULT_RETRY_COUNT = 2;
/** The default first ceiling. */
export const DEFAULT_BACKOFF_MS = 500;
/**
 * The ceiling's own ceiling. A doubling schedule with a generous base disappears for
 * minutes on a long budget, which reads as a hang; past this a spinner is a lie and the
 * error slot is the honest answer.
 */
export const MAX_BACKOFF_MS = 10_000;

/**
 * How far the gate reaches over failures the app never classified (`retryable` absent).
 *
 *   - `classified` — the default policy: only `retryable === true` is retried. An app that
 *     classifies nothing gets no automatic retries at all, which is the point: default-on
 *     retry over unclassified failures would hammer its 404s.
 *   - `broad` — an island that asked for a policy: the legacy code rule stands for
 *     unclassified failures (the catch-all `failed` retries, a coined code does not), and
 *     the flag overrides it in both directions.
 */
export type RetryReach = 'classified' | 'broad';

/** What {@link resolveRetry} hands the policy: the option, resolved against the defaults. */
export type RetrySettings = {
    count: number;
    backoffMs: number;
    reach: RetryReach;
};

/**
 * The island's option → the policy to build, or `null` for no policy at all.
 *
 * Absent is the *default* policy, not the absent one — retry should just work. `false` (and
 * `{ count: 0 }`, which has always meant off) is the opt-out.
 */
export function resolveRetry(option: RetryOption | undefined): RetrySettings | null {
    if (option === undefined) {
        return { count: DEFAULT_RETRY_COUNT, backoffMs: DEFAULT_BACKOFF_MS, reach: 'classified' };
    }
    if (option === false || option.count <= 0) return null;
    return {
        count: option.count,
        backoffMs: option.backoffMs ?? DEFAULT_BACKOFF_MS,
        reach: 'broad',
    };
}

type PolicyWiring = {
    /** Re-resolve from scratch — the mandala's retry bump, unwrapped (this *is* the retry). */
    retry: () => void;
    /** Publish the attempt in flight — `useScopeControls().retrying`. */
    report: (attempt: number) => void;
};

/** No generation has been ruled on yet — distinct from any `treeKey`, which is a string. */
const NO_GENERATION = Symbol('rati.retry.none');

export class RetryPolicy {
    private readonly count: number;
    private readonly backoffMs: number;
    private readonly reach: RetryReach;
    private wiring: PolicyWiring | null = null;

    /** Automatic attempts spent in the current failure streak. */
    private spent = 0;
    /** The generation whose failure has been ruled on, and the ruling — so a re-render of
     *  the boundary re-reads the decision instead of buying another attempt. */
    private ruledOn: unknown = NO_GENERATION;
    private accepted = false;
    /** The generation whose backoff is already counting down (`arm` is idempotent). */
    private armedFor: unknown = NO_GENERATION;
    private timer: ReturnType<typeof setTimeout> | null = null;
    /**
     * The inputs version the island last committed — see {@link committed}. Starts at the
     * version the policy is built under: a mandala creates one on its first render, which is
     * always version 0, and starting anywhere else would make that first commit look like a
     * param change and cancel an attempt a *synchronous* first failure had just armed.
     */
    private version = 0;

    constructor(settings: RetrySettings) {
        this.count = settings.count;
        this.backoffMs = settings.backoffMs;
        this.reach = settings.reach;
    }

    /** Wired every render, like the refresh controller's: the verbs stay current. */
    wire(wiring: PolicyWiring): void {
        this.wiring = wiring;
    }

    /**
     * Render-time, from the error boundary: does this failure get an automatic attempt?
     *
     * Idempotent per generation: the boundary re-renders while it holds an error (its
     * parent re-renders, a source ticks), and each of those must re-read the ruling rather
     * than buy another attempt. One generation can only be failing once.
     */
    accept(error: SourceError, generation: unknown): boolean {
        if (this.ruledOn === generation) return this.accepted;
        this.ruledOn = generation;
        this.accepted = this.eligible(error) && this.spent < this.count;
        if (this.accepted) {
            this.spent += 1;
            this.report(this.spent);
        } else {
            // Out of budget (or never eligible): the error slot takes over, and an island
            // showing its error is not retrying.
            this.report(0);
        }
        return this.accepted;
    }

    /**
     * Is this failure the kind worth another attempt? The two-level error, read top level
     * first: the app's own classification wins wherever it exists.
     *
     * `retryable: false` is an answer, not a fault — a 403 will not become a 200 in 500ms
     * and a 404 retried is still a 404, so retrying only delays what the user is owed.
     * `true` is a blip. Absent means the app never said, and then the reach decides: the
     * default policy declines (see {@link RetryReach}), a configured one falls back to the
     * code rule it has always had — the catch-all `failed`, and nothing a load coined.
     */
    private eligible(error: SourceError): boolean {
        if (error.retryable !== undefined) return error.retryable;
        return this.reach === 'broad' && error.code === 'failed';
    }

    /**
     * Commit-time, from the boundary's `componentDidCatch` / `componentDidUpdate`: start the
     * countdown of an accepted attempt. Idempotent, and a no-op when render declined — so
     * the only thing that can start a timer is a commit, which is what keeps the server out
     * of it.
     */
    arm(): void {
        if (!this.accepted || this.armedFor === this.ruledOn) return;
        this.armedFor = this.ruledOn;
        this.clear();
        // Exponential from `backoffMs`: a backend that just failed is the one case where
        // trying again immediately is least likely to help, and three attempts 300ms apart
        // are barely different from one. Capped, then drawn from with **full jitter** — the
        // schedule is a ceiling, not an appointment. Every island that failed in the same
        // backend blip would otherwise re-fire on the same synchronized tick, a small
        // thundering herd back at a server already struggling; spreading them over the
        // window costs one `Math.random()` (FND-02).
        const ceiling = Math.min(MAX_BACKOFF_MS, this.backoffMs * 2 ** (this.spent - 1));
        const wait = Math.round(Math.random() * ceiling);
        this.timer = setTimeout(() => {
            this.timer = null;
            this.wiring?.retry();
        }, wait);
    }

    /**
     * Effect-time, on every commit of the island: which inputs it is now resolving. New
     * inputs are a new bucket and a fresh budget — and an attempt still counting down for
     * the *previous* inputs is about a screen that no longer exists, so it is dropped here
     * rather than left to fire into the new resolution.
     *
     * Compared rather than reset unconditionally, because this runs after every commit —
     * including the one that armed a synchronous failure's attempt moments earlier.
     */
    committed(version: number): void {
        if (this.version === version) return;
        this.version = version;
        this.reset();
    }

    /**
     * The streak is over — cancel any pending attempt and restore the budget. Three callers,
     * one meaning: content committed (the retry worked, or nothing was wrong), the inputs
     * changed, or a human pressed retry. The last is the interesting one: a click is new
     * information, so it buys a fresh budget rather than continuing an exhausted one.
     */
    reset(): void {
        this.clear();
        this.spent = 0;
        this.ruledOn = NO_GENERATION;
        this.accepted = false;
        this.armedFor = NO_GENERATION;
        this.report(0);
    }

    /** The island is gone; the countdown goes with it. */
    dispose(): void {
        this.clear();
    }

    private clear(): void {
        if (!this.timer) return;
        clearTimeout(this.timer);
        this.timer = null;
    }

    private report(attempt: number): void {
        this.wiring?.report(attempt);
    }
}
