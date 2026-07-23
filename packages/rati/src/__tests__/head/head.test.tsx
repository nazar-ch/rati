import { describe, test, expect, afterEach } from 'vite-plus/test';
import { act, cleanup, render, screen } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { createHeadStore } from '../../head/store';
import { HeadProvider } from '../../head/HeadProvider';
import { Title } from '../../head/Title';
import { useTitle } from '../../head/useTitle';
import { Meta } from '../../head/Meta';
import { island } from '../../island/island';
import { scope } from '../../scope/scope';
import { headTags } from '../../ssr/headTags';
import { controllableSource, prerenderToString } from '../../testing';

afterEach(() => {
    cleanup();
    // The provider's meta reconciler appends to document.head, and the tests below plant
    // a server-rendered head there — reset between tests, or the marked tags left behind
    // would make the next test's document look server-rendered.
    // querySelectorAll returns a static list, so removing while iterating is safe.
    for (const el of document.head.querySelectorAll('[data-rati-head]')) el.remove();
    document.title = '';
});

/**
 * Plant what a rati server left in `<head>` — the `headTags` output of a previous
 * render, which is what HeadProvider wakes up to on a server-rendered page.
 */
function serverHead(tags: { title?: string; metas?: { name: string; content: string }[] }): void {
    if (tags.title !== undefined) {
        // `document.title` reads (and writes) the *first* <title> in the document, and
        // the reset below leaves an empty unmarked one behind — so clear before
        // planting, the way a server-rendered head has exactly one.
        for (const stale of document.head.querySelectorAll('title')) stale.remove();
        const title = document.createElement('title');
        title.textContent = tags.title;
        title.setAttribute('data-rati-head', 'server');
        document.head.appendChild(title);
    }
    for (const meta of tags.metas ?? []) {
        const element = document.createElement('meta');
        element.setAttribute('name', meta.name);
        element.setAttribute('content', meta.content);
        element.setAttribute('data-rati-head', 'server');
        document.head.appendChild(element);
    }
}

const managedMetas = () => [...document.head.querySelectorAll('meta[data-rati-head]')];

const metaContent = (name: string) =>
    document.head.querySelector(`meta[data-rati-head][name="${name}"]`)?.getAttribute('content');

