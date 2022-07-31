import { smartApi, SmartApiOptions } from './smartApi';

export function smartApi_Key<
    Args extends any[],
    Result extends Record<string, unknown>,
    Key extends keyof Result
>(f: (...args: Args) => Promise<Result>, key: Key, options: SmartApiOptions = {}) {
    return smartApi(api_Key(f, key), options);
}

export function api_Key<
    Args extends any[],
    Result extends Record<string, unknown>,
    Key extends keyof Result
>(f: (...args: Args) => Promise<Result>, key: Key) {
    return async (...args: Args) => {
        const result = await f(...args);
        return result[key] as Result[Key];
    };
}

// const aaa = async ({ x }: { x: string }) => ({
//     a: 1,
//     b: 2,
// });

// const a1 = api_Key(aaa, 'a');
// const aaaa1 = a1({ x: 's' });
