/*
    `retry` — the island's automatic second (and third) go at a failed resolution.

    One per mandala instance, driving the retry counter the boundary already had: a caught
    error that qualifies is not shown as an error at all, it is treated as "still resolving"
    — the island keeps showing what it shows while resolving (the loading slot, or the kept
    run under `keepStale`) and re-resolves from scratch once the backoff elapses. Only when
    the budget runs out does the `error` slot come up, with its manual `retry` armed as
    always.

    Two halves, the same split `LoadingDelay` uses and for the same reason. `accept` is
    render-time — the boundary's render is where the error is seen, and the decision has to
    be made *there* or the error slot mounts for a frame (its effects with it) before
    anything could take it back. `arm` is commit-time, so it starts no timer during a server
    render: the server has no commit phase, which is the whole of "the policy is
    client-only" — one attempt per request, no machinery needed to enforce it.
*/

/** The `retry` option — see {@link MandalaConfig.retry}. */
export type RetryOptions = {
    /** How many automatic attempts after the first failure. `0` disables the policy. */
    count: number;
    /**
     * The first backoff, in milliseconds. Each further attempt doubles it, so
     * `{ count: 3, backoffMs: 500 }` waits 500ms, then 1s, then 2s.
     */
    backoffMs: number;
};

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

    constructor(options: RetryOptions) {
        this.count = options.count;
        this.backoffMs = options.backoffMs;
    }

    /** Wired every render, like the refresh controller's: the verbs stay current. */
    wire(wiring: PolicyWiring): void {
        this.wiring = wiring;
    }

    /**
     * Render-time, from the error boundary: does this failure get an automatic attempt?
     *
     * `failed` only. A `not-available` retried is still a `not-available` — the load said
     * the thing does not exist, which is an answer, not a transient fault; retrying it just
     * delays the 404 the user is owed. Same for any other code a load coins.
     *
     * Idempotent per generation: the boundary re-renders while it holds an error (its
     * parent re-renders, a source ticks), and each of those must re-read the ruling rather
     * than buy another attempt. One generation can only be failing once.
     */
    accept(code: string, generation: unknown): boolean {
        if (this.ruledOn === generation) return this.accepted;
        this.ruledOn = generation;
        this.accepted = code === 'failed' && this.spent < this.count;
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
        // are barely different from one.
        const wait = this.backoffMs * 2 ** (this.spent - 1);
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
