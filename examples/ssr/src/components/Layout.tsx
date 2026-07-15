import type { ReactNode } from 'react';
import { Link, useRouter } from 'rati';

// Each entry's `to` is typed against the route table (the RatiUserTypes['routes']
// augmentation in routes.tsx), so a wrong name or a missing param is a type error.
const LINKS = [
    { to: { name: 'home' }, label: 'Home' },
    { to: { name: 'about' }, label: 'About' },
    { to: { name: 'product', productId: '1' }, label: 'Product' },
    { to: { name: 'profile', userId: '7' }, label: 'Profile' },
    { to: { name: 'counter' }, label: 'Counter' },
    { to: { name: 'live' }, label: 'Live' },
    { to: { name: 'flaky' }, label: 'Flaky' },
    { to: { name: 'split' }, label: 'Split' },
    { to: { name: 'fallback' }, label: 'Fallback' },
] as const;

/**
 * App chrome wrapped around the router (in `createApp`), so it renders once and
 * survives navigation. `useRouter()` subscribes via useSyncExternalStore, so
 * reading `router.activeRoute` re-highlights the active link as you navigate — no
 * `observer` needed.
 */
export function Layout({ children }: { children: ReactNode }) {
    const router = useRouter();
    const active = router.activeRoute?.name;
    return (
        <div className="shell">
            <header className="topbar">
                <Link to={{ name: 'home' }} className="brand">
                    🦜 rati
                </Link>
                <nav className="nav">
                    {LINKS.map(({ to, label }) => (
                        <Link
                            key={label}
                            to={to}
                            className={active === to.name ? 'navlink active' : 'navlink'}
                        >
                            {label}
                        </Link>
                    ))}
                </nav>
            </header>
            <main className="content">{children}</main>
            <footer className="foot">
                Every page declares its data with a rati <code>scope</code> and resolves it through
                an island — server-rendered, then hydrated.
            </footer>
        </div>
    );
}
