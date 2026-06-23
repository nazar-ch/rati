import { observer } from 'mobx-react-lite';
import { observable, runInAction } from 'mobx';
import {
    Component,
    createContext,
    Suspense,
    use,
    useContext,
    useEffect,
    useId,
    useLayoutEffect,
    useReducer,
    useRef,
} from 'react';
import type { ComponentType, Context, ErrorInfo, FC, ReactNode } from 'react';
import {
    ParamSymbol,
    type Scope,
    type ScopeParams,
    type ScopeProps,
    type ScopeProvideDef,
} from '../common/scope';
import { isSource, toSourceError, type Source, type SourceError } from '../common/source';
import { deepEqual, is } from '../common/utils';
import { IslandHydrationContext } from './islandHydration';

/*
    EXPERIMENTAL — see docs/research/data-views.plan.md.

    An island is a self-contained unit of UI: a scope (declarative data definition)
    bundled with a component and loading/error slots. It resolves the scope at render
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
    teardown / param change. A `.provide()` value is built once the scope resolves and
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

// Flatten the scope's prevScope links into ordered levels (level 0 first).
function flattenLevels(scope: Scope): Scope['definition'][] {
    const levels: Scope['definition'][] = [];
    for (let current: Scope | undefined = scope; current; current = current.prevScope) {
        levels.unshift(current.definition);
    }
    return levels;
}

// One resolved scope cell. Props/classes/plain values resolve instantly; a function
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

// A built `.provide()` value, wrapped so "not built yet" (undefined box) stays
// distinct from a value that is itself undefined.
type BuiltProvided = { value: unknown };

/*
    One resolution attempt for a given (params, env). Holds the scope's levels and a
    lazily-built, render-stable cache of cells — so a promise handed to `use()` and a
    source handed to the reactive read keep their identity across re-renders. Cells are
    built in render as prior levels resolve (pure: no attach, no side effects beyond
    constructing the source/promise); attach and the `.provide()` build/dispose run in
    effects. Construction in render (not an effect) is what lets SSR resolve the
    promises — effects don't run on the server.
*/
class IslandResolution {
    readonly levels: Scope['definition'][];
    readonly #params: Record<string, unknown>;
    readonly #provideDef: ScopeProvideDef | undefined;
    // Server-resolved promise values to rehydrate from (scope key -> value), or
    // undefined off the hydration path. A key present here short-circuits its cell.
    readonly #hydration: Record<string, unknown> | undefined;
    // Cells cached per key (keys are unique across the whole scope).
    readonly #cells = new Map<string, Cell>();
    // Source cells in construction order, each with its detach once attached.
    readonly #sources: { source: Source<unknown>; detach: (() => void) | null }[] = [];
    // The value the island provides (`.provide()`): built once the scope resolves,
    // disposed before the sources detach. `undefined` until built / when the scope
    // declares no `.provide()`.
    readonly provided = observable.box<BuiltProvided | undefined>(undefined, { deep: false });
    #disposed = false;

    constructor(
        scope: Scope,
        params: Record<string, unknown>,
        hydration?: Record<string, unknown> | undefined
    ) {
        this.levels = flattenLevels(scope);
        this.#params = params;
        this.#provideDef = scope.provideDef;
        this.#hydration = hydration;
    }

    get hasProvide(): boolean {
        return this.#provideDef !== undefined;
    }

    // The app-owned React context (.provide({ provideTo })) to also publish into.
    get appChannel(): Context<unknown> | undefined {
        return this.#provideDef?.channel;
    }

