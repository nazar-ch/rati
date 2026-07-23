import type { ReactNode } from 'react';
import { Title } from 'rati';

/**
 * The throw, and the reason it is *here* rather than in the page below: a route's
 * `wrapper` renders outside the route's island, and the island's boundary is what
 * catches a render error in the page. One component lower, this same throw would be
 * caught, the page would render without its content, and the response would be a
 * cheerful 200. Out here there is nothing to catch it — so `renderApp` rejects, and
 * rati/server answers with the shell.
 *
 * `import.meta.env.SSR` is true only in the server build, so the client build drops the
 * throw as dead code. That is what makes the fallback *work* here rather than merely
 * happen: a bug that lived on both sides would white-screen either way.
 */
export function FallbackWrapper({ children }: { children: ReactNode }) {
    if (import.meta.env.SSR) {
        throw new Error('rati SSR demo — /fallback throws outside its island, on purpose.');
    }
    return <>{children}</>;
}

export function Fallback() {
    return (
        <article className="page">
            <Title>The CSR fallback</Title>
            <h1>When the server gives up</h1>
            <p className="lead">
                This route&rsquo;s <code>wrapper</code> throws during the server render — outside
                every island, where no boundary catches it and no status can encode it. There is no
                half-rendered page to send, so <code>rati/server</code> sends the shell the app
                would have hydrated: same script, same stylesheet, no payload.
            </p>

            <div className="note">
                <span className="badge server">server</span> Check the network tab: this page
                arrived with status <strong>500</strong>, and <em>View Source</em> shows an empty{' '}
                <code>#root</code> and no <code>__rati-hydration</code> script. The status is honest
                — the render did fail, and a crawler should be told so — but a reader still gets the
                app.
            </div>

            <div className="note">
                <span className="badge client">client</span> With no payload to hydrate from, the
                client entry calls <code>createRoot</code> instead of <code>hydrateRoot</code> and
                resolves every load from scratch. Which is why you can read this at all.
            </div>

            <div className="note">
                <span className="badge server">contrast</span> A load that fails is not this: the
                island catches that one, the HTML ships the loading slot, and the status carries the
                failure (see <em>Flaky</em>). This is the other half — the failure an island
                can&rsquo;t see, because it happened outside one.
            </div>

            <div className="note">
                <span className="badge client">dev</span> Reload this page under <code>vp dev</code>{' '}
                and you get Vite&rsquo;s error overlay with the stack mapped onto the source
                instead. Same throw, different answer: dev wants the error in your face, production
                wants the reader served.
            </div>
        </article>
    );
}
