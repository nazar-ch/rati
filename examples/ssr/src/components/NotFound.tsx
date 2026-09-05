import { Link } from 'rati';

export function NotFound() {
    return (
        <article className="page">
            <h1>Not found</h1>
            <p className="lead">That URL didn&apos;t match any route, so the catch-all rendered.</p>
            <p>
                <Link to={{ name: 'home' }}>← Back to the gallery</Link>
            </p>
        </article>
    );
}
