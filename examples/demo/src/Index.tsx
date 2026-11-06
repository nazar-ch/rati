import { Link } from 'rati';

import { sleep } from './util';

export function Index() {
    const onTestClick = () => {
        // why-void: a DOM `onClick` returns nothing, and `sleep` never rejects.
        void sleep(2000).then(() => alert('ok'));
    };

    return (
        <div className="App">
            Test
            <br />
            <br />
            <button onClick={onTestClick}>test rati</button>
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
