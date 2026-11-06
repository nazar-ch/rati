import { Title } from 'rati';

export interface SplitProps {
    chapter: string;
}

/**
 * The gallery's lazy route: `routes.tsx` reaches it through `lazy(() => import(…))`, so
 * the client build splits it into a chunk of its own — and this module is the default
 * export a lazy route needs.
 */
export default function Split({ chapter }: SplitProps) {
    return (
        <article className="page">
            <Title>Code splitting</Title>
            <h1>Lazy routes · modulepreload</h1>
            <p className="lead">
                This page is a <code>lazy()</code> route: the build gives it a chunk of its own, and
                the entry doesn’t carry it. On the server that costs nothing —{' '}
                <code>prepareRoute</code> awaits the route’s <code>preload()</code> before
                rendering, so the HTML below is complete either way.
            </p>

            <div className="kv">
                <span className="badge server">resolved</span>
                <span>Chapter</span>
                <code className="mono">{chapter}</code>
            </div>

            <div className="note">
                <span className="badge server">server</span> The interesting part is in{' '}
                <em>View Source</em>: a <code>&lt;link rel=&quot;modulepreload&quot;&gt;</code> for
                this page’s chunk sits in the <code>&lt;head&gt;</code>. Without it the browser
                learns the chunk exists only after the entry runs and React resolves the lazy
                component — one round trip after the HTML it could have started during. The plugin
                knows which module this route imports (it recorded it) and which chunk the build
                made of it (the manifest), so it names it in the page.
            </div>

            <div className="note">
                <span className="badge client">client</span> In dev there is no chunk and no
                preload: Vite serves modules as they are. This is a production-only difference —
                build the app and read the source to see it.
            </div>
        </article>
    );
}
