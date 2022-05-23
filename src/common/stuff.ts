export function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function createContext<T>(
    stores: T,
    data: Record<string, unknown>,
    contextStores: Record<string, { (context: any): any }>,
    routeParams?: unknown
) {
    const context = {
        stores,
        routeParams,
    } as Record<string, any>;

    // Set data first
    for (const key in data) {
        context[key] = data[key];
    }

    // Init stores when we have expected data
    for (const key in contextStores) {
        const item = contextStores[key];
        // FIXME: type
        // @ts-ignore
        context[key] = item(context);

        // TODO: call context[key].init() to rehydrate stores // possible in another loop
        // when all stores are in the context
    }

    return context;
}
