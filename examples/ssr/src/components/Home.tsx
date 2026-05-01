import { Link } from 'rati';

export function Home() {
    return (
        <section>
            <h1>Home</h1>
            <p>Welcome to the rati SSR demo.</p>
            <nav>
                <ul>
                    <li>
                        <Link to={{ name: 'about' }}>About</Link>
                    </li>
                    <li>
                        <Link to={{ name: 'user', userId: '42' }}>User 42</Link>
                    </li>
                </ul>
            </nav>
        </section>
    );
}
