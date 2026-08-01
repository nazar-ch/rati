import './App.css';
import { createRouter, RouterOutlet, RouterProvider } from 'rati';
import { routes } from './routes';

// One router for the app's lifetime, built at module scope — nothing about it is
// React state.
const router = createRouter(routes);

export function App() {
    return (
        <RouterProvider router={router}>
            <RouterOutlet />
        </RouterProvider>
    );
}
