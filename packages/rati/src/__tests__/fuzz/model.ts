/*
    The reference model — the mandala contract's semantics as plain JS, plus the vocabulary
    the harness and the commands share (the spec shape, the value formula, the declared
    state). No React, no engine imports, no `deepEqual` borrowed from `util/` — the file's
    import list is the altitude rule made structural (docs/research/mandala-testing.md
    §"The altitude rule"). If a rule here needed engine code to express, it would not be a
    contract.

    THE VALUE FORMULA. Every key's value is a pure function of three declared things: its
    own name, its *epoch*, and its reads' current values. The epoch is not a run counter —
    it is the test's declared intent, bumped by a `refresh` command on a `fresh`-payload key
    to mean "this re-fetch must produce something new". That indirection is deliberate and
    load-bearing:

      - It keeps the value independent of *how many times* the engine ran the producer. A
        run counter would encode exact run counts into every convergence assert through the
        back door — and an engine that legitimately coalesces two dirty marks into one
        re-run (a direct refresh landing in the same render as a cascade) would fail while
        being correct. The altitude rule says an engine that gets lazier must stay green;
        run counts are asserted separately, as upper bounds.
      - It makes the expected value at quiesce a **fixpoint** over the declared state —
        literally "what a from-scratch resolution of the current inputs would produce",
        which is the convergence invariant's own wording.

    A `stable` payload never bumps, so its re-fetch yields a deep-equal value: the engine's
    equals gate must hold, keep the old *identity*, and cascade nothing.
*/

/** The scope head's single input, readable by any level's producer (`reads`). */
export const INPUT_KEY = 'n';

export type KeyKind = 'value' | 'promise' | 'source';
export type KeyPayload = 'fresh' | 'stable';

export type KeySpec = {
    key: string;
    level: number;
    kind: KeyKind;
    /** `INPUT_KEY` and/or keys of strictly earlier levels — any kind, sources included
     * (a cascade reaches through one: `__tests__/mandala/cascadeThroughSource.test.tsx`). */
    reads: string[];
    payload: KeyPayload;
    /** Settle priority for the MF-01 smoke property (the command suite picks its own). */
    settleOrder: number;
};

export type ScopeSpec = { levels: KeySpec[][] };

export const allKeys = (spec: ScopeSpec): KeySpec[] => spec.levels.flat();

/** Values are objects (a fresh reference per producer run) so an equal-content re-fetch is
 * distinguishable from reference reuse — the shape the equals gate exists for. */
export type HarnessValue = { v: string };

export function formatValue(key: string, epoch: number, readValues: string[]): HarnessValue {
    return { v: `${key}#${epoch}(${readValues.join(',')})` };
}

/** The model's own value comparison — deliberately not the engine's `deepEqual`, so a bug
 * in that comparator cannot hide behind a model that shares it. */
export const sameValue = (a: HarnessValue | null, b: HarnessValue | null): boolean =>
    a !== null && b !== null && a.v === b.v;

// ---------------------------------------------------------------------------------------

/*
    The declared state: what the *test* has said should be true. Both the real producers and
    the model read it — the formula is plumbing, the engine is the subject (MF-01's note).
    It doubles as the input's external store, so `changeInput` re-renders the island host.
*/

export type DeclaredState = {
    epochOf(key: string): number;
    /** Declare that `key`'s next producer run must yield a different value. */
    bumpEpoch(key: string): void;
    inputValue(): string;
    /** Change the island's input — a new generation (the inner tree remounts). */
    setInput(): void;
    subscribeInput(onChange: () => void): () => void;
};

export function createDeclaredState(): DeclaredState {
    const epochs = new Map<string, number>();
    const listeners = new Set<() => void>();
    let inputCounter = 0;
    let input = 'i0';
    return {
        epochOf: (key) => epochs.get(key) ?? 0,
        bumpEpoch: (key) => epochs.set(key, (epochs.get(key) ?? 0) + 1),
        inputValue: () => input,
        setInput() {
            input = `i${++inputCounter}`;
            for (const listener of listeners) listener();
        },
        subscribeInput(onChange) {
            listeners.add(onChange);
            return () => {
                listeners.delete(onChange);
            };
        },
    };
}

// ---------------------------------------------------------------------------------------

export type Slot = 'loading' | 'content' | 'error';

