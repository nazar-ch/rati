import { Link } from 'rati';

export function NotFound() {
    return (
        <section>
            <h1>Not found</h1>
            <p>That URL didn&apos;t match any route.</p>
            <p>
                <Link to={{ name: 'home' }}>Back home</Link>
            </p>
        </section>
    );
}