    // Build-or-get the cell for `key`, classified from `entry` with the prior levels'
    // resolved values. Cached, so the same promise/source identity is reused across
    // renders. Reached only once every prior level is ready, so `prevValues` is stable.
    cell(key: string, entry: unknown, prevValues: Record<string, unknown>): Cell {
        let cell = this.#cells.get(key);
        if (!cell) {
            // A value dehydrated from the server short-circuits the entry: skip the
            // load function (no re-fetch) and `use()` (no re-suspend), so the client's
            // hydration render produces the server HTML synchronously. Only promise
            // entries are ever dehydrated, so this only ever replaces a would-be
            // `use()` — sources still go through classifyEntry and attach as usual.
            if (this.#hydration && key in this.#hydration) {
                cell = { kind: 'value', value: this.#hydration[key] };
            } else {
                cell = classifyEntry(entry, prevValues, this.#params, key);
                if (cell.kind === 'source') {
                    this.#sources.push({ source: cell.source, detach: null });
                }
            }
            this.#cells.set(key, cell);
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

    // Build the `.provide()` value from the fully resolved scope. Runs from an effect
    // (not render) because the factory does set-up side effects that must run once and
    // never during render / a discarded StrictMode pass.
    buildProvided(resolved: Record<string, unknown>) {
        if (!this.#provideDef || this.#disposed || this.provided.get()) return;
        const provideDef = this.#provideDef;
        runInAction(() => this.provided.set({ value: provideDef.factory(resolved) }));
    }

    teardown() {
        if (this.#disposed) return;
        this.#disposed = true;
        runInAction(() => {
            // Dispose the provided value first: its teardown (e.g. deactivate) still
            // reads through the grabbed resource the scope resolved, which the source
            // detach below then releases — so this order is load-bearing.
            const provided = this.provided.get();
            const dispose = (provided?.value as Partial<Disposable> | undefined)?.[Symbol.dispose];
            if (typeof dispose === 'function') {
                try {
                    dispose.call(provided!.value);
                } catch (error) {
                    console.error('Island provided value dispose failed', error);
                }
            }
            this.provided.set(undefined);
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

type IslandFallbackProps<View extends Scope<any>> = {
    params: ScopeParams<View>;
    retry: () => void;
};

export type IslandConfig<Env, View extends Scope<any>> = {
    /**
     * The declarative data definition, parameterized by the environment (stores,
     * api clients — anything per-root loads need). Called on every (re)resolve;
     * keep it a cheap pure function.
     */
    scope: (env: Env) => View;

    /** Composes the environment from the host app's contexts. It's a hook. */
    useEnv: () => Env;

    /** Gets clean, fully resolved props — no loading/error states inside. */
    component: ComponentType<ScopeProps<View>>;

    /**
     * Shown while the scope resolves — also the `<Suspense>` fallback for a pending
     * promise entry. Defaults to rendering nothing.
     */
    loading?: ComponentType<{ params: ScopeParams<View> }>;

    /**
     * Rendered on any failure. not-available / forbidden / failed all arrive here
     * as a `SourceError` — switch on `error.code` to distinguish them. When
     * omitted, the error is thrown during render so the nearest ErrorBoundary
     * handles it.
     */
    error?: ComponentType<IslandFallbackProps<View> & { error: SourceError }>;
};

export const IslandSymbol = Symbol();

export type IslandComponent<View extends Scope<any>> = FC<ScopeParams<View>> & {
    /** Type-level only: carries the scope type for useScope inference. */
    [IslandSymbol]?: View;
    /**
     * Forwarded from a `lazy()` component the island wraps, so the island is a
     * transparent entry point: the router's `<Link prefetch>` / `prepareRoute`
     * preload reach a route's chunk whether it is mounted as a bare component or
     * folded into an island by `route`. Absent when the component isn't lazy.
     */
    preload?: () => Promise<unknown>;
};

// ---------------------------------------------------------------------------------------

// Single value channel per island component, for useScope. Holds whatever the island
// provides — the resolved props by default, or the `.provide()` value when declared.
// The sentinel distinguishes "no provider above" from a value that is itself nullish.
const ISLAND_SCOPE_MISSING = Symbol('rati.island-scope-missing');
const islandChannels = new WeakMap<object, Context<unknown>>();
const noScopeChannel = createContext<unknown>(ISLAND_SCOPE_MISSING);

// The value a scope provides, read back off the island for useScope's return type:
// the `.provide()` value when present, else the resolved props (provide-by-default).
type ProvidedOf<View extends Scope<any>> = View extends Scope<any, infer P> ? P : never;
type ScopeProvidesOf<View extends Scope<any>> = unknown extends ProvidedOf<View>
    ? ScopeProps<View>
    : ProvidedOf<View>;

// Shared lookup for the two reader hooks: resolve the island's value channel and read
// it. Returns the raw value (possibly the MISSING sentinel) so each hook can apply its
// own absent-value policy (throw vs. undefined). Throwing on a non-island argument is
// common to both — that's a misuse, not an absent value. A hook (calls useContext), so
// both callers invoke it unconditionally.
function useRawScope(island: object, hookName: string): unknown {
    const channel = islandChannels.get(island);
    const value = useContext(channel ?? noScopeChannel);

    if (!channel) {
        throw new Error(`${hookName} expects a component created by island()`);
    }
    return value;
}

/**
 * Read the value an island provides to its subtree — the resolved props by default,
 * or the `.provide()` value when the scope declares one. The value is created and
 * (for a `.provide()` value) torn down by the island in lockstep with its sources, so
 * a store built over a grabbed resource never outlives that grab. Nearest island
 * instance wins.
 *
 * Throws when no island is above — see {@link useOptionalScope} for the non-throwing
 * form.
 */
export function useScope<View extends Scope<any>>(
    island: IslandComponent<View>
): ScopeProvidesOf<View> {
    const value = useRawScope(island, 'useScope');

    if (value === ISLAND_SCOPE_MISSING) {
        throw new Error('No scope value found. Render this component under the island.');
    }

    return value as ScopeProvidesOf<View>;
}

/**
 * Optional form of {@link useScope}: returns `undefined` instead of throwing when no
 * island is above — the component renders outside the island. For components that may
 * render either under the island or standalone. Still throws when `island` is not an
 * `island()` component (a misuse, not an absent value).
 */
export function useOptionalScope<View extends Scope<any>>(
    island: IslandComponent<View>
): ScopeProvidesOf<View> | undefined {
    const value = useRawScope(island, 'useOptionalScope');

    return value === ISLAND_SCOPE_MISSING ? undefined : (value as ScopeProvidesOf<View>);
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
    channel: Context<unknown>;
    // Server only: record a resolved promise value for dehydration (bound to this
    // island's id). Undefined off the SSR collection path.
    collect: ((key: string, value: unknown) => void) | undefined;
};

const ResolvedView = observer(function ResolvedView({
    resolution,
    component: ResolvedComponent,
    loading: Loading,
    params,
    channel,
    collect,
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
                const value = use(cell.promise);
                // Record for dehydration. A render-time write, but it only runs on the
                // server (the client provides no `collect`) and is idempotent per
                // key — the established SSR data-collection pattern.
                collect?.(key, value);
                resolved[key] = value;
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

    if (resolution.hasProvide) {
        return (
            <ProvideGate
                resolution={resolution}
                resolved={resolved}
                component={ResolvedComponent}
                loading={Loading}
                params={params}
                channel={channel}
            />
        );
    }

    // Provide-by-default: publish the resolved props to the subtree (useScope).
    return renderResolved(ResolvedComponent, resolved, resolved, channel);
});

function renderResolved(
    ResolvedComponent: ComponentType<any>,
    resolved: Record<string, unknown>,
    channelValue: unknown,
    channel: Context<unknown>
): ReactNode {
    return (
        <channel.Provider value={channelValue}>
            <ResolvedComponent {...resolved} />
        </channel.Provider>
    );
}

// The scope is fully resolved; build the `.provide()` value in an effect (its factory
// has side effects), hold the loading slot until it's built, then provide it to the
// subtree (the island channel for useScope, plus any app channel). Collection already
// happened in ResolvedView's level walk before it hands off to the gate, so the gate
// doesn't carry `collect`.
type ProvideGateProps = Omit<ResolvedViewProps, 'collect'> & { resolved: Record<string, unknown> };

const ProvideGate = observer(function ProvideGate({
    resolution,
    resolved,
    component: ResolvedComponent,
    loading: Loading,
    params,
    channel,
}: ProvideGateProps) {
    useEffect(() => {
        resolution.buildProvided(resolved);
        // Dispose is owned by the island's resolution teardown (dispose-before-detach).
    }, [resolution]);

    const built = resolution.provided.get();
    if (!built) return <Loading params={params} />;

    let content = renderResolved(ResolvedComponent, resolved, built.value, channel);
    const appChannel = resolution.appChannel;
    if (appChannel) {
        const AppProvider = appChannel.Provider;
        content = <AppProvider value={built.value}>{content}</AppProvider>;
    }
    return content;
});

export function island<Env, View extends Scope<any>>(
    config: IslandConfig<Env, View>
): IslandComponent<View> {
    const Channel = createContext<unknown>(ISLAND_SCOPE_MISSING);
    const Loading = (config.loading ?? DefaultLoading) as ComponentType<{ params: unknown }>;

    const Island = observer(function Island(params: ScopeParams<View>) {
        const env = config.useEnv();

        // Stable across server render and client hydration by tree position, so it
        // keys this island's slice of the SSR dehydration registry (see islandHydration).
        const islandId = useId();
        const hydration = useContext(IslandHydrationContext);

        // Retry rebuilds the resolution (fresh promises/sources) on error-slot retry.
        const [retry, bumpRetry] = useReducer((count: number) => count + 1, 0);

        // The resolution is built in render (pure — no attach, no side effects) so it
        // exists on the server too; attach + teardown run in the effects below. A
        // changed (env, params, retry) key rebuilds it.
        const keyRef = useRef<{ env: Env; params: unknown; retry: number } | null>(null);
        const ref = useRef<IslandResolution | null>(null);
        const initialParamsRef = useRef(params);

        const key = keyRef.current;
        if (
            !ref.current ||
            !key ||
            !shallowEqual(key.env, env) ||
            !deepEqual(key.params, params) ||
            key.retry !== retry
        ) {
            // Seed from server-resolved values only on this island's *first* resolution:
            // a retry must re-fetch, and a params change wants the new params' data, not
            // the replayed first-paint slice. StrictMode's double-invoke and the
            // post-hydration source re-render both keep (retry 0, initial params), so
            // they stay consistent with the server HTML.
            const firstResolution = retry === 0 && deepEqual(params, initialParamsRef.current);
            const hydrationSlice = firstResolution ? hydration.data?.[islandId] : undefined;
            ref.current = new IslandResolution(
                config.scope(env) as Scope,
                params as Record<string, unknown>,
                hydrationSlice
            );
            keyRef.current = { env, params, retry };
        }
        const resolution = ref.current;

        // Bound to this island's id; present only on the server (the client provides no
        // `collect`), where the level walk records each resolved promise for the wire.
        const collect = hydration.collect
            ? (k: string, value: unknown) => hydration.collect!(islandId, k, value)
            : undefined;

        // Tear down (dispose provided value, then detach sources) when the resolution
        // is replaced (param change / retry) or the island unmounts. Reset the ref on
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
                        channel={Channel}
                        collect={collect}
                    />
                </Suspense>
            </IslandErrorBoundary>
        );
    }) as IslandComponent<View>;

    const componentName =
        config.component.displayName ?? (config.component as { name?: string }).name;
    Island.displayName = `Island(${componentName || 'Component'})`;

    // Stay transparent to chunk preloading: a `lazy()` component hangs `.preload` on
    // itself; surface it on the island so the router can prefetch through the wrapper.
    const preload = (config.component as { preload?: () => Promise<unknown> }).preload;
    if (typeof preload === 'function') Island.preload = preload;

    islandChannels.set(Island, Channel);

    return Island;
}
