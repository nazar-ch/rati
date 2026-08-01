import { island, scope } from 'rati';
import { flakyService } from '../sources/flaky';

const flakyScope = scope().load({ status: () => flakyService() });

const FlakyCard = island({
    scope: flakyScope,
    component: ({ status }: { status: string }) => (
        <div className="bigvalue">
            <span className="badge live">ready</span>
            <span className="value">✅ {status}</span>
        </div>
    ),
    loading: () => (
        <div className="bigvalue">
            <span className="badge client">connecting…</span>
            <span className="value muted">reaching the flaky service…</span>
        </div>
    ),
    // not-available / forbidden / failed all arrive here as one SourceError — switch
    // on `error.code` to tell them apart. `retry` remounts the inner tree.
    error: ({ error, retry }) => (
        <div className="bigvalue error">
            <span className="badge err">error · {error.code}</span>
            <span className="value">⚠️ {error.message ?? 'failed'}</span>
            <button type="button" className="btn" onClick={retry}>
                retry
            </button>
        </div>
    ),
});

export function Flaky() {
    return (
        <article className="page">
            <h1>Error slot · retry</h1>
            <p className="lead">
                This source fails on every odd attempt and succeeds on every even one. The island
                routes the failure to its <code>error</code> slot; the slot’s <code>retry</code>{' '}
                rebuilds the load.
            </p>

            <FlakyCard />

            <div className="note">
                <span className="badge server">server</span> The source is pending during SSR, so
                the HTML shows the loading slot. <span className="badge client">client</span> After
                hydration the first attempt errors — click <strong>retry</strong> and the next
                attempt connects.
            </div>
        </article>
    );
}
