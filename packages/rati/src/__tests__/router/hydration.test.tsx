import { describe, test, expect, vi, beforeEach, afterEach } from 'vite-plus/test';
import { RouterStore } from '../../router/store';
import { route, type GenericRouteType } from '../../router/route';
import { RootStore, RootStoreProvider } from '../../stores/RootStore';
import { Router } from '../../router/Router';
import { createBrowserHistory, createMemoryHistory } from '../../router/history';
import { prepareRoute } from '../../router/prepareRoute';
import { scope, type ScopeComponent } from '../../scope/scope';
import { ssrRender, cleanup } from '../../testing';

/*
    Route-level SSR round-trips, through the testing kit's `ssrRender` / `.hydrate()` — with
    the router wiring as a *documented composition* rather than a kit helper (the kit owns the
    prerender→collect→hydrate mechanics; the router-SSR shape stays the app's to assemble, so
    the entry doesn't freeze it). The composition: a memory-history router on the server, a
    browser-history router on the client seeded from `prepareRoute`'s snapshot, and the two
    trees handed to `ssrRender` / `.hydrate`.
*/

function Home() {
    return <div data-testid="home">welcome home</div>;
}

function User(props: { userId: string }) {
    return <div data-testid="user">user {props.userId}</div>;
}

const baseRoutes = [route('/', 'home', Home), route('/users/:userId', 'user', User)] as const;

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    window.history.replaceState(null, '', 'http://localhost/');
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    cleanup();
    consoleErrorSpy.mockRestore();
});

/**
 * The console.error calls React meant. One message is tolerated: running two react-dom
 * renderers (static/server for the prerender, client for the hydrate) in a single process
 * shares the module-level store context, which cannot happen where the server and the browser
 * are separate processes.
 *
 * This is the weaker of the two checks each round-trip makes, and deliberately not the only
 * one — see `client.recovered` below: a mismatch React client-renders through is reported to
 * `onRecoverableError`, which the round-trip's guard turns into a thrown failure (so a
 * mismatched route never even reaches these assertions).
 */
function reactErrors(calls: unknown[][]): unknown[][] {
    return calls.filter((args) => !String(args[0]).includes('multiple renderers concurrently'));
}

/**
 * The documented route round-trip: prerender the server tree (memory history) collecting its
 * payload, then hydrate the client tree (browser history) seeded from `prepareRoute`. The
 * client mount (and its router disposal) is tracked by `cleanup()`; the server router is
 * disposed inline once its render is done.
 */
async function ssrThenHydrate(url: string, routes: readonly GenericRouteType[]) {
    // ----- Server: memory history, collect the dehydration payload -----
    const serverRouter = new RouterStore({}, routes, { history: createMemoryHistory({ url }) });
    const serverRoot = new RootStore({ router: serverRouter }, { isReady: true });
    const prepared = await prepareRoute(serverRouter);
    const server = await ssrRender(
        <RootStoreProvider rootStore={serverRoot}>
            <Router />
        </RootStoreProvider>,
    );
    serverRouter.dispose();

    // ----- Client: browser history seeded from the routing snapshot, hydrate -----
    window.history.replaceState(null, '', url);
    const clientRouter = new RouterStore({}, routes, {
        history: createBrowserHistory(),
        hydratedState: prepared!.hydratedState,
    });
    const clientRoot = new RootStore({ router: clientRouter }, { isReady: true });
    const client = await server.hydrate(
        <RootStoreProvider rootStore={clientRoot}>
            <Router />
        </RootStoreProvider>,
        { onDispose: () => clientRouter.dispose() },
    );

    return { prepared, server, client };
}

describe('SSR + hydration', () => {
    test('hydrates a static route with no mismatch', async () => {
        const { server, client } = await ssrThenHydrate('/', baseRoutes);

        expect(server.html).toContain('welcome home');
        // The server's markup was hydrated as-is: React neither recovered from a mismatch
        // (the round-trip guard would have thrown) nor said anything of its own.
        expect(client.recovered).toEqual([]);
        expect(reactErrors(consoleErrorSpy.mock.calls)).toEqual([]);
    });

    test('hydrates a parameterized route with no mismatch', async () => {
        const { server, client } = await ssrThenHydrate('/users/42', baseRoutes);

        expect(server.html).toContain('data-testid="user"');
        expect(client.recovered).toEqual([]);
        expect(reactErrors(consoleErrorSpy.mock.calls)).toEqual([]);
    });

    test('hydrates a scope route from dehydrated island data without re-running its promise', async () => {
        let calls = 0;
        const greetingScope = scope().load({
            greeting: async () => {
                calls++;
                return 'hello from server';
            },
        });
        const Greeting: ScopeComponent<typeof greetingScope> = ({ greeting }) => (
            <div data-testid="greeting">{greeting}</div>
        );
        const routesWithScope = [route('/', 'home', Greeting, { scope: greetingScope })] as const;

        const { server, client } = await ssrThenHydrate('/', routesWithScope);

        // The promise resolved once, server-side (the prerender awaited it), and its value
        // was dehydrated into the payload.
        expect(server.html).toContain('hello from server');
        expect(calls).toBe(1);

        // The client hydrated from that payload: the content rendered and the promise was
        // not re-run. No mismatch — the dehydrated value rendered the same markup the server
        // shipped, so React had nothing to recover from.
        expect(client.text()).toContain('hello from server');
        expect(calls).toBe(1);
        expect(client.recovered).toEqual([]);
        expect(reactErrors(consoleErrorSpy.mock.calls)).toEqual([]);
    });
});
