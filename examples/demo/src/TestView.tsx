import { type FC } from 'react';

import { type ScopeComponent, useRouter } from 'rati';

import type { complexTestScope, simpleTestScope } from './testScopes';

// A plain route component with no data of its own: it reads the router through
// rati's `useRouter()` hook (so it never has to import the router module, which
// would cycle through the route list).
export const SimpleTest: FC = () => {
    const router = useRouter();
    return <div>simple test view - {router.path}</div>;
};

// A plain route component whose single input is fed directly from the `:productId`
// path param — no scope, no resolution.
export const TestRouteParamsWithoutView: FC<{ productId: string }> = ({ productId }) => {
    return <div>route params, no scope: {productId}</div>;
};

export const SimpleTestWithScope: ScopeComponent<typeof simpleTestScope> = (props) => {
    return <div>simple scope view: {props.xx}</div>;
};

export const ComplexTestWithScope: ScopeComponent<typeof complexTestScope> = (props) => {
    return (
        <div>
            complex scope view: {props.productName} → {props.name} → {props.xStore.text}
        </div>
    );
};
