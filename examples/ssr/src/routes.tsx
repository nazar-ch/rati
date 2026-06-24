import { route, scope } from 'rati';
import { Home } from './components/Home';
import { User } from './components/User';
import { About } from './components/About';
import { NotFound } from './components/NotFound';
import type { GenericRouteType } from 'rati';

declare module 'rati' {
    interface RatiUserTypes {
        routes: typeof routes;
    }
}

const aboutScope = scope().load({
    // Both loads are async (promises), so the island engine dehydrates their
    // resolved values into the SSR payload — the client reuses them verbatim
    // instead of re-running the loads (a sync load would not be serialized, and
    // its client re-run would mismatch the server HTML).
    serverTime: async () => new Date().toISOString(),
    fact: async () => {
        // Pretend this is a database/HTTP fetch. Awaited on the server before
        // render; embedded in the SSR payload so the client doesn't refetch.
        await new Promise((resolve) => setTimeout(resolve, 10));
        const facts = [
            'Octopuses have three hearts.',
            'Honey never spoils.',
            'Bananas are berries; strawberries are not.',
        ];
        return facts[Math.floor(Math.random() * facts.length)]!;
    },
});

export const routes = [
    route('/', 'home', Home),
    route('/about', 'about', About, { scope: aboutScope }),
    route('/users/:userId', 'user', User),
    route('*', 'notFound', NotFound),
] as const satisfies GenericRouteType[];
