import { action, makeObservable, observable, runInAction } from 'mobx';

// TODO: optimistic updates belongs here?
export class Summon<T> {
    constructor(private fetchApi: () => Promise<T>) {
        makeObservable(this);
    }

    async fetch() {
        const data = await this.fetchApi();
        this.setData(data);
    }

    @action setData(data: T | null) {
        this._rawData = data;
    }

    async refresh() {
        // TODO: should this be different from fetch?
        await this.fetch();
    }

    @observable protected _rawData: T | null = null;

    get rawData() {
        if (!this._rawData) {
            throw new Error('Accessing non-loaded data');
        }
        return this._rawData;
    }
}
