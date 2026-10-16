/*
    `loadingDelayMs` — the island's "don't flash a spinner" gate, one per mandala instance;
    the design is docs/current/internals.md.
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
     * A resolution begins: holds the slot back, render-time and timer-less (`arm` starts the
     * countdown). A no-op once the delay is paid, so a superseding re-resolve never blanks a
     * slot already showing.
     */
    begin(): void {
        if (this.expired) return;
        this.set(true);
    }

    /**
     * Effect-time: start the countdown of an open window. Idempotent — called on every
     * render of the island, so a window already counting keeps its deadline (the slot moving
     * between its sites must not push it out).
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
     * The slot is on screen, so the delay has nothing left to hide. Called from the slot's
     * render, covering what the timer can't: the server render and the hydration pass show
     * the slot regardless, and the first client render must not take it back.
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
