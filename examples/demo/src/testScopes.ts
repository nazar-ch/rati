import { input, scope } from 'rati';

import { sleep } from './util';

// A data-only scope: no inputs, one async load. The island resolves `xx` and
// hands it to the component as a fully-resolved input.
export const simpleTestScope = scope().load({
    xx: async () => {
        await sleep(1000);
        return 'x';
    },
});

// A small store class, built from the resolved values of the levels above it.
class SimpleTextStore {
    text: string;
    constructor(params: { productName: string; first: string }) {
        this.text = `~${params.first} ${params.productName}~`;
    }
}

// A waterfall scope: each `.load` level resolves from the levels before it, a class
// level included.
export const complexTestScope = scope({ productName: input<string>() })
    .load({
        name: async (params) => {
            await sleep(1000);
            return `product name: ${params.productName}`;
        },
    })
    .load({ first: '1' })
    .load({ xStore: SimpleTextStore });
