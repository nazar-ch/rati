import { describe, test, expect, afterEach, vi } from 'vite-plus/test';
import { hydrateRoot } from 'react-dom/client';
import { act } from '@testing-library/react';
import type { Hydration } from '../../mandala/hydration';
import { createHeadStore, type HeadStore } from '../../head/store';
import { HeadProvider } from '../../head/HeadProvider';
import { Title } from '../../head/Title';
import { Meta } from '../../head/Meta';
import { island } from '../../island/island';
import { scope } from '../../scope/scope';
import { createHydrationCollector, HydrationProvider } from '../../mandala/hydration';
import { headTags } from '../../ssr/headTags';
import { isWholeDocument, spliceDocument } from '../../ssr/html';
import { HYDRATION_SCRIPT_ID, readHydration, serializeHydration } from '../../ssr/payload';
import { renderToHtml } from '../../ssr/renderToHtml';

/*
    The whole-document pattern end to end — the one docs/public/ssr.md describes but no
    suite walked: React renders `<html>` itself, `headTags` and the payload script splice
    into the rendered string *outside* the React tree, and the client hydrates `document`.
    The seam being pinned is that last part: React must neither reconcile nor duplicate
    the spliced tags, and the payload must still reach the islands.

    The other pattern (a template with `#root`) is covered by ssr/html.test.ts and the
    router's hydration suite; this file is only the document-as-root half.
*/

// spliceDocument reports who is assembling so a refusal can name the fix; no refusal is
// expected here, so any stand-in does.
const assembler = { name: 'test', template: 'the template', option: 'ratiSsr({ placeholders })' };

const pristineDocumentElement = document.documentElement;

afterEach(() => {
    // The test swaps the whole documentElement out; put jsdom's back for everyone else.
    if (document.documentElement !== pristineDocumentElement) {
        document.replaceChild(pristineDocumentElement, document.documentElement);
    }
    vi.restoreAllMocks();
});

let loads = 0;

const Page = island({
    scope: scope().load({
        page: async () => {
            loads++;
            return { title: 'Torcal' };
        },
    }),
    component: ({ page }) => (
        <>
            <Title>{page.title}</Title>
            <Meta name="description" content="a walk in the karst" />
            <article>{page.title}</article>
        </>
    ),
    loading: () => <div>loading</div>,
});

/** The app root *is* the document — no shell, no `<script>` in the markup. */
function Document({ head, hydration }: { head: HeadStore; hydration: Hydration }) {
    return (
        <HeadProvider store={head}>
            <HydrationProvider {...hydration}>
                <html lang="en">
                    <head>
                        <meta charSet="utf-8" />
                    </head>
                    <body>
                        <div id="root">
                            <Page />
                        </div>
                    </body>
                </html>
            </HydrationProvider>
        </HeadProvider>
    );
}

function newHeadStore(): HeadStore {
    return createHeadStore({ titleTemplate: (title) => `${title} · Site` });
}

describe('the whole-document pattern', () => {
    test('prerender → splice → hydrate document: head reads back, payload round-trips', async () => {
        loads = 0;

        // ----- Server -----
        const head = newHeadStore();
        const collector = createHydrationCollector();
        const rendered = await renderToHtml(
            <Document
                head={head}
                hydration={{ collect: collector.collect, collectError: collector.collectError }}
            />,
        );
        expect(isWholeDocument(rendered)).toBe(true);
        expect(loads).toBe(1);

        const html = spliceDocument(
            rendered,
            {
                html: rendered,
                headTags: headTags(head),
                stateScript: serializeHydration({ data: collector.data, seeds: collector.seeds }),
            },
            assembler,
        );

        // ----- The wire: parse the served document into the live one -----
        const parsed = new DOMParser().parseFromString(html, 'text/html');
        document.replaceChild(
            document.importNode(parsed.documentElement, true),
            document.documentElement,
        );

        // The read-back reached the document React rendered, through the splice.
        expect(document.title).toBe('Torcal · Site');
        expect(
            document.head
                .querySelector('meta[data-rati-head][name="description"]')
                ?.getAttribute('content'),
        ).toBe('a walk in the karst');
        expect(document.querySelector('article')?.textContent).toBe('Torcal');

        // ----- Client -----
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const state = readHydration();
        expect(state).not.toBeNull();

        const root = await act(async () =>
            hydrateRoot(
                document,
                <Document
                    head={newHeadStore()}
                    hydration={{ data: state!.data, seeds: state!.seeds }}
                />,
            ),
        );

        // The island read its slice off the payload instead of re-running the load.
        expect(loads).toBe(1);
        expect(document.querySelector('article')?.textContent).toBe('Torcal');
        expect(document.title).toBe('Torcal · Site');

        // The spliced-in tags are outside the React tree: hydration neither dropped them
        // nor grew a second copy alongside React's own head children.
        expect(document.head.querySelectorAll('title')).toHaveLength(1);
        expect(document.head.querySelectorAll('meta[data-rati-head]')).toHaveLength(1);
        expect(document.head.querySelectorAll('meta[charset]')).toHaveLength(1);
        expect(document.getElementById(HYDRATION_SCRIPT_ID)).not.toBeNull();

        // …and React said nothing about them: a mismatch surfaces as console.error, so
        // an empty list is the whole assertion. The one tolerated message is the same
        // artifact the router's hydration suite documents — running react-dom/static and
        // react-dom/client in a single process shares the module-level context between
        // two renderers, which cannot happen where server and browser are separate
        // processes. A real mismatch reads differently and would still fail here.
        const mismatches = error.mock.calls.filter(
            (args: unknown[]) => !String(args[0]).includes('multiple renderers concurrently'),
        );
        expect(mismatches).toEqual([]);

        root.unmount();
    });
});
