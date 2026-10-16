import { island, scope, useScope } from 'rati';

// A standalone island (not bound to a route): it resolves its own async data,
// dehydrates it into the SSR payload, and provides the resolved props to its
// subtree. Composed inside the Home page to show islands nest and each dehydrates
// its own slice.
const statsScope = scope().load({
    renderedAt: async () => new Date().toISOString(),
});

// Threaded no props — it reads the island's resolved value off the scope channel.
function StatsReadout() {
    const { renderedAt } = useScope(statsScope);
    return <code className="mono">{renderedAt}</code>;
}

export const StatsIsland = island({
    scope: statsScope,
    component: () => (
        <div className="note">
            <span className="badge server">island</span> This widget is a standalone{' '}
            <code>island()</code>. Its timestamp resolved once on the server (<StatsReadout />
            ), shipped in the page, and the client reused it with no re-fetch — and a nested child
            read it through <code>useScope</code>, no prop drilling.
        </div>
    ),
    loading: () => <div className="note">resolving server stats…</div>,
});
