import { route } from 'rati';
import { FC } from 'react';
import { Index } from './Index';
import {
    complexTestView,
    ComplexTestWithView,
    SimpleTest,
    simpleTestView,
    SimpleTestWithView,
    TestRouteParamsWithoutView,
} from './TestView';

const NotFound: FC = () => {
    return <div>- Not found -</div>;
};

export const routes = [
    route('/', 'index', Index),
    route('/test', 'test', SimpleTest),
    route('/test/rpwv/:productId', 'test-route-params-without-view', TestRouteParamsWithoutView),
    route('/test/simple/', 'simple-view', SimpleTestWithView, simpleTestView),
    route('/test/complex/:productName/', 'complex-view', ComplexTestWithView, complexTestView),

    route('*', '404', NotFound),
] as const;
