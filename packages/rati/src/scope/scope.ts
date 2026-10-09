import type { Context, FC } from 'react';

import type { Simplify } from 'type-fest';

import type { Source } from './source.js';

import type { ExcludeNever } from '../types/generic.js';

export const ScopeSymbol = Symbol();

// Type-level only, never present at runtime: carries the merged definition of
// the whole scope chain, so resolving a scope never has to walk prevScope types
export const ScopeDefinitionsSymbol = Symbol();

// Type-level only: carries the value a scope provides to its subtree (declared by
// `.provide()`, or the resolved props by default), so `useScope` reads it straight
// off the scope instead of re-deriving it.
export const ScopeProvidesSymbol = Symbol();

// Brands a load as a hook load (see `hook()`): the resolver runs it every render
// in stable order and never caches it, so its function may call React hooks. A
// symbol prop (not a name) so it survives minification, mirroring `InputSymbol`.
export const HookSymbol = Symbol();

/**
 * A load the resolver calls every render and never caches, so it may call any React hook
 * (`use(SomeContext)`, `useQuery`, SWR) and map its output to a value or a `Source` whose
 * lifecycle the hook owns. Create one with {@link hook}.
 */
export type HookLoad<T = unknown> = ((resolved: any) => T) & { readonly [HookSymbol]: true };

/**
 * The second argument a function load receives, optional to declare: an `AbortSignal` that
 * fires when the load's run is discarded — an input change, a retry, `refresh()`, unmount.
 * `hook()` loads and sources get none.
 *
 *     members: ({ spaceId }, { signal }) => api.members.list(spaceId, { signal }),
 */
export type LoadContext = {
    /**
     * Aborted when this load's run is discarded. Pass it to `fetch` or any signal-aware
     * client; ignored, the load runs to completion.
     */
    readonly signal: AbortSignal;
};

// One entry of a scope's merged definition: an `input()` marker, a `hook()` load, or a data
// load. A `HookLoad` is structurally a function, so the function member covers it; a member
// of its own widens plain function loads' contextual argument type.
type ScopeEntry =
    | ((...args: any) => any | Promise<any>)
    | { new (...args: any): any }
    | Promise<any>
    | Source<any>
    | Input<any>
    | string;

type GenericScopeDefinition = Record<string, ScopeEntry>;

// A load function/value may yield a Source<T>; the island observes it and hands
// the component its ready `value`, so the resolved prop type is the unwrapped T.
type UnwrapSource<T> = T extends Source<infer U> ? U : T;

// Runtime shape of a `.provide()` declaration. The factory builds the provided
// value from the fully resolved scope; if that value is `Disposable`, the island
// calls its `[Symbol.dispose]` on teardown, before detaching the scope's sources.
export type ScopeProvideDef = {
    factory: (resolved: Record<string, unknown>) => unknown;
    // Optional app-owned React context to also publish the value into. Lets app
    // code read the value through its own context instead of `useScope`, which
    // avoids the import cycle that reading it off the island component would
    // create when the reader sits inside the island's own subtree.
    channel?: Context<unknown> | undefined;
};

// `Provided` defaults to `unknown` so the `Scope<any>` constraint sites keep accepting
// provide-bearing scopes; a scope without `.provide()` carries `unknown`, which `useScope`
// reads as "provide the resolved props" (ScopeProvidesOf).
export type Scope<
    VD extends GenericScopeDefinition = GenericScopeDefinition,
    Provided = unknown,
> = {
    definition: GenericScopeDefinition;
    prevScope?: Scope | undefined;
    // Present only when the chain ends in `.provide()`. Named `provideDef` (not
    // `provide`) so it never collides with ChainableScope's `.provide()` method.
    provideDef?: ScopeProvideDef | undefined;
    [ScopeSymbol]: true;
    [ScopeDefinitionsSymbol]?: VD;
    [ScopeProvidesSymbol]?: Provided;
};

