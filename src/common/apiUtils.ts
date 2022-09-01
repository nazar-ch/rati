import { remoteData, RemoteDataOptions } from './remoteData';

export function remoteDataKey<
    Args extends any[],
    Result extends Record<string, unknown>,
    Key extends keyof Result
>(f: (...args: Args) => Promise<Result>, key: Key, options: RemoteDataOptions = {}) {
    return remoteData(responseKey(f, key), options);
}

export function responseKey<
    Args extends any[],
    Result extends Record<string, unknown>,
    Key extends keyof Result
>(f: (...args: Args) => Promise<Result>, key: Key) {
    return async (...args: Args) => {
        const result = await f(...args);
        return result[key] as Result[Key];
    };
}
