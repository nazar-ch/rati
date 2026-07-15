import { Fragment, Suspense, useContext, useEffect, useId, useReducer, useRef } from 'react';
import type { ComponentType, FC } from 'react';
import type { Scope, ScopeInputs, ScopeProps } from '../scope/scope';
import type { SourceError } from '../scope/source';
import { deepEqual } from '../util/utils';
import { buildTree, flattenLevels, type Bucket, type Shared } from './resolver';
import { registerScopeChannel, setScopeLabel } from './channel';
import { registerScopeControlsChannel } from './controls';
import { RefreshController, sweepDetach } from './refresh';
import { MandalaErrorBoundary } from './boundary';
import { HydrationContext } from './hydration';

/*
    The mandala — rati's core renderable unit, the shared abstraction under `island()`
    (standalone) and `route()` (URL-bound). A mandala is a *scope* (declarative data
    definition) bound to a component with loading/error slots; it resolves its own data,
    provides the resolved value to its subtree (read with `useScope`), and manages the
    sources' attach/detach + the `.provide()` value's dispose in lockstep with its own
    lifetime. See resolver.tsx for the Step-tree resolution mechanics, channel.ts for the
    value channel, hydration.tsx for SSR dehydration.

    Internal name only: callers see `island` / `route`, never "mandala".
*/

type MandalaFallbackProps<S extends Scope<any>> = {
    inputs: ScopeInputs<S>;
    retry: () => void;
};

export type MandalaConfig<S extends Scope<any>> = {
    /** The declarative data definition (a scope value). */
    scope: S;

    /** Gets clean, fully resolved props — no loading/error states inside. */
    component: ComponentType<ScopeProps<S>>;

    /**
     * Shown while the scope resolves — also the `<Suspense>` fallback for a pending
     * promise entry. Defaults to rendering nothing.
     */
    loading?: ComponentType<{ inputs: ScopeInputs<S> }>;

    /**
     * Rendered on any failure. not-available / forbidden / failed all arrive here as a
     * `SourceError` — switch on `error.code` to distinguish them. When omitted, the error
     * is thrown during render so the nearest ErrorBoundary handles it.
     */
    error?: ComponentType<MandalaFallbackProps<S> & { error: SourceError }>;
};

export type MandalaComponent<S extends Scope<any>> = FC<ScopeInputs<S>> & {
    /**
     * Forwarded from a `lazy()` component the mandala wraps, so the mandala is a
     * transparent entry point: the router's `<Link prefetch>` / `prepareRoute` preload
     * reach a route's chunk whether it is mounted as a bare component or folded into a
     * mandala by `route`. Absent when the component isn't lazy.
     */
    preload?: () => Promise<unknown>;
    /** Forwarded from the same `lazy()` component, for the same reason — see {@link lazy}. */
    moduleId?: string;
};

const DefaultLoading: FC<{ inputs: unknown }> = () => null;

/**
 * Build a mandala component from a scope + component + slots. `kindLabel` is the public
 * concept the caller represents (`Island` / `Route`) — used for the React `displayName`
 * and the scope's read-error label, so callers never see "mandala". The two public
 * wrappers (`island`, `route`) are thin calls onto this.
 */