describe('HeadStore winners', () => {
    test('deepest declaration wins; unmount falls back to the outer one', async () => {
        const store = createHeadStore({ defaultTitle: 'Default' });

        function Page({ showInner }: { showInner: boolean }) {
            return (
                <HeadProvider store={store}>
                    <Title>Layout</Title>
                    {showInner && <Title>Page</Title>}
                </HeadProvider>
            );
        }

        const view = render(<Page showInner={true} />);
        expect(document.title).toBe('Page');

        view.rerender(<Page showInner={false} />);
        expect(document.title).toBe('Layout');

        view.unmount();
        // All declarations gone — the default applies on the next external read; the
        // provider is unmounted so document.title keeps its last value.
        expect(store.snapshot('client').title).toBe('Default');
    });

    test('a value update keeps registration depth (a layout re-render cannot steal the win)', () => {
        const store = createHeadStore();

        function Layout({ label, children }: { label: string; children?: React.ReactNode }) {
            return (
                <>
                    <Title>{label}</Title>
                    {children}
                </>
            );
        }

        const view = render(
            <HeadProvider store={store}>
                <Layout label="Layout v1">
                    <Title>Page</Title>
                </Layout>
            </HeadProvider>,
        );
        expect(document.title).toBe('Page');

        view.rerender(
            <HeadProvider store={store}>
                <Layout label="Layout v2">
                    <Title>Page</Title>
                </Layout>
            </HeadProvider>,
        );
        expect(document.title).toBe('Page');
        expect(store.snapshot('client').title).toBe('Page');
    });

    test('titleTemplate wraps declared titles but not the default', () => {
        const store = createHeadStore({
            defaultTitle: 'Site',
            titleTemplate: (title) => `${title} · Site`,
        });
        const view = render(
            <HeadProvider store={store}>
                <Title>Docs</Title>
            </HeadProvider>,
        );
        expect(document.title).toBe('Docs · Site');
        view.unmount();
        expect(store.snapshot('client').title).toBe('Site');
    });

    test('useTitle(null) declares nothing; a later value registers at its own depth', () => {
        const store = createHeadStore({ defaultTitle: 'Default' });

        function AsyncTitled() {
            const [title, setTitle] = useState<string | null>(null);
            useTitle(title);
            return <button onClick={() => setTitle('Loaded')}>load</button>;
        }

        const view = render(
            <HeadProvider store={store}>
                <AsyncTitled />
            </HeadProvider>,
        );
        expect(document.title).toBe('Default');
        act(() => {
            view.getByText('load').click();
        });
        expect(document.title).toBe('Loaded');
    });

    test('useTitle value → null → value re-registers at a fresh depth', () => {
        const store = createHeadStore();

        function Toggling({ title }: { title: string | null }) {
            useTitle(title);
            return null;
        }

        // `Sibling` registers after `Toggling`, so it is the deeper of the two and wins
        // — the arrangement that makes the re-registration below observable.
        function Page({ title }: { title: string | null }) {
            return (
                <HeadProvider store={store}>
                    <Toggling title={title} />
                    <Title>Sibling</Title>
                </HeadProvider>
            );
        }

        const view = render(<Page title="First" />);
        expect(document.title).toBe('Sibling');

        view.rerender(<Page title={null} />);
        expect(document.title).toBe('Sibling');

        // Going null withdrew the entry (a committed one leaves through the effect's
        // `remove`, not the render's `clear`), so the returning value registers at the
        // *end* of the sequence — it now outranks the sibling it used to lose to.
        view.rerender(<Page title="Again" />);
        expect(document.title).toBe('Again');
    });

    test('a committed entry survives the null render and leaves only through remove', () => {
        // The two store phases the test above runs together, pulled apart — the render's
        // `clear` cannot drop a committed entry (an abandoned render must not steal the
        // win); the effect's `remove` is the only exit.
        const store = createHeadStore();
        store.set('outer', { kind: 'title', text: 'Outer' });
        store.commit('outer', { kind: 'title', text: 'Outer' });
        store.set('inner', { kind: 'title', text: 'Inner' });
        store.commit('inner', { kind: 'title', text: 'Inner' });
        expect(store.snapshot('client').title).toBe('Inner');

        store.clear('inner');
        expect(store.snapshot('client').title).toBe('Inner');

        store.remove('inner');
        expect(store.snapshot('client').title).toBe('Outer');
    });

    test('a Title inside an island that errors after committing falls back to the outer winner', async () => {
        const store = createHeadStore();
        // Driven by hand to walk the island ready → error on the client; its raw mutators
        // drive a sync act (the head reconciler applies from an effect, flushed at act end).
        const page = controllableSource<string>();

        const Island = island({
            scope: scope().load({ page: () => page }),
            component: ({ page: title }) => <Title>{title}</Title>,
            loading: () => <div>loading</div>,
            error: ({ error }) => <div>error: {error.code}</div>,
        });

        render(
            <HeadProvider store={store}>
                <Title>Layout</Title>
                <Island />
            </HeadProvider>,
        );

        act(() => page.setReady('Page'));
        expect(document.title).toBe('Page');

        // The source errors *after* the Title committed: the island swaps in its error
        // slot, so the declaration unmounts and its `remove` hands the win back out.
        act(() => page.setError('failed'));
        expect(await screen.findByText('error: failed')).toBeTruthy();
        expect(document.title).toBe('Layout');
    });

    test('StrictMode double render registers once per declaration', () => {
        const store = createHeadStore();
        render(
            <StrictMode>
                <HeadProvider store={store}>
                    <Title>Outer</Title>
                    <Title>Inner</Title>
                </HeadProvider>
            </StrictMode>,
        );
        expect(document.title).toBe('Inner');
    });
});

