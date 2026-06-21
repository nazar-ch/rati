import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ComponentType, Context, FC } from 'react';
import {
    ParamSymbol,
    type CreateView,
    type RequiredViewParams,
    type ResolveView,
} from '../common/view';
import { deepEqual, is } from '../common/utils';

/*
    EXPERIMENTAL — see docs/research/data-views.md.

    An island is a self-contained unit of UI: a view (declarative data
    definition) bundled with a component and loading/failure slots. The wrapper
    owns everything Page-like components currently do by hand: param diffing,
    cancellation of superseded resolves, typed failure states, and disposal of
    resolved resources.
*/

// ---------------------------------------------------------------------------------------

/**
 * Thrown by view functions to signal that the requested data does not exist
 * (vs. failed to load). Routed to the island's `notAvailable` slot.
 */
export class NotAvailableError extends Error {
    code: string | undefined;

    constructor(message = 'Not available', options?: { code?: string; cause?: unknown }) {
        super(message, { cause: options?.cause });
        this.name = 'NotAvailableError';
        this.code = options?.code;
    }
}

/** Internal: a resolve was superseded by newer params/env or an unmount. */
class ResolveCancelledError extends Error {
    constructor() {
        super('View resolve cancelled');
        this.name = 'ResolveCancelledError';
    }
}

// ---------------------------------------------------------------------------------------

/**
 * Disposes every resolved prop that opted into explicit resource management
 * (responds to `[Symbol.dispose]` with a callable) — e.g. grabbed ref-counted
 * resources. Dispose errors are reported, not rethrown: one failing resource
 * must not leak the others.
 *
 * Disposability is detected by *reading* the disposer, not by probing
 * `Symbol.dispose in value`. A resolved prop may synthesize its disposer on
 * access rather than expose it as an own/inherited key — e.g. a ref-counted
 * resource handed out behind a `Proxy` whose `Symbol.dispose` comes from the
 * `get` trap. An `in`/`has` probe wouldn't see that, so such resources used to
 * need a `has` trap added purely to satisfy this feature-detection. Treating a
 * callable get-result as the contract removes that impedance mismatch: the
 * resource implements only the standard `Disposable` get, nothing rati-specific.
 */
export function disposeViewProps(props: Record<string, unknown>) {
    for (const [key, value] of Object.entries(props)) {
        if (!is.object(value)) continue;

        const dispose = (value as Partial<Disposable>)[Symbol.dispose];
        if (typeof dispose !== 'function') continue;

        try {
            dispose.call(value);
        } catch (error) {
            console.error(`Failed to dispose view prop '${key}'`, error);
        }
    }
}

/*
    Same waterfall semantics as resolveView (levels run sequentially, props
    within a level in parallel), plus the island lifecycle contract:
    - cancellation is checked between levels and after the last one;
    - on any failure or cancellation, everything resolved so far is disposed
      before rethrowing, so partially resolved chains don't leak grabbed
      resources.
*/
async function resolveViewOwned(
    view: CreateView,
    params: Record<string, unknown>,
    isCancelled: () => boolean
): Promise<Record<string, unknown>> {
    const levels: CreateView['definition'][] = [];
    for (let current: CreateView | undefined = view; current; current = current.prevView) {
        levels.unshift(current.definition);
    }

    const resolved: Record<string, unknown> = {};

    try {
        for (const definition of levels) {
            if (isCancelled()) throw new ResolveCancelledError();

            // Functions and classes of this level get a stable snapshot of
            // everything resolved before it
            const prevProps = { ...resolved };

            const keys = Object.keys(definition);
            const values = await Promise.all(
                Object.values(definition).map((value, i) => {
                    if (is.object(value) && ParamSymbol in value) return params[keys[i]!];
                    if (is.promise(value)) return value;
                    if (is.class(value)) return new value(prevProps);
                    if (is.function(value)) return value(prevProps);
                    return value;
                })
            );

            keys.forEach((key, i) => {
                resolved[key] = values[i];
            });
        }

        if (isCancelled()) throw new ResolveCancelledError();
    } catch (error) {
        disposeViewProps(resolved);
        throw error;
    }

    return resolved;
}

