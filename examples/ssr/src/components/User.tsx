import { Link } from 'rati';

export function User(props: { userId: string }) {
    return (
        <section>
            <h1>User {props.userId}</h1>
            <p>This page received its userId via route params, on the server.</p>
            <p>
                <Link to={{ name: 'home' }}>Back home</Link>
            </p>
        </section>
    );
}
