import { describe, test, expect, afterEach, vi } from 'vite-plus/test';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { act } from '@testing-library/react';
import { createRequestHandler } from '../../server/requestHandler';
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

    Then the same pattern's failure path (SSR-12): a render that throws has no document to
    splice into, so the handler synthesizes one from the assets and the client boots it
    with `createRoot(document)` — the mount the last two describes below cover, one as the
    real walk and one as a canary on React itself.

    The other pattern (a template with `#root`) is covered by ssr/html.test.ts and the
    router's hydration suite; this file is only the document-as-root half.
*/

// spliceDocument reports who is assembling so a refusal can name the fix; no refusal is
// expected here, so any stand-in does.
const assembler = { name: 'test', template: 'the template', option: 'ratiSsr({ placeholders })' };

const pristineDocumentElement = document.documentElement;

/** The root the running test mounted, torn down below whether or not it got that far. */
let mounted: Root | null = null;

afterEach(() => {
    // Unmount here rather than at the end of each test: a failed assertion would leave
    // the root attached to `document`, and the next test's mount on that same container
    // warns about double-rooting — a second, misleading failure stacked on the real one.
    // The canary below asserts a clean console, so it would be the one to report it.
    mounted?.unmount();
    mounted = null;
    // The tests swap the whole documentElement out; put jsdom's back for everyone else.
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

/** The wire: parse a served document and make it the live one, as a browser would. */
function installDocument(html: string): void {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    document.replaceChild(
        document.importNode(parsed.documentElement, true),
        document.documentElement,
    );
}

/**
 * The console.error calls React meant. One message is tolerated, the same artifact the
 * router's hydration suite documents: running react-dom/static and react-dom/client in a
 * single process shares the module-level context between two renderers, which cannot
 * happen where the server and the browser are separate processes.
 *
 * This is the weaker of the two checks each mount below makes, and deliberately not the
 * only one: React reports a *recoverable* error (a mismatch it client-rendered through)
 * to `onRecoverableError`, whose default is `reportGlobalError` — not console.error. In
 * this environment that lands as an unhandled error, which fails nothing. So every mount
 * here passes its own `onRecoverableError` and asserts it never fired; the console is
 * only what's left.
 */
function reactErrors(calls: unknown[][]): unknown[][] {
    return calls.filter((args) => !String(args[0]).includes('multiple renderers concurrently'));
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

        // ----- The wire -----
        installDocument(html);

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
        const recovered = vi.fn();
        const state = readHydration();
        expect(state).not.toBeNull();

        mounted = await act(async () =>
            hydrateRoot(
                document,
                <Document
                    head={newHeadStore()}
                    hydration={{ data: state!.data, seeds: state!.seeds }}
                />,
                { onRecoverableError: recovered },
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

        // …and React said nothing about them: a mismatch on the spliced tags would be a
        // recovery, and this hydrate matched outright.
        expect(recovered).not.toHaveBeenCalled();
        expect(reactErrors(error.mock.calls)).toEqual([]);
    });
});

describe('the CSR fallback', () => {
    test('throw → a synthesized document → the client boots it from scratch', async () => {
        // ----- Server: the real handler, on its error path -----
        const handler = createRequestHandler({
            // An error outside every island — a wrapper, the shell — is what rejects
            // `render`; a failing load never reaches here.
            render: () => Promise.reject(new Error('wrapper exploded')),
            // No template: this app renders `<html>` itself, so there is no shell to
            // pass and none to fill.
            assets: {
                bootstrapModules: ['/assets/entry-a1b2.js'],
                styleTags: '<link rel="stylesheet" href="/assets/index-c3d4.css">',
            },
            onError: vi.fn(),
        });
        const response = await handler(new Request('http://app.test/pictures/torcal'));

        expect(response.status).toBe(500);

        // ----- The wire -----
        installDocument(await response.text());
        // No payload is what makes the client resolve rather than hydrate — there is no
        // server render to reuse, and claiming otherwise is the mismatch this avoids.
        expect(readHydration()).toBeNull();

        // ----- Client: no payload → createRoot(document), not hydrateRoot -----
        loads = 0;
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const recovered = vi.fn();
        mounted = createRoot(document, { onRecoverableError: recovered });
        await act(async () => {
            mounted!.render(<Document head={newHeadStore()} hydration={{}} />);
        });

        // The reader gets the app anyway: it loaded its own data, rendered, and the head
        // layer wrote the title a server never got to send.
        expect(loads).toBe(1);
        expect(document.querySelector('article')?.textContent).toBe('Torcal');
        expect(document.title).toBe('Torcal · Site');
        // The entry that is running this render survived the mount that it started.
        expect(document.querySelector('script[src="/assets/entry-a1b2.js"]')).not.toBeNull();
        // The point of the client entry's branch (docs/public/ssr.md §The client entry):
        // hydrating this document instead would reach the same page *through* recovery,
        // and tell the reader's console about it on every fallback.
        expect(recovered).not.toHaveBeenCalled();
        expect(reactErrors(error.mock.calls)).toEqual([]);
    });
});

/*
    The canary, and the reason it is a test and not a comment: `createRoot(document)` is
    what the fallback above rests on, and react.dev does not document it — the page says
    createRoot takes "a DOM element" and names `document` only under `hydrateRoot`. The
    types (DefinitelyTyped's `Container` includes `Document`), the runtime
    (`isValidContainer` accepts `nodeType === 9`, `clearContainer` has a document branch)
    and two browsers say otherwise, but that is observed behaviour rather than a stated
    contract. The maintainer accepted that soft spot on the condition that a React release
    which narrows the container fails *here*, loudly, instead of in a consumer's 500 path.

    If this goes red, the escape hatch is the shape SSR-12 was filed with: hydrate the
    synthesized document instead and let React's mismatch recovery client-render it — the
    same working page, at the cost of a reported error (`onRecoverableError` →
    `reportGlobalError`, an uncaught error in the console) on every fallback. See
    docs/research/directions-2026-07/ssr-server-kit.md §The fallback for whole-document
    apps, and docs/public/ssr.md §When a render throws.
*/
describe('createRoot(document) — the React contract the fallback rests on', () => {
    test('renders a synthesized minimal document into a working page', async () => {
        installDocument(
            '<!doctype html><html><head><link rel="stylesheet" href="/assets/index-c3d4.css">' +
                '</head><body><script type="module" src="/assets/entry-a1b2.js"></script>' +
                '</body></html>',
        );
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const recovered = vi.fn();

        mounted = createRoot(document, { onRecoverableError: recovered });
        await act(async () => {
            mounted!.render(
                <html lang="en">
                    <head>
                        <meta charSet="utf-8" />
                    </head>
                    <body>
                        <article>rendered</article>
                    </body>
                </html>,
            );
        });

        expect(document.querySelector('article')?.textContent).toBe('rendered');
        // The singleton React adopted rather than replaced.
        expect(document.documentElement.lang).toBe('en');
        // `clearContainerSparingly` is the detail the whole shape rests on: SCRIPT, STYLE
        // and LINK rel=stylesheet stay, everything else goes. A synthesized document
        // holds exactly those, so the mount cannot orphan the entry running it.
        expect(document.querySelector('script[src="/assets/entry-a1b2.js"]')).not.toBeNull();
        expect(document.querySelector('link[href="/assets/index-c3d4.css"]')).not.toBeNull();
        // A first-class client render, not one React forgave: this is what separates the
        // shipped shape from the one SSR-12 was filed with. See `recovered` above.
        expect(recovered).not.toHaveBeenCalled();
        expect(reactErrors(error.mock.calls)).toEqual([]);
    });
});
