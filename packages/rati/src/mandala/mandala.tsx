import { observer } from 'mobx-react-lite';
import { Fragment, Suspense, useContext, useEffect, useId, useReducer, useRef } from 'react';
import type { ComponentType, FC } from 'react';
import type { Scope, ScopeParams, ScopeProps } from '../common/scope';
import type { SourceError } from '../common/source';
import { deepEqual } from '../common/utils';
import { buildTree, flattenLevels, type Bucket, type Shared } from './resolver';
import { registerScopeChannel, setScopeLabel } from './channel';
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
    params: ScopeParams<S>;
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
    loading?: ComponentType<{ params: ScopeParams<S> }>;

    /**
     * Rendered on any failure. not-available / forbidden / failed all arrive here as a
     * `SourceError` — switch on `error.code` to distinguish them. When omitted, the error
     * is thrown during render so the nearest ErrorBoundary handles it.
     */
    error?: ComponentType<MandalaFallbackProps<S> & { error: SourceError }>;
};

export type MandalaComponent<S extends Scope<any>> = FC<ScopeParams<S>> & {
    /**
     * Forwarded from a `lazy()` component the mandala wraps, so the mandala is a
     * transparent entry point: the router's `<Link prefetch>` / `prepareRoute` preload
     * reach a route's chunk whether it is mounted as a bare component or folded into a
     * mandala by `route`. Absent when the component isn't lazy.
     */
    preload?: () => Promise<unknown>;
};

const DefaultLoading: FC<{ params: unknown }> = () => null;

/**
 * Build a mandala component from a scope + component + slots. `kindLabel` is the public
 * concept the caller represents (`Island` / `Route`) — used for the React `displayName`
 * and the scope's read-error label, so callers never see "mandala". The two public
 * wrappers (`island`, `route`) are thin calls onto this.
 */
export function createMandala<S extends Scope<any>>(
    config: MandalaConfig<S>,
    kindLabel: string
): MandalaComponent<S> {
    // One value channel per scope identity: mandalas built from the same scope share it,
    // so a descendant reading by scope resolves the nearest one's value.
    const scopeKey = config.scope as object;
    const Channel = registerScopeChannel(scopeKey);
    const Loading = (config.loading ?? DefaultLoading) as ComponentType<{ params: unknown }>;
    const levels = flattenLevels(config.scope as Scope);

    const Mandala = observer(function Mandala(params: ScopeParams<S>) {
        // Stable across server render and client hydration by tree position, so it keys
        // this mandala's slice of the SSR dehydration registry (see hydration.tsx).
        const mandalaId = useId();
        const hydration = useContext(HydrationContext);

        // Retry re-mounts the inner tree (fresh promises/sources) on error-slot retry.
        const [retry, bumpRetry] = useReducer((count: number) => count + 1, 0);

        // Bump a version when params change by value, so the inner tree remounts — React
        // tears the old one down (children first: the `.provide()` value disposes before
        // its sources detach) and resolves the new params from scratch. Source transitions
        // (same params) re-render in place, keeping promise/source identity.
        const initialParamsRef = useRef(params);
        const paramsRef = useRef(params);
        const versionRef = useRef(0);
        if (!deepEqual(paramsRef.current, params)) {
            paramsRef.current = params;
            versionRef.current += 1;
        }
        const treeKey = `${versionRef.current}:${retry}`;

        // Seed from server-resolved values only on this mandala's *first* resolution: a
        // retry must re-fetch, and a params change wants the new params' data. The
        // post-hydration source re-render keeps (retry 0, initial params), consistent
        // with the server HTML.
        const firstMount = retry === 0 && deepEqual(params, initialParamsRef.current);
        const hydrationSlice = firstMount ? hydration.data?.[mandalaId] : undefined;

        // Bound to this mandala's id; present only on the server (client has no `collect`),
        // where each Step records its resolved promise for the wire.
        const collect = hydration.collect
            ? (key: string, value: unknown) => hydration.collect!(mandalaId, key, value)
            : undefined;

        // Per-level data-cell caches, rebuilt when the inner tree remounts (treeKey
        // change). Held on the mandala's committed ref so a Step's `use()` suspension
        // can't discard a half-built cell (which would re-run its load forever).
        const cacheRef = useRef<{ key: string; buckets: Bucket[] } | null>(null);
        if (!cacheRef.current || cacheRef.current.key !== treeKey) {
            cacheRef.current = {
                key: treeKey,
                buckets: levels.map(() => ({ cells: new Map(), sources: [], built: false })),
            };
        }

        // Drop the cache on unmount so a StrictMode remount (mount → cleanup → mount)
        // rebuilds a fresh run instead of reusing the torn-down one's cells/sources — the
        // subtree then reads the surviving run's identities.
        useEffect(() => {
            return () => {
                cacheRef.current = null;
            };
        }, []);

        const shared: Shared = {
            scope: config.scope as Scope,
            component: config.component as ComponentType<any>,
            channel: Channel,
            loading: Loading,
            params,
            buckets: cacheRef.current.buckets,
            collect,
            hydration: hydrationSlice,
        };

        return (
            <MandalaErrorBoundary
                errorSlot={
                    config.error as
                        | ComponentType<{ params: unknown; error: SourceError; retry: () => void }>
                        | undefined
                }
                params={params}
                retry={bumpRetry}
                resetKey={treeKey}
            >
                <Suspense fallback={<Loading params={params} />}>
                    <Fragment key={treeKey}>{buildTree(levels, 0, params, shared)}</Fragment>
                </Suspense>
            </MandalaErrorBoundary>
        );
    }) as MandalaComponent<S>;

    const componentName =
        config.component.displayName ?? (config.component as { name?: string }).name;
    Mandala.displayName = `${kindLabel}(${componentName || 'Component'})`;

    // Stay transparent to chunk preloading: a `lazy()` component hangs `.preload` on
    // itself; surface it on the mandala so the router can prefetch through the wrapper.
    const preload = (config.component as { preload?: () => Promise<unknown> }).preload;
    if (typeof preload === 'function') Mandala.preload = preload;

    // A readable identifier for this scope's read errors (best-effort: shared scopes keep
    // the last mandala's label).
    setScopeLabel(scopeKey, Mandala.displayName);

    return Mandala;
}
