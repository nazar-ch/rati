import is from '@sindresorhus/is';
import { Merge, Simplify } from 'type-fest';
import _ from 'lodash';
import { FC } from 'react';
import { ExcludeNever } from '../types/generic';

const ViewSymbol = Symbol();

type ViewProp =
    | ((...args: any) => any | Promise<any>)
    | { new (...args: any): any }
    | Promise<any>
    | ViewParam<any>
    | string;

type GenericViewDefinition = Record<string, ViewProp>;

export type CreateView<
    VD extends GenericViewDefinition,
    PrevView extends GenericViewDefinition = any
> = {
    definition: VD;
    prevView?: CreateView<PrevView>;
    [ViewSymbol]: true;
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

// Limits the recursion depth to prevent "Type instantiation is excessively deep
// and possibly infinite" Typescript's error
// https://stackoverflow.com/questions/65527030/how-to-abort-early-with-type-instantiation-is-excessively-deep-and-possibly-infi
type Depth = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

type MergeViewDefinitions<View extends CreateView<any>, D extends number = 9> = [D] extends [0]
    ? never
    : View['definition'] &
          (View['prevView'] extends CreateView<any>
              ? MergeViewDefinitions<View['prevView'], Depth[D]>
              : {});

export type ResolveView<View extends CreateView<any>> = Simplify<
    ResolveViewDefinition<MergeViewDefinitions<View>>
>;

type RecursiveViewDefinition<PrevView extends CreateView<GenericViewDefinition> | undefined> = {
    [key: string]:
        | ViewParam<any>
        | ((params: PrevView extends {} ? ResolveView<PrevView> : {}) => any | Promise<any>)
        | Promise<any>
        | { new (params: PrevView extends {} ? ResolveView<PrevView> : {}): any }
        | string;
};

export type RequiredViewParams<View extends CreateView<{}>> = Simplify<
    ExcludeNever<{
        [K in keyof MergeViewDefinitions<View>]: MergeViewDefinitions<View>[K] extends ViewParam<any>
            ? MergeViewDefinitions<View>[K]['value']
            : never;
    }>
>;

// ---------------------------------------------------------------------------------------

type CreateViewFunc = {
    <PrevView extends undefined, Def extends RecursiveViewDefinition<PrevView>>(
        viewDefinition: Def
    ): {
        definition: Def;
        [ViewSymbol]: true;
    };

    <
        PrevView extends CreateView<GenericViewDefinition>,
        Def extends RecursiveViewDefinition<PrevView>
    >(
        prevView: PrevView,
        viewDefinition: Def
    ): {
        definition: Def;
        prevView: PrevView;
        [ViewSymbol]: true;
    };

    chain: typeof viewChainHead;
};

export const createView: CreateViewFunc = <
    PrevView extends CreateView<GenericViewDefinition> | undefined,
    Def extends RecursiveViewDefinition<PrevView>
>(
    definitionOrPrevView: PrevView,
    maybeViewDefinition?: Def
) => {
    const viewDefinition = maybeViewDefinition ?? definitionOrPrevView;
    const prevView = maybeViewDefinition ? definitionOrPrevView : undefined;

    return { prevView, definition: viewDefinition, [ViewSymbol]: true as const };
};

const viewChainHead = <Def extends RecursiveViewDefinition<undefined>>(vd: Def) =>
    createViewChain(
        vd,
        // Give an empty view to not support undefined in createViewChain's type definition
        {
            [ViewSymbol]: true,
            definition: {},
            prevView: undefined,
        }
    );

export function createViewChain<
    PrevView extends CreateView<GenericViewDefinition> | undefined,
    Def extends RecursiveViewDefinition<PrevView>
>(viewDefinition: Def, prevView: PrevView) {
    const view = { definition: viewDefinition as Def, prevView, [ViewSymbol]: true as const };

    return {
        ...view,
        chain: <NextDef extends RecursiveViewDefinition<typeof view>>(
            nextViewDefinition: NextDef
        ) => createViewChain(nextViewDefinition, view),
    };
}

createView.chain = viewChainHead;

// ---------------------------------------------------------------------------------------

export async function resolveView<View extends CreateView<GenericViewDefinition>>(
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
        } else if (is.class_(value)) {
            // create the class instance with the params from the previous views
            values.push(new value(prevViewResolvedProps));
        } else if (is.function_(value)) {
            // call the function with the params from the previous views
            // FIXME: error after mobx upgrade
            // @ts-expect-error
            values.push(value(prevViewResolvedProps));
        } else {
            values.push(value);
        }
    }

    const resolvedValues = await Promise.all(values);

    return { ...prevViewResolvedProps, ..._.zipObject(keys, resolvedValues) } as any;
}

// ----------------------

export const ParamSymbol = Symbol();

type ViewParam<T> = {
    value: T;
    [ParamSymbol]: true;
};

export function viewParam<T>() {
    return {
        [ParamSymbol]: true as const,
        value: null as T,
    };
}

// ----------------------

export type ViewComponent<
    View extends CreateView<any>,
    Props extends Record<string, unknown> = {}
> = FC<ResolveView<View> & Props>;
