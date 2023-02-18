import { FC } from 'react';
import { createView, resolveView, sleep, ViewComponent, viewParam } from 'rati';

class XClass {
    constructor(params: { whyNot: string; first: string }) {
        this.niceThing = `~${params.whyNot}~`;
    }

    niceThing;
}

const vvv = createView({
    productIdX: viewParam<number>(),
    xx: async () => 'x',
});

const vvvvv = createView(vvv, {
    first: '1',
    productId: viewParam<number>(),
    one: async (params) => {},
});

const xcxcx = vvvvv['prevView'];

const heyView = createView(vvvvv, {
    name: (async (params) => {
        await sleep(1000);
        return 'Alina';
    })(),
    whyNot: 'hey',
    productName: viewParam<string>(),
});

const xcxcx223 = heyView['prevView'];

const helloView = createView(heyView, {
    hello: async (params) => {
        await sleep(1000);
        return `[${params.productName}] hello ${params.name}`;
    },
    hey: (async () => {
        await sleep(1000);
        return 14;
    })(),
    wow: 'wow',
    xStore: XClass,
});

async function test() {
    const res = await resolveView(helloView, {
        productId: 12,
        productIdX: 123,
        productName: 'cfdds',
    });
    console.log('res>', res);
}

export const SimpleTest: FC<{}> = () => {
    return <div>simple test view</div>;
};

export const TestRouteParamsWithoutView: FC<{ productId: string }> = ({ productId }) => {
    return <div>complex test view {productId}</div>;
};

export const SimpleTestWithView: ViewComponent<typeof simpleTestView> = (props) => {
    return <div>simple test view: {props.xx}</div>;
};

export const simpleTestView = createView({
    xx: async () => 'x',
});

export const ComplexTestWithView: ViewComponent<typeof complexTestView> = (props) => {
    return (
        <div>
            complex test view: {props.productName} → {props.name} → {props.xStore.text}
        </div>
    );
};

class SimpleTextViewClass {
    constructor(params: { productName: string; first: string }) {
        this.text = `~${params.first} ${params.productName}~`;
    }

    text;
}

export const complexTestView = createView
    .chain({
        productName: viewParam<string>(),
    })
    .chain({
        name: async (params) => {
            await sleep(1000);
            return `product name: ${params.productName}`;
        },
    })
    .chain({
        first: '1',
    })
    .chain({
        xStore: SimpleTextViewClass,
    });

const rrrrrr = createView
    .chain({
        productIdX: viewParam<number>(),
        xx: async () => 'x',
    })
    .chain({
        name2: async (params) => {
            await sleep(1000);
            return 'Alina';
        },
        whyNot: 'hey',
        productName: viewParam<string>(),
    })
    .chain({
        first: '1',
        productId: viewParam<number>(),
        one: async (params) => {},
    })
    .chain({
        hello: async (params) => {
            await sleep(1000);
            return `[${params.xx}] hello ${params.productName}`;
        },
        hey: (async () => {
            await sleep(1000);
            return 14;
        })(),
        wow: 'wow',
        xStore: XClass,
    });

// const rrr = await resolveView(rrrrrr, {
//     productId: 1,
//     productIdX: 2,
//     productName: 'xx',
// });

// console.log('rrr', rrr);

// // rrrrrr.prevView.definition

// const xxx = createView.chain({
//     productIdX: viewParam<number>(),
//     xx: async () => 'x',
// });

// const zzxzxzxz = await resolveView(xxx, {
//     productIdX: 1,
// });
