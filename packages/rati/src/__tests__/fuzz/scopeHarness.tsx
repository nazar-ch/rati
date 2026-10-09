import { useSyncExternalStore, type FC } from 'react';

import * as fc from 'fast-check';

import { byLevel } from './arbitraries.js';
import {
    formatValue,
    INPUT_KEY,
    type DeclaredState,
    type HarnessValue,
    type KeyKind,
    type KeyPayload,
    type KeySpec,
    type ScopeSpec,
} from './model.js';

import { island } from '../../island/island.js';
import { useScopeControls, type ScopeControls } from '../../mandala/controls.js';
import { scope, input, type Scope } from '../../scope/scope.js';
import { controllableSource, type ControllableSource } from '../../testing/index.js';

/*
    The generated-scope harness: an arbitrary over scope SPECS and a builder turning one into an
    instrumented island, checked against model.ts. Producers compute from the bag the ENGINE
    hands them, the model from its own state, so a stale upstream value fails convergence.
*/

/**
 * `minLevels` lets a property insist on a real waterfall: a single-level scope has no
 * dependents, so it expresses no cascade. The command property sets it; the smoke property
 * keeps single-level shapes.
 */
export function scopeSpecArb({
    minLevels = 1,
}: { minLevels?: number } = {}): fc.Arbitrary<ScopeSpec> {
    const maxLevels = byLevel(4, 1);
    const maxKeysPerLevel = byLevel(3, 1);
    return fc
        .array(fc.integer({ min: 1, max: maxKeysPerLevel }), {
            minLength: minLevels,
            maxLength: Math.max(minLevels, maxLevels),
        })
        .chain((keysPerLevel) => {
            const names = keysPerLevel.map((count, level) =>
                Array.from({ length: count }, (_, i) => `k${level}_${i}`),
            );
            const perKey = keysPerLevel.flatMap((count, level) => {
                // A producer may read the island's input plus every strictly-earlier key.
                const earlier = [INPUT_KEY, ...names.slice(0, level).flat()];
                return Array.from({ length: count }, () =>
                    fc.record({
                        kind: fc.constantFrom<KeyKind>('value', 'promise', 'source'),
                        payload: fc.constantFrom<KeyPayload>('fresh', 'stable'),
                        readsMask: fc.array(fc.boolean(), {
                            minLength: earlier.length,
                            maxLength: earlier.length,
                        }),
                        settleOrder: fc.nat(1000),
                    }),
                );
            });
            return fc.tuple(...perKey).map((defs) => {
                let cursor = 0;
                const levels: KeySpec[][] = names.map((levelNames, level) => {
                    const earlier = [INPUT_KEY, ...names.slice(0, level).flat()];
                    return levelNames.map((key) => {
                        const def = defs[cursor++]!;
                        return {
                            key,
                            level,
                            kind: def.kind,
                            reads: earlier.filter((_, i) => def.readsMask[i]),
                            payload: def.payload,
                            settleOrder: def.settleOrder,
                        };
                    });
                });
                return { levels };
            });
        });
}

export type LedgerEntry = {
    /** `key#n` — one entry per SOURCE INSTANCE, not per key: a cascade legitimately has
     * the new source attached (layout phase) before the old detaches (passive cleanup), so
     * per-key concurrency would read 2 on a correct swap. Per instance, >1 is a real
     * double-attach. */
    id: string;
    key: string;
    attaches: number;
    detaches: number;
    maxConcurrent: number;
    /** Attached right now — the ledger's live half. */
    attached: boolean;
    /** The instance this key's cell holds now, whose transitions reach the render. A
     * cascade-swapped predecessor is NOT current even while its value bridges on screen, which
     * is why the "nothing detached still feeds renders" bound tests this. */
    current: boolean;
};

/**
 * One `.provide()` value's lifecycle. The contract it exists to pin: the value disposes
 * BEFORE the sources it was built over detach, so a value holding a grabbed resource is
 * torn down while that grab is still live (scope.ts `.provide()`).
 */
export type ProvideRecord = {
    /** `provide#n` — one per build; a refresh-driven rebuild makes a new one. */
    id: string;
    /**
     * Null while the value is live. At dispose: the source instances it was built over that
     * had ALREADY detached — the violation list. Instances a later swap replaced are left out:
     * that cascade detached them on purpose.
     */
    detachedAtDispose: readonly string[] | null;
};

