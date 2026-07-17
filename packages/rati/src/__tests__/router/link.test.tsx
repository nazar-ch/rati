import { describe, test, expect, beforeEach, afterEach, vi } from 'vite-plus/test';
import { type FC } from 'react';
import { act, render, fireEvent, cleanup } from '@testing-library/react';
import { RouterStore } from '../../router/store';
import { route } from '../../router/route';
import { Link } from '../../router/Link';
import { GenericStoresContext } from '../../stores/RootStore';

/**
 * RF-07's pins: `<Link>` navigates to the URL the *anchor* resolved, and decides active
 * state against the same resolution.
 *
 * Kills executed once, 2026-07-17, each reverted after:
 *   - click handler back to `router.navigate(href)`: the five pins whose resolution
 *     differs from the spelling go red ('..', 'sub', '?q=1', '#h', and the absolute URL —
 *     that last one because navigating the full URL now hits the router's refusal guard).
 *     `href="/x"` stays green: an already-absolute path resolves to itself, which is the
 *     point — this changes nothing for the input class that always worked.
 *   - `isHrefActive` back to `router.isPath(href)`: only `href="c"` goes red.
 *
 * The `..`/`sub`/external *inactive* pins pass under both engines — `isPath` said false for
 * the raw spelling too, by accident. They pin the other direction (resolution must not
 * start marking things active) and are honest regression cover, not evidence for this fix.
 */

const NoopComponent: FC = () => null;

const routes = [
    route('/', 'home', NoopComponent),
    route('/a', 'a', NoopComponent),
    route('/a/', 'a-slash', NoopComponent),
    route('/a/b/c', 'abc', NoopComponent),
    route('/x', 'x', NoopComponent),
] as const;

beforeEach(() => {
    window.history.replaceState(null, '', 'http://localhost/');
});

afterEach(() => {
    cleanup();
});

/** Render a `<Link href>` with the browser sitting at `at`, and hand back the anchor. */
function renderLinkAt(at: string, href: string, props: { prefetch?: boolean } = {}) {
    window.history.replaceState(null, '', at);
    const router = new RouterStore({}, routes);
    const utils = render(
        <GenericStoresContext.Provider value={{ router }}>
            <Link href={href} {...props}>
                go
            </Link>
        </GenericStoresContext.Provider>,
    );
    return { router, anchor: utils.container.querySelector('a')!, ...utils };
}

describe('<Link> navigates to the anchor-resolved URL', () => {
    test.each([
        // at              href            pushed
        ['/a/b/c', '..', '/a/'],
        ['/a/b/c', 'sub', '/a/b/sub'],
        ['/a/b/c', '/x', '/x'],
        ['/a/b/c', 'http://localhost/x', '/x'],
        ['/a/b/c', '?q=1', '/a/b/c?q=1'],
        ['/a/b/c', '#h', '/a/b/c#h'],
    ])('at %s, href=%s pushes %s', (at, href, expected) => {
        const { router, anchor } = renderLinkAt(at, href);
        const navigate = vi.spyOn(router, 'navigate');

        act(() => {
            fireEvent.click(anchor);
        });

        // The pushed path is what the DOM resolved — byte-identical to where the
        // unintercepted click would have gone.
        expect(navigate).toHaveBeenCalledWith(expected);
        router.dispose();
    });

    test('a cross-origin href is left to the browser, not pushed', () => {
        const { router, anchor } = renderLinkAt('/a/b/c', 'https://example.com/x');
        const navigate = vi.spyOn(router, 'navigate');

        act(() => {
            fireEvent.click(anchor);
        });

        expect(navigate).not.toHaveBeenCalled();
        router.dispose();
    });

    test('prefetch reads the same resolution as the click', () => {
        const { router, anchor } = renderLinkAt('/a/b/c', '..', { prefetch: true });
        const preloadRoute = vi.spyOn(router, 'preloadRoute');

        act(() => {
            fireEvent.mouseEnter(anchor);
        });

        // Not '..' — otherwise a relative link prefetches whatever route '..' happens to
        // match and the click then goes somewhere else.
        expect(preloadRoute).toHaveBeenCalledWith('/a/');
        router.dispose();
    });
});

describe('<Link> active state resolves before comparing', () => {
    test.each([
        // at              href       active
        ['/a/b/c', 'c', true],
        ['/a/b/c', '/a/b/c', true],
        ['/a/b/c', '..', false],
        ['/a/b/c', 'sub', false],
        ['/a/b/c', '/x', false],
        ['/a/b/c', 'https://example.com/a/b/c', false],
    ])('at %s, href=%s → active=%s', (at, href, expected) => {
        const { router, anchor } = renderLinkAt(at, href);
        expect(anchor.getAttribute('aria-current')).toBe(expected ? 'page' : null);
        router.dispose();
    });
});
