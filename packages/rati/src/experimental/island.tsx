import { observer } from 'mobx-react-lite';
import { observable, reaction, runInAction } from 'mobx';
import { createContext, useContext, useEffect, useReducer, useRef } from 'react';
import type { ComponentType, Context, FC } from 'react';
import {
    ParamSymbol,
    type CreateView,
    type RequiredViewParams,
    type ResolveView,
    type ViewContextDef,
} from '../common/view';
import {
    isSource,
    promiseSource,
    readySource,
    toSource,
    type Source,
    type SourceError,
} from '../common/source';
import { deepEqual, is } from '../common/utils';

/*
    EXPERIMENTAL — see docs/research/data-views.plan.md.

    An island is a self-contained unit of UI: a chain (declarative data definition)
    bundled with a component and loading/error slots. Each resolved prop is a
    reactive *source* (`pending | ready | error`); the island observes the whole
    set, aggregates, and renders:

      - every source ready  → the main component, fed each source's value;
      - any source error    → the error slot (one slot: not-available / forbidden /
                               failed all arrive as a SourceError, switch on `code`);
      - otherwise           → the loading slot.

    States are live — a ready source may return to pending (resync), which drops the
    island back to loading (a "stale" hold is a planned next step). Lifetime is
    explicit: each source is attached when its level builds and detached on
    teardown / param change. The island owns no disposal contract — sources own
    their own teardown via the detach returned from attach().
*/

// ---------------------------------------------------------------------------------------

/*
    `useEnv` typically builds a fresh object from stable services on every render
    (`() => ({ resourcesStore })`), so the environment is compared shallowly — a
    changed service identity re-resolves, a fresh wrapper object does not.
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

// Flatten the chain's prevView links into ordered levels (level 0 first).
function flattenLevels(view: CreateView): CreateView['definition'][] {
    const levels: CreateView['definition'][] = [];
    for (let current: CreateView | undefined = view; current; current = current.prevView) {
        levels.unshift(current.definition);
    }
    return levels;
}

// Turn one definition entry into a source. Params resolve instantly; functions and
// classes get a snapshot of the prior levels' ready values; promises/sources adapt.
function entryToSource(
    entry: unknown,
    prevValues: Record<string, unknown>,
    params: Record<string, unknown>,
    key: string
): Source<unknown> {
    if (is.object(entry) && ParamSymbol in entry) return readySource(params[key]);
    if (is.promise(entry)) return promiseSource(entry);
    if (isSource(entry)) return entry;
    if (is.class(entry)) return readySource(new entry(prevValues));
    if (is.function(entry)) return toSource(entry(prevValues));
    return readySource(entry);
}

type AttachedLevel = Record<string, { source: Source<unknown>; detach: () => void }>;

// A built `.context()` value plus the teardown its `mount` returned (if any).
type BuiltContext = { value: unknown; cleanup: (() => void) | undefined };

type RunPhase =
    | { phase: 'pending' }
    | { phase: 'ready'; props: Record<string, unknown>; context?: unknown }
    | { phase: 'error'; error: SourceError };

/*
    One resolution attempt for a given (params, env). Builds the chain level by
    level: a dependent level is built lazily, only once every source in the prior
    levels is ready, so the waterfall is preserved with sources instead of awaited
    promises. The MobX reaction advances the build front as sources settle; the
    `phase` getter aggregates and is read inside the island's observer.
*/
class IslandRun {
    #levels: CreateView['definition'][];
    #params: Record<string, unknown>;
    #built = observable.array<AttachedLevel>([], { deep: false });
    #disposeProgression: () => void;
    #disposed = false;

    // Island-owned context (`.context()`): built once every level is ready and
    // disposed before the sources detach. `undefined` until built / when absent.
    #contextDef: ViewContextDef | undefined;
    #context = observable.box<BuiltContext | undefined>(undefined, { deep: false });
    #disposeContextBuild: (() => void) | undefined;

