import { route, type GenericRouteType } from 'rati';
import { Index } from './Index';
import {
    complexTestView,
    ComplexTestWithView,
    SimpleTest,
    simpleTestView,
    SimpleTestWithView,
    TestRouteParamsWithoutView,
} from './TestView';

declare module 'rati' {
    interface RatiUserTypes {
        routes: typeof routes;
    }
}

const NotFound = () => {
    return <div>- Not found -</div>;
};

export const routes = [
    route('/', 'index', Index),
    route('/test', 'test', SimpleTest),
    route('/test/rpwv/:productId', 'test-route-params-without-view', TestRouteParamsWithoutView),
    route('/test/simple/', 'simple-view', SimpleTestWithView, simpleTestView),
    route('/test/complex/:productName/', 'complex-view', ComplexTestWithView, complexTestView),

    route('*', '404', NotFound),
] as const satisfies GenericRouteType[];