type HeldEntry = {
    key: string;
    kind: 'promise' | 'source';
    /** A newer producer run replaced this one (a superseded refresh, or a remount). Firing
     * it must be inert — that is the refresh token guard's tripwire. */
    superseded: boolean;
    settle: () => void;
    fail: () => void;
};

// The entry's `controllableSource` with the harness's model driver layered on: `ready`
// recomputes the formula value per emit, `restore` re-emits the last value with stable
// identity (S8's no-op recovery), and `id` / `key` identify the instance for the ledger.
type Controllable = ControllableSource<HarnessValue> & {
    id: string;
    key: string;
    /** Emit the value the formula says this source holds NOW — its first ready, and every
     * later one after a `sourceBump` moves its epoch. */
    ready: () => void;
    pend: () => void;
    restore: () => void;
    fail: () => void;
};

export type BuiltHarness = {
    /** Mounts the island and feeds it the declared input. */
    Host: FC;
    /** Keys with a live (non-superseded) first settle or re-fetch held. */
    held(): string[];
    /** Keys with a superseded entry still holdable — firing one must change nothing. */
    staleHeld(): string[];
    settle(key: string): void;
    reject(key: string): void;
    settleStale(key: string): void;
    sourcePend(key: string): void;
    sourceRestore(key: string): void;
    sourceError(key: string): void;
    /** Re-emit `key`'s source at the epoch the declared state now holds — a live source
     * moving by itself. The MODEL owns epoch bumps (as it does for `refresh`), so this
     * only emits; bumping here too would double-count and desync the two. */
    sourceEmit(key: string): void;
    /** Mark every outstanding entry superseded — a remount drops the cells behind them. */
    supersedeAll(): void;
    refresh(key: string): void;
    refreshAll(): void;
    /** The island's `pending` set, read through `useScopeControls` (the public surface). */
    pending(): string[];
    runCounts(): ReadonlyMap<string, number>;
    totalRuns(): number;
    ledger(): readonly LedgerEntry[];
    /** Every `.provide()` value the run has built, in order. Empty unless the spec variant
     * asked for one. */
    provideLog(): readonly ProvideRecord[];
    /** The object identity last rendered for `key` — the equals gate's observable half. */
    identityOf(key: string): HarnessValue | undefined;
};

export type HarnessOptions = {
    /** End the scope chain in `.provide()` — the lifecycle variant. The value records its
     * build/dispose and the sources it was built over (see {@link ProvideRecord}); it also
     * reads every resolved key, so its tracked read-set is the whole scope and any changed
     * value must rebuild it. */
    provide?: boolean;
};

export const CONTENT_TESTID = 'fuzz-content';
export const LOADING_TESTID = 'fuzz-loading';
export const ERROR_TESTID = 'fuzz-error';

/**
 * The slot node, if it is ON SCREEN: a suspending update keeps the old subtree mounted but
 * hidden beside the fallback, so `querySelector` alone excuses every loading-slot flash
 * (packages/rati/src/__tests__/suspense-situations.md).
 */
function visibleNode(container: HTMLElement, testid: string): Element | null {
    const node = container.querySelector(`[data-testid="${testid}"]`);
    if (!node) return null;
    // React hides the boundary's CHILDREN, which are ancestors of these markers.
    for (let el: Element | null = node; el && el !== container; el = el.parentElement) {
        if (el instanceof HTMLElement && el.style.display === 'none') return null;
    }
    return node;
}

/** Parse the rendered dump back into key -> HarnessValue. */
export function readContent(container: HTMLElement): Record<string, HarnessValue> | null {
    const node = visibleNode(container, CONTENT_TESTID);
    if (!node?.textContent) return null;
    return JSON.parse(node.textContent) as Record<string, HarnessValue>;
}

/** Which slot the island is showing — the contract's headline observable. */
export function readSlot(container: HTMLElement): 'loading' | 'content' | 'error' {
    if (visibleNode(container, ERROR_TESTID)) return 'error';
    if (visibleNode(container, CONTENT_TESTID)) return 'content';
    return 'loading';
}

