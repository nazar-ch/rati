import { describe, test, expect, vi } from 'vite-plus/test';
import { autorun } from 'mobx';
import { keyed } from '../../data/keyed';
import { query } from '../../data/query';
import { mutation } from '../../data/mutation';

describe('get-or-create', () => {
    test('the same key returns the same instance; the factory runs once per key', () => {
        const factory = vi.fn((id: string) => ({ id }));
        const map = keyed(factory);

        const first = map.get('a');
        expect(map.get('a')).toBe(first);
        expect(factory).toHaveBeenCalledTimes(1);

        const other = map.get('b');
        expect(other).not.toBe(first);
        expect(factory).toHaveBeenCalledTimes(2);
        expect(factory).toHaveBeenLastCalledWith('b');
    });

    test('holds an instance the factory built as `undefined` without rebuilding it', () => {
        const factory = vi.fn(() => undefined);
        const map = keyed<string, undefined>(factory);

        expect(map.get('a')).toBeUndefined();
        expect(map.get('a')).toBeUndefined();
        expect(factory).toHaveBeenCalledTimes(1);
    });

    test('number keys are their own identities', () => {
        const map = keyed((id: number) => ({ id }));
        expect(map.get(1)).toBe(map.get(1));
        expect(map.get(1)).not.toBe(map.get(2));
    });
});

describe('peek', () => {
    test('never creates', () => {
        const factory = vi.fn((id: string) => ({ id }));
        const map = keyed(factory);

        expect(map.peek('a')).toBeUndefined();
        expect(factory).not.toHaveBeenCalled();

        const instance = map.get('a');
        expect(map.peek('a')).toBe(instance);
    });

    test('is reactive — a derivation that peeked a missing key re-runs when it appears', () => {
        const map = keyed((id: string) => ({ id }));
        const seen: (string | undefined)[] = [];
        const stop = autorun(() => {
            seen.push(map.peek('a')?.id);
        });

        expect(seen).toEqual([undefined]);
        map.get('a');
        expect(seen).toEqual([undefined, 'a']);

        // An unrelated key doesn't disturb the observer.
        map.get('b');
        expect(seen).toEqual([undefined, 'a']);
        stop();
    });
});

describe('reset', () => {
    test('drops every instance; the next get builds a fresh one', () => {
        const factory = vi.fn((id: string) => ({ id }));
        const map = keyed(factory);
        const before = map.get('a');

        map.reset();
        expect(map.peek('a')).toBeUndefined();

        const after = map.get('a');
        expect(after).not.toBe(before);
        expect(factory).toHaveBeenCalledTimes(2);
    });

    test('does not call into the instances — dropping the references is the semantics', () => {
        const dispose = vi.fn();
        const map = keyed((id: string) => ({ id, reset: dispose, dispose }));
        map.get('a');

        map.reset();
        expect(dispose).not.toHaveBeenCalled();
    });

    test('a reset is visible to a peeking derivation', () => {
        const map = keyed((id: string) => ({ id }));
        const seen: (string | undefined)[] = [];
        const stop = autorun(() => {
            seen.push(map.peek('a')?.id);
        });
        map.get('a');
        map.reset();
        expect(seen).toEqual([undefined, 'a', undefined]);
        stop();
    });
});

describe('the keyed dependent a mutation refreshes', () => {
    test('refreshes exactly the instance the call names', async () => {
        const fetches: string[] = [];
        class Store {
            members = keyed((spaceId: string) =>
                query(async () => {
                    fetches.push(spaceId);
                    return [`${spaceId}-member`];
                }),
            );

            invite = mutation(async (_spaceId: string, _email: string) => undefined, {
                refreshes: (spaceId) => [this.members.get(spaceId)],
            });
        }
        const store = new Store();

        await store.members.get('s1').prime();
        await store.members.get('s2').prime();
        expect(fetches).toEqual(['s1', 's2']);

        await store.invite('s1', 'a@example.com');
        // Refreshes are fired, not awaited — the fetch itself starts synchronously.
        await Promise.resolve();
        expect(fetches).toEqual(['s1', 's2', 's1']);
    });
});
