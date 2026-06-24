export interface AboutProps {
    serverTime: string;
    fact: string;
}

export function About({ serverTime, fact }: AboutProps) {
    return (
        <article className="page">
            <h1>Async loads · dehydration</h1>
            <p className="lead">
                The about scope is two async loads in one level. They resolve on the server before
                render, ship in the page payload, and the client reuses them verbatim — no second
                fetch, no loading flash.
            </p>

            <div className="kv">
                <span className="badge server">resolved</span>
                <span>Server time</span>
                <code className="mono">{serverTime}</code>
                <span>Fact of the moment</span>
                <span>{fact}</span>
            </div>

            <div className="note">
                <span className="badge server">server</span> Open <em>View Source</em>: both values
                appear in the HTML and again under <code>window.__RATI_STATE__</code> — that second
                copy is what the client hydrates from.
            </div>
        </article>
    );
}
