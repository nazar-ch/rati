import type { Simplify } from 'type-fest';
import type { Context, FC } from 'react';
import type { ExcludeNever } from '../types/generic';
import type { Source } from './source';
import { is } from './utils';

export const ViewSymbol = Symbol();

// Type-level only, never present at runtime: carries the merged definition of
// the whole view chain, so resolving a view never has to walk prevView types
export const ViewDefinitionsSymbol = Symbol();

// Type-level only: carries the island-owned context value type declared by
// `.context()`, so `useIslandContext` reads it straight off the view instead of
// re-deriving it from the factory.
export const ViewContextSymbol = Symbol();

type ViewProp =
    | ((...args: any) => any | Promise<any>)
    | { new (...args: any): any }
    | Promise<any>
    | Source<any>
    | ViewParam<any>
    | string;

type GenericViewDefinition = Record<string, ViewProp>;

// A view function/value may yield a Source<T>; the island observes it and hands
// the component its ready `value`, so the resolved prop type is the unwrapped T.
type UnwrapSource<T> = T extends Source<infer U> ? U : T;

// Runtime shape of a `.context()` declaration. The factory builds the context
// value from the fully resolved chain; `mount` (optional) runs side effects and
// returns a teardown the island calls before detaching the chain's sources.
export type ViewContextDef = {
    factory: (resolved: Record<string, unknown>) => unknown;
    mount?: ((value: unknown) => (() => void) | void) | undefined;
    // Optional app-owned React context to also publish the value into. Lets app
    // code read the context through its own context instead of `useIslandContext`,
    // which avoids the import cycle that reading it off the island component would
    // create when the reader sits inside the island's own subtree.
    channel?: Context<unknown> | undefined;
};

// `Ctx` defaults to `unknown` so the many `CreateView<any>` constraint sites keep
// accepting context-bearing views (a `PageContextStore` context is assignable to
// `unknown`); a view without `.context()` carries `unknown` here.
export type CreateView<
    VD extends GenericViewDefinition = GenericViewDefinition,
    Ctx = unknown,
> = {
    definition: GenericViewDefinition;
    prevView?: CreateView | undefined;
    // Present only when the chain ends in `.context()`. Named `contextDef` (not
    // `context`) so it never collides with ChainableView's `.context()` method.
    contextDef?: ViewContextDef | undefined;
    [ViewSymbol]: true;
    [ViewDefinitionsSymbol]?: VD;
    [ViewContextSymbol]?: Ctx;
};