export function buildHarness(
    spec: ScopeSpec,
    declared: DeclaredState,
    options: HarnessOptions = {},
): BuiltHarness {
    const runCounts = new Map<string, number>();
    const heldEntries: HeldEntry[] = [];
    const liveSources = new Map<string, Controllable>();
    const identities = new Map<string, HarnessValue>();
    // Every source instance ever built (never pruned), so `ledger()` can report the
    // teardown bounds off each one's own attach/detach counters.
    const createdSources: Controllable[] = [];
    const provideRecords: Array<{ id: string; detachedAtDispose: readonly string[] | null }> = [];
    let sourceInstances = 0;
    let provideInstances = 0;

    const dumpKeys = spec.levels
        .flat()
        .map((keySpec) => keySpec.key)
        .sort();

    const supersede = (key: string) => {
        for (const entry of heldEntries) if (entry.key === key) entry.superseded = true;
    };

    const makeControllable = (key: string, recompute: () => HarnessValue): Controllable => {
        const id = `${key}#${sourceInstances++}`;
        const source = controllableSource<HarnessValue>();
        const controllable = Object.assign(source, {
            id,
            key,
            ready: () => source.setReady(recompute()),
            pend: () => source.setPending(),
            // S8 recovery re-emits the SAME value: recovery runs no producer, and an unchanged
            // snapshot moves nothing. A genuinely new value is `sourceBump` (→ `ready`).
            restore: () => source.emit(),
            fail: () => source.setError({ code: 'failed', message: id }),
        });
        createdSources.push(controllable);
        return controllable;
    };

    const makeProducer = (keySpec: KeySpec) => (bag: Record<string, unknown>) => {
        runCounts.set(keySpec.key, (runCounts.get(keySpec.key) ?? 0) + 1);
        const readValues = keySpec.reads.map((read) =>
            read === INPUT_KEY ? (bag[read] as string) : (bag[read] as HarnessValue).v,
        );
        const value = formatValue(keySpec.key, declared.epochOf(keySpec.key), readValues);
        // This run replaces whatever the last one left in flight.
        supersede(keySpec.key);
        switch (keySpec.kind) {
            case 'value':
                return value;
            case 'promise': {
                let resolve!: (value: HarnessValue) => void;
                let reject!: (reason: unknown) => void;
                const promise = new Promise<HarnessValue>((res, rej) => {
                    resolve = res;
                    reject = rej;
                });
                // Register a rejection handler up front: a superseded promise's rejection
                // reaches no `use()` and no controller, and would surface as an unhandled
                // rejection that fails the worker rather than the property.
                void promise.catch(() => {});
                heldEntries.push({
                    key: keySpec.key,
                    kind: 'promise',
                    superseded: false,
                    settle: () => resolve(value),
                    fail: () => reject(new Error(`fuzz: ${keySpec.key} rejected`)),
                });
                return promise;
            }
            case 'source': {
                // Recomputed rather than captured: a `sourceBump` moves this key's epoch and
                // the source must then emit the new value without its producer re-running.
                // Safe for the first ready too — only a COMMITTED source can be bumped, so
                // the epoch cannot move between this run and that first settle.
                const source = makeControllable(keySpec.key, () =>
                    formatValue(keySpec.key, declared.epochOf(keySpec.key), readValues),
                );
                liveSources.set(keySpec.key, source);
                heldEntries.push({
                    key: keySpec.key,
                    kind: 'source',
                    superseded: false,
                    settle: () => source.ready(),
                    fail: () => source.fail(),
                });
                return source;
            }
        }
    };

    /*
        The `.provide()` variant's factory: it records the value's build and dispose and the
        source instances it was built over, so the dispose says whether they were still
        attached. It reads every resolved key, so a change to any key rebuilds the value.
    */
    const provideFactory = (resolved: Record<string, unknown>) => {
        const record: { id: string; detachedAtDispose: readonly string[] | null } = {
            id: `provide#${provideInstances++}`,
            detachedAtDispose: null,
        };
        provideRecords.push(record);
        const seen = [INPUT_KEY, ...dumpKeys].map((key) => resolved[key]);
        const builtOver = [...liveSources.values()];
        return {
            seen,
            [Symbol.dispose]() {
                record.detachedAtDispose = builtOver
                    .filter((source) => liveSources.get(source.key) === source && !source.attached)
                    .map((source) => source.id);
            },
        };
    };

    let chain = scope({ [INPUT_KEY]: input<string>() }) as unknown as {
        load: (def: Record<string, unknown>) => unknown;
    };
    for (const level of spec.levels) {
        const def: Record<string, unknown> = {};
        for (const keySpec of level) def[keySpec.key] = makeProducer(keySpec);
        chain = chain.load(def) as typeof chain;
    }
    // `.provide()` stamps the factory onto the same node rather than adding a level, but it
    // returns a NEW object — so the island, `useScopeControls` and `useScope` must all be
    // keyed off this one (the channels are scope-identity keyed).
    const provideChain = chain as unknown as {
        provide: (factory: (resolved: Record<string, unknown>) => unknown) => Scope;
    };
    const builtScope = (options.provide
        ? provideChain.provide(provideFactory)
        : chain) as unknown as Scope;

    // Reads the island's controls from inside its subtree — rendered in every slot, since
    // the mandala provides the controls channel around the whole inner tree.
    const captured: { current: ScopeControls<Scope> | null } = { current: null };
    const Probe: FC = () => {
        captured.current = useScopeControls(builtScope);
        return null;
    };

    const Dump: FC<Record<string, unknown>> = (props) => {
        for (const key of dumpKeys) identities.set(key, props[key] as HarnessValue);
        return (
            <div>
                <div data-testid={CONTENT_TESTID}>{JSON.stringify(props, [...dumpKeys, 'v'])}</div>
                <Probe />
            </div>
        );
    };

    const Island = island({
        scope: builtScope,
        component: Dump,
        loading: () => (
            <div>
                <div data-testid={LOADING_TESTID}>loading</div>
                <Probe />
            </div>
        ),
        error: ({ error }) => (
            <div>
                <div data-testid={ERROR_TESTID}>{error.code}</div>
                <Probe />
            </div>
        ),
    }) as FC<{ n: string }>;

    const Host: FC = () => {
        const n = useSyncExternalStore(
            declared.subscribeInput,
            declared.inputValue,
            declared.inputValue,
        );
        return <Island n={n} />;
    };

    const take = (key: string, superseded: boolean): HeldEntry => {
        const index = heldEntries.findIndex(
            (entry) => entry.key === key && entry.superseded === superseded,
        );
        if (index === -1) {
            throw new Error(`harness: no ${superseded ? 'stale' : 'live'} entry held for '${key}'`);
        }
        return heldEntries.splice(index, 1)[0]!;
    };

    const liveSource = (key: string): Controllable => {
        const source = liveSources.get(key);
        if (!source) throw new Error(`harness: no live source for '${key}'`);
        return source;
    };

    return {
        Host,
        held: () =>
            heldEntries
                .filter((entry) => !entry.superseded)
                .map((entry) => entry.key)
                .sort(),
        staleHeld: () =>
            [
                ...new Set(
                    heldEntries.filter((entry) => entry.superseded).map((entry) => entry.key),
                ),
            ].sort(),
        settle: (key) => take(key, false).settle(),
        reject: (key) => take(key, false).fail(),
        settleStale: (key) => take(key, true).settle(),
        sourcePend: (key) => liveSource(key).pend(),
        sourceRestore: (key) => liveSource(key).restore(),
        sourceError: (key) => liveSource(key).fail(),
        sourceEmit: (key) => liveSource(key).ready(),
        supersedeAll: () => {
            for (const entry of heldEntries) entry.superseded = true;
        },
        // Fire-and-forget on purpose: the returned promise settles only when the key does,
        // which is a LATER command's job. Refresh failures resolve (they log), so no
        // rejection escapes.
        refresh: (key) => void captured.current!.refresh(key),
        refreshAll: () => void captured.current!.refresh(),
        pending: () => [...(captured.current?.pending ?? [])].sort(),
        runCounts: () => runCounts,
        totalRuns: () => [...runCounts.values()].reduce((total, count) => total + count, 0),
        ledger: () =>
            createdSources.map((source) => ({
                id: source.id,
                key: source.key,
                attaches: source.attachCount,
                detaches: source.detachCount,
                maxConcurrent: source.peakAttached,
                attached: source.attached,
                current: liveSources.get(source.key)?.id === source.id,
            })),
        provideLog: () => provideRecords,
        identityOf: (key) => identities.get(key),
    };
}
