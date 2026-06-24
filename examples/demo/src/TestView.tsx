import { type FC } from 'react';
import { prop, scope, type ScopeComponent, sleep, useWebRouter } from 'rati';

// A plain route component with no data of its own: it reads the router straight
// off the global stores via rati's `useWebRouter()` hook (so it never has to
// import the app's store module, which would cycle through the route list).
export const SimpleTest: FC = () => {
    const router = useWebRouter();
    return <div>simple test view - {router.path}</div>;
};

// A plain route component whose single prop is fed directly from the `:productId`
// path param — no scope, no resolution.
export const TestRouteParamsWithoutView: FC<{ productId: string }> = ({ productId }) => {
    return <div>route params, no scope: {productId}</div>;
};

// A data-only scope: no inputs, one async load. The island resolves `xx` and
// hands it to the component as a fully-resolved prop.
export const simpleTestScope = scope().load({
    xx: async () => {
        await sleep(1000);
        return 'x';
    },
});

export const SimpleTestWithScope: ScopeComponent<typeof simpleTestScope> = (props) => {
    return <div>simple scope view: {props.xx}</div>;
};

// A small store class, built from the resolved values of the levels above it.
class SimpleTextStore {
    text: string;
    constructor(params: { productName: string; first: string }) {
        this.text = `~${params.first} ${params.productName}~`;
    }
}

// A waterfall scope: a `productName` input, then an async `name` load that
// depends on it, then a plain `first` value, then a `SimpleTextStore`
// instantiated from the resolved props of the prior levels.
export const complexTestScope = scope({ productName: prop<string>() })
    .load({
        name: async (params) => {
            await sleep(1000);
            return `product name: ${params.productName}`;
        },
    })
    .load({ first: '1' })
    .load({ xStore: SimpleTextStore });

export const ComplexTestWithScope: ScopeComponent<typeof complexTestScope> = (props) => {
    return (
        <div>
            complex scope view: {props.productName} → {props.name} → {props.xStore.text}
        </div>
    );
};
