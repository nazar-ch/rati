import _ from 'lodash';
import { observable, makeObservable, computed } from 'mobx';
import { PartialDeep } from 'type-fest';
import { Expand } from '../types/generic';
import { Summon } from './Summon';

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
    // This allows to access the type of `data` protected property without exposing it
    __dataType: T = null as any;

    @observable protected data: T;

    protected constructor(data: T) {
        makeObservable(this);
        this.data = data;
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
    @computed protected get data(): Readonly<T['rawData']> {
        return _.merge({}, this.summon.rawData, this.draft) as Readonly<T['rawData']>;
    }

    @observable public draft: PartialDeep<T['rawData']> = {} as any;

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
