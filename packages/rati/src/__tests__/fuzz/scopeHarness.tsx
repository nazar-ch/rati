import * as fc from 'fast-check';
import type { FC } from 'react';
import { scope, type Scope } from '../../scope/scope';
import { SourceSymbol, type Source, type SourceState } from '../../scope/source';
import { island } from '../../island/island';
import { byLevel } from './arbitraries';

/*
    The generated-scope harness: a fast-check arbitrary over scope *specs*, a builder that
    turns a spec into a real instrumented island, and a plain-JS reference model computing
    what that island must show. Design record: docs/research/mandala-testing.md §"The fuzz
    foundation"; the invariant altitude (contract only, no engine mechanics) binds everything
    in here.

    The value formula is shared between the real producers and the model on purpose: the
    formula is plumbing, the engine is the subject. Real producers compute from the resolved
    bag the engine hands them; the model computes from its own state — if the engine delivers
    wrong or stale upstream values, the two disagree and convergence fails.

    Shape knobs (FUZZ_LEVEL via byLevel): level count byLevel(4, 1), keys per level
    byLevel(3, 1) — level 2 already generates scopes up to 6 levels × 5 keys.
*/

export type KeyKind = 'value' | 'promise' | 'source';
export type KeyPayload = 'fresh' | 'stable';

export type KeySpec = {
    key: string;
    level: number;
    kind: KeyKind;
    /** Keys of strictly earlier levels this producer reads. */
    reads: string[];
    /** Re-run behavior: 'fresh' yields a new value each run, 'stable' a deep-equal one.
     * (Inert until refresh enters the alphabet — MF-02.) */
    payload: KeyPayload;
    /** Settle priority: the harness settles the held key with the lowest value first. */
    settleOrder: number;
};

export type ScopeSpec = { levels: KeySpec[][] };

export const allKeys = (spec: ScopeSpec): KeySpec[] => spec.levels.flat();

/** Values are objects (fresh reference per producer run) so equal-content re-fetches are
 * distinguishable from reference reuse — the shape the deepEqual gate exists for. */
export type HarnessValue = { v: string };

export function formatValue(key: string, gen: number, readValues: string[]): HarnessValue {
    return { v: `${key}#${gen}(${readValues.join(',')})` };
}

// ---------------------------------------------------------------------------------------

