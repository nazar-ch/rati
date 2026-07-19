import { describe, test, expect } from 'vite-plus/test';
import type { FC, ReactNode } from 'react';
import { route } from '../../router/route';
import { group } from '../../router/group';
import { scope, input } from '../../scope/scope';
import { prerenderToString } from '../../testing';

const Page: FC = () => null;
const ScopedPage: FC<{ id: string }> = () => null;
const Wrap: FC<{ children?: ReactNode }> = ({ children }) => children;
const OtherWrap: FC<{ children?: ReactNode }> = ({ children }) => children;
const Loading: FC = () => null;
const ErrorSlot: FC = () => null;
const OtherError: FC = () => null;

const idScope = () => scope({ id: input<string>() });

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

    test("carries a child's ssr: false through a re-fold", async () => {
        let runs = 0;
        const optedOut = scope().load({
            note: async () => {
                runs++;
                return 'resolved';
            },
        });
        const Note: FC<{ note: string }> = ({ note }) => <div>{note}</div>;
        const original = route('/p', 'p', Note, { scope: optedOut, ssr: false });

        // A group loading slot the route lacks — the condition that rebuilds the mandala.
        const [refolded] = group({ loading: () => <div>group loading</div> }, [original]);
        expect(refolded.component).not.toBe(original.component);

        // The route's folded mandala takes the scope's inputs (none here), not the
        // component's resolved props — which is what `group`'s pass-through type still says.
        const Refolded = refolded.component as FC;
        const html = await prerenderToString(<Refolded />);

        // The rebuild kept the opt-out: the group's slot is what shipped, not the load.
        expect(html).toContain('group loading');
        expect(runs).toBe(0);
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