// ---------------------------------------------------------------------------------------

/*
    `useEnv` typically builds a fresh object from stable services on every
    render (`() => ({ resourcesStore })`), so the environment is compared
    shallowly — a changed service identity re-resolves, a fresh wrapper object
    does not.
*/
function shallowEqual(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) return true;
    if (!is.object(a) || !is.object(b)) return false;

    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);

    return (
        aKeys.length === bKeys.length &&
        aKeys.every((key) =>
            Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
        )
    );
}

type IslandFallbackProps<View extends CreateView<any>> = {
    params: RequiredViewParams<View>;
    retry: () => void;
};

export type IslandConfig<Env, View extends CreateView<any>> = {
    /**
     * The declarative data definition, parameterized by the environment
     * (stores, api clients — anything per-root that view functions need).
     * Called on every (re)resolve; keep it a cheap pure function.
     */
    view: (env: Env) => View;

    /** Composes the environment from the host app's contexts. It's a hook. */
    useEnv: () => Env;

    /** Gets clean, fully resolved props — no loading states inside. */
    component: ComponentType<ResolveView<View>>;

    loading: ComponentType<{ params: RequiredViewParams<View> }>;

    /** Rendered when the view throws NotAvailableError. Falls back to `error`. */
    notAvailable?: ComponentType<IslandFallbackProps<View> & { error: NotAvailableError }>;

    /** Rendered on any other failure. When omitted, the error is rethrown
     * during render so the nearest ErrorBoundary handles it. */
    error?: ComponentType<IslandFallbackProps<View> & { error: unknown }>;

    /**
     * Provide the resolved props to all descendants via context — read them
     * with `useIslandProps(ThisIsland)` anywhere under the island's component
     * instead of prop drilling. Nearest island instance wins, so two islands
     * of the same kind (e.g. two panels with different pages) stay scoped.
     */
    provideContext?: boolean;
};

export const IslandSymbol = Symbol();

export type IslandComponent<View extends CreateView<any>> = FC<RequiredViewParams<View>> & {
    /** Type-level only: carries the view type for useIslandProps inference. */
    [IslandSymbol]?: View;
};

// ---------------------------------------------------------------------------------------

/*
    Island type helpers — the island-side counterparts of `ResolveView` /
    `RequiredViewParams` / `ViewComponent`. Because an island's view is an
    env→view *factory* (the `view` field of IslandConfig), reading its prop and
    param types meant deriving them by hand at the definition site:

        type View = ReturnType<typeof pageView>;
        type Props = ResolveView<View>;
        type Params = RequiredViewParams<View>;

    These collapse that to `IslandProps<typeof pageView>` /
    `IslandParams<typeof pageView>`, so the component and loading/failure slots
    type themselves straight off the factory — no manual `ReturnType` step.
*/

/** The env→view factory shape an island is configured with (`IslandConfig.view`). */
export type IslandViewFactory<View extends CreateView<any> = CreateView<any>> = (
    env: any
) => View;

/** The view a `createIsland` factory produces — the input to the view helpers. */
export type IslandViewOf<Factory extends IslandViewFactory> = ReturnType<Factory>;

/**
 * Clean, fully-resolved props an island's `component` receives — the island
 * analogue of `ResolveView`, read from the view factory.
 */
export type IslandProps<Factory extends IslandViewFactory> = ResolveView<ReturnType<Factory>>;

/**
 * The params an island accepts as props (URL/host inputs) and that its slots
 * receive as `params` — the island analogue of `RequiredViewParams`.
 */
export type IslandParams<Factory extends IslandViewFactory> = RequiredViewParams<
    ReturnType<Factory>
>;

// Resolved-props context per island component, for useIslandProps
const islandContexts = new WeakMap<object, Context<Record<string, unknown> | null>>();

// Lets useIslandProps call useContext unconditionally even for a component
// that didn't come from createIsland (it throws right after)
const noContext = createContext<Record<string, unknown> | null>(null);