describe('hydration phase', () => {
    test('a server-rendered head stands while nothing has hydrated', () => {
        // The clobber SSR-04 hit on nazar: HeadProvider sits above the route's Suspense
        // boundary, so its first apply runs while the page that declares the title is
        // still unhydrated. Nothing is confirmed — which is not the same as nothing
        // being declared, and the server already said what this page's head is.
        serverHead({
            title: 'Server page',
            metas: [{ name: 'description', content: 'from server' }],
        });

        const store = createHeadStore({ defaultTitle: 'Default' });
        render(<HeadProvider store={store}>content, no declarations yet</HeadProvider>);

        expect(document.title).toBe('Server page');
        expect(metaContent('description')).toBe('from server');
        expect(store.phase).toBe('hydrating');
    });

    test('a declaration that hydrates lands; the tags nobody spoke for stay', () => {
        serverHead({
            title: 'Server page',
            metas: [
                { name: 'description', content: 'from server' },
                { name: 'keywords', content: 'server, keywords' },
            ],
        });

        const store = createHeadStore({ defaultTitle: 'Default' });
        render(
            <HeadProvider store={store}>
                <Title>Hydrated page</Title>
                <Meta name="description" content="hydrated description" />
            </HeadProvider>,
        );

        // What committed wins — the server's tags are adopted, not duplicated.
        expect(document.title).toBe('Hydrated page');
        expect(metaContent('description')).toBe('hydrated description');
        expect(managedMetas()).toHaveLength(2);
        // `keywords` has no declaration *yet*: its declarer may be in a boundary that
        // hasn't hydrated. Removing it here is the half of the bug that doesn't heal.
        expect(metaContent('keywords')).toBe('server, keywords');
        expect(store.phase).toBe('hydrating');
    });

    test('the first remove settles the store: defaults apply, orphans are reconciled away', () => {
        serverHead({
            title: 'Server page',
            metas: [{ name: 'keywords', content: 'server, keywords' }],
        });

        const store = createHeadStore({ defaultTitle: 'Default' });

        function Page({ show }: { show: boolean }) {
            return <HeadProvider store={store}>{show && <Title>Page</Title>}</HeadProvider>;
        }

        const view = render(<Page show={true} />);
        expect(document.title).toBe('Page');
        expect(managedMetas()).toHaveLength(1);

        // The declaration leaves — that can only follow its subtree hydrating, so the
        // head is now the tree's and it is saying nothing.
        view.rerender(<Page show={false} />);
        expect(store.phase).toBe('live');
        expect(document.title).toBe('Default');
        expect(managedMetas()).toHaveLength(0);
    });

    test('a document with no rati-marked tags is client-only: the default applies at once', () => {
        // No serverHead() — index.html's own title, nothing rati wrote.
        document.title = 'from index.html';

        const store = createHeadStore({ defaultTitle: 'Default' });
        render(<HeadProvider store={store}>content, no declarations</HeadProvider>);

        expect(store.phase).toBe('live');
        expect(document.title).toBe('Default');
    });

    test("the client sync's own leftover tags are not mistaken for a server head", () => {
        // A client-only app that declared a <Meta> leaves it in <head> when its root
        // unmounts: React tears the provider's subscription down before the
        // declaration's removal, so the reconcile that would have dropped it never runs.
        // A fresh store must read that as its own litter, not as a head to protect —
        // otherwise a client-only page that declares no title never gets defaultTitle,
        // which is the whole case the marker's `server` value exists to keep working.
        const first = createHeadStore({ defaultTitle: 'Default' });
        const view = render(
            <HeadProvider store={first}>
                <Meta name="description" content="from the client" />
            </HeadProvider>,
        );
        view.unmount();
        expect(managedMetas()).toHaveLength(1);
        expect(managedMetas()[0]!.getAttribute('data-rati-head')).toBe('client');

        document.title = 'from index.html';
        const second = createHeadStore({ defaultTitle: 'Default' });
        render(<HeadProvider store={second}>nothing declared</HeadProvider>);

        expect(second.phase).toBe('live');
        expect(document.title).toBe('Default');
    });

    test('a remove that removes nothing does not settle the phase', () => {
        // `useHeadTag(null)` calls remove() on mount for a declaration that never
        // registered — a page that declares its title once loaded, not a churning head.
        const store = createHeadStore({ defaultTitle: 'Default' });
        store.remove('never-registered');
        expect(store.phase).toBe('hydrating');
        expect(store.snapshot('hydrating').title).toBeNull();

        store.set('a', { kind: 'title', text: 'A' });
        store.commit('a', { kind: 'title', text: 'A' });
        expect(store.phase).toBe('hydrating');

        store.remove('a');
        expect(store.phase).toBe('live');
    });
});

