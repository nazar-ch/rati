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

// One entry of a scope's merged definition: a `prop()` input (head only) or a data
// load (function / promise / source / class / value). The two are kept apart at the
// builder surface — `scope({…})` takes inputs, `.load({…})` takes data — but the
// merged definition carries both, so the resolver and prop/param helpers see them.
type ScopeEntry =
    | ((...args: any) => any | Promise<any>)
    | { new (...args: any): any }
    | Promise<any>
    | Source<any>
    | Prop<any>
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
export type Scope<VD extends GenericScopeDefinition = GenericScopeDefinition, Provided = unknown> = {
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
    [K in keyof VD]: VD[K] extends Prop<any>
        ? VD[K]['value']
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

// A scope value, or the `(env) => scope(…)` factory still used in Step 1 to thread
// per-root services. The prop/param helpers accept either and unwrap the factory,
// so `ScopeProps<typeof pageScope>` works whether `pageScope` is a value or a
// factory — and the call sites stay correct once Step 2 drops the factory.
export type ScopeFactory<S extends Scope<any> = Scope<any>> = (env: any) => S;
type ScopeOrFactory = Scope<any> | ScopeFactory;

/** The scope a `ScopeFactory` produces, or the scope itself when given a value. */
export type ScopeOf<S extends ScopeOrFactory> = S extends (...args: any[]) => infer V ? V : S;

type ScopeDefinitions<S extends Scope<any>> = NonNullable<S[typeof ScopeDefinitionsSymbol]>;

/** Clean, fully-resolved props the component receives — inputs plus loaded data. */
export type ScopeProps<S extends ScopeOrFactory> = Simplify<
    ResolveScopeDefinition<ScopeDefinitions<ScopeOf<S>>>
>;

type ParamsOf<Defs extends GenericScopeDefinition> = ExcludeNever<{
    [K in keyof Defs]: Defs[K] extends Prop<any> ? Defs[K]['value'] : never;
}>;

/** The inputs a scope accepts (island props / slot `params`) — its `prop()` head. */
export type ScopeParams<S extends ScopeOrFactory> = Simplify<
    ParamsOf<ScopeDefinitions<ScopeOf<S>>>
>;

// ---------------------------------------------------------------------------------------

type CreateScopeFunc = <P extends ParamsDefinition = {}>(params?: P) => ChainableScope<P>;

// The head takes inputs only — `prop()` markers (route params or host props). Data
// goes into `.load()`, never here.
type ParamsDefinition = Record<string, Prop<any>>;

// A dependent level: each entry receives the prior levels' resolved values and
// yields data — a function/promise/source/class/value. Not `prop()`: inputs live
// in the `scope({…})` head, so a `prop()` here is a (type) error.
type LoadDefinition<PrevDefs extends GenericScopeDefinition> = {
    [key: string]:
        | ((params: Simplify<ResolveScopeDefinition<PrevDefs>>) => any | Promise<any>)
        | Promise<any>
        | Source<any>
        | { new (params: Simplify<ResolveScopeDefinition<PrevDefs>>): any }
        | string;
};

/**
 * Build a scope. The single entry form — always chainable:
 *
 *     scope({ space: prop<string>(), pageId: prop<Base64Uuid>() })  // inputs
 *         .load({ spaceId: ({ space }) => resolveSpaceId(space) })  // dependent level
 *         .load({ tree: ({ spaceId }) => trees.source(spaceId) })  // parallel level
 *         .provide(({ tree }) => new PageContext(tree));           // terminal (optional)
 *
 * `scope()` with no inputs is valid for a data-only scope: `scope().load({ … })`.
 */
export const scope: CreateScopeFunc = <P extends ParamsDefinition = {}>(params?: P) =>
    createScopeChain<P>(params ?? ({} as P), undefined);

export type ChainableScope<VD extends GenericScopeDefinition> = Scope<VD> & {
    load<NextDef extends LoadDefinition<VD>>(
        def: NextDef
    ): ChainableScope<Simplify<VD & NextDef>>;

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
        }
    ): Scope<VD, C>;
};

function createScopeChain<VD extends GenericScopeDefinition>(
    definition: GenericScopeDefinition,
    prevScope: Scope | undefined
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
            options?: { provideTo?: Context<C | null> }
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

export const ParamSymbol = Symbol();

export type Prop<T> = {
    value: T;
    [ParamSymbol]: true;
};

export function prop<T>(): Prop<T> {
    return {
        [ParamSymbol]: true,
        value: null as T,
    };
}

// ----------------------

export type ScopeComponent<
    S extends ScopeOrFactory,
    Props extends Record<string, unknown> = {},
> = FC<ScopeProps<S> & Props>;