type ResolveScopeDefinition<VD extends GenericScopeDefinition> = {
    // HookLoad is also a function, so it must be matched before the function branch.
    // A hook resolves like a function load: its Source<T> (or promise) unwraps to T.
    [K in keyof VD]: VD[K] extends Input<any>
        ? VD[K]['value']
        : VD[K] extends HookLoad<infer R>
          ? UnwrapSource<Awaited<R>>
          : VD[K] extends Promise<any>
            ? UnwrapSource<Awaited<VD[K]>>
            : VD[K] extends (...args: any) => any
              ? UnwrapSource<Awaited<ReturnType<VD[K]>>>
              : VD[K] extends { new (...args: any): any }
                ? InstanceType<VD[K]>
                : VD[K] extends Source<infer U>
                  ? U
                  : VD[K];
};

type ScopeDefinitions<S extends Scope<any>> = NonNullable<S[typeof ScopeDefinitionsSymbol]>;

/** Clean, fully-resolved props the component receives — inputs plus loaded data. */
export type ScopeProps<S extends Scope<any>> = Simplify<
    ResolveScopeDefinition<ScopeDefinitions<S>>
>;

type InputsOf<Defs extends GenericScopeDefinition> = ExcludeNever<{
    [K in keyof Defs]: Defs[K] extends Input<any> ? Defs[K]['value'] : never;
}>;

/** The inputs a scope accepts (island props / slot `inputs`) — its `input()` head. */
export type ScopeInputs<S extends Scope<any>> = Simplify<InputsOf<ScopeDefinitions<S>>>;

/** The load keys of a scope — everything resolved minus the inputs (what `refresh(key)` accepts). */
export type ScopeLoadKeys<S extends Scope<any>> = Exclude<
    keyof ScopeProps<S>,
    keyof ScopeInputs<S>
> &
    string;

// The `.provide()` value a scope declares, or `unknown` when the chain has none.
type ScopeProvided<S extends Scope<any>> = S extends Scope<any, infer P> ? P : never;

/**
 * The value a scope provides to its subtree — and so the type `useScope` /
 * `useRouteContext` return: the `.provide()` value when the chain declares one, else
 * the resolved props (provide-by-default). Mirrors the island's runtime `Leaf`.
 */
export type ScopeProvidesOf<S extends Scope<any>> =
    unknown extends ScopeProvided<S> ? ScopeProps<S> : ScopeProvided<S>;

type CreateScopeFunc = <P extends InputsDefinition = {}>(inputs?: P) => ChainableScope<P>;

// The head takes inputs only — `input()` markers (route params or host props). Data
// goes into `.load()`, never here.
type InputsDefinition = Record<string, Input<any>>;

// A dependent level: each entry receives the prior levels' resolved values; `input()` is a
// type error here. A `hook()` load satisfies the function member, because a member of its own
// widens plain loads' argument type to `any`. The {@link LoadContext} parameter is optional.
type LoadDefinition<PrevDefs extends GenericScopeDefinition> = {
    [key: string]:
        | ((
              resolved: Simplify<ResolveScopeDefinition<PrevDefs>>,
              context: LoadContext,
          ) => any | Promise<any>)
        | Promise<any>
        | Source<any>
        | { new (resolved: Simplify<ResolveScopeDefinition<PrevDefs>>): any }
        | string;
};

/**
 * Builds a scope: an `input()` head, `.load()` levels, an optional terminal `.provide()`.
 *
 *     scope({ space: input<string>() })
 *         .load({ tree: ({ space }) => trees.source(space) })
 *         .provide(({ tree }) => new PageContext(tree));
 */
export const scope: CreateScopeFunc = <P extends InputsDefinition = {}>(inputs?: P) =>
    createScopeChain<P>(inputs ?? ({} as P), undefined);

export type ChainableScope<VD extends GenericScopeDefinition> = Scope<VD> & {
    load<NextDef extends LoadDefinition<VD>>(def: NextDef): ChainableScope<Simplify<VD & NextDef>>;

    /**
     * Replaces what the island provides — the resolved props by default — with
     * `factory(resolvedProps)`, built once every level is ready. A `Disposable` value is
     * disposed on teardown BEFORE the sources detach; `provideTo` also publishes it into an
     * app-owned React context. Terminal.
     */
    provide<C>(
        factory: (resolved: Simplify<ResolveScopeDefinition<VD>>) => C,
        options?: {
            // Bridge into an app context of the usual "provided by a parent" shape,
            // `Context<C | null>` (nullable default). The `| null` makes `C` unify
            // with the factory's return instead of being widened by the context.
            provideTo?: Context<C | null>;
        },
    ): Scope<VD, C>;
};

