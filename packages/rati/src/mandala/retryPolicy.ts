/*
    `retry` — the island's automatic re-resolution of a failed run, one per mandala instance;
    the design is docs/current/internals.md.
*/

import type { SourceError } from '../scope/source.js';

/** The `retry` option's configured form — see {@link MandalaConfig.retry}. */
export type RetryOptions = {
    /** How many automatic attempts after the first failure. `0` disables the policy. */
    count: number;
    /**
     * The first backoff's ceiling in milliseconds (default {@link DEFAULT_BACKOFF_MS}),
     * doubling per attempt; each wait is a full-jitter draw from `[0, ceiling]`.
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
 * How far the gate reaches over unclassified failures (`retryable` absent):
 *
 *   - `classified` — the default policy: only `retryable === true` retries, so an
 *     unclassified 404 is never hammered.
 *   - `broad` — a configured policy: the catch-all `failed` retries too, a coined code not.
 */
export type RetryReach = 'classified' | 'broad';

/** What {@link resolveRetry} hands the policy: the option, resolved against the defaults. */
export type RetrySettings = {
    count: number;
    backoffMs: number;
    reach: RetryReach;
};

/**
 * The island's option → the policy to build, or `null` for none: absent is the DEFAULT
 * policy, and `false` or `{ count: 0 }` opts out.
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
    /** Re-resolve from scratch — the mandala's retry bump, unwrapped (this IS the retry). */
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
     * The inputs version the island last committed ({@link committed}), starting at the
     * version the policy is built under, so the first commit never reads as a param change
     * and cancels a synchronous first failure's attempt.
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
     * Idempotent per generation, since the boundary re-renders while holding an error. The
     * budget is spent in {@link arm}, at commit: a discarded render's failure never commits.
     */
    accept(error: SourceError, generation: unknown): boolean {
        if (this.ruledOn === generation) return this.accepted;
        this.ruledOn = generation;
        this.accepted = this.eligible(error) && this.spent < this.count;
        if (!this.accepted) {
            // Out of budget (or never eligible): the error slot takes over, and an island
            // showing its error is not retrying.
            this.report(0);
        }
        return this.accepted;
    }

    /**
     * Is this failure worth another attempt? The app's `retryable` wins wherever it is set —
     * `false` is an answer, not a fault. Absent, the reach decides ({@link RetryReach}).
     */
    private eligible(error: SourceError): boolean {
        if (error.retryable !== undefined) return error.retryable;
        return this.reach === 'broad' && error.code === 'failed';
    }

    /**
     * Commit-time, from the boundary's `componentDidCatch` / `componentDidUpdate`: spends the
     * accepted attempt and starts its countdown. Idempotent, and a no-op when render declined,
     * so only a commit spends budget or starts a timer — never the server.
     */
    arm(): void {
        if (!this.accepted || this.armedFor === this.ruledOn) return;
        this.armedFor = this.ruledOn;
        this.spent += 1;
        this.report(this.spent);
        this.clear();
        // Exponential from `backoffMs`, capped, then a full-jitter draw: the schedule is a
        // ceiling, so islands that failed in one backend blip spread out rather than
        // re-firing on one tick.
        const ceiling = Math.min(MAX_BACKOFF_MS, this.backoffMs * 2 ** (this.spent - 1));
        const wait = Math.round(Math.random() * ceiling);
        this.timer = setTimeout(() => {
            this.timer = null;
            this.wiring?.retry();
        }, wait);
    }

    /**
     * Effect-time, on every commit: which inputs the island now resolves. New inputs drop an
     * attempt still counting down for the PREVIOUS ones. Compared rather than reset, since
     * this runs after the commit that armed a synchronous failure's attempt.
     */
    committed(version: number): void {
        if (this.version === version) return;
        this.version = version;
        this.reset();
    }

    /**
     * The streak is over: cancels any pending attempt and restores the budget — content
     * committed, the inputs changed, or a person pressed retry, which is new information.
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
