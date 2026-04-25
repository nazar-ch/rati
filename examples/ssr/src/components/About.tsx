import { Link } from '../link';

export interface AboutProps {
    serverTime: string;
    fact: string;
}

export function About(props: AboutProps) {
    return (
        <section>
            <h1>About</h1>
            <p>This page demonstrates the view system resolving on the server.</p>
            <ul>
                <li>
                    <strong>Server time:</strong> {props.serverTime}
                </li>
                <li>
                    <strong>Fact of the moment:</strong> {props.fact}
                </li>
            </ul>
            <p>
                <Link to={{ name: 'home' }}>Back home</Link>
            </p>
        </section>
    );
}
