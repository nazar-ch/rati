import { Link } from 'rati';
import { sleep } from './util';

export function Index() {
    // The click handler is async, but a DOM `onClick` must return `void` — so the
    // promise is wrapped with `void` at the call site rather than passed directly.
    const onTestClick = async () => {
        await sleep(2000);
        alert('ok');
    };

    return (
        <div className="App">
            Test
            <br />
            <br />
            <button onClick={() => void onTestClick()}>test rati</button>
            <br />
            <br />
            <Link to={{ name: 'test' }}>test page</Link> {' | '}
            <Link href="/test/">test page (href)</Link>
            <br />
            <br />
            <Link to={{ name: 'test-route-params-without-view', productId: '23' }}>
                test 23
            </Link> |{' '}
            <Link to={{ name: 'test-route-params-without-view', productId: '88' }}>test 88</Link>
            <br />
            <br />
            <Link to={{ name: 'simple-view' }}>test simple view</Link> |{' '}
            <Link to={{ name: 'complex-view', productName: 'Unicorn' }}>test complex view</Link>
        </div>
    );
}
