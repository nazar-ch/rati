import _ from 'lodash';
import {  observable, runInAction } from 'mobx';
import { FC } from 'react';
import { Expand, isNonNull } from '../types/generic';

type ViewData = Record<string, Promise<unknown>>;

type GenericViewStores = Record<
    string,
    | {
          new (data: any, params: any, stores: any): unknown;
      }
    | { createInView(data: any, params: any, stores: any): unknown }
>;

export type GenericView = {
    data: ViewData;
    stores: GenericViewStores;
    params: Record<string, unknown>;
    // TODO: expand with a few more fields to make sure that only proper views will be passed as GenericView
};

export abstract class View<
    TView extends GenericView,
    TParams extends Record<string, unknown> = {},
    TParentStores extends Record<string, unknown> = {}
> implements GenericView
{
    // TODO: try to make this constructor protected. The problem is with types in GenericViewLoaderComponent
    constructor(public params: TParams, public parentStores: TParentStores) {
    }

    static create<TView extends GenericView = GenericView>(
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

    declare data: ViewData;
    declare stores: Record<
        string,
        | {
              new (
                  data: ViewDataToData<TView['data']>,
                  params: TParams,
                  stores: TParentStores
              ): unknown;
          }
        | {
              createInView(
                  data: ViewDataToData<TView['data']>,
                  params: TParams,
                  stores: TParentStores
              ): unknown;
          }
    >;

    // FIXME: should this become null if data disappears after refresh?
    @observable.ref accessor props: {
        data: ViewDataToData<TView['data']>;
        stores: ViewStoresToStores<TView['stores']>;
        params: Record<string, unknown>;
    } | null = null;

    private init = async () => {
        // Load all data
        await Promise.all(Object.values(this.data).filter(isNonNull));

        for (const key in this.data) {
            // Promises are executed in the previous step
            // @ts-ignore
            this.data[key] = await Promise.resolve(this.data[key]);

            if (!this.data[key]) {
                throw new Error('Not all data have been loaded');
            }
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
                                  ? store.createInView(
                                        this.data as any,
                                        this.params,
                                        this.parentStores
                                    )
                                  : new store(this.data as any, this.params, this.parentStores),
                          ] as const)
                        : null
                )
                .filter(isNonNull)
        );

        runInAction(() => {
            this.props = {
                data: this.data as any,
                stores: stores as any,
                params: this.params,
            };
        });
    };
}

type ExcludeNever<T> = {
    [K in keyof T as T[K] extends never ? never : K]: T[K];
};

type ViewDataToData<TData extends ViewData> = Expand<
    ExcludeNever<{
        [DataKey in keyof TData]: Awaited<TData[DataKey]>;
    }>
>;

type ViewStoresToStores<TStores extends GenericViewStores> = Expand<
    ExcludeNever<{
        [StoreKey in keyof TStores]: TStores[StoreKey] extends {
            new (data: any, params: any, stores: any): unknown;
        }
            ? InstanceType<TStores[StoreKey]>
            : TStores[StoreKey] extends {
                  createInView(data: any, params: any, stores: any): unknown;
              }
            ? ReturnType<TStores[StoreKey]['createInView']>
            : never;
    }>
>;
export type LegacyViewComponent<
    TView extends GenericView,
    Props extends Record<string, unknown> = {}
> = FC<
    {
        data: ViewDataToData<TView['data']>;
        stores: ViewStoresToStores<TView['stores']>;
        params: TView['params'];
    } & Props
>;

export type ViewDataType<TView extends GenericView> = ViewDataToData<TView['data']>;
export type ViewClassForView<TView, TParams, TParentStores> = {
    new (params: TParams, parentStores: TParentStores): TView;
    create(...arg: any[]): any;
};
