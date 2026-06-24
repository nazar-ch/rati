import { describe, test, expect } from 'vite-plus/test';
import type { FC, ReactNode } from 'react';
import { route } from '../../router/route';
import { group } from '../../router/group';
import { scope, prop } from '../../scope/scope';

const Page: FC = () => null;
const ScopedPage: FC<{ id: string }> = () => null;
const Wrap: FC<{ children?: ReactNode }> = ({ children }) => children;
const OtherWrap: FC<{ children?: ReactNode }> = ({ children }) => children;
const Loading: FC = () => null;
const ErrorSlot: FC = () => null;
const OtherError: FC = () => null;

const idScope = () => scope({ id: prop<string>() });

describe('group', () => {
    test('applies the wrapper to children that lack one', () => {
        const [home, about] = group({ wrapper: Wrap }, [
            route('/home', 'home', Page),
            route('/about', 'about', Page),
        ]);
        expect(home.wrapperComponent).toBe(Wrap);
        expect(about.wrapperComponent).toBe(Wrap);
    });

    test("a child's own wrapper wins over the group's", () => {
        const [r] = group({ wrapper: Wrap }, [route('/x', 'x', Page, { wrapper: OtherWrap })]);
        expect(r.wrapperComponent).toBe(OtherWrap);
    });

    test('leaves a plain route component untouched (no refold)', () => {
        const original = route('/x', 'x', Page);
        const [r] = group({ wrapper: Wrap }, [original]);
        expect(r.component).toBe(original.component);
    });

    test('does not rebuild a scope route when the group adds no slot', () => {
        const original = route('/p/:id', 'p', ScopedPage, { scope: idScope() });
        const [r] = group({ wrapper: Wrap }, [original]);
        expect(r.component).toBe(original.component);
    });

    test('re-folds a scope route to apply a group error slot it lacks', () => {
        const original = route('/p/:id', 'p', ScopedPage, { scope: idScope() });
        const [r] = group({ wrapper: Wrap, error: ErrorSlot }, [original]);
        expect(r.component).not.toBe(original.component);
    });

    test('re-folds a scope route to apply a group loading slot it lacks', () => {
        const original = route('/p/:id', 'p', ScopedPage, { scope: idScope() });
        const [r] = group({ loading: Loading }, [original]);
        expect(r.component).not.toBe(original.component);
    });

    test("a child's own error wins over the group's (no rebuild)", () => {
        const original = route('/p/:id', 'p', ScopedPage, { scope: idScope(), error: ErrorSlot });
        const [r] = group({ error: OtherError }, [original]);
        expect(r.component).toBe(original.component);
    });

    test('preserves the route tuple type (literal names) for the router type machinery', () => {
        const grouped = group({ wrapper: Wrap }, [
            route('/a', 'a', Page),
            route('/b/:id', 'b', ScopedPage, { scope: idScope() }),
        ]);

        // The names survive as a literal union — what `Link`'s `to` / `useRouteContext` read.
        type Names = (typeof grouped)[number]['name'];
        const names: Names[] = ['a', 'b'];
        expect(names).toEqual(['a', 'b']);

        // @ts-expect-error — 'c' is not one of the group's route names
        const bad: Names = 'c';
        expect(bad).toBe('c');
    });
});