describe('meta sync', () => {
    test('creates, deduplicates by name, updates, and removes rati-managed tags', () => {
        const store = createHeadStore();

        const view = render(
            <HeadProvider store={store}>
                <Meta name="description" content="layout description" />
                <Meta name="description" content="page description" />
                <Meta property="og:title" content="OG" />
            </HeadProvider>,
        );

        const managed = () => [...document.head.querySelectorAll('meta[data-rati-head]')];
        expect(managed()).toHaveLength(2);
        expect(
            document.head
                .querySelector('meta[data-rati-head][name="description"]')
                ?.getAttribute('content'),
        ).toBe('page description');
        expect(
            document.head
                .querySelector('meta[data-rati-head][property="og:title"]')
                ?.getAttribute('content'),
        ).toBe('OG');

        view.rerender(
            <HeadProvider store={store}>
                <Meta name="description" content="layout description" />
            </HeadProvider>,
        );
        expect(managed()).toHaveLength(1);
        expect(
            document.head
                .querySelector('meta[data-rati-head][name="description"]')
                ?.getAttribute('content'),
        ).toBe('layout description');

        // Declarations gone but the provider still mounted → tags reconciled away.
        // (A full unmount tears the provider's subscription down with them, so the
        // final removal isn't observable there — nor does it matter.)
        view.rerender(<HeadProvider store={store}>none</HeadProvider>);
        expect(managed()).toHaveLength(0);
    });

    test('name and property carrying the same value string are separate keys', () => {
        // `og:title` as a `name` and as a `property` dedupe independently — a key built
        // from the value alone would drop one of them, on both readers.
        const store = createHeadStore();
        render(
            <HeadProvider store={store}>
                <Meta name="og:title" content="by name" />
                <Meta property="og:title" content="by property" />
            </HeadProvider>,
        );

        expect(document.head.querySelectorAll('meta[data-rati-head]')).toHaveLength(2);
        expect(
            document.head
                .querySelector('meta[data-rati-head][name="og:title"]')
                ?.getAttribute('content'),
        ).toBe('by name');
        expect(
            document.head
                .querySelector('meta[data-rati-head][property="og:title"]')
                ?.getAttribute('content'),
        ).toBe('by property');
        expect(store.snapshot('client').metas).toHaveLength(2);
    });

    test('adopts server-emitted tags instead of duplicating them', () => {
        // Simulate the server-injected output of headTags() already in <head>.
        const injected = document.createElement('meta');
        injected.setAttribute('name', 'description');
        injected.setAttribute('content', 'from server');
        injected.setAttribute('data-rati-head', '');
        document.head.appendChild(injected);

        const store = createHeadStore();
        render(
            <HeadProvider store={store}>
                <Meta name="description" content="from client" />
            </HeadProvider>,
        );

        const tags = [...document.head.querySelectorAll('meta[data-rati-head]')];
        expect(tags).toHaveLength(1);
        expect(tags[0]).toBe(injected);
        expect(tags[0]!.getAttribute('content')).toBe('from client');
    });
});

describe('server read-back (headTags after prerender)', () => {
    test('reads declarations registered during the prerender, escaped', async () => {
        const store = createHeadStore({ titleTemplate: (title) => `${title} · Site` });
        await prerenderToString(
            <HeadProvider store={store}>
                <Title>{'Fish & <Chips>'}</Title>
                <Meta name="description" content='a "quoted" page' />
            </HeadProvider>,
        );

        const html = headTags(store);
        expect(html).toBe(
            '<title data-rati-head="server">Fish &amp; &lt;Chips&gt; · Site</title>' +
                '<meta name="description" content="a &quot;quoted&quot; page" data-rati-head="server">',
        );
    });

    test('declarations inside a suspended island register by the time prerender drains', async () => {
        // The load resolves during prerender; the Title inside the resolved content
        // must be visible to a post-prerender read.
        const { island } = await import('../../island/island');
        const { scope } = await import('../../scope/scope');

        const Island = island({
            scope: scope().load({ name: async () => 'Resolved page' }),
            component: ({ name }) => (
                <>
                    <Title>{name}</Title>
                    <div>{name}</div>
                </>
            ),
            loading: () => <div>loading</div>,
        });

        const store = createHeadStore();
        await prerenderToString(
            <HeadProvider store={store}>
                <Title>Layout</Title>
                <Island />
            </HeadProvider>,
        );
        expect(headTags(store)).toBe('<title data-rati-head="server">Resolved page</title>');
    });

    test('no declarations and no default → empty string (leave the shell alone)', async () => {
        const store = createHeadStore();
        await prerenderToString(<HeadProvider store={store}>content</HeadProvider>);
        expect(headTags(store)).toBe('');
    });
});
