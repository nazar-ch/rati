import { observer } from 'mobx-react-lite';
import { island, scope } from 'rati';
import { CounterStore } from '../stores/CounterStore';

// The scope resolves a single class load: the island does `new CounterStore(...)`
// and hands the instance to the component. An `observer`, so reads of `count`
// re-render on mutation.
const counterScope = scope().load({ counter: CounterStore });

const CounterCard = island({
    scope: counterScope,
    component: observer(({ counter }: { counter: CounterStore }) => (
        <div className="bigvalue">
            <button type="button" className="btn" onClick={() => counter.decrement()}>
                −
            </button>
            <span className="value mono">{counter.count}</span>
            <button type="button" className="btn" onClick={() => counter.increment()}>
                +
            </button>
            <button type="button" className="btn ghost" onClick={() => counter.reset()}>
                reset
            </button>
        </div>
    )),
    loading: () => <div className="value mono muted">0</div>,
});

export function Counter() {
    return (
        <article className="page">
            <h1>MobX store · class load</h1>
            <p className="lead">
                <code>scope().load(&#123; counter: CounterStore &#125;)</code> resolves a class by
                instantiating it. The component gets the live store instance and mutates it as an{' '}
                <code>observer</code>.
            </p>

            <CounterCard />

            <div className="note">
                <span className="badge server">server</span> The store renders at its initial state
                (<code>0</code>) in the SSR HTML, so the first paint matches.{' '}
                <span className="badge client">client</span> After hydration the buttons mutate the
                store; navigating away and back builds a fresh instance.
            </div>
        </article>
    );
}