export function useIslandProps<View extends CreateView<any>>(
    island: IslandComponent<View>
): ResolveView<View> {
    const context = islandContexts.get(island);
    const props = useContext(context ?? noContext);

    if (!context) {
        throw new Error('useIslandProps expects a component created by createIsland');
    }
    if (!props) {
        throw new Error(
            'No island props found in context. Render this component under the island ' +
                'and set `provideContext: true` in its config'
        );
    }

    return props as ResolveView<View>;
}

type IslandState<View extends CreateView<any>> =
    | { phase: 'loading' }
    | { phase: 'ready'; props: ResolveView<View> }
    | { phase: 'not-available'; error: NotAvailableError }
    | { phase: 'error'; error: unknown };

export function createIsland<Env, View extends CreateView<any>>(
    config: IslandConfig<Env, View>
): IslandComponent<View> {
    const PropsContext = createContext<Record<string, unknown> | null>(null);

    const Island: IslandComponent<View> = (params) => {
        const env = config.useEnv();

        const [state, setState] = useState<IslandState<View>>({ phase: 'loading' });

        // Bumped to supersede in-flight resolves (param/env change, retry, unmount)
        const generationRef = useRef(0);
        // What the latest resolve was started for; null forces a resolve
        const resolveKeyRef = useRef<{ params: unknown; env: Env } | null>(null);
        // Resolved props the island currently owns and must dispose
        const ownedPropsRef = useRef<Record<string, unknown> | null>(null);

        useEffect(() => {
            const key = resolveKeyRef.current;
            if (key && shallowEqual(key.env, env) && deepEqual(key.params, params)) return;
            resolveKeyRef.current = { params, env };

            const generation = ++generationRef.current;

            // Entering loading: the previous props may hold grabbed resources
            // for data we are navigating away from — release them now
            if (ownedPropsRef.current) {
                disposeViewProps(ownedPropsRef.current);
                ownedPropsRef.current = null;
            }
            setState((prev) => (prev.phase === 'loading' ? prev : { phase: 'loading' }));

            void (async () => {
                try {
                    const props = await resolveViewOwned(
                        config.view(env),
                        params,
                        () => generationRef.current !== generation
                    );
                    ownedPropsRef.current = props;
                    setState({ phase: 'ready', props: props as ResolveView<View> });
                } catch (error) {
                    if (error instanceof ResolveCancelledError) return;
                    if (generationRef.current !== generation) return;
                    setState(
                        error instanceof NotAvailableError
                            ? { phase: 'not-available', error }
                            : { phase: 'error', error }
                    );
                }
            })();
        });

        useEffect(
            () => () => {
                // Unmount: supersede whatever is in flight and release owned props.
                // Also reset the resolve key so a StrictMode remount resolves again.
                generationRef.current++;
                resolveKeyRef.current = null;
                if (ownedPropsRef.current) {
                    disposeViewProps(ownedPropsRef.current);
                    ownedPropsRef.current = null;
                }
            },
            []
        );

        const retry = () => {
            resolveKeyRef.current = null;
            setState({ phase: 'loading' });
        };

        if (state.phase === 'ready') {
            const Component = config.component;
            const content = <Component {...state.props} />;

            return config.provideContext ? (
                <PropsContext.Provider value={state.props as Record<string, unknown>}>
                    {content}
                </PropsContext.Provider>
            ) : (
                content
            );
        }

        if (state.phase === 'loading') {
            const Loading = config.loading;
            return <Loading params={params} />;
        }

        if (state.phase === 'not-available' && config.notAvailable) {
            const NotAvailable = config.notAvailable;
            return <NotAvailable params={params} error={state.error} retry={retry} />;
        }

        if (config.error) {
            const ErrorComponent = config.error;
            return <ErrorComponent params={params} error={state.error} retry={retry} />;
        }

        throw state.error;
    };

    const componentName =
        config.component.displayName ?? (config.component as { name?: string }).name;
    Island.displayName = `Island(${componentName || 'Component'})`;

    islandContexts.set(Island, PropsContext);

    return Island;
}
