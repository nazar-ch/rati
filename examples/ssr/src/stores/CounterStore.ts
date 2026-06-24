import { makeAutoObservable } from 'mobx';

/**
 * A plain MobX store, resolved as a *class load* — `scope().load({ counter:
 * CounterStore })`. The island instantiates it from the resolved-so-far props and
 * hands the instance to the component, which reads and mutates it as an `observer`.
 * It SSRs at its initial state (count 0) and becomes interactive after hydration;
 * a fresh instance is built whenever the island mounts.
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
