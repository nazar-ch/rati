import _ from 'lodash';
import { makeObservable, observable, runInAction } from 'mobx';
import { createContext } from '../common/stuff';
import { Data } from './Data';

export abstract class View {
    constructor(protected globalStores: unknown, protected params: unknown) {
        makeObservable(this);
    }
    @observable.ref context: ContextType<this> | null = null;
    abstract data: Record<string, Data>;
    get dependentData(): Record<string, Data> {
        return {};
    }

    stores?: Record<string, (...args: any) => any>;

    init = async () => {
        await Promise.all(Object.values(this.data).map((item) => item.fetch({})));

        for (const key in this.data) {
            // FIXME: type
            // @ts-ignore
            if (!this.data[key].data) {
                runInAction(() => {
                    // TODO: handle as error
                    this.context = null;
                });
                return;
            }
        }

        // Get getter value once
        const dependentData = this.dependentData;
        if (dependentData) {
            await Promise.all(Object.values(dependentData).map((item) => item.fetch({})));

            for (const key in dependentData) {
                // FIXME: type
                // @ts-ignore
                if (!dependentData[key].data) {
                    runInAction(() => {
                        // TODO: handle as error
                        this.context = null;
                    });
                    return;
                }
            }
        }

        const allData = { ...this.data, ...dependentData };

        const context = await createContext(
            this.globalStores,
            _.mapValues(allData, (item) => item.data),
            this.stores ?? {},
            this.params
        );

        runInAction(() => {
            // FIXME: type
            // @ts-ignore
            this.context = context;
        });
    };
}
type ContextType<T extends View> =
    | ({ stores: unknown } & ContextDataType<T, 'data'> &
          ContextDataType<T, 'dependentData'> &
          ContextStoresType<T>)
    | null;

type ContextDataType<T extends View, DataPropName extends keyof T> = {
    [K in keyof T[DataPropName]]: NonNullable<
        T[DataPropName][K] extends { data: unknown } ? T[DataPropName][K]['data'] : never
    >;
};

type ContextStoresType<T extends View> = {
    [K in keyof T['stores']]: T['stores'][K] extends (...args: any) => any
        ? NonNullable<ReturnType<T['stores'][K]>>
        : never;
};
