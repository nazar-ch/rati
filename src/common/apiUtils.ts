import { api, ApiOptions } from './apiWrapper';

export function apiGetKey<Args extends any[], R extends Record<string, unknown>, Key extends keyof R>(
    f: (...args: Args) => Promise<R>,
    key: Key,
    options: ApiOptions = {}
) {
    const mF = async (...args: Args) => {
        const result = await f(...args);
        return result[key] as R[Key];
    };

    return api(mF, options);
}
