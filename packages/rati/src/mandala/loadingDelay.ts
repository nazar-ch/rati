/*
    `loadingDelayMs` — the island's "don't flash a spinner" gate.

    One per mandala instance, holding back the *one* loading-slot element the mandala
    threads into the three places it can appear (the Suspense fallback, a Step pending on a
    source, `ProvideLeaf`'s build frame), so the delay is a single deadline rather than three.

    The unit it measures is a *stretch without fresh content*, not a resolution: the deadline
    starts when the island leaves content behind and is paid off exactly once. That is what
    makes the two edges honest — a re-resolve arriving mid-stretch doesn't push the slot
    further out, and once the slot is on screen nothing takes it back (`expired`).

    Two halves on purpose. `begin` is render-time — the generation that starts a resolution
    is created in render, and so is the server's — and therefore starts no timer: a server
    render must neither hold a slot back (its snapshot is `false`, see the slot's
    `useSyncExternalStore`) nor leave a `setTimeout` behind holding the process open. `arm`
    is the effect-time half, which the server never runs.
*/

export class LoadingDelay {
    private readonly delayMs: number;
    private timer: ReturnType<typeof setTimeout> | null = null;
    /** Holding the slot back right now. */
    private holding = false;
    /** The delay has been paid for the current stretch — nothing hides the slot again
     *  until content comes back (see `settled`). */
    private expired = false;
    private readonly listeners = new Set<() => void>();
    private notifyScheduled = false;

    constructor(delayMs: number) {
        this.delayMs = delayMs;
    }

    /** uSES pair — read by the mandala (to keep the previous run on screen for the window)
     *  and by the loading slot itself (to render nothing until the deadline). */
    getHeld = (): boolean => this.holding;

    subscribe = (onChange: () => void): (() => void) => {
        this.listeners.add(onChange);
        return () => {
            this.listeners.delete(onChange);
        };
    };

    /**
     * A resolution begins — hold the slot back. Render-time (called where the generation is
     * built), and deliberately timer-less; `arm` starts the countdown.
     *
     * A no-op once the delay is paid: an island that is already showing its slot must not
     * blank when a second re-resolve supersedes the first, and the second one's user has
     * been waiting since the first.
     */
    begin(): void {
        if (this.expired) return;
        this.set(true);
    }

    /**
     * Effect-time: start the countdown of an open window. Idempotent — called on every
     * render of the island, so a window already counting keeps its deadline (the slot moving
     * between its three sites must not push it out).
     */
    arm(): void {
        if (!this.holding || this.timer) return;
        this.timer = setTimeout(() => {
            this.timer = null;
            this.expired = true;
            this.set(false);
        }, this.delayMs);
    }

    /**
     * The slot is on screen — the delay has nothing left to hide. Called from the slot's own
     * render, which is what covers the renders the timer can't: a server render and the
     * client's hydration pass both show the slot regardless of the delay, and taking it back
     * on the first post-hydration render would be exactly the flash this option exists to
     * prevent.
     */
    expire(): void {
        this.clear();
        this.expired = true;
        this.set(false);
    }

    /** Content is on screen: the stretch is over and the next one gets the full delay. */
    settled(): void {
        this.clear();
        this.expired = false;
        this.set(false);
    }

    /** The island is gone. */
    dispose(): void {
        this.clear();
    }

    private clear(): void {
        if (!this.timer) return;
        clearTimeout(this.timer);
        this.timer = null;
    }

    private set(holding: boolean): void {
        if (this.holding === holding) return;
        this.holding = holding;
        if (this.notifyScheduled) return;
        // Deferred like the controller's status notify, and for the same reason: `begin` and
        // `expire` are both called during render, where a listener's setState is not allowed.
        this.notifyScheduled = true;
        queueMicrotask(() => {
            this.notifyScheduled = false;
            for (const listener of this.listeners) listener();
        });
    }
}

/** uSES stand-ins for an island built without the option, and the server snapshot for one
 *  built with it: off the client the delay is inert. */
export const noDelaySubscribe = (): (() => void) => () => {};
export const notHeld = (): boolean => false;
