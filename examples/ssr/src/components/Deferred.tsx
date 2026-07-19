import { island, scope } from 'rati';
import { sleep } from '../util';

// Where the load actually ran. The one-word, honest answer to "did this gate the
// document?" — and the thing the two islands below disagree about.
const ranOn = () => (typeof window === 'undefined' ? 'the server' : 'the client');

// ---------------------------------------------------------------------------------
// The default: `prerender` is all-or-nothing, so this load is awaited before a single
// byte goes out, and its value ships in the HTML payload.

const headlineScope = scope().load({
    headline: async () => {
        await sleep(120);
        return { where: ranOn(), at: new Date().toISOString() };
    },
});

const HeadlineIsland = island({
    scope: headlineScope,
    component: ({ headline }) => (
        <div className="kv">
            <span className="badge server">blocking</span>
            <span>resolved on</span>
            <strong>{headline.where}</strong>
            <span>at</span>
            <code className="mono">{headline.at}</code>
        </div>
    ),
    loading: () => <div className="note">resolving the headline…</div>,
});

// ---------------------------------------------------------------------------------
// The same island with one option flipped. Nothing about the scope changes — the load
// is just as async — but the server never starts it: it renders the loading slot into
// the HTML and the browser picks the work up after hydration.

const feedScope = scope().load({
    feed: async () => {
        // Deliberately slow. On the default path this would be 700ms of TTFB that every
        // visitor pays before seeing anything at all.
        await sleep(700);
        return { where: ranOn(), at: new Date().toISOString() };
    },
});

const FeedIsland = island({
    scope: feedScope,
    component: ({ feed }) => (
        <div className="kv">
            <span className="badge client">deferred</span>
            <span>resolved on</span>
            <strong>{feed.where}</strong>
            <span>at</span>
            <code className="mono">{feed.at}</code>
        </div>
    ),
    // This is what View Source shows. It is in the HTML on purpose.
    loading: () => <div className="note">loading the activity feed…</div>,
    ssr: false,
});

export function DeferredPage() {
    return (
        <article className="page">
            <h1>Opting an island out of SSR</h1>
            <p className="lead">
                Two islands on one page, identical but for a single option. The first is the default
                and gates the response; the second sets <code>ssr: false</code>, so the server ships
                its loading slot and the browser resolves it after hydration.
            </p>

            <HeadlineIsland />
            <FeedIsland />

            <div className="note">
                <span className="badge server">view source</span> Reload and read the raw HTML: the
                blocking island’s timestamp is in it, and where the deferred island sits you will
                find the words <code>loading the activity feed…</code>. That spinner shipped on
                purpose — it is the pressure valve for <code>prerender</code> being all-or-nothing.
                rati does not stream, so an island that shouldn’t hold the document up opts out
                instead.
            </div>

            <div className="note">
                <span className="badge client">note</span> The opt-out belongs to the island, so it
                wins over anything inside its scope — a source marked <code>ssr: true</code> in an{' '}
                <code>ssr: false</code> island stays pending on the server too. And because the
                island contributes nothing to the payload, it can’t contribute a server-side load
                failure either: no 404 or 5xx can come from this half of the page.
            </div>
        </article>
    );
}
