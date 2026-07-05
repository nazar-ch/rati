import { Link } from 'rati';
import { StatsIsland } from './StatsIsland';

// One card per demo route. `to` is checked against the route table.
const FEATURES = [
    {
        to: { name: 'about' },
        title: 'Async loads · dehydration',
        tags: ['scope().load', 'SSR dehydration'],
        blurb: 'Two async loads resolve on the server and ship in the HTML payload; the client reuses them with no re-fetch.',
    },
    {
        to: { name: 'product', productId: '1' },
        title: 'Waterfall · inputs · hook DI',
        tags: ['input', 'hook', '.load waterfall'],
        blurb: 'A :productId feeds a multi-level waterfall, and a hook() injects the region — the reason there is no env to thread.',
    },
    {
        to: { name: 'profile', userId: '7' },
        title: 'The value channel',
        tags: ['useRouteContext'],
        blurb: 'A badge nested deep in the page reads the route’s resolved data by name — no props drilled, no import cycle.',
    },
    {
        to: { name: 'counter' },
        title: 'MobX store · class load',
        tags: ['.load(Class)', 'observer'],
        blurb: 'The scope instantiates a MobX store and hands the component the instance; mutate it after hydration.',
    },
    {
        to: { name: 'live' },
        title: 'Sources · the SSR boundary',
        tags: ['Source', 'attach / detach'],
        blurb: 'A ticking clock source: pending on the server (loading slot in the HTML), live after hydration, cleaned up on navigate.',
    },
    {
        to: { name: 'flaky' },
        title: 'Error slot · retry',
        tags: ['Source', 'error', 'retry'],
        blurb: 'A source that fails then recovers; the island routes the failure to an error slot whose retry rebuilds the load.',
    },
] as const;

export function Home() {
    return (
        <article className="page">
            <section className="hero">
                <h1>rati feature gallery</h1>
                <p className="lead">
                    A small server-rendered tour of rati: declare data with a <code>scope</code>,
                    mount it with an <code>island</code> or a <code>route</code>, and components
                    receive clean, fully-resolved props. Each card is a live demo — open it and
                    watch what happens across the server/client boundary.
                </p>
            </section>

            <StatsIsland />

            <section className="grid">
                {FEATURES.map((feature) => (
                    <Link key={feature.title} to={feature.to} className="card">
                        <h3>{feature.title}</h3>
                        <div className="card-tags">
                            {feature.tags.map((tag) => (
                                <span key={tag} className="tag">
                                    {tag}
                                </span>
                            ))}
                        </div>
                        <p>{feature.blurb}</p>
                        <span className="open">Open →</span>
                    </Link>
                ))}
            </section>
        </article>
    );
}
