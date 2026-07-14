import { describe, test, expect, afterEach } from 'vite-plus/test';
import { prerender } from 'react-dom/static';
import { act, cleanup, render } from '@testing-library/react';
import { StrictMode, useState, type ReactElement } from 'react';
import { createHeadStore } from '../../head/store';
import { HeadProvider } from '../../head/HeadProvider';
import { Title } from '../../head/Title';
import { useTitle } from '../../head/useTitle';
import { Meta } from '../../head/Meta';
import { headTags } from '../../ssr/headTags';

afterEach(() => {
    cleanup();
    // The provider's meta reconciler appends to document.head — reset between tests.
    // querySelectorAll returns a static list, so removing while iterating is safe.
    for (const el of document.head.querySelectorAll('meta[data-rati-head]')) el.remove();
    document.title = '';
});

async function prerenderToString(element: ReactElement): Promise<string> {
    const { prelude } = await prerender(element);
    const reader = prelude.getReader();
    const decoder = new TextDecoder();
    let html = '';
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        html += decoder.decode(value, { stream: true });
    }
    return html;
}

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
            '<title>Fish &amp; &lt;Chips&gt; · Site</title>' +
                '<meta name="description" content="a &quot;quoted&quot; page" data-rati-head>',
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
        expect(headTags(store)).toBe('<title>Resolved page</title>');
    });

    test('no declarations and no default → empty string (leave the shell alone)', async () => {
        const store = createHeadStore();
        await prerenderToString(<HeadProvider store={store}>content</HeadProvider>);
        expect(headTags(store)).toBe('');
    });
});
