import { route, createView } from 'rati';
import { Home } from './components/Home';
import { User } from './components/User';
import { About } from './components/About';
import { NotFound } from './components/NotFound';

const aboutView = createView({
    serverTime: () => new Date().toISOString(),
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
    route('/about', 'about', About, aboutView),
    route('/users/:userId', 'user', User),
    route('*', 'notFound', NotFound),
] as const;