export function createMandala<S extends Scope<any>>(
    config: MandalaConfig<S>,
    kindLabel: string,
): MandalaComponent<S> {
    // One value channel per scope identity: mandalas built from the same scope share it,
    // so a descendant reading by scope resolves the nearest one's value.
    const scopeKey = config.scope as object;
    const Channel = registerScopeChannel(scopeKey);
    const ControlsChannel = registerScopeControlsChannel(scopeKey);
    const Loading = (config.loading ?? DefaultLoading) as ComponentType<{ inputs: unknown }>;
    const levels = flattenLevels(config.scope as Scope);

    // Plain function component: source reactivity now lives in each Step's
    // useSyncExternalStore, so the mandala no longer needs to be an observer.
    const Mandala = function Mandala(inputs: ScopeInputs<S>) {
        // Stable across server render and client hydration by tree position, so it keys
        // this mandala's slice of the SSR dehydration registry (see hydration.tsx).
        const mandalaId = useId();
        const hydration = useContext(HydrationContext);

        // Retry re-mounts the inner tree (fresh promises/sources) on error-slot retry.
        const [retry, bumpRetry] = useReducer((count: number) => count + 1, 0);

        // Bump a version when inputs change by value, so the inner tree remounts — React
        // tears the old one down (children first: the `.provide()` value disposes before
        // its sources detach) and resolves the new inputs from scratch. Source transitions
        // (same inputs) re-render in place, keeping promise/source identity.
        const initialInputsRef = useRef(inputs);
        const inputsRef = useRef(inputs);
        const versionRef = useRef(0);
        if (!deepEqual(inputsRef.current, inputs)) {
            inputsRef.current = inputs;
            versionRef.current += 1;
        }
        const treeKey = `${versionRef.current}:${retry}`;

        // Seed from server-resolved values only on this mandala's *first* resolution: a
        // retry must re-fetch, and an inputs change wants the new inputs' data. The
        // post-hydration source re-render keeps (retry 0, initial inputs), consistent
        // with the server HTML.
        const firstMount = retry === 0 && deepEqual(inputs, initialInputsRef.current);
        const hydrationSlice = firstMount ? hydration.data?.[mandalaId] : undefined;
        const seedsSlice = firstMount ? hydration.seeds?.[mandalaId] : undefined;

        // Bound to this mandala's id; present only on the server (client has no `collect`),
        // where each Step records its resolved promise for the wire.
        const collect = hydration.collect
            ? (key: string, value: unknown, kind: 'value' | 'seed') =>
                  hydration.collect!(mandalaId, key, value, kind)
            : undefined;
        const collectError = hydration.collectError
            ? (key: string, error: SourceError) => hydration.collectError!(mandalaId, key, error)
            : undefined;
        const claim = hydration.claim
            ? (key: string, section: 'data' | 'seeds') => hydration.claim!(mandalaId, key, section)
            : undefined;

        // Per-level data-cell caches, rebuilt when the inner tree remounts (treeKey
        // change). Held on the mandala's committed ref so a Step's `use()` suspension
        // can't discard a half-built cell (which would re-run its load forever).
        const cacheRef = useRef<{ key: string; buckets: Bucket[] } | null>(null);
        // Buckets the line below replaced, awaiting the sweep in the commit effect. A Step
        // torn down while its bucket was still live keeps its sources attached on purpose
        // (it can't tell a source swap from an unmount — see the resolver's detach effect)
        // and defers to a sweep; but a source erroring or a mid-tree source dropping to
        // pending tears levels down with *no* remount, so without this the next generation
        // would orphan that bucket and its still-attached sources would never detach.
        const orphanedRef = useRef<Bucket[][]>([]);
        if (!cacheRef.current || cacheRef.current.key !== treeKey) {
            if (cacheRef.current) orphanedRef.current.push(cacheRef.current.buckets);
            cacheRef.current = {
                key: treeKey,
                buckets: levels.map(() => ({ cells: new Map(), sources: [], built: false })),
            };
        }

        // A bare re-render trigger (does not change treeKey), used by the effects below
        // and by the refresh controller (dirty cells / swapped values re-render in place).
        const [, forceRebuild] = useReducer((count: number) => count + 1, 0);

        // The instance's refresh controller — the value behind `useScopeControls`. Wired
        // every render so it always sees the current run's buckets; created once so the
        // channel value (and the hook's verbs) stay referentially stable.
        const controllerRef = useRef<RefreshController | null>(null);
        controllerRef.current ??= new RefreshController();
        const controller = controllerRef.current;
        controller.wire({
            levels,
            buckets: cacheRef.current.buckets,
            treeKey,
            notify: forceRebuild,
            fullRefresh: bumpRetry,
        });

        // A committed remount (inputs change / retry) tears the old cells down —
        // outstanding refresh bookkeeping settles wholesale, and the generation it replaced
        // releases whatever its Steps left attached. Off the render path on purpose: a
        // discarded render must not detach. Idempotent both ways — the ordinary remount
        // path has already detached through the Steps' own cleanups (by then the live
        // buckets are the new ones), so this finds only what those deferred.
        useEffect(() => {
            controller.treeCommitted(treeKey);
            const orphaned = orphanedRef.current;
            orphanedRef.current = [];
            for (const buckets of orphaned) sweepDetach(buckets);
        }, [controller, treeKey]);

        // Drop the cache on unmount so a StrictMode remount (mount → cleanup → mount)
        // rebuilds a fresh run instead of reusing the torn-down one's cells/sources. On
        // the remount the cache is null, so force one re-render to rebuild it into a fresh
        // run — the mandala used to get this re-render for free as a mobx `observer`; now
        // it's explicit. The subtree then reads the surviving run's identities. A real
        // (production) mount runs once with the cache non-null, so it adds no render there.
        // The sweep is the sources' unmount backstop: Step cleanups keep entries their
        // live bucket still holds (they can't tell a source swap from an unmount), so the
        // final detach of everything still attached happens here — after the leaf's
        // layout-phase dispose, preserving the dispose-before-detach order.
        useEffect(() => {
            if (cacheRef.current === null) forceRebuild();
            return () => {
                sweepDetach(cacheRef.current?.buckets);
                // An unmount racing a generation change can leave a bucket queued but
                // unswept (the effect above never ran for it).
                for (const buckets of orphanedRef.current) sweepDetach(buckets);
                orphanedRef.current = [];
                cacheRef.current = null;
            };
        }, []);

        const shared: Shared = {
            scope: config.scope as Scope,
            component: config.component as ComponentType<any>,
            channel: Channel,
            loading: Loading,
            inputs,
            buckets: cacheRef.current.buckets,
            currentBuckets: () => cacheRef.current?.buckets ?? null,
            controller: collect ? undefined : controller,
            collect,
            collectError,
            claim,
            hydration: hydrationSlice,
            seeds: seedsSlice,
        };

        return (
            <ControlsChannel.Provider value={controller}>
                <MandalaErrorBoundary
                    errorSlot={
                        config.error as
                            | ComponentType<{
                                  inputs: unknown;
                                  error: SourceError;
                                  retry: () => void;
                              }>
                            | undefined
                    }
                    inputs={inputs}
                    retry={bumpRetry}
                    resetKey={treeKey}
                >
                    <Suspense fallback={<Loading inputs={inputs} />}>
                        <Fragment key={treeKey}>{buildTree(levels, 0, inputs, shared)}</Fragment>
                    </Suspense>
                </MandalaErrorBoundary>
            </ControlsChannel.Provider>
        );
    } as MandalaComponent<S>;

    const componentName =
        config.component.displayName ?? (config.component as { name?: string }).name;
    Mandala.displayName = `${kindLabel}(${componentName || 'Component'})`;

    // Stay transparent to chunk preloading: a `lazy()` component hangs `.preload` and
    // (built through rati/vite) its `.moduleId` on itself; surface both on the mandala,
    // so the router can prefetch through the wrapper and a server render can name the
    // chunk of a route that folded its scope in.
    const lazyComponent = config.component as {
        preload?: () => Promise<unknown>;
        moduleId?: string;
    };
    if (typeof lazyComponent.preload === 'function') Mandala.preload = lazyComponent.preload;
    if (lazyComponent.moduleId !== undefined) Mandala.moduleId = lazyComponent.moduleId;

    // A readable identifier for this scope's read errors (best-effort: shared scopes keep
    // the last mandala's label).
    setScopeLabel(scopeKey, Mandala.displayName);

    return Mandala;
}