type ResolveViewDefinition<VD extends GenericViewDefinition> = {
    [K in keyof VD]: VD[K] extends ViewParam<any>
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

type ViewDefinitions<View extends CreateView<any>> = NonNullable<
    View[typeof ViewDefinitionsSymbol]
>;

export type ResolveView<View extends CreateView<any>> = Simplify<
    ResolveViewDefinition<ViewDefinitions<View>>
>;

type ViewDefinition<PrevDefs extends GenericViewDefinition> = {
    [key: string]:
        | ViewParam<any>
        | ((params: Simplify<ResolveViewDefinition<PrevDefs>>) => any | Promise<any>)
        | Promise<any>
        | Source<any>
        | { new (params: Simplify<ResolveViewDefinition<PrevDefs>>): any }
        | string;
};

export type RequiredViewParams<View extends CreateView<any>> = Simplify<
    ExcludeNever<{
        [K in keyof ViewDefinitions<View>]: ViewDefinitions<View>[K] extends ViewParam<any>
            ? ViewDefinitions<View>[K]['value']
            : never;
    }>
>;

// ---------------------------------------------------------------------------------------

type CreateViewFunc = {
    <Def extends ViewDefinition<{}>>(viewDefinition: Def): CreateView<Def>;

    <PrevDefs extends GenericViewDefinition, Def extends ViewDefinition<PrevDefs>>(
        prevView: CreateView<PrevDefs>,
        viewDefinition: Def
    ): CreateView<Simplify<PrevDefs & Def>>;

    chain: typeof viewChainHead;
};

export const createView: CreateViewFunc = <
    PrevDefs extends GenericViewDefinition,
    Def extends ViewDefinition<PrevDefs>,
>(
    definitionOrPrevView: CreateView<PrevDefs> | Def,
    maybeViewDefinition?: Def
) => {
    const viewDefinition = maybeViewDefinition ?? definitionOrPrevView;
    const prevView = maybeViewDefinition ? definitionOrPrevView : undefined;

    return { prevView, definition: viewDefinition, [ViewSymbol]: true as const };
};

export type ChainableView<VD extends GenericViewDefinition> = CreateView<VD> & {
    chain<NextDef extends ViewDefinition<VD>>(
        nextViewDefinition: NextDef
    ): ChainableView<Simplify<VD & NextDef>>;

    /**
     * Declare an island-owned context value derived from the fully resolved chain.
     * The factory runs once every level is ready; the value is handed to the
     * subtree (read with `useIslandContext(Island)`) and, if `mount` is given,
     * mounted at the same point — its returned cleanup runs on island teardown
     * *before* the chain's sources detach, so a context built over a grabbed
     * resource is torn down while that grab is still live (fixing the decoupled
     * "accessed after releasing" race). Terminal: `.context()` ends the chain.
     *
     * `provideTo` additionally publishes the value into an app-owned React context,
     * so app code can read it via that context (no `useIslandContext`, no import
     * cycle with the island the reader is rendered under).
     */
    context<C>(
        factory: (resolved: Simplify<ResolveViewDefinition<VD>>) => C,
        options?: {
            mount?: (value: C) => (() => void) | void;
            // Bridge into an app context of the usual "provided by a parent" shape,
            // `Context<C | null>` (nullable default). The `| null` makes `C` unify
            // with the factory's return instead of being widened by the context.
            provideTo?: Context<C | null>;
        }
    ): CreateView<VD, C>;
};

const viewChainHead = <Def extends ViewDefinition<{}>>(viewDefinition: Def) =>
    createViewChain<Def>(viewDefinition, undefined);

function createViewChain<VD extends GenericViewDefinition>(
    viewDefinition: GenericViewDefinition,
    prevView: CreateView | undefined
): ChainableView<VD> {
    const view: CreateView<VD> = { definition: viewDefinition, prevView, [ViewSymbol]: true };

    return {
        ...view,
        chain: <NextDef extends ViewDefinition<VD>>(nextViewDefinition: NextDef) =>
            createViewChain<Simplify<VD & NextDef>>(nextViewDefinition, view),
        // `.context()` adds no level — it stamps the context factory onto this same
        // node (same definition/prevView), so flattenLevels still sees the chain
        // unchanged and the island reads the factory off `view.context`.
        context: <C>(
            factory: (resolved: Simplify<ResolveViewDefinition<VD>>) => C,
            options?: {
                mount?: (value: C) => (() => void) | void;
                provideTo?: Context<C | null>;
            }
        ): CreateView<VD, C> =>
            // The [ViewContextSymbol] carrier is type-only (never present at
            // runtime), so cast to stamp the C onto the otherwise-unchanged node.
            ({
                ...view,
                contextDef: {
                    factory: factory as ViewContextDef['factory'],
                    mount: options?.mount as ViewContextDef['mount'],
                    channel: options?.provideTo as Context<unknown> | undefined,
                },
            }) as CreateView<VD, C>,
    };
}

createView.chain = viewChainHead;

// ---------------------------------------------------------------------------------------

export async function resolveView<View extends CreateView>(
    view: View,
    params: RequiredViewParams<View>
): Promise<ResolveView<View>> {
    const prevViewResolvedProps = view.prevView
        ? await resolveView(view.prevView as any, params)
        : {};

    const keys: string[] = [];
    const values: any[] = [];

    for (const [key, value] of Object.entries(view.definition)) {
        keys.push(key);

        if (is.object(value) && ParamSymbol in value) {
            // params case
            values.push((params as any)[key]);
        } else if (is.promise(value)) {
            values.push(value);
        } else if (is.class(value)) {
            // create the class instance with the params from the previous views
            values.push(new value(prevViewResolvedProps));
        } else if (is.function(value)) {
            // call the function with the params from the previous views
            values.push(value(prevViewResolvedProps));
        } else {
            values.push(value);
        }
    }

    const resolvedValues = await Promise.all(values);

    return {
        ...prevViewResolvedProps,
        ...Object.fromEntries(keys.map((k, i) => [k, resolvedValues[i]])),
    } as any;
}

// ----------------------

export const ParamSymbol = Symbol();

export type ViewParam<T> = {
    value: T;
    [ParamSymbol]: true;
};

export function viewParam<T>(): ViewParam<T> {
    return {
        [ParamSymbol]: true,
        value: null as T,
    };
}

// ----------------------

export type ViewComponent<
    View extends CreateView<any>,
    Props extends Record<string, unknown> = {},
> = FC<ResolveView<View> & Props>;