type ModelKey = {
    spec: KeySpec;
    /**
     * 'unreached' — its level has not resolved yet, so the producer has not run;
     * 'held'      — the producer ran, the first value is still in flight;
     * 'ready'     — a value is committed (and rendered, unless a slot rule below hides it);
     * 'errored'   — the load failed terminally (an initial rejection / a source error).
     */
    status: 'unreached' | 'held' | 'ready' | 'errored';
    /** The committed (rendered) value — *not* the in-flight one: a re-fetch keeps this
     * rendered until it settles, which is the no-blank promise. */
    value: HarnessValue | null;
    /** A re-fetch in flight over a committed value: 'promise' keeps the stale value
     * rendered, 'source' is a cascade-swapped source bridging with it. */
    inFlight: null | 'promise' | 'source';
    /** A live source that was ready and dropped back to pending (S8) — forces the loading
     * slot without disturbing the values below it. */
    repending: boolean;
    /** Run budget: the contract's upper bound (one run per generation + one per direct
     * refresh + one per time a read changed). Never an exact count. */
    runBudget: number;
};

export type ReferenceModel = {
    slot(): Slot;
    /** Keys whose first settle the harness is holding (initial loads). */
    held(): string[];
    /** Keys with a re-fetch in flight — the contract's `pending` set. */
    pending(): string[];
    /** Every key with a producer run outstanding — a first load or a re-fetch. The harness's
     * live-entry frontier must equal this exactly. */
    liveEntries(): string[];
    /** The subset a `settle` may target *observably* — empty in the error slot, where the
     * inner tree is gone and a settle reaches nothing until a retry rebuilds it. */
    settleable(): string[];
    /** Would settling `key` now get through the equals gate? Drives the identity-stability
     * invariant: an unchanged settle must keep the rendered reference. */
    willChange(key: string): boolean;
    /** Keys with a superseded run still outstanding — firing one must be inert. */
    staleKeys(): string[];
    /** Discard a superseded run (bookkeeping only: it must change nothing observable). */
    dropStale(key: string): void;
    /** Ready source keys that can be dropped to pending / errored. */
    liveSources(): string[];
    /** Source keys currently repending (droppable back to ready). */
    repending(): string[];
    /** Keys a `refresh(key)` command may target: rerunnable, committed, non-source. */
    refreshable(): string[];
    /** Keys a `reject` may target *observably* — see the implementation for why not all. */
    rejectable(): string[];
    runBudgetOf(key: string): number;
    totalRunBudget(): number;
    /** The rendered values at quiesce — the fixpoint over the declared state. */
    expectedValues(): Record<string, HarnessValue>;
    /** True once every key has committed a value at least once in this generation. */
    allReady(): boolean;

    settle(key: string): void;
    reject(key: string): void;
    sourcePend(key: string): void;
    sourceRestore(key: string): void;
    sourceError(key: string): void;
    /** A live source emits a new value on its own — no producer re-run, no refresh. */
    sourceBump(key: string): void;
    refresh(key: string): void;
    newGeneration(): void;

    /** Counts of what the run actually exercised — the non-vacuity ledger. */
    stats: {
        refreshWithChange: number;
        cascades: number;
        supersededRuns: number;
        sourceValueChanges: number;
    };
};

