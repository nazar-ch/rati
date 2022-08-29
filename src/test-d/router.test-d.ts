import { FC } from 'react';
import { expectType, expectError } from 'tsd';
import { route, View, ViewComponent } from '../main';

let s: string = 's';
expectType<string>(s);

class EmptyView extends View<EmptyView> {
    data = {};
    stores = {};
}

class EmptyViewWithRouteParams extends View<EmptyView, { routeParams: { productId: string } }> {
    data = {};
    stores = {};
}

const TestFC: FC = () => null;

const C1: ViewComponent<EmptyView> = () => null;

// Should not provide non-existing properties
const C2: ViewComponent<EmptyView> = ({
    params: {
        // @ts-expect-error
        routeParams: { productId: string },
    },
    data: {
        // @ts-expect-error
        something: any,
    },
    stores: {
        // @ts-expect-error
        store: any,
    },
    // @ts-expect-error
    nothing: any,
}) => null;

// Should provide empty view properties
const C3: ViewComponent<EmptyView> = ({ params: {}, data: {}, stores: {} }) => null;

const FCWithRouteParams: FC<{ params: { routeParams: { productId: string } } }> = (props) => null;
const ViewComponentWithRouteParams: ViewComponent<EmptyViewWithRouteParams> = (props) => null;

// Just some correct lines
// TODO: replace with something that makes sense
route('/', 'name', TestFC);
route('/:productId', 'name', C1);
route('/:productId', 'name', C2);
route('/:productId', 'name', C3);

// Should error for routes without expected params
expectError(route('/', 'name', FCWithRouteParams));
expectError(route('/', 'name', ViewComponentWithRouteParams));
expectError(route('/', 'name', ViewComponentWithRouteParams, EmptyViewWithRouteParams));

// Should work for routes with expected params
route('/shop/:productId', 'name', FCWithRouteParams);
route('/shop/:productId', 'name', ViewComponentWithRouteParams);
route('/:productId', 'name', ViewComponentWithRouteParams, EmptyViewWithRouteParams);
