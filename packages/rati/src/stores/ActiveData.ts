import _ from 'lodash';
import { observable, makeObservable, computed, runInAction } from 'mobx';
import { PartialDeep, ReadonlyDeep } from 'type-fest';
import { Expand } from '../types/generic';

export function dataMergeCustomizer(objValue: unknown, srcValue: unknown) {
    // Don't merge arrays
    if (_.isArray(objValue)) return srcValue;

    return undefined;
}

export abstract class ActiveData<T> {
    protected constructor(data: T) {
        makeObservable(this);
        this.originalData = data;
    }

    static create<
        TActiveDataClass extends { prototype: { __dataType: object } },
        TRawData extends TActiveDataClass['prototype']['__dataType']
    >(
        this: TActiveDataClass,
        rawData: TRawData
    ): Expand<
        Omit<TActiveDataClass['prototype'], 'data' | '__dataType'> &
            Readonly<Omit<TRawData, keyof TActiveDataClass>>
    > {
        const instance = new (this as any)(rawData);
        return extendInstance(instance, rawData);
    }
    // This allows to access the type of `data` protected property without exposing the property
    __dataType: T = null as any;

    @observable public originalData: T;

    @computed protected get data(): ReadonlyDeep<T> {
        // TODO: consider replacing this with a shallow merge
        // Now { a: { a: 1, b: 2 } } + draft = { a: { b: 3 } results in { a: { a: 1, b: 2 } },
        // but { a: { b: 3 } } may be expected in this case
        return _.mergeWith(
            {},
            this.originalData,
            this.draft,
            dataMergeCustomizer
        ) as ReadonlyDeep<T>;
    }

    @observable public draft: PartialDeep<T> = {} as any;
}

type ApiFactory = () => (...args: any) => Promise<any>;

// Graphql need only one parameter, no sense to make this more universal
type ApiParams<T extends ApiFactory> = Parameters<ReturnType<T>>[0];

type ApiResult<T extends ApiFactory> = Awaited<ReturnType<ReturnType<T>>>;

/*
    [rati] api functions hold the loading state and similar things. 

    Passing it directly instead of a function that creates an api function will
    cause having the shared state between all ActiveApiData subclass instances
    (because it will be the same instance of an api function).
*/
export abstract class ActiveApiData<TConstructorApiFactory extends ApiFactory> {
    protected constructor(
        rawData: ApiResult<TConstructorApiFactory>,
        protected remoteDataLoader: ReturnType<TConstructorApiFactory>
    ) {
        makeObservable(this);
        this.rawData = rawData;
    }

    static async create<
        SActiveDataClass extends { prototype: { __dataType: object } },
        SRemoteDataFactory extends () => (
            ...args: any
        ) => Promise<SActiveDataClass['prototype']['__dataType']>
    >(
        this: SActiveDataClass,
        remoteDataFactory: SRemoteDataFactory,
        apiParams: ApiParams<SRemoteDataFactory>
    ): Promise<
        Expand<
            Omit<SActiveDataClass['prototype'], 'data' | '__dataType'> &
                Readonly<Omit<ApiResult<SRemoteDataFactory>, keyof SActiveDataClass>>
        >
    > {
        const remoteDataLoader = remoteDataFactory();

        const data = await remoteDataLoader(apiParams);

        const instance = new (this as any)(data, remoteDataLoader);
        return extendInstance(instance, data);
    }

    @observable protected rawData: ApiResult<TConstructorApiFactory>;

    // This allows to access the type of `data` protected property without exposing it
    __dataType: ApiResult<TConstructorApiFactory> = null as any;

    async reload(params: ApiParams<TConstructorApiFactory>) {
        const data = await this.remoteDataLoader(params);
        runInAction(() => {
            this.rawData = data;
        });
    }

    // This filed is used in getters created by extendInstance
    @computed protected get data(): ReadonlyDeep<ApiResult<TConstructorApiFactory>> {
        return _.mergeWith(
            {},
            this.rawData,
            this.draft,
            dataMergeCustomizer
            // @ts-expect-error FIXME
        ) as ReadonlyDeep<ClassTData>;
    }

    @observable public draft: PartialDeep<ApiResult<TConstructorApiFactory>> = {} as any;
}

// TODO: move this to type tests

// const x = async (params: { x: string; z: any[] }) => {
//     return { x: '5', y: 4 };
// };
// const xApi = () => api(x);

// export class ActiveCalendarPrices extends ActiveApiData<typeof xApi> {}

// async function xz() {
//     const xx = await ActiveCalendarPrices.create(xApi, { x: '4', z: [] });
//     xx.y;
// }

function extendInstance<T>(instance: any, data: T) {
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
                    return this['data'][dataKey];
                },
                // set: function (value: unknown) {
                //     return this['draftData']['value'];
                // },
                enumerable: true,
            });
        }
    }
    // @ts-ignore
    return instance;
}
