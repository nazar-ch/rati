import { observable, action, makeObservable, computed, runInAction } from 'mobx';
import { ComponentType, FC } from 'react';
import { createBrowserHistory, Location } from 'history';
import { GlobalStore } from './GlobalStore';
import { TupleToUnion } from '../types/generic';
import { CreateView, ViewComponent } from '../common/view';
// import { TupleToUnion } from 'type-fest';

//--------------------------------------------

// Sources:
// https://twitter.com/danvdk/status/1301707026507198464
// https://ja.nsommer.dk/articles/type-checked-url-router.html#d (with validation)

export type ExtractRouteParams<T extends string> = string extends T
    ? // This matches `string` type instead of string literals. It's not
      // possible to get the type for this case, return something generic
      Record<string, string>
    : T extends `${infer Start}:${infer Param}/${infer Rest}`
    ? { [k in Param | keyof ExtractRouteParams<Rest>]: string }
    : T extends `${infer Start}:${infer Param}`
    ? { [k in Param]: string }
    : {};

/*
export type ViewComponentForOptionalView<
    TView extends GenericView | undefined,
    TParams extends {}
> = TView extends GenericView
    ? LegacyViewComponent<TView>
    : LegacyViewComponent<EmptyView<TParams>>;


export class EmptyView<Params extends {} = {}> extends View<EmptyView<Params>, Params> {
    data = {};
    stores = {};
}

export function routeLegacy<
    Path extends string,
    Name extends string,
    ViewComponent extends ViewComponentForOptionalView<
        TView,
        { routeParams: ExtractRouteParams<Path> }
    >, // ViewComponentForClass<VS>,
    TView extends GenericView | undefined
>(
    path: Path,
    name: Name,
    component: ViewComponent,
    view?: ViewClassForView<TView, { routeParams: ExtractRouteParams<Path> }, any>, // TODO: improve any type
    wrapperComponent?: ComponentType
) {
    // TODO 2023: allow regexps for the path (manually type params in this case)
    const pathReCore = path.replace(/:(.*?)(\/|$)/g, '(?<$1>[^/]+?)$2');
    const pathReString =
        '^' +
        pathReCore +
        (pathReCore.endsWith('/')
            ? '$'
            : // Optional slash in the end (match /path & /path/)
              // TODO 2023: use redirects for this case
              '/{0,1}$');

    const pathRe = path === '*' ? null : new RegExp(pathReString);

    return {
        path,
        pathRe,
        name,
        // Empty view is used here to pass routeParams to the component
        view: view ?? EmptyView,
        component,
        wrapperComponent,
    };
}
*/

export type ViewComponentForOptionalView<
    View extends CreateView<any> | undefined,
    Params extends {}
> = View extends CreateView<any> ? ViewComponent<View> : FC<Params>;

export function route<
    Path extends string,
    Name extends string,
    TViewComponent extends ViewComponentForOptionalView<TView, ExtractRouteParams<Path>>, // ViewComponentForClass<VS>,
    TView extends CreateView<any> | undefined
>(
    path: Path,
    name: Name,
    component: TViewComponent,
    view?: TView extends CreateView<any> ? TView : undefined,
    wrapperComponent?: ComponentType
) {
    // TODO 2023: allow regexps for the path (manually type params in this case)
    const pathReCore = path.replace(/:(.*?)(\/|$)/g, '(?<$1>[^/]+?)$2');
    const pathReString =
        '^' +
        pathReCore +
        (pathReCore.endsWith('/')
            ? '$'
            : // Optional slash in the end (match /path & /path/)
              // TODO 2023: use redirects for this case
              '/{0,1}$');

    const pathRe = path === '*' ? null : new RegExp(pathReString);

    return {
        path,
        pathRe,
        name,
        // Empty view is used here to pass routeParams to the component
        view,
        component,
        wrapperComponent,
    };
}

export type GenericRouteType = {
    name: string;
    path: string;
    pathRe: RegExp | null;
    view: any;
    component: any;
    wrapperComponent?: ComponentType;
};

type RoutesType<
    T extends
        | { name: string; path: string }[]
        | readonly { readonly name: string; readonly path: string }[]
> = {
    [K in keyof T]: {
        name: T[K]['name'];
    } & ExtractRouteParams<T[K]['path']>;
};

type GetView = Awaited<ReturnType<WebRouter<GenericRouteType[]>['getActiveRoute']>>;

export type NameToRoute<T extends readonly GenericRouteType[]> = TupleToUnion<RoutesType<T>>;

export class WebRouter<
    T extends readonly GenericRouteType[] = readonly GenericRouteType[]
> extends GlobalStore<{}> {
    history;
    unlistenHistory;

    constructor(stores: any, public routes: T) {
        super(stores);
        makeObservable(this);

        const listener = ({ location }: { location: Location }) => this.setPath(location);

        this.history = createBrowserHistory();
        this.unlistenHistory = this.history.listen(listener);

        // Set path where the page is opened
        this.setPath(this.history.location);
    }

    getPath(args: NameToRoute<T>) {
        const { name, ...params } = args;
        let path: string = this.routes.find((item) => item.name === name)!.path;
        if (params) {
            for (const [key, value] of Object.entries(params)) {
                path = path.replace(`:${key}`, value as string);
            }
        }
        return path;
    }

    @computed get path() {
        return this._path;
    }

    @observable private _path: string = '';

    // Non-shallow observable breaks view class inside this property
    @observable.shallow activeRoute: GetView | null = null;

    @action.bound async setPath(location: Location) {
        // console.log('>> setPath', location.pathname);??
        this._path = location.pathname;

        const activeRoute = await this.getActiveRoute(this.path, this.stores as any);
        runInAction(() => {
            this.activeRoute = activeRoute;
        });
    }

    @action.bound redirect(to: string) {
        this.history.replace(to);
    }

    async getActiveRoute(currentPath: string, stores: any) {
        for (const { pathRe, path, view, name, component, wrapperComponent } of this.routes) {
            let result;

            if (pathRe) {
                result = pathRe.exec(currentPath);
            } else {
                result = {
                    groups: {},
                };
            }

            if (result) {
                return {
                    name,
                    component,
                    view,
                    routeParams: (result.groups as any) ?? {},
                    path,
                    wrapperComponent,
                };
            }
        }
    }
}
