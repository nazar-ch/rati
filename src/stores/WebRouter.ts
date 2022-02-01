import { observable, action, makeObservable, computed, runInAction } from 'mobx';
import { Awaited } from '../types/generic';
import { FC } from 'react';
import { createBrowserHistory, Location } from 'history';
import { GlobalStore } from './GlobalStore';
import { View } from './View';

//--------------------------------------------

// Sources:
// https://twitter.com/danvdk/status/1301707026507198464
// https://ja.nsommer.dk/articles/type-checked-url-router.html#d (with validation)

export type ExtractRouteParams<T extends string> = string extends T
    ? Record<string, string>
    : T extends `${infer Start}:${infer Param}/${infer Rest}`
    ? { [k in Param | keyof ExtractRouteParams<Rest>]: string }
    : T extends `${infer Start}:${infer Param}`
    ? { [k in Param]: string }
    : {};

export type ViewComponent<T extends InstanceType<ViewStore<any>>, ExtraParams extends {} = {}> = FC<
    NonNullable<T['context']> & ExtraParams
>;

export type ViewComponentForClass<T extends ViewStore<any> | undefined> = T extends ViewStore<any>
    ? ViewComponent<InstanceType<T>>
    : // FIXME: here should be EmptyView instead of ViewStore<any>
      ViewComponent<InstanceType<ViewStore<any>>>;

export class EmptyView extends View {
    constructor(protected globalStores: unknown, params: any) {
        super(globalStores, params);
    }
    data = {};
}

export function route<
    Params extends ExtractRouteParams<Path>,
    Path extends string,
    Name extends string,
    VC extends ViewComponentForClass<VS>,
    VS extends ViewStore<Params> | undefined
>(path: Path, name: Name, component: VC, view?: VS, options?: { group?: string }) {
    // TODO: allow regexps for the path (manually type params in this case)
    const pathRe =
        path === '*' ? null : new RegExp('^' + path.replace(/:(.*?)(\/|$)/g, '(?<$1>[^/]*?)$2') + '$');

    return {
        path,
        pathRe,
        name,
        view: view ?? EmptyView,
        component,
        options: {
            group: 'default',
            // overwrite default value if defined
            ...options,
        },
    };
}

// type ViewStore = View;
interface ViewStore<T> {
    new (stores: any, params: T):
        | View
        | {
              context: Record<string, any> | null;
              init?: () => Promise<any>;
          };
}

// FIXME: maybe not any? Without { component: any } this breaks WebRouter because it's params are not
// generic enough for real routes
export type RouteType = Omit<ReturnType<typeof route>, 'component'> & { component: any };

export type RoutesType<T extends RouteType[]> = T[number];

type GetView = Awaited<ReturnType<WebRouter<RouteType[]>['getActiveRoute']>>;

type NameToRouteWrapper<K extends RouteType> = { name: K['name'] } & ExtractRouteParams<K['path']>;

export type NameToRoute<T extends RouteType[]> = NameToRouteWrapper<RoutesType<T>>;

export class WebRouter<T extends RouteType[] = RouteType[]> extends GlobalStore<{}> {
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
                // FIXME: type
                // @ts-ignore
                path = path.replace(`:${key}`, value);
            }
        }
        return path;
    }

    // TODO: make this readonly
    @observable path: string = '';

    @observable activeRoute: GetView | null = null;

    @action.bound async setPath(location: Location) {
        // console.log('>> setPath', location.pathname);÷
        this.path = location.pathname;

        const activeRoute = await this.getActiveRoute(this.path, this.stores as any);
        runInAction(() => {
            this.activeRoute = activeRoute;
        });
    }

    @action.bound redirect(to: string) {
        this.history.replace(to);
    }

    async getActiveRoute(path: string, stores: any) {
        for (const { pathRe, view, name, component, options } of this.routes) {
            let result;

            if (pathRe) {
                result = pathRe.exec(path) ?? pathRe.exec(path + '/');
            } else {
                result = {
                    groups: {},
                };
            }

            if (result) {
                const viewInstance = new view(stores, result.groups as any);
                if ('init' in viewInstance) {
                    // TODO: add .catch()
                    // FIXME: type
                    // @ts-ignore
                    viewInstance.init();
                }
                return { name, component, view: viewInstance, options };
                // return await view(result.groups as any);
            }
        }

        // TODO: "in transition" state (between await and context is ready)
    }
}
