import { describe, test, expect, afterEach } from 'vite-plus/test';
import { act, type FC } from 'react';
import { scope, input } from '../../scope/scope';
import { island } from '../../island/island';
import { controllableSource, flush, renderIsland, cleanup } from '../../testing';

/*
    The resolver names each level's `Step` for its keys (`Step(user,prefs)`), so the React
    DevTools tree is self-describing instead of a stack of anonymous `Step`s.

    DevTools names a fiber `type.displayName || type.name`, and React hangs a DOM node's
    fiber on the node itself — so walking up from the island's own DOM reads exactly what
    the DevTools tree draws (minus the host elements). That walk is white-box by nature;
    it is the only way to assert the thing the feature is *for*.
*/

type Fiber = { type: unknown; return: Fiber | null };
type NamedType = { displayName?: string; name: string };

const Loading: FC = () => <div>loading…</div>;

function componentTypes(node: ChildNode | null): NamedType[] {
    const key = node && Object.keys(node).find((name) => name.startsWith('__reactFiber$'));
    if (!node || !key) throw new Error('no React fiber on the node — did the island render?');
    const types: NamedType[] = [];
    for (
        let fiber: Fiber | null = (node as unknown as Record<string, Fiber>)[key]!;
        fiber;
        fiber = fiber.return
    ) {
        if (typeof fiber.type === 'function') types.push(fiber.type as unknown as NamedType);
    }
    return types;
}

const componentNames = (node: ChildNode | null): string[] =>
    componentTypes(node).map((type) => type.displayName ?? type.name);

afterEach(cleanup);

describe('Step displayName', () => {
    // Innermost level first, as the walk goes up: the deepest `.load()`, then the one above
    // it, then the scope's inputs head — under the island's own label.
    test('each level is named for its keys, below the island', async () => {
        const Page = island({
            scope: scope({ id: input<string>() })
                .load({ user: async () => 'u', prefs: async () => 'p' })
                .load({ tree: async () => 't' }),
            component: function Page() {
                return <div>content</div>;
            },
            loading: Loading,
        });

        const handle = await renderIsland(Page, { props: { id: 'a1' } });
        await flush();

        const names = componentNames(handle.container.firstChild);
        expect(names.filter((name) => name.startsWith('Step'))).toEqual([
            'Step(tree)',
            'Step(user,prefs)',
            'Step(id)',
        ]);
        expect(names).toContain('Island(Page)');
    });

    // An input-less scope has an empty head level — bare `Step`, not `Step()`.
    test('the empty inputs head stays bare', async () => {
        const Page = island({
            scope: scope().load({ page: async () => 'home' }),
            component: function Page() {
                return <div>content</div>;
            },
            loading: Loading,
        });

        const handle = await renderIsland(Page);
        await flush();

        expect(
            componentNames(handle.container.firstChild).filter((n) => n.startsWith('Step')),
        ).toEqual(['Step(page)', 'Step']);
    });

    // The naming is a bound copy of `Step` memoized on the (frozen) level object, so a
    // level's component identity is stable across renders — React reconciles the tree
    // exactly as it did before the names existed, and nothing remounts.
    test('a level keeps one component identity across re-renders', async () => {
        const feed = controllableSource<string>();
        const Live = island({
            scope: scope().load({ feed: () => feed }),
            component: function Live({ feed: value }) {
                return <div>{value}</div>;
            },
            loading: Loading,
        });

        const handle = await renderIsland(Live);
        await act(async () => feed.setReady('one'));
        const before = componentTypes(handle.container.firstChild);
        await act(async () => feed.setReady('two'));
        const after = componentTypes(handle.container.firstChild);

        expect(handle.container.textContent).toBe('two');
        expect(after.map((type) => type.displayName)).toEqual(
            before.map((type) => type.displayName),
        );
        // Identity, not just the name: a fresh component type per render would remount the
        // level (and detach its sources) on every pass.
        expect(after).toEqual(before);
        expect(feed.attachCount).toBe(1);
    });
});
