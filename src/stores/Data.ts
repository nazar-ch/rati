import { observable, action, makeObservable, computed } from 'mobx';

/*
    TODO:
    Data may not be loaded (on errors), we can't guarantee it exists

    NOTES:

    ! reuse names & concepts from react suspense
    ? how to chain REST api calls? for graphql it’s simpler = no need to chain
    ! race conditions for requests
    ? data invalidation
    ? calculations: guess new data, get correct on server after (and maybe shared code for it)

    Кейс:
    В мене є список продуктів з частковою інформацією. Я відкриваю продукт в 
    модальному вікні, запитую всі деталі з сервера, і змінюю його статус. Як зробити 
    щоб він оновився в списку продуктів?

*/

export type DataType<T extends Data> = NonNullable<T['data']>;

export type DataFactoryType<T extends (...args: any) => Data> = DataType<ReturnType<T>>;

export class Data<T = {}, Params extends {} = {}> {
    constructor(private _fetch: (params: Params) => Promise<T>) {
        // this._data = data;
        makeObservable(this);
    }

    // NOTE: will not support multiple types of queries for on data type (e. g. query & mutate)
    private requestId = 0;

    isCurrentRequest(requestId: number) {
        return this.requestId === requestId;
    }

    @action.bound async fetch(params: Params) {
        // TODO: what if .fetch() was called again in loading state?
        // -> maybe ignore, but some places may expect in as a promise, so return the reference to the promise?
        // how will it work if it will be "awaited" in two places?

        const localRequestId = (this.requestId += 1);
        this.setLoading(true, localRequestId);
        setTimeout(() => this.showSpinner(localRequestId), this.spinnerTimeout);

        let data: T;
        try {
            data = await this._fetch(params);
            this.setData(data, localRequestId);
        } catch (error) {
            if (this.isCurrentRequest(localRequestId)) {
                throw error;
            }
        } finally {
            this.setLoading(false, localRequestId);
        }
    }

    @observable private _data: T | null = null;

    @action.bound setData(data: T | null, requestId: number) {
        if (this.isCurrentRequest(requestId)) {
            this._data = data;
        }
    }
    //_staleDate: T (do we need this??)

    spinnerTimeout = 200; // switch to { loading: true }
    staleTimeout = 1500; // switch to null on loading

    // staleCallback() {
    // }

    // error: boolean // set on failure (or use default handling with toast), unset on retry / manually

    // ? how to add an option to show errors in closable boxes inline (like for Laax shop)
    // >> ErrorBoundary

    // NOTE: maybe rename to displayIsLoading
    @computed get isLoading() {
        return this.loading && this.spinner;
    }

    @computed get data() {
        return this._data;
    }

    @observable private loading: boolean = false;
    @observable private spinner: boolean = false;
    @action.bound setLoading(loading: boolean, requestId: number) {
        if (this.isCurrentRequest(requestId)) {
            this.loading = loading;
            if (!loading) this.spinner = false;
        }
    }

    @action.bound showSpinner(requestId: number) {
        // Changed requestId means that something is loading anyway, no need to check it
        if (this.loading) {
            this.spinner = true;
        }
    }
}
