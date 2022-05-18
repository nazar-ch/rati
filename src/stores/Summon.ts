import { action, makeObservable, observable, runInAction } from 'mobx';
import { ReadonlyDeep } from 'type-fest';

// TODO: optimistic updates belongs here?
export class Summon<T> {
    constructor(private fetchApi: () => Promise<T>) {
        makeObservable(this);
    }

    // Easy access to the original data type (externally exposed prop is read only)
    __writableRawDataType: T = null as any;

    async fetch() {
        const data = await this.fetchApi();
        this.setData(data);
    }

    @action setData(data: T | null) {
        this._data = data;
    }

    async refresh() {
        // TODO: should this be different from fetch?
        await this.fetch();
    }

    @observable protected _data: T | null = null;

    // Writable data for internal use
    protected get data() {
        if (!this._data) {
            throw new Error('Accessing non-loaded data');
        }
        return this._data;
    }

    // Read only property for external use
    get rawData() {
        return this.data as ReadonlyDeep<T>;
    }
}