export function scopeSpecArb(): fc.Arbitrary<ScopeSpec> {
    const maxLevels = byLevel(4, 1);
    const maxKeysPerLevel = byLevel(3, 1);
    return fc
        .array(fc.integer({ min: 1, max: maxKeysPerLevel }), { minLength: 1, maxLength: maxLevels })
        .chain((keysPerLevel) => {
            const names = keysPerLevel.map((count, level) =>
                Array.from({ length: count }, (_, i) => `k${level}_${i}`),
            );
            const perKey = keysPerLevel.flatMap((count, level) => {
                const earlier = names.slice(0, level).flat();
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
                    const earlier = names.slice(0, level).flat();
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

// ---------------------------------------------------------------------------------------

export type LedgerEntry = {
    key: string;
    attaches: number;
    detaches: number;
    /** Highest number of simultaneous attaches ever observed (must stay ≤ 1). */
    maxConcurrent: number;
};

type Held = { key: string; fire: () => void };

export type BuiltHarness = {
    Island: FC;
    /** Keys currently held pending (unsettled deferreds / pending sources), sorted. */
    held(): string[];
    /** Fire one held key (resolve its deferred / ready its source). Caller wraps in act. */
    settle(key: string): void;
    runCounts(): ReadonlyMap<string, number>;
    ledger(): readonly LedgerEntry[];
};

export const CONTENT_TESTID = 'fuzz-content';
export const LOADING_TESTID = 'fuzz-loading';

/** Parse the rendered dump back into key → HarnessValue. */
export function readContent(container: HTMLElement): Record<string, HarnessValue> | null {
    const node = container.querySelector(`[data-testid="${CONTENT_TESTID}"]`);
    if (!node?.textContent) return null;
    return JSON.parse(node.textContent) as Record<string, HarnessValue>;
}

export function buildHarness(spec: ScopeSpec): BuiltHarness {
    const runCounts = new Map<string, number>();
    const heldEntries: Held[] = [];
    const ledgers = new Map<
        string,
        { attaches: number; detaches: number; depth: number; maxConcurrent: number }
    >();

    const ledgerFor = (key: string) => {
        let entry = ledgers.get(key);
        if (!entry) {
            entry = { attaches: 0, detaches: 0, depth: 0, maxConcurrent: 0 };
            ledgers.set(key, entry);
        }
        return entry;
    };

    const controllableSource = (
        key: string,
    ): Source<HarnessValue> & { ready(v: HarnessValue): void } => {
        let state: SourceState<HarnessValue> = { status: 'pending' };
        const listeners = new Set<() => void>();
        return {
            [SourceSymbol]: true,
            getSnapshot: () => state,
            subscribe(onChange) {
                listeners.add(onChange);
                return () => {
                    listeners.delete(onChange);
                };
            },
            attach() {
                const ledger = ledgerFor(key);
                ledger.attaches++;
                ledger.depth++;
                ledger.maxConcurrent = Math.max(ledger.maxConcurrent, ledger.depth);
                return () => {
                    ledger.detaches++;
                    ledger.depth--;
                };
            },
            ready(value) {
                state = { status: 'ready', value };
                for (const listener of listeners) listener();
            },
        };
    };

    const makeProducer = (keySpec: KeySpec) => (bag: Record<string, unknown>) => {
        const runs = (runCounts.get(keySpec.key) ?? 0) + 1;
        runCounts.set(keySpec.key, runs);
        const gen = keySpec.payload === 'stable' ? 0 : runs - 1;
        const readValues = keySpec.reads.map((read) => (bag[read] as HarnessValue).v);
        const value = formatValue(keySpec.key, gen, readValues);
        switch (keySpec.kind) {
            case 'value':
                return value;
            case 'promise': {
                let resolve!: (v: HarnessValue) => void;
                const promise = new Promise<HarnessValue>((res) => {
                    resolve = res;
                });
                heldEntries.push({ key: keySpec.key, fire: () => resolve(value) });
                return promise;
            }
            case 'source': {
                const source = controllableSource(keySpec.key);
                heldEntries.push({ key: keySpec.key, fire: () => source.ready(value) });
                return source;
            }
        }
    };

    let chain = scope() as { load: (def: Record<string, unknown>) => unknown };
    for (const level of spec.levels) {
        const def: Record<string, unknown> = {};
        for (const keySpec of level) def[keySpec.key] = makeProducer(keySpec);
        chain = chain.load(def) as typeof chain;
    }

    const keys = allKeys(spec).map((keySpec) => keySpec.key);
    const dumpKeys = [...keys].sort();
    const Dump: FC<Record<string, unknown>> = (props) => (
        <div data-testid={CONTENT_TESTID}>{JSON.stringify(props, [...dumpKeys, 'v'])}</div>
    );
    const Island = island({
        scope: chain as unknown as Scope,
        component: Dump,
        loading: () => <div data-testid={LOADING_TESTID}>loading</div>,
    }) as FC;

    return {
        Island,
        held: () => heldEntries.map((entry) => entry.key).sort(),
        settle(key) {
            const index = heldEntries.findIndex((entry) => entry.key === key);
            if (index === -1) throw new Error(`harness: settle('${key}') — not held`);
            const [entry] = heldEntries.splice(index, 1);
            entry!.fire();
        },
        runCounts: () => runCounts,
        ledger: () =>
            [...ledgers.entries()].map(([key, { attaches, detaches, maxConcurrent }]) => ({
                key,
                attaches,
                detaches,
                maxConcurrent,
            })),
    };
}

// ---------------------------------------------------------------------------------------

/*
    The reference model — the contract's semantics with no React and no engine imports:

      - a level's producers run when every key of all earlier levels is ready (the waterfall);
      - 'value' keys become ready at run; 'promise'/'source' keys are held until settled;
      - each key's value follows the shared formula over the model's own read values.
*/

type ModelKeyState = {
    spec: KeySpec;
    status: 'unreached' | 'held' | 'ready';
    value: HarnessValue | null;
};

export type ModelHarness = {
    allReady(): boolean;
    held(): string[];
    /** The next key the settle policy picks (lowest settleOrder among held). */
    nextToSettle(): string;
    settle(key: string): void;
    expectedValues(): Record<string, HarnessValue>;
};

export function createModel(spec: ScopeSpec): ModelHarness {
    const keys = new Map<string, ModelKeyState>();
    for (const keySpec of allKeys(spec)) {
        keys.set(keySpec.key, { spec: keySpec, status: 'unreached', value: null });
    }

    const levelReady = (level: number): boolean =>
        spec.levels
            .slice(0, level)
            .every((levelSpecs) =>
                levelSpecs.every(({ key }) => keys.get(key)!.status === 'ready'),
            );

    const runReachable = () => {
        for (let level = 0; level < spec.levels.length; level++) {
            if (!levelReady(level)) break;
            for (const keySpec of spec.levels[level]!) {
                const state = keys.get(keySpec.key)!;
                if (state.status !== 'unreached') continue;
                const readValues = keySpec.reads.map((read) => keys.get(read)!.value!.v);
                state.value = formatValue(keySpec.key, 0, readValues);
                state.status = keySpec.kind === 'value' ? 'ready' : 'held';
            }
        }
    };
    runReachable();

    const held = () =>
        [...keys.values()]
            .filter((state) => state.status === 'held')
            .map((state) => state.spec.key)
            .sort();

    return {
        allReady: () => [...keys.values()].every((state) => state.status === 'ready'),
        held,
        nextToSettle() {
            const candidates = [...keys.values()].filter((state) => state.status === 'held');
            candidates.sort(
                (a, b) =>
                    a.spec.settleOrder - b.spec.settleOrder || (a.spec.key < b.spec.key ? -1 : 1),
            );
            if (!candidates[0]) throw new Error('model: nothing held to settle');
            return candidates[0].spec.key;
        },
        settle(key) {
            const state = keys.get(key);
            if (!state || state.status !== 'held')
                throw new Error(`model: settle('${key}') — not held`);
            state.status = 'ready';
            runReachable();
        },
        expectedValues() {
            const values: Record<string, HarnessValue> = {};
            for (const [key, state] of keys) {
                if (state.value === null) throw new Error(`model: '${key}' has no value yet`);
                values[key] = state.value;
            }
            return values;
        },
    };
}