export function createModel(spec: ScopeSpec, declared: DeclaredState): ReferenceModel {
    const keys = new Map<string, ModelKey>();
    const ordered = allKeys(spec);
    const stats = { refreshWithChange: 0, cascades: 0, supersededRuns: 0, sourceValueChanges: 0 };
    /** Superseded runs still outstanding, per key — the harness holds a settleable entry
     * for each, and firing one must be inert (the refresh token guard). */
    const stale = new Map<string, number>();

    const hasLiveEntry = (state: ModelKey) => state.status === 'held' || state.inFlight !== null;

    /** A producer re-run replaces whatever that key had in flight. */
    const supersedeLive = (state: ModelKey) => {
        if (!hasLiveEntry(state)) return;
        stale.set(state.spec.key, (stale.get(state.spec.key) ?? 0) + 1);
        stats.supersededRuns++;
    };

    const reset = () => {
        for (const keySpec of ordered) {
            const previous = keys.get(keySpec.key);
            // The remount drops the cells behind every outstanding run.
            if (previous) supersedeLive(previous);
            keys.set(keySpec.key, {
                spec: keySpec,
                status: 'unreached',
                value: null,
                inFlight: null,
                repending: false,
                // A new generation grants every producer one run.
                runBudget: (previous?.runBudget ?? 0) + 1,
            });
        }
    };

    const at = (key: string): ModelKey => {
        const state = keys.get(key);
        if (!state) throw new Error(`model: unknown key '${key}'`);
        return state;
    };

    /** A producer's value: the formula over the declared epoch and the reads' committed
     * values. Reads are strictly earlier levels, so their values are final for this pass. */
    const compute = (keySpec: KeySpec): HarnessValue => {
        const readValues = keySpec.reads.map((read) => {
            if (read === INPUT_KEY) return declared.inputValue();
            const value = at(read).value;
            if (!value) throw new Error(`model: '${keySpec.key}' read unresolved '${read}'`);
            return value.v;
        });
        return formatValue(keySpec.key, declared.epochOf(keySpec.key), readValues);
    };

    const levelResolved = (level: number): boolean =>
        spec.levels
            .slice(0, level)
            .every((specs) => specs.every(({ key }) => at(key).status === 'ready'));

    /** The waterfall: a level's producers run once every earlier level is fully ready. */
    const runReachable = () => {
        for (let level = 0; level < spec.levels.length; level++) {
            if (!levelResolved(level)) break;
            for (const keySpec of spec.levels[level]!) {
                const state = at(keySpec.key);
                if (state.status !== 'unreached') continue;
                if (keySpec.kind === 'value') {
                    state.value = compute(keySpec);
                    state.status = 'ready';
                } else {
                    state.status = 'held';
                }
            }
        }
    };

    /** A key's committed value changed: re-run exactly the later-level producers that read
     * it, and follow the ones that changed in turn (the transitive cascade). */
    const cascade = (changed: string) => {
        for (const keySpec of ordered) {
            if (keySpec.level <= at(changed).spec.level) continue;
            if (!keySpec.reads.includes(changed)) continue;
            const state = at(keySpec.key);
            if (state.status !== 'ready') continue;
            state.runBudget++;
            stats.cascades++;
            if (keySpec.kind === 'value') {
                const next = compute(keySpec);
                if (!sameValue(next, state.value)) {
                    state.value = next;
                    cascade(keySpec.key);
                }
            } else {
                // Promise: stale value bridges the re-fetch. Source: the producer yields a
                // fresh source, bridged by the pre-swap value until its first ready.
                supersedeLive(state);
                state.inFlight = keySpec.kind;
            }
        }
    };

    /** A committed value arrived (a first settle, or a re-fetch that got through the gate). */
    const commit = (state: ModelKey, next: HarnessValue) => {
        const changed = !sameValue(next, state.value);
        state.value = next;
        state.inFlight = null;
        if (state.status === 'held') {
            state.status = 'ready';
            runReachable();
        } else if (changed) {
            cascade(state.spec.key);
        }
    };

    reset();
    runReachable();

    // Sorted throughout, so every frontier compares against the harness's own sorted view.
    const someKey = (predicate: (state: ModelKey) => boolean) =>
        ordered
            .filter((keySpec) => predicate(at(keySpec.key)))
            .map((keySpec) => keySpec.key)
            .sort();

    const allReadyOf = () => ordered.every((keySpec) => at(keySpec.key).status === 'ready');

    const anyRepending = () => ordered.some((keySpec) => at(keySpec.key).repending);

    const slotOf = (): Slot => {
        if (ordered.some((keySpec) => at(keySpec.key).status === 'errored')) return 'error';
        if (!allReadyOf()) return 'loading';
        if (ordered.some((keySpec) => at(keySpec.key).repending)) return 'loading';
        return 'content';
    };

    return {
        stats,
        slot: slotOf,
        allReady: allReadyOf,
        held: () => someKey((state) => state.status === 'held'),
        pending: () => someKey((state) => state.inFlight !== null),
        liveEntries: () => someKey(hasLiveEntry),
        /*
            Two states freeze the tree, and the alphabet steps *through* them rather than
            into them — it does not stop exercising them, it stops trying to predict a torn
            -down tree's internals key by key.

              - **The error slot** is terminal until a retry: the boundary has replaced the
                whole inner tree, so an outstanding settle reaches nothing — no cell to
                write, no Step to re-render, so no `pending` bookkeeping either (that runs in
                the resolver's render).
              - **A repending source** (S8) unmounts every level below it, which freezes
                their in-flight work in the same way: a swapped source's first ready is
                noticed in render, so its `pending` never clears while its Step is gone, and
                a cascade into those levels only marks cells dirty — the re-run waits for the
                remount. (A *promise* re-fetch is unaffected either way: it settles through
                the controller's own `.then`, not through a render.)

            Both resolve the way an app resolves them: retry / input change, or restoring the
            source — and the property's quiesce tail does exactly that before converging.
        */
        settleable: () => (slotOf() === 'error' || anyRepending() ? [] : someKey(hasLiveEntry)),
        willChange(key) {
            const state = at(key);
            // A first load always "changes" (there is nothing committed to keep).
            if (state.status === 'held') return true;
            return !sameValue(compute(state.spec), state.value);
        },
        staleKeys: () =>
            [...stale.entries()]
                .filter(([, count]) => count > 0)
                .map(([key]) => key)
                .sort(),
        dropStale(key) {
            const count = stale.get(key) ?? 0;
            if (count <= 0) throw new Error(`model: no stale run held for '${key}'`);
            stale.set(key, count - 1);
        },
        // Only from a fully-resolved island: S8's situation, and it keeps the alphabet's
        // combinations honest (a source dropping out from under a half-built tree is not a
        // situation the catalog describes).
        liveSources: () =>
            slotOf() !== 'content'
                ? []
                : someKey((state) => state.spec.kind === 'source' && state.inFlight === null),
        repending: () => someKey((state) => state.repending),
        // Content must be showing: `refresh` reaches a cell through its *built* bucket, and
        // a level whose Step is unmounted (a source above it repending) never re-runs the
        // producer — the returned waiter would simply never settle.
        refreshable: () =>
            slotOf() !== 'content' ? [] : someKey((state) => state.spec.kind !== 'source'),
        /*
            A failure is only observable once the resolve loop actually reaches it, and a
            Step that suspends on a pending promise never finishes its loop — never commits,
            so its level's sources never even attach. Two consequences, both latent rather
            than wrong: an errored source in a level that still has a promise in flight
            changes nothing on screen, and a rejected promise sitting behind an unsettled
            one is not reached either. Both surface later, when the loop gets that far.

            *When* the engine notices is loop order — mechanism, below the altitude line
            (docs/research/mandala-testing.md). So rather than model it, the alphabet only
            rejects where the answer is unambiguous:

              - a re-fetch in flight — content is showing, so the Step is committed and
                subscribed, and a promise re-fetch fails through the controller rather than
                through `use()`;
              - the *last* held load of an initial resolution. Held keys all sit at one
                level (the waterfall reaches a level only once every earlier one is ready),
                so being alone means nothing else in the level can mask it.
        */
        rejectable() {
            if (slotOf() === 'error' || anyRepending()) return [];
            const held = someKey((state) => state.status === 'held');
            const inFlight = someKey((state) => state.inFlight !== null);
            return [...inFlight, ...(held.length === 1 ? held : [])].sort();
        },
        runBudgetOf: (key) => at(key).runBudget,
        totalRunBudget: () =>
            ordered.reduce((total, keySpec) => total + at(keySpec.key).runBudget, 0),
        expectedValues() {
            const values: Record<string, HarnessValue> = {};
            for (const keySpec of ordered) {
                const value = at(keySpec.key).value;
                if (!value) throw new Error(`model: '${keySpec.key}' has no value at quiesce`);
                values[keySpec.key] = value;
            }
            return values;
        },

        settle(key) {
            const state = at(key);
            if (state.status === 'held') {
                commit(state, compute(state.spec));
                return;
            }
            if (state.inFlight === null) throw new Error(`model: settle('${key}') — not in flight`);
            commit(state, compute(state.spec));
        },

        reject(key) {
            const state = at(key);
            // An initial rejection (a `use()`d promise, or a source's first state being an
            // error) throws to the boundary — the error slot.
            if (state.status === 'held' || state.inFlight === 'source') {
                state.status = 'errored';
                state.inFlight = null;
                return;
            }
            // A failed promise *re-fetch* keeps the previous value and resolves (it logs).
            state.inFlight = null;
        },

        sourcePend(key) {
            at(key).repending = true;
        },
        sourceRestore(key) {
            at(key).repending = false;
        },
        sourceError(key) {
            const state = at(key);
            state.status = 'errored';
            state.inFlight = null;
            state.repending = false;
        },
        // A live source transitioning ready -> ready on a new value. No producer runs (the
        // source emits by itself), but the new value must reach its readers like any other
        // changed value — so the budget it grants is the cascade's, not its own.
        sourceBump(key) {
            const state = at(key);
            declared.bumpEpoch(key);
            stats.sourceValueChanges++;
            commit(state, compute(state.spec));
        },

        refresh(key) {
            const state = at(key);
            state.runBudget++;
            if (state.spec.payload === 'fresh') {
                declared.bumpEpoch(key);
                stats.refreshWithChange++;
            }
            if (state.spec.kind === 'value') {
                // A sync re-run gates and swaps in the same render pass — no in-flight window.
                commit(state, compute(state.spec));
                return;
            }
            supersedeLive(state);
            state.inFlight = 'promise';
        },

        newGeneration() {
            reset();
            runReachable();
        },
    };
}
