import { Link } from '../link';

export function NotFound() {
    return (
        <section>
            <h1>Not found</h1>
            <p>That URL didn't match any route.</p>
            <p>
                <Link to={{ name: 'home' }}>Back home</Link>
            </p>
        </section>
    );
}
