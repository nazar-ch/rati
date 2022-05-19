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
    // Typescript infers only last generic. This structure with two parameters
    // is to force passing TActiveData instead of inferring it
    static create<
        TActiveDataClass extends { __dataType: object } = never,
        TRawData extends TActiveDataClass['__dataType'] = TActiveDataClass['__dataType']
    >(
        this: any,
        rawData: TRawData
    ): Expand<
        Omit<TActiveDataClass, 'data' | '__dataType'> & Readonly<Omit<TRawData, keyof TActiveDataClass>>
    > {
        const instance = new this(rawData);
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

    protected constructor(data: T) {
        makeObservable(this);
        this.originalData = data;
    }
}

export abstract class ActiveSummonData<T extends Summon<unknown>> {
    // Typescript infers only last generic. This structure with two parameters
    // is to force passing TActiveData instead of inferring it
    static create<
        TActiveDataClass extends { __dataType: object } = never,
        TSummon extends Summon<TActiveDataClass['__dataType']> = Summon<TActiveDataClass['__dataType']>
    >(
        this: any,
        summon: TSummon
    ): Expand<
        Omit<TActiveDataClass, 'data' | '__dataType'> &
            Readonly<Omit<TSummon['rawData'], keyof TActiveDataClass>>
    > {
        const instance = new this(summon);
        return extendInstance(instance, summon.rawData);
    }
    // This allows to access the type of `data` protected property without exposing it
    __dataType: T['rawData'] = null as any;

    @observable protected summon: T;

    // This filed is used in getters created by extendInstance
    @computed protected get data(): T['rawData'] {
        return _.merge({}, this.summon.rawData, this.draft) as T['rawData'];
    }

    @observable public draft: PartialDeep<T['__writableRawDataType']> = {} as any;

    protected constructor(summon: T) {
        makeObservable(this);
        this.summon = summon;
    }
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