function createScopeChain<VD extends GenericScopeDefinition>(
    definition: GenericScopeDefinition,
    prevScope: Scope | undefined,
): ChainableScope<VD> {
    const node: Scope<VD> = { definition, prevScope, [ScopeSymbol]: true };

    return {
        ...node,
        load: <NextDef extends LoadDefinition<VD>>(def: NextDef) =>
            createScopeChain<Simplify<VD & NextDef>>(def, node),
        // `.provide()` adds no level — it stamps the provide factory onto this same
        // node (same definition/prevScope), so flattenLevels still sees the chain
        // unchanged and the island reads the factory off `scope.provideDef`.
        provide: <C>(
            factory: (resolved: Simplify<ResolveScopeDefinition<VD>>) => C,
            options?: { provideTo?: Context<C | null> },
        ): Scope<VD, C> =>
            // The [ScopeProvidesSymbol] carrier is type-only (never present at
            // runtime), so cast to stamp the C onto the otherwise-unchanged node.
            ({
                ...node,
                provideDef: {
                    factory: factory as ScopeProvideDef['factory'],
                    channel: options?.provideTo as Context<unknown> | undefined,
                },
            }) as Scope<VD, C>,
    };
}

export const InputSymbol = Symbol();

export type Input<T> = {
    value: T;
    [InputSymbol]: true;
};

export function input<T>(): Input<T> {
    return {
        [InputSymbol]: true,
        value: null as T,
    };
}

/**
 * Marks a load as a hook load: `fn` runs every render, never cached, so it may call any
 * React hook — `hook(() => use(StoresCtx))`. Its return resolves like a function load's. A
 * bare function load that calls a hook is a bug: it is cached, and its hook runs once.
 */
export function hook<T>(fn: (resolved: any) => T): HookLoad<T> {
    (fn as { [HookSymbol]?: true })[HookSymbol] = true;
    return fn as HookLoad<T>;
}

export const isHookLoad = (entry: unknown): entry is HookLoad =>
    typeof entry === 'function' && (entry as { [HookSymbol]?: true })[HookSymbol] === true;

// Brands a load as a data load with options (see `data()`). A symbol prop so it
// survives minification, mirroring `HookSymbol`.
export const DataSymbol = Symbol();

export type DataLoadOptions<T = unknown> = {
    /**
     * The refresh gate: when `refresh(key)` re-runs this load, the new value is compared
     * to the old one — equal keeps the old value (and identity) and stops the downstream
     * cascade. Defaults to deep equality; provide a cheaper discriminator for large
     * payloads (`(a, b) => a.etag === b.etag`).
     */
    equals?: (previous: T, next: T) => boolean;
};

/**
 * A data load carrying per-load options — a plain function load plus configuration the
 * resolver reads (the `equals` refresh gate). Create one with {@link data}.
 */
export type DataLoad<T = unknown> = ((resolved: any, context: LoadContext) => T) & {
    readonly [DataSymbol]: true;
    readonly dataOptions: DataLoadOptions;
};

/**
 * Marks a function load with per-load options: `hook()` says how a load runs, `data()`
 * what it is. A bare function load is `data(fn)` with no options.
 *
 *     members: data(({ spaceId }) => fetchMembers(spaceId), {
 *         equals: (a, b) => a.etag === b.etag,
 *     }),
 */
export function data<T>(
    fn: (resolved: any, context: LoadContext) => T,
    options: DataLoadOptions<Awaited<UnwrapSource<Awaited<T>>>> = {},
): DataLoad<T> {
    const marked = fn as typeof fn & { [DataSymbol]?: true; dataOptions?: DataLoadOptions };
    marked[DataSymbol] = true;
    marked.dataOptions = options as DataLoadOptions;
    return marked as DataLoad<T>;
}

export const isDataLoad = (entry: unknown): entry is DataLoad =>
    typeof entry === 'function' && (entry as { [DataSymbol]?: true })[DataSymbol] === true;

export type ScopeComponent<S extends Scope<any>, Props extends Record<string, unknown> = {}> = FC<
    ScopeProps<S> & Props
>;
