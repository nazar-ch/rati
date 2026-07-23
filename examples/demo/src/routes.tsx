import { route, type GenericRouteType } from 'rati';
import { Index } from './Index';
import { NotFound } from './NotFound';
import {
    complexTestScope,
    ComplexTestWithScope,
    SimpleTest,
    simpleTestScope,
    SimpleTestWithScope,
    TestRouteParamsWithoutView,
} from './TestView';

declare module 'rati' {
    interface RatiUserTypes {
        routes: typeof routes;
    }
}

export const routes = [
    route('/', 'index', Index),
    route('/test', 'test', SimpleTest),
    route('/test/rpwv/:productId', 'test-route-params-without-view', TestRouteParamsWithoutView),
    route('/test/simple/', 'simple-view', SimpleTestWithScope, { scope: simpleTestScope }),
    route('/test/complex/:productName/', 'complex-view', ComplexTestWithScope, {
        scope: complexTestScope,
    }),

    route('*', '404', NotFound),
] as const satisfies GenericRouteType[];
