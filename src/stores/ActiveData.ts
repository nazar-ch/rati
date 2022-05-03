import { observable, makeObservable } from 'mobx';
import { Expand } from '../types/generic';

export abstract class ActiveData<T> {
    static create<T extends { __dataType: object } = never, U extends T['__dataType'] = T['__dataType']>(
        this: any,
        data: U
    ): Expand<Omit<T, 'data'> & Readonly<Omit<U, keyof T>>> {
        const instance = new this(data);
        for (const dataKey in data) {
            if (!(dataKey in instance)) {
                /*
                    Multiple property creation for thousands of objects
                    is not performant. It could make sense to use a proxy
                    instead and don't use this at all when a huge amount of
                    objects is needed.
                */
                Object.defineProperty(instance, dataKey, {
                    get: function () {
                        return this.data[dataKey];
                    },
                    enumerable: true,
                });
            }
        }
        // @ts-ignore
        return instance;
    }

    // This allows to access the type of `data` protected property without exposing it
    __dataType: T = null as any;

    @observable protected data: T;

    protected constructor(data: T) {
        makeObservable(this);
        this.data = data;
    }
}
