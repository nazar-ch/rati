import { observer } from 'mobx-react-lite';
import { observable, runInAction } from 'mobx';
import {
    Component,
    createContext,
    Suspense,
    use,
    useContext,
    useEffect,
    useLayoutEffect,
    useReducer,
    useRef,
} from 'react';
import type { ComponentType, Context, ErrorInfo, FC, ReactNode } from 'react';
import {
    ParamSymbol,
    type CreateView,
    type RequiredViewParams,
    type ResolveView,
    type ViewContextDef,
} from '../common/view';
import { isSource, toSourceError, type Source, type SourceError } from '../common/source';
import { deepEqual, is } from '../common/utils';

/*
    EXPERIMENTAL — see docs/research/data-views.plan.md.

    An island is a self-contained unit of UI: a chain (declarative data definition)
    bundled with a component and loading/error slots. It resolves the chain at render
    time, level by level, and renders:

      - every entry ready  → the main component, fed each entry's value;
      - any entry errored  → the error slot (one slot: not-available / forbidden /
                             failed all arrive as a SourceError, switch on `code`);
      - otherwise          → the loading slot.

    Resolution runs on React mechanics so it works under SSR:

      - a *promise* entry is unwrapped with `use()` — it suspends while pending (the
        Suspense fallback is the loading slot) and a Suspense-aware server render
        (react-dom/static `prerender`) awaits it. Rejections throw to the island's
        ErrorBoundary → the error slot.
      - a *source* entry (a reactive `pending | ready | error` state machine) is read
        observably; pending renders the loading slot (no server resolution — sources
        stay pending under SSR and resolve on the client), error throws to the slot.
        A ready source returning to pending drops back to loading, live.

    Lifetime is explicit: each source attaches when its level builds and detaches on
    teardown / param change. A `.context()` value is built once the chain resolves and
    disposed on teardown *before* the sources it was built over detach.
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

// One resolved chain cell. Params/classes/plain values resolve instantly; a function
// is called with the prior levels' ready values and its result re-classified; a
// promise is unwrapped with `use()`; a source is read observably.
type Cell =
    | { kind: 'value'; value: unknown }
    | { kind: 'promise'; promise: Promise<unknown> }
    | { kind: 'source'; source: Source<unknown> };

function classifyEntry(
    entry: unknown,
    prevValues: Record<string, unknown>,
    params: Record<string, unknown>,
    key: string
): Cell {
    if (is.object(entry) && ParamSymbol in entry) return { kind: 'value', value: params[key] };
    if (is.promise(entry)) return { kind: 'promise', promise: entry };
    if (isSource(entry)) return { kind: 'source', source: entry };
    if (is.class(entry)) return { kind: 'value', value: new entry(prevValues) };
    if (is.function(entry)) {
        const result = entry(prevValues);
        if (is.promise(result)) return { kind: 'promise', promise: result };
        if (isSource(result)) return { kind: 'source', source: result };
        return { kind: 'value', value: result };
    }
    return { kind: 'value', value: entry };
}

// A built `.context()` value, wrapped so "not built yet" (undefined box) stays
// distinct from a value that is itself undefined.
type BuiltContext = { value: unknown };

/*
    One resolution attempt for a given (params, env). Holds the chain's levels and a
    lazily-built, render-stable cache of cells — so a promise handed to `use()` and a
    source handed to the reactive read keep their identity across re-renders. Cells are
    built in render as prior levels resolve (pure: no attach, no side effects beyond
    constructing the source/promise); attach and the `.context()` build/dispose run in
    effects. Construction in render (not an effect) is what lets SSR resolve the
    promises — effects don't run on the server.
*/
class IslandResolution {
    readonly levels: CreateView['definition'][];
    readonly #params: Record<string, unknown>;
    readonly #contextDef: ViewContextDef | undefined;
    // Cells cached per key (keys are unique across the whole chain).
    readonly #cells = new Map<string, Cell>();
    // Source cells in construction order, each with its detach once attached.
    readonly #sources: { source: Source<unknown>; detach: (() => void) | null }[] = [];
    // Island-owned context (`.context()`): built once the chain resolves, disposed
    // before the sources detach. `undefined` until built / when the view has none.
    readonly context = observable.box<BuiltContext | undefined>(undefined, { deep: false });
    #disposed = false;

    constructor(view: CreateView, params: Record<string, unknown>) {
        this.levels = flattenLevels(view);
        this.#params = params;
        this.#contextDef = view.contextDef;
    }