    constructor(view: CreateView, params: Record<string, unknown>) {
        this.#params = params;
        this.#levels = flattenLevels(view);
        this.#contextDef = view.contextDef;

        this.#buildLevel(0, {});

        this.#disposeProgression = reaction(
            () => this.#nextBuildableLevel(),
            (index) => {
                if (index >= 0 && !this.#disposed) this.#buildLevel(index, this.#mergedReady(index));
            },
            { fireImmediately: true }
        );

        // Build the context as soon as every level is built and ready. Kept off the
        // render path (a reaction, not the phase getter) so the factory / mount side
        // effects never run during render or double-run under StrictMode.
        if (this.#contextDef) {
            this.#disposeContextBuild = reaction(
                () => this.#built.length === this.#levels.length && this.#allReady(),
                (ready) => {
                    if (ready && !this.#disposed) this.#buildContext();
                },
                { fireImmediately: true }
            );
        }
    }

    // The app-owned React context (.context({ provideTo })) to also publish into,
    // if any. Static for the run; read in the ready branch.
    get contextChannel(): Context<unknown> | undefined {
        return this.#contextDef?.channel;
    }

    get phase(): RunPhase {
        const error = this.#firstError();
        if (error) return { phase: 'error', error };
        if (this.#built.length < this.#levels.length || !this.#allReady()) {
            return { phase: 'pending' };
        }
        // Sources are ready; if a context is declared, hold pending until it is
        // built so the subtree never observes a missing context on the first ready
        // render (the context reaction fills it in the same tick).
        const context = this.#context.get();
        if (this.#contextDef && !context) return { phase: 'pending' };
        return {
            phase: 'ready',
            props: this.#mergedReady(this.#built.length),
            context: context?.value,
        };
    }

    detach() {
        if (this.#disposed) return;
        this.#disposed = true;
        this.#disposeProgression();
        this.#disposeContextBuild?.();
        // detach() runs from the unmount effect / a rebuild, not a reaction, so
        // iterating the observable level array goes through an action to keep
        // dev-only `observableRequiresReaction` quiet.
        runInAction(() => {
            // Dispose the context first: its teardown (e.g. deactivate) still reads
            // through the grabbed resource the chain resolved, which the source
            // detach below then releases — so this order is load-bearing.
            const context = this.#context.get();
            if (context?.cleanup) {
                try {
                    context.cleanup();
                } catch (error) {
                    console.error('Island context dispose failed', error);
                }
            }
            this.#context.set(undefined);
            // Detach levels in reverse: a later level may depend on an earlier one.
            for (let i = this.#built.length - 1; i >= 0; i--) {
                for (const { detach } of Object.values(this.#built[i]!)) {
                    try {
                        detach();
                    } catch (error) {
                        console.error('Island source detach failed', error);
                    }
                }
            }
            this.#built.clear();
        });
    }

    // Build the context value from the fully resolved chain and run its mount. The
    // reads + side effects run inside an action because this fires from a reaction
    // effect (untracked), where bare observable reads would trip the dev-only
    // observableRequiresReaction warning.
    #buildContext() {
        if (!this.#contextDef || this.#context.get() || this.#disposed) return;
        const contextDef = this.#contextDef;
        runInAction(() => {
            const resolved = this.#mergedReady(this.#built.length);
            const value = contextDef.factory(resolved);
            const cleanup = contextDef.mount?.(value) ?? undefined;
            this.#context.set({ value, cleanup });
        });
    }

    // Index of the next level to build, or -1 if blocked (waiting / errored / done).
    #nextBuildableLevel(): number {
        if (this.#built.length >= this.#levels.length) return -1;
        if (this.#firstError()) return -1;
        return this.#allReady() ? this.#built.length : -1;
    }

    #buildLevel(index: number, prevValues: Record<string, unknown>) {
        // Guard against out-of-order / double builds (the reaction may refire).
        // The length read goes through an action: build runs from a React effect
        // (mount / param change), not a reaction, so a bare read trips MobX's
        // dev-only `observableRequiresReaction`. attach() stays outside any action
        // so each source's first autorun still runs synchronously.
        if (runInAction(() => this.#built.length) !== index) return;

        const definition = this.#levels[index]!;
        const level: AttachedLevel = {};
        for (const [key, entry] of Object.entries(definition)) {
            const source = entryToSource(entry, prevValues, this.#params, key);
            level[key] = { source, detach: source.attach() };
        }
        runInAction(() => this.#built.push(level));
    }

    #allReady(): boolean {
        for (const level of this.#built) {
            for (const { source } of Object.values(level)) {
                if (source.state.status !== 'ready') return false;
            }
        }
        return true;
    }

    #firstError(): SourceError | undefined {
        for (const level of this.#built) {
            for (const { source } of Object.values(level)) {
                const state = source.state;
                if (state.status === 'error') return state.error;
            }
        }
        return undefined;
    }

    // Merge the ready values of levels [0, upto).
    #mergedReady(upto: number): Record<string, unknown> {
        const props: Record<string, unknown> = {};
        for (let i = 0; i < upto && i < this.#built.length; i++) {
            for (const [key, { source }] of Object.entries(this.#built[i]!)) {
                const state = source.state;
                if (state.status === 'ready') props[key] = state.value;
            }
        }
        return props;
    }
}

// ---------------------------------------------------------------------------------------

type IslandFallbackProps<View extends CreateView<any>> = {
    params: RequiredViewParams<View>;
    retry: () => void;
};

export type IslandConfig<Env, View extends CreateView<any>> = {
    /**
     * The declarative data definition, parameterized by the environment (stores,
     * api clients — anything per-root view functions need). Called on every
     * (re)resolve; keep it a cheap pure function.
     */
    view: (env: Env) => View;

    /** Composes the environment from the host app's contexts. It's a hook. */
    useEnv: () => Env;

    /** Gets clean, fully resolved props — no loading/error states inside. */
    component: ComponentType<ResolveView<View>>;

    loading: ComponentType<{ params: RequiredViewParams<View> }>;

    /**
     * Rendered on any failure. not-available / forbidden / failed all arrive here
     * as a `SourceError` — switch on `error.code` to distinguish them. When
     * omitted, the error is thrown during render so the nearest ErrorBoundary
     * handles it.
     */
    error?: ComponentType<IslandFallbackProps<View> & { error: SourceError }>;

    /**
     * Provide the resolved props to all descendants via context — read them with
     * `useIslandProps(ThisIsland)` anywhere under the island's component instead of
     * prop drilling. Nearest island instance wins, so two islands of the same kind
     * (e.g. two panels with different pages) stay scoped.
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
    `RequiredViewParams` / `ViewComponent`. Because an island's view is an env→view
    *factory* (the `view` field of IslandConfig), reading its prop and param types
    by hand meant `ResolveView<ReturnType<typeof factory>>`. These collapse that to
    `IslandProps<typeof factory>` / `IslandParams<typeof factory>`, so the component
    and slots type themselves straight off the factory.
*/

/** The env→view factory shape an island is configured with (`IslandConfig.view`). */
export type IslandViewFactory<View extends CreateView<any> = CreateView<any>> = (
    env: any
) => View;

/** The view a `createIsland` factory produces — the input to the view helpers. */
export type IslandViewOf<Factory extends IslandViewFactory> = ReturnType<Factory>;

/**
 * Clean, fully-resolved props an island's `component` receives — the island
 * analogue of `ResolveView`, read from the view factory. Source props are already
 * unwrapped to their ready value type by `ResolveView`.
 */
export type IslandProps<Factory extends IslandViewFactory> = ResolveView<ReturnType<Factory>>;

/**
 * The params an island accepts as props (URL/host inputs) and that its slots
 * receive as `params` — the island analogue of `RequiredViewParams`.
 */
export type IslandParams<Factory extends IslandViewFactory> = RequiredViewParams<
    ReturnType<Factory>
>;

// ---------------------------------------------------------------------------------------

// Resolved-props context per island component, for useIslandProps
const islandContexts = new WeakMap<object, Context<Record<string, unknown> | null>>();

// Lets useIslandProps call useContext unconditionally even for a component that
// didn't come from createIsland (it throws right after)
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

// ---------------------------------------------------------------------------------------

// Island-owned context value (`.context()`) per island component, for
// useIslandContext. Keyed by the island component like useIslandProps; the sentinel
// distinguishes "no provider above" from a context whose value is nullish.
const ISLAND_CONTEXT_MISSING = Symbol('rati.island-context-missing');
const islandContextChannels = new WeakMap<object, Context<unknown>>();
const noIslandContext = createContext<unknown>(ISLAND_CONTEXT_MISSING);

// The context value type a view carries via `.context()` (CreateView's second
// param), read back off the island for useIslandContext's return type.
type ViewContextOf<View extends CreateView<any, any>> =
    View extends CreateView<any, infer Ctx> ? Ctx : never;

/**
 * Read the island-owned context declared by the view's `.context()` step — the
 * lifecycle-managed counterpart of `useIslandProps`. The value is created and torn
 * down by the island in lockstep with its sources (built when the chain is ready,
 * disposed before the sources detach), so a store built over a grabbed resource
 * never outlives that grab. Nearest island instance wins.
 */
export function useIslandContext<View extends CreateView<any, any>>(
    island: IslandComponent<View>
): ViewContextOf<View> {
    const channel = islandContextChannels.get(island);
    const value = useContext(channel ?? noIslandContext);

    if (!channel) {
        throw new Error('useIslandContext expects a component created by createIsland');
    }
    if (value === ISLAND_CONTEXT_MISSING) {
        throw new Error(
            'No island context found. Render this component under the island whose view ' +
                'ends in a `.context()` step.'
        );
    }

    return value as ViewContextOf<View>;
}

export function createIsland<Env, View extends CreateView<any>>(
    config: IslandConfig<Env, View>
): IslandComponent<View> {
    const PropsContext = createContext<Record<string, unknown> | null>(null);
    const ContextChannel = createContext<unknown>(ISLAND_CONTEXT_MISSING);

    const Island = observer(function Island(params: RequiredViewParams<View>) {
        const env = config.useEnv();

        // Forces a re-render after the resolve run is (re)built in an effect; once a
        // phase is read the observer re-renders on its own as sources transition.
        const [, forceRender] = useReducer((count: number) => count + 1, 0);

        // What the current run was built for; null forces a (re)build.
        const keyRef = useRef<{ params: unknown; env: Env } | null>(null);
        const runRef = useRef<IslandRun | null>(null);

        const start = () => {
            runRef.current?.detach();
            runRef.current = new IslandRun(
                config.view(env) as CreateView,
                params as Record<string, unknown>
            );
        };

        useEffect(() => {
            const key = keyRef.current;
            if (key && shallowEqual(key.env, env) && deepEqual(key.params, params)) return;
            keyRef.current = { params, env };
            start();
            forceRender();
        });

        useEffect(
            () => () => {
                // Unmount: detach the run and reset the key so a StrictMode remount
                // rebuilds.
                runRef.current?.detach();
                runRef.current = null;
                keyRef.current = null;
            },
            []
        );

        const retry = () => {
            if (!keyRef.current) return;
            start();
            forceRender();
        };

        const run = runRef.current;
        const phase: RunPhase = run ? run.phase : { phase: 'pending' };

        if (phase.phase === 'ready') {
            const Component = config.component;
            let content: React.ReactNode = <Component {...(phase.props as ResolveView<View>)} />;

            if (config.provideContext) {
                content = <PropsContext.Provider value={phase.props}>{content}</PropsContext.Provider>;
            }
            // Provide the `.context()` value (when the view declares one). A context
            // factory is expected to return a non-nullish value (a store/object).
            if (phase.context !== undefined) {
                content = <ContextChannel.Provider value={phase.context}>{content}</ContextChannel.Provider>;
                // Bridge into the app-owned context too, if `.context({ provideTo })`
                // named one — lets app code read it without importing the island.
                const appChannel = run?.contextChannel;
                if (appChannel) {
                    const AppProvider = appChannel.Provider;
                    content = <AppProvider value={phase.context}>{content}</AppProvider>;
                }
            }
            return content;
        }

        if (phase.phase === 'error') {
            if (config.error) {
                const ErrorSlot = config.error;
                return <ErrorSlot params={params} error={phase.error} retry={retry} />;
            }
            throw new Error(phase.error.message ?? phase.error.code, { cause: phase.error.cause });
        }

        const Loading = config.loading;
        return <Loading params={params} />;
    }) as IslandComponent<View>;

    const componentName =
        config.component.displayName ?? (config.component as { name?: string }).name;
    Island.displayName = `Island(${componentName || 'Component'})`;

    islandContexts.set(Island, PropsContext);
    islandContextChannels.set(Island, ContextChannel);

    return Island;
}
