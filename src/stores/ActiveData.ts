import _ from 'lodash';
import { observable, makeObservable, computed } from 'mobx';
import { PartialDeep, ReadonlyDeep } from 'type-fest';
import { Expand } from '../types/generic';
import { Summon } from './Summon';

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
        return _.mergeWith({}, this.originalData, this.draft, dataMergeCustomizer) as ReadonlyDeep<T>;
    }

    @observable public draft: PartialDeep<T> = {} as any;
}

export abstract class ActiveSummonData<T extends Summon<unknown>> {
    protected constructor(summon: T) {
        makeObservable(this);
        this.summon = summon;
    }

    static create<
        TActiveDataClass extends { prototype: { __dataType: object } },
        TSummon extends Summon<TActiveDataClass['prototype']['__dataType']>
    >(
        this: TActiveDataClass,
        summon: TSummon
    ): Expand<
        Omit<TActiveDataClass['prototype'], 'data' | '__dataType'> &
            Readonly<Omit<TSummon['rawData'], keyof TActiveDataClass>>
    > {
        const instance = new (this as any)(summon);
        return extendInstance(instance, summon.rawData);
    }
    // This allows to access the type of `data` protected property without exposing it
    __dataType: T['rawData'] = null as any;

    @observable protected summon: T;

    // This filed is used in getters created by extendInstance
    @computed protected get data(): T['rawData'] {
        return _.merge({}, this.summon.rawData, this.draft, dataMergeCustomizer) as ReadonlyDeep<
            T['rawData']
        >;
    }

    @observable public draft: PartialDeep<T['__writableRawDataType']> = {} as any;
}

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
