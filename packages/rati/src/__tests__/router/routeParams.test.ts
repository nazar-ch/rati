import { describe, test, expect, beforeEach, vi } from 'vite-plus/test';
import { RouterStore } from '../../router/store';
import { route } from '../../router/route';
import { createMemoryHistory } from '../../router/history';

// Every pin below was run once against the unfixed engine and observed red: raw
// interpolation put `hello world` and `a/b` into the URL unencoded and handed the
// browser's `hello%20world` back to the component, the substring scan turned
// `/x/:idx/:id` into `/x/7x/:id`, and the malformed case threw a URIError out of
// setPath. The base64url pin is the deliberate exception — it passes either way, and
// exists to hold that jnana's URL shape does not move under the codec.

const NoopComponent = () => null;

const routes = [
    route('/pages/:pageId', 'page', NoopComponent),
    // `:id` is a prefix of `:idx`, and its segment *follows* — the shape a
    // substring scan corrupts.
    route('/x/:idx/:id', 'prefixCollision', NoopComponent),
    route('*', 'notFound', NoopComponent),
] as const;

// A 22-char base64url uuid, the shape jnana puts in its URLs. Its alphabet
// (A-Za-z0-9-_) is entirely unreserved, so the codec must leave it alone —
// byte-identical out through getPath and back in through the match.
const BASE64URL_UUID = 'abcDEF123-_ghiJKL456mn';

beforeEach(() => {
    window.history.replaceState(null, '', 'http://localhost/');
});

describe('route param codec', () => {
    test('a value with a space round-trips out through getPath and back into the params', async () => {
        const router = new RouterStore({}, routes);
        await Promise.resolve();

        expect(router.getPath({ name: 'page', pageId: 'hello world' })).toBe(
            '/pages/hello%20world',
        );

        router.navigate({ name: 'page', pageId: 'hello world' });
        await Promise.resolve();

        expect(window.location.pathname).toBe('/pages/hello%20world');
        expect(router.activeRoute?.name).toBe('page');
        // What went in is what the component gets — not the browser's `hello%20world`.
        expect(router.activeRoute?.routeParams).toEqual({ pageId: 'hello world' });
        router.dispose();
    });

    test('a value with a slash stays inside its own segment', async () => {
        const router = new RouterStore({}, routes);
        await Promise.resolve();

        // Unencoded, this would read as two segments and miss the route entirely.
        expect(router.getPath({ name: 'page', pageId: 'a/b' })).toBe('/pages/a%2Fb');

        router.navigate({ name: 'page', pageId: 'a/b' });
        await Promise.resolve();

        expect(router.activeRoute?.name).toBe('page');
        expect(router.activeRoute?.routeParams).toEqual({ pageId: 'a/b' });
        router.dispose();
    });

    test('values carrying URL syntax round-trip', async () => {
        const router = new RouterStore({}, routes);
        await Promise.resolve();

        for (const value of ['a?b', 'a#b', 'a&b=c', '100%', 'Ünïcødé', 'ключ']) {
            router.navigate({ name: 'page', pageId: value });
            await Promise.resolve();
            expect(router.activeRoute?.name).toBe('page');
            expect(router.activeRoute?.routeParams).toEqual({ pageId: value });
        }
        router.dispose();
    });

    test('a base64url uuid is byte-identical through the URL (the jnana shape)', async () => {
        const router = new RouterStore({}, routes);
        await Promise.resolve();

        const path = router.getPath({ name: 'page', pageId: BASE64URL_UUID });
        expect(path).toBe(`/pages/${BASE64URL_UUID}`);
        expect(path).not.toContain('%');

        router.navigate({ name: 'page', pageId: BASE64URL_UUID });
        await Promise.resolve();

        expect(window.location.pathname).toBe(`/pages/${BASE64URL_UUID}`);
        expect(router.activeRoute?.routeParams).toEqual({ pageId: BASE64URL_UUID });
        router.dispose();
    });

    test('a malformed percent-sequence in the URL yields the raw value and warns', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        // A hand-typed or truncated URL. Decoding this throws a URIError; the app
        // must survive it.
        window.history.replaceState(null, '', '/pages/%zz');
        const router = new RouterStore({}, routes);
        await Promise.resolve();

        expect(router.activeRoute?.name).toBe('page');
        expect(router.activeRoute?.routeParams).toEqual({ pageId: '%zz' });
        expect(warn).toHaveBeenCalled();

        warn.mockRestore();
        router.dispose();
    });
});

describe('route param codec under SSR', () => {
    test('the server decodes, and hydration seeds without decoding twice', () => {
        // Everything the codec touches at once: a space, a slash, and a literal
        // percent — a value that decodes differently if run through twice.
        const value = 'a b/c%d';
        const url = `/pages/${encodeURIComponent(value)}`;

        // The server renders off a memory history — no DOM, same codec.
        const server = new RouterStore({}, routes, { history: createMemoryHistory({ url }) });
        expect(server.activeRoute?.routeParams).toEqual({ pageId: value });

        // The params the server dehydrates into the HTML are already decoded, so the
        // client must seed them as-is. Decoding again here would corrupt the value
        // (and only for values that survive one pass — hence the `%d`).
        const dehydrated = JSON.parse(JSON.stringify(server.activeRoute!.routeParams));
        const client = new RouterStore({}, routes, {
            history: createMemoryHistory({ url }),
            hydratedState: {
                path: url,
                search: '',
                hash: '',
                activeRouteName: 'page',
                routeParams: dehydrated,
            },
        });
        expect(client.activeRoute?.routeParams).toEqual({ pageId: value });

        server.dispose();
        client.dispose();
    });
});

describe('getPath param substitution', () => {
    test('a param name that prefixes another is substituted at its own boundary', () => {
        const router = new RouterStore({}, routes);

        // `id` first is the order a substring scan corrupts: `:id` matches inside
        // `:idx`, so `/x/:idx/:id` came out as `/x/7x/:id`.
        expect(router.getPath({ name: 'prefixCollision', id: '7', idx: '9' })).toBe('/x/9/7');
        // The result must not depend on the caller's key order.
        expect(router.getPath({ name: 'prefixCollision', idx: '9', id: '7' })).toBe('/x/9/7');

        router.dispose();
    });

    test('a prefix-colliding route round-trips into the right params', async () => {
        const router = new RouterStore({}, routes);
        await Promise.resolve();

        router.navigate({ name: 'prefixCollision', id: '7', idx: '9' });
        await Promise.resolve();

        expect(router.activeRoute?.name).toBe('prefixCollision');
        expect(router.activeRoute?.routeParams).toEqual({ idx: '9', id: '7' });
        router.dispose();
    });
});
