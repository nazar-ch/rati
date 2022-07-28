import _ from 'lodash';
import { makeObservable, observable, runInAction } from 'mobx';
import { FC } from 'react';
import { createContext } from '../common/stuff';
import { Expand, isNonNull } from '../types/generic';
import { ActiveDataInstanceType } from './ActiveDataInstanceType';
import { Data } from './Data';
import { Summon } from './Summon';

export abstract class View<
    TView extends View<any, any, any>,
    TParams extends Record<string, unknown> = {},
    TParentStores extends Record<string, unknown> = {}
> {
    // TODO: try to make this constructor protected. The problem is with types in GenericViewLoaderComponent
    constructor(public params: TParams, public parentStores: TParentStores) {
        makeObservable(this);
    }

    static create<TView extends View<any> = View<any>>(
        this: any,
        params: Record<string, unknown>,
        parentStores: Record<string, unknown>
    ) {
        const instance = new this(params, parentStores) as View<TView>;
        // This can't be called in the constructor because this call will happen before
        // initialization of child's properties
        instance.init();
        return instance;
    }

    declare data: Record<string, Summon<unknown>>;
    declare stores: Record<
        string,
        | { new (data: TView['data'], params: TParams, stores: TParentStores): unknown }
        | { createInView(data: TView['data'], params: TParams, stores: TParentStores): unknown }
    >;

    // FIXME: should this become null if data disappears after refresh?
    @observable.ref props: {
        data: ViewToData<TView>;
        stores: ViewStoresToStores<TView>;
        params: Record<string, unknown>;
    } | null = null;

    private init = async () => {
        // Load all data
        await Promise.all(
            Object.values(this.data)
                .filter(isNonNull)
                .map((item) => item.fetch())
        );

        const data = Object.fromEntries(
            Object.entries(this.data)
                .map(([key, summon]) => (summon?.rawData ? ([key, summon.rawData] as const) : null))
                .filter(isNonNull)
        );

        if (Object.keys(data).length < Object.keys(this.data).length) {
            throw new Error('Not all data have been loaded');
        }

        if (!this.stores) {
            // TODO: make stores optional (it's about updating the types)
            throw new Error('Please define stores for the view');
        }

        const stores = Object.fromEntries(
            Object.entries(this.stores)
                .map(([key, store]) =>
                    store
                        ? ([
                              key,
                              'createInView' in store
                                  ? store.createInView(this.data, this.params, this.parentStores)
                                  : new store(this.data as any, this.params, this.parentStores),
                          ] as const)
                        : null
                )
                .filter(isNonNull)
        );

        runInAction(() => {
            this.props = {
                data: data as any,
                stores: stores as any,
                params: this.params,
            };
        });
    };
}

type ExcludeNever<T> = {
    [K in keyof T as T[K] extends never ? never : K]: T[K];
};
type ViewToData<TView extends View<any>> = Expand<
    ExcludeNever<{
        [DataKey in keyof TView['data']]: TView['data'][DataKey] extends Summon<unknown>
            ? NonNullable<TView['data'][DataKey]['rawData']>
            : never;
    }>
>;
type ViewStoresToStores<TView extends View<any>> = Expand<
    ExcludeNever<{
        [StoreKey in keyof TView['stores']]: TView['stores'][StoreKey] extends {
            new (data: any, params: any, stores: any): unknown;
        }
            ? InstanceType<TView['stores'][StoreKey]>
            : TView['stores'][StoreKey] extends {
                  createInView(data: any, params: any, stores: any): unknown;
              }
            ? ReturnType<TView['stores'][StoreKey]['createInView']>
            : never;
    }>
>;
export type ViewComponent<
    TView extends View<any, any, any>,
    Props extends Record<string, unknown> = {}
> = FC<
    {
        data: ViewToData<TView>;
        stores: ViewStoresToStores<TView>;
    } & Props
>;
