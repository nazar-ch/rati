import type { Simplify } from 'type-fest';
import type { FC } from 'react';
import type { ExcludeNever } from '../types/generic';
import { is } from './utils';

export const ViewSymbol = Symbol();

// Type-level only, never present at runtime: carries the merged definition of
// the whole view chain, so resolving a view never has to walk prevView types
export const ViewDefinitionsSymbol = Symbol();

type ViewProp =
    | ((...args: any) => any | Promise<any>)
    | { new (...args: any): any }
    | Promise<any>
    | ViewParam<any>
    | string;

type GenericViewDefinition = Record<string, ViewProp>;

export type CreateView<VD extends GenericViewDefinition = GenericViewDefinition> = {
    definition: GenericViewDefinition;
    prevView?: CreateView | undefined;
    [ViewSymbol]: true;
    [ViewDefinitionsSymbol]?: VD;
};

type ResolveViewDefinition<VD extends GenericViewDefinition> = {
    [K in keyof VD]: VD[K] extends Promise<any>
        ? Awaited<VD[K]>
        : VD[K] extends ViewParam<any>
          ? VD[K]['value']
          : VD[K] extends (...args: any) => any
            ? Awaited<ReturnType<VD[K]>>
            : VD[K] extends { new (...args: any): any }
              ? InstanceType<VD[K]>
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
