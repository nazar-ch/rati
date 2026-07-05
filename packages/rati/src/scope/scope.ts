import type { Simplify } from 'type-fest';
import type { Context, FC } from 'react';
import type { ExcludeNever } from '../types/generic';
import type { Source } from './source';

export const ScopeSymbol = Symbol();

// Type-level only, never present at runtime: carries the merged definition of
// the whole scope chain, so resolving a scope never has to walk prevScope types
export const ScopeDefinitionsSymbol = Symbol();

// Type-level only: carries the value a scope provides to its subtree (declared by
// `.provide()`, or the resolved props by default), so `useScope` reads it straight
// off the scope instead of re-deriving it.
export const ScopeProvidesSymbol = Symbol();

// Brands a load as a *hook load* (see `hook()`): the resolver runs it every render
// in stable order and never caches it, so its function may call React hooks. A
// symbol prop (not a name) so it survives minification, mirroring `InputSymbol`.
export const HookSymbol = Symbol();

/**
 * A hook load — a function the resolver calls every render (so it may call any React
 * hook: `use(SomeContext)`, Apollo's `useQuery`, react-query, SWR…) and never caches.
 * It's the adapter seam: shape the resolved-so-far into the hook's inputs and map its
 * output back to a value or a `Source`. The hook owns its own subscription lifecycle;
 * rati never attaches/detaches a hook source. Create one with {@link hook}.
 */
export type HookLoad<T = unknown> = ((resolved: any) => T) & { readonly [HookSymbol]: true };

// One entry of a scope's merged definition: an `input()` marker (head only), a `hook()`
// load, or a data load (function / promise / source / class / value). They're kept
// apart at the builder surface — `scope({…})` takes inputs, `.load({…})` takes hooks
// and data — but the merged definition carries all, so the resolver and input helpers
// see them. (A `HookLoad` is structurally a function, so the function member covers it
// here; it's not listed separately to avoid polluting the contextual argument typing of
// plain function loads.)
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

// `Provided` defaults to `unknown` so the many `Scope<any>` constraint sites keep
// accepting provide-bearing scopes (a `PageContextStore` value is assignable to
// `unknown`); a scope without `.provide()` carries `unknown` here, and `useScope`
// reads that as "provide the resolved props" (see ScopeProvidesOf).
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

// The `.provide()` value a scope declares, or `unknown` when the chain has none.
type ScopeProvided<S extends Scope<any>> = S extends Scope<any, infer P> ? P : never;

/**
 * The value a scope provides to its subtree — and so the type `useScope` /
 * `useRouteContext` return: the `.provide()` value when the chain declares one, else
 * the resolved props (provide-by-default). Mirrors the island's runtime `Leaf`.
 */
export type ScopeProvidesOf<S extends Scope<any>> =
    unknown extends ScopeProvided<S> ? ScopeProps<S> : ScopeProvided<S>;

// ---------------------------------------------------------------------------------------

type CreateScopeFunc = <P extends InputsDefinition = {}>(inputs?: P) => ChainableScope<P>;

// The head takes inputs only — `input()` markers (route params or host props). Data
// goes into `.load()`, never here.
type InputsDefinition = Record<string, Input<any>>;

// A dependent level: each entry receives the prior levels' resolved values and
// yields data — a `hook()` load, function, promise, source, class, or value. Not
// `input()`: inputs live in the `scope({…})` head, so an `input()` here is a (type)
// error. A `hook()` load satisfies the function member (a `HookLoad` is a function),
// so it's accepted without a dedicated union member — which would otherwise widen the
// contextual argument type of plain function loads to `any`.
type LoadDefinition<PrevDefs extends GenericScopeDefinition> = {
    [key: string]:
        | ((resolved: Simplify<ResolveScopeDefinition<PrevDefs>>) => any | Promise<any>)
        | Promise<any>
        | Source<any>
        | { new (resolved: Simplify<ResolveScopeDefinition<PrevDefs>>): any }
        | string;
};

/**
 * Build a scope. The single entry form — always chainable:
 *
 *     scope({ space: input<string>(), pageId: input<Base64Uuid>() })  // inputs
 *         .load({ spaceId: ({ space }) => resolveSpaceId(space) })    // dependent level
 *         .load({ tree: ({ spaceId }) => trees.source(spaceId) })     // parallel level
 *         .provide(({ tree }) => new PageContext(tree));              // terminal (optional)
 *
 * `scope()` with no inputs is valid for a data-only scope: `scope().load({ … })`.
 */
export const scope: CreateScopeFunc = <P extends InputsDefinition = {}>(inputs?: P) =>
    createScopeChain<P>(inputs ?? ({} as P), undefined);

export type ChainableScope<VD extends GenericScopeDefinition> = Scope<VD> & {
    load<NextDef extends LoadDefinition<VD>>(def: NextDef): ChainableScope<Simplify<VD & NextDef>>;

    /**
     * Customize what the island provides to its subtree. By default an island
     * provides the resolved props; `.provide(factory)` replaces that with
     * `factory(resolvedProps)` — a derived, lifecycle-managed value (read with
     * `useScope(Island)`). The factory runs once every level is ready; if the
     * value is `Disposable`, its `[Symbol.dispose]` runs on island teardown
     * *before* the scope's sources detach, so a value built over a grabbed
     * resource is torn down while that grab is still live (fixing the decoupled
     * "accessed after releasing" race). Set-up is the factory's job — construct,
     * activate, return the value; there is no separate mount step. Terminal:
     * `.provide()` ends the chain.
     *
     * `provideTo` additionally publishes the value into an app-owned React
     * context, so app code can read it via that context (no `useScope`, no import
     * cycle with the island the reader is rendered under).
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

// ----------------------

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

// ----------------------

/**
 * Mark a load as a *hook load*: `fn` runs every render (never cached), so it may
 * call any React hook. Use it for dependency injection — `hook(() => use(StoresCtx))`
 * — and to adapt external hook-based data libs to a `Source`. The resolver classifies
 * `fn`'s return like a function load (a `Source<T>` unwraps to `T`); a bare function
 * load that calls a hook (no `hook()`) is a bug — it would be cached and its hook run
 * once.
 */
export function hook<T>(fn: (resolved: any) => T): HookLoad<T> {
    (fn as { [HookSymbol]?: true })[HookSymbol] = true;
    return fn as HookLoad<T>;
}

export const isHookLoad = (entry: unknown): entry is HookLoad =>
    typeof entry === 'function' && (entry as { [HookSymbol]?: true })[HookSymbol] === true;

// ----------------------

export type ScopeComponent<S extends Scope<any>, Props extends Record<string, unknown> = {}> = FC<
    ScopeProps<S> & Props
>;