    get hasContext(): boolean {
        return this.#contextDef !== undefined;
    }

    // The app-owned React context (.context({ provideTo })) to also publish into.
    get appChannel(): Context<unknown> | undefined {
        return this.#contextDef?.channel;
    }

    // Build-or-get the cell for `key`, classified from `entry` with the prior levels'
    // resolved values. Cached, so the same promise/source identity is reused across
    // renders. Reached only once every prior level is ready, so `prevValues` is stable.
    cell(key: string, entry: unknown, prevValues: Record<string, unknown>): Cell {
        let cell = this.#cells.get(key);
        if (!cell) {
            cell = classifyEntry(entry, prevValues, this.#params, key);
            this.#cells.set(key, cell);
            if (cell.kind === 'source') this.#sources.push({ source: cell.source, detach: null });
        }
        return cell;
    }

    // Attach any not-yet-attached sources. Runs from a layout effect after each commit,
    // so a source built in render is attached as soon as its level renders.
    attachPending() {
        if (this.#disposed) return;
        for (const entry of this.#sources) {
            if (!entry.detach) entry.detach = entry.source.attach();
        }
    }

    // Build the `.context()` value from the fully resolved chain. Runs from an effect
    // (not render) because the factory does set-up side effects that must run once and
    // never during render / a discarded StrictMode pass.
    buildContext(resolved: Record<string, unknown>) {
        if (!this.#contextDef || this.#disposed || this.context.get()) return;
        const contextDef = this.#contextDef;
        runInAction(() => this.context.set({ value: contextDef.factory(resolved) }));
    }

    teardown() {
        if (this.#disposed) return;
        this.#disposed = true;
        runInAction(() => {
            // Dispose the context first: its teardown (e.g. deactivate) still reads
            // through the grabbed resource the chain resolved, which the source detach
            // below then releases — so this order is load-bearing.
            const context = this.context.get();
            const dispose = (context?.value as Partial<Disposable> | undefined)?.[Symbol.dispose];
            if (typeof dispose === 'function') {
                try {
                    dispose.call(context!.value);
                } catch (error) {
                    console.error('Island context dispose failed', error);
                }
            }
            this.context.set(undefined);
            // Detach in reverse: a later level may depend on an earlier one.
            for (let i = this.#sources.length - 1; i >= 0; i--) {
                const entry = this.#sources[i]!;
                if (entry.detach) {
                    try {
                        entry.detach();
                    } catch (error) {
                        console.error('Island source detach failed', error);
                    }
                    entry.detach = null;
                }
            }
        });
    }
}

function asSourceError(thrown: unknown): SourceError {
    // A source error is already a SourceError (plain object with a string `code`); a
    // promise rejection is a raw Error / value — map it through toSourceError.
    if (
        is.object(thrown) &&
        !(thrown instanceof Error) &&
        typeof (thrown as { code?: unknown }).code === 'string'
    ) {
        return thrown as SourceError;
    }
    return toSourceError(thrown);
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

    /**
     * Shown while the chain resolves — also the `<Suspense>` fallback for a pending
     * promise entry. Defaults to rendering nothing.
     */
    loading?: ComponentType<{ params: RequiredViewParams<View> }>;

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
export type IslandViewFactory<View extends CreateView<any> = CreateView<any>> = (env: any) => View;

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

// Shared lookup for the two reader hooks: resolve the island's context channel and
// read it. Returns the raw value (possibly the MISSING sentinel) so each hook can
// apply its own absent-value policy (throw vs. undefined). Throwing on a non-island
// argument is common to both — that's a misuse, not an absent value. A hook (calls
// useContext), so both callers invoke it unconditionally.
function useRawIslandContext(island: object, hookName: string): unknown {
    const channel = islandContextChannels.get(island);
    const value = useContext(channel ?? noIslandContext);

    if (!channel) {
        throw new Error(`${hookName} expects a component created by createIsland`);
    }
    return value;
}

/**
 * Read the island-owned context declared by the view's `.context()` step — the
 * lifecycle-managed counterpart of `useIslandProps`. The value is created and torn
 * down by the island in lockstep with its sources (built when the chain is ready,
 * disposed before the sources detach), so a store built over a grabbed resource
 * never outlives that grab. Nearest island instance wins.
 *
 * Throws when no context value is above — see {@link useOptionalIslandContext} for
 * the non-throwing form.
 */
export function useIslandContext<View extends CreateView<any, any>>(
    island: IslandComponent<View>
): ViewContextOf<View> {
    const value = useRawIslandContext(island, 'useIslandContext');

    if (value === ISLAND_CONTEXT_MISSING) {
        throw new Error(
            'No island context found. Render this component under the island whose view ' +
                'ends in a `.context()` step.'
        );
    }

    return value as ViewContextOf<View>;
}

/**
 * Optional form of {@link useIslandContext}: returns `undefined` instead of
 * throwing when no context value is above — the component renders outside the
 * island, or its view declares no `.context()` step. For components that may render
 * either under the island or standalone. Still throws when `island` is not a
 * `createIsland` component (a misuse, not an absent value).
 */
export function useOptionalIslandContext<View extends CreateView<any, any>>(
    island: IslandComponent<View>
): ViewContextOf<View> | undefined {
    const value = useRawIslandContext(island, 'useOptionalIslandContext');

    return value === ISLAND_CONTEXT_MISSING ? undefined : (value as ViewContextOf<View>);
}

// ---------------------------------------------------------------------------------------

const DefaultLoading: FC<{ params: unknown }> = () => null;

// Catches a rejected promise (`use()`) or a thrown source error and renders the
// island's error slot — or rethrows to the nearest outer boundary when there's no
// slot. `resetKey` (the live resolution) clears the error on retry / param change.
type ErrorBoundaryProps = {
    errorSlot:
        | ComponentType<{ params: unknown; error: SourceError; retry: () => void }>
        | undefined;
    params: unknown;
    retry: () => void;
    resetKey: unknown;
    children: ReactNode;
};

class IslandErrorBoundary extends Component<ErrorBoundaryProps, { error: unknown }> {
    override state: { error: unknown } = { error: null };

    static getDerivedStateFromError(error: unknown) {
        return { error: error ?? new Error('Island error') };
    }

    override componentDidUpdate(prev: ErrorBoundaryProps) {
        // A new resolution (retry or param change) clears the caught error so the
        // fresh attempt renders.
        if (prev.resetKey !== this.props.resetKey && this.state.error !== null) {
            this.setState({ error: null });
        }
    }

    override componentDidCatch(_error: unknown, _info: ErrorInfo) {
        // Swallowed: the error is surfaced through the slot (or rethrown in render).
    }

    override render() {
        if (this.state.error !== null) {
            const { errorSlot: ErrorSlot, params, retry } = this.props;
            if (!ErrorSlot) {
                // No slot — propagate to the nearest outer ErrorBoundary.
                throw this.state.error;
            }
            return (
                <ErrorSlot params={params} error={asSourceError(this.state.error)} retry={retry} />
            );
        }
        return this.props.children;
    }
}

// Walks the resolution at render time: `use()` for promises (suspends → the Suspense
// fallback), reactive read for sources (pending → the loading slot), values inline.
// An observer so a source transition re-renders. Attaches sources from a layout
// effect after each commit (a source built in render attaches as its level renders).
type ResolvedViewProps = {
    resolution: IslandResolution;
    component: ComponentType<any>;
    loading: ComponentType<{ params: unknown }>;
    params: unknown;
    provideContext: boolean;
    propsContext: Context<Record<string, unknown> | null>;
    islandChannel: Context<unknown>;
};

const ResolvedView = observer(function ResolvedView({
    resolution,
    component: ResolvedComponent,
    loading: Loading,
    params,
    provideContext,
    propsContext,
    islandChannel,
}: ResolvedViewProps) {
    useLayoutEffect(() => {
        resolution.attachPending();
    });

    const resolved: Record<string, unknown> = {};
    for (const level of resolution.levels) {
        for (const key of Object.keys(level)) {
            const cell = resolution.cell(key, level[key], resolved);
            if (cell.kind === 'promise') {
                // `use()` is the one hook allowed in a loop / after an early return,
                // so the level walk can suspend per promise.
                resolved[key] = use(cell.promise);
            } else if (cell.kind === 'source') {
                const state = cell.source.state;
                if (state.status === 'error') throw state.error;
                if (state.status === 'pending') return <Loading params={params} />;
                resolved[key] = state.value;
            } else {
                resolved[key] = cell.value;
            }
        }
    }

    if (resolution.hasContext) {
        return (
            <ContextGate
                resolution={resolution}
                resolved={resolved}
                component={ResolvedComponent}
                loading={Loading}
                params={params}
                provideContext={provideContext}
                propsContext={propsContext}
                islandChannel={islandChannel}
            />
        );
    }

    return renderResolved(ResolvedComponent, resolved, provideContext, propsContext);
});

function renderResolved(
    ResolvedComponent: ComponentType<any>,
    resolved: Record<string, unknown>,
    provideContext: boolean,
    propsContext: Context<Record<string, unknown> | null>
): ReactNode {
    let content: ReactNode = <ResolvedComponent {...resolved} />;
    if (provideContext) {
        content = <propsContext.Provider value={resolved}>{content}</propsContext.Provider>;
    }
    return content;
}

// The chain is fully resolved; build the `.context()` value in an effect (its
// factory has side effects), hold the loading slot until it's built, then provide it
// to the subtree (the island channel for useIslandContext, plus any app channel).
type ContextGateProps = ResolvedViewProps & { resolved: Record<string, unknown> };

const ContextGate = observer(function ContextGate({
    resolution,
    resolved,
    component: ResolvedComponent,
    loading: Loading,
    params,
    provideContext,
    propsContext,
    islandChannel,
}: ContextGateProps) {
    useEffect(() => {
        resolution.buildContext(resolved);
        // Dispose is owned by the island's resolution teardown (dispose-before-detach).
    }, [resolution]);

    const built = resolution.context.get();
    if (!built) return <Loading params={params} />;

    let content = renderResolved(ResolvedComponent, resolved, provideContext, propsContext);
    content = <islandChannel.Provider value={built.value}>{content}</islandChannel.Provider>;
    const appChannel = resolution.appChannel;
    if (appChannel) {
        const AppProvider = appChannel.Provider;
        content = <AppProvider value={built.value}>{content}</AppProvider>;
    }
    return content;
});

export function createIsland<Env, View extends CreateView<any>>(
    config: IslandConfig<Env, View>
): IslandComponent<View> {
    const PropsContext = createContext<Record<string, unknown> | null>(null);
    const ContextChannel = createContext<unknown>(ISLAND_CONTEXT_MISSING);
    const Loading = (config.loading ?? DefaultLoading) as ComponentType<{ params: unknown }>;

    const Island = observer(function Island(params: RequiredViewParams<View>) {
        const env = config.useEnv();

        // Retry rebuilds the resolution (fresh promises/sources) on error-slot retry.
        const [retry, bumpRetry] = useReducer((count: number) => count + 1, 0);

        // The resolution is built in render (pure — no attach, no side effects) so it
        // exists on the server too; attach + teardown run in the effects below. A
        // changed (env, params, retry) key rebuilds it.
        const keyRef = useRef<{ env: Env; params: unknown; retry: number } | null>(null);
        const ref = useRef<IslandResolution | null>(null);

        const key = keyRef.current;
        if (
            !ref.current ||
            !key ||
            !shallowEqual(key.env, env) ||
            !deepEqual(key.params, params) ||
            key.retry !== retry
        ) {
            ref.current = new IslandResolution(
                config.view(env) as CreateView,
                params as Record<string, unknown>
            );
            keyRef.current = { env, params, retry };
        }
        const resolution = ref.current;

        // Tear down (dispose context, then detach sources) when the resolution is
        // replaced (param change / retry) or the island unmounts. Reset the ref on
        // unmount so a StrictMode remount rebuilds a fresh resolution.
        useEffect(() => {
            return () => {
                resolution.teardown();
                if (ref.current === resolution) {
                    ref.current = null;
                    keyRef.current = null;
                }
            };
        }, [resolution]);

        return (
            <IslandErrorBoundary
                errorSlot={
                    config.error as
                        | ComponentType<{ params: unknown; error: SourceError; retry: () => void }>
                        | undefined
                }
                params={params}
                retry={bumpRetry}
                resetKey={resolution}
            >
                <Suspense fallback={<Loading params={params} />}>
                    <ResolvedView
                        resolution={resolution}
                        component={config.component}
                        loading={Loading}
                        params={params}
                        provideContext={config.provideContext ?? false}
                        propsContext={PropsContext}
                        islandChannel={ContextChannel}
                    />
                </Suspense>
            </IslandErrorBoundary>
        );
    }) as IslandComponent<View>;

    const componentName =
        config.component.displayName ?? (config.component as { name?: string }).name;
    Island.displayName = `Island(${componentName || 'Component'})`;

    islandContexts.set(Island, PropsContext);
    islandContextChannels.set(Island, ContextChannel);

    return Island;
}
