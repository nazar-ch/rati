import { island, scope } from 'rati';
import { sleep } from '../util';

// A backend that is down for the server and up for the browser — the shape of a page
// whose data lives behind something the render host can't reach. Contrived, and the only
// way to show both halves of the round trip on one click.
const orderStatus = async () => {
    await sleep(80);
    if (typeof window === 'undefined') {
        throw new Error('order service unreachable from the render host');
    }
    return { id: 'A-4127', state: 'shipped', at: new Date().toISOString() };
};

const orderScope = scope().load({ order: orderStatus });

const OrderCard = island({
    scope: orderScope,
    component: ({ order }) => (
        <div className="bigvalue">
            <span className="badge live">ready</span>
            <span className="value">
                ✅ order {order.id} — {order.state}
            </span>
            <code className="mono">{order.at}</code>
        </div>
    ),
    // Never reached under SSR on this page: the load fails before the slot could show.
    loading: () => (
        <div className="bigvalue">
            <span className="badge client">loading…</span>
            <span className="value muted">reaching the order service…</span>
        </div>
    ),
    error: ({ error, retry }) => (
        <div className="bigvalue error">
            <span className="badge err">error · {error.code}</span>
            <span className="value">⚠️ {error.message ?? 'failed'}</span>
            <button type="button" className="btn" onClick={retry}>
                retry
            </button>
        </div>
    ),
    // The option this page is about. Without it the server would ship the *loading* slot
    // and the client would quietly re-run the load — self-healing, but the first paint
    // would be a spinner for a failure the server already knew about.
    ssrErrors: 'dehydrate',
});

export function Broken() {
    return (
        <article className="page">
            <h1>Dehydrating a server-side failure</h1>
            <p className="lead">
                This island’s load fails on the server and succeeds in the browser. With{' '}
                <code>ssrErrors: &apos;dehydrate&apos;</code> the server renders the{' '}
                <code>error</code> slot into the HTML and sends the failure along with it, so the
                browser hydrates straight onto the same slot — no spinner, no silent re-fetch.
            </p>

            <OrderCard />

            <div className="note">
                <span className="badge server">view source</span> The raw HTML holds the error slot,
                not the loading one, and the payload script carries an <code>errors</code> section
                next to <code>data</code> and <code>seeds</code> —{' '}
                <code>{'{ code, message }'}</code>, nothing more. A <code>cause</code> never
                travels: a live <code>Error</code> does not survive JSON, and a server-side cause
                chain is not the browser’s business. The <code>message</code> does, which is the
                trade — a load whose failures carry backend text should say something else instead.
            </div>

            <div className="note">
                <span className="badge client">client</span> Press <strong>retry</strong>: the
                slot’s own button re-resolves the island, the load runs here for the first time, and
                it succeeds. Nothing ran automatically to get there — that is the difference from
                the default, where React’s abandoned boundary re-runs the load during hydration.
            </div>

            <div className="note">
                <span className="badge err">status</span> The response is still a{' '}
                <strong>500</strong>. The option changes what is painted, not what the server knows:
                the failure is recorded either way, and <code>renderApp</code> derives the status
                from it (a <code>NotAvailableError</code> here would be a 404 with the same rendered
                slot).
            </div>
        </article>
    );
}
