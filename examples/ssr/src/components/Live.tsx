import { island, scope } from 'rati';
import { clockSource } from '../sources/clock';

// A source-backed scope. `time` unwraps the Source<string> to its ready value.
const clockScope = scope().load({ time: () => clockSource() });

const ClockCard = island({
    scope: clockScope,
    component: ({ time }: { time: string }) => (
        <div className="bigvalue">
            <span className="badge live">live</span>
            <span className="value mono">{time}</span>
        </div>
    ),
    // Sources stay pending under SSR, so this is what lands in the HTML.
    loading: () => (
        <div className="bigvalue">
            <span className="badge client">starting…</span>
            <span className="value mono muted">--:--:--</span>
        </div>
    ),
});

export function Live() {
    return (
        <article className="page">
            <h1>Sources · the SSR boundary</h1>
            <p className="lead">
                A <code>Source</code> is a reactive <code>pending → ready</code> state machine the
                island observes. This clock source ticks once a second once it is attached.
            </p>

            <ClockCard />

            <div className="note">
                <span className="badge server">server</span> View source: the HTML carries the{' '}
                <em>loading slot</em> — a source can’t resolve during the static render, so it stays
                pending. <span className="badge client">client</span> After hydration the island
                attaches the source and it goes live; navigating away runs the source’s detach and
                clears its interval.
            </div>
        </article>
    );
}
