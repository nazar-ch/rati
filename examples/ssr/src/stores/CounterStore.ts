import { makeAutoObservable } from 'mobx';

/**
 * A plain MobX store, resolved as a class load — `scope().load({ counter: CounterStore })`.
 * The island builds a fresh instance whenever it mounts; it SSRs at its initial state and
 * turns interactive after hydration.
 */
export class CounterStore {
    count = 0;

    constructor() {
        makeAutoObservable(this);
    }

    increment() {
        this.count += 1;
    }

    decrement() {
        this.count -= 1;
    }

    reset() {
        this.count = 0;
    }
}
