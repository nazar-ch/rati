import { sleep } from 'rati';
import { Link } from './link';

export function Index() {
    return (
        <div className="App">
            Test
            <br />
            <br />
            <button
                onClick={async () => {
                    await sleep(2000);
                    alert('ok');
                }}
            >
                test rati
            </button>
            <br />
            <br />
            <Link to={{ name: 'test' }}>test page</Link>
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
