import { Link, Meta, Title, type SourceError } from 'rati';
import type { Product, Review } from '../data';

// Matches the resolved shape of `productScope` (routes.tsx): the `productId` input,
// the `region` from the hook load, then the dependent `product` and `reviews`
// levels. `route` checks this component against that scope structurally.
interface ProductPageProps {
    productId: string;
    region: string;
    product: Product;
    reviews: Review[];
}

const STARS = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);
const price = (cents: number, region: string) =>
    `${region === 'EU' ? '€' : '$'}${(cents / 100).toFixed(2)}`;

export function ProductPage({ productId, region, product, reviews }: ProductPageProps) {
    return (
        <article className="page">
            {/* Declared from resolved data: the deepest Title wins over the store's
                default, the server reads it after prerender (headTags), the client
                keeps document.title in sync across navigations. */}
            <Title>{product.name}</Title>
            <Meta name="description" content={`${product.name} — the rati SSR gallery.`} />
            <h1>{product.name}</h1>
            <p className="lead">
                The scope is a waterfall: the <code>:productId</code> path param feeds a{' '}
                <code>hook()</code> that injects the region, then a dependent <code>product</code>{' '}
                load, then a <code>reviews</code> load keyed off the resolved product — all awaited
                on the server and dehydrated.
            </p>

            <div className="kv">
                <span className="badge server">resolved</span>
                <span>Price</span>
                <code className="mono">{price(product.priceCents, region)}</code>
                <span>Region (via hook)</span>
                <code className="mono">{region}</code>
                <span>Product id (path param)</span>
                <code className="mono">{productId}</code>
            </div>

            <h3>Reviews</h3>
            <ul className="reviews">
                {reviews.map((review) => (
                    <li key={review.author}>
                        <span className="stars">{STARS(review.stars)}</span> {review.text}
                        <span className="muted"> — {review.author}</span>
                    </li>
                ))}
            </ul>

            <div className="row">
                <span className="muted">Try another product:</span>
                <Link to={{ name: 'product', productId: '1' }}>#1</Link>
                <Link to={{ name: 'product', productId: '2' }}>#2</Link>
                <Link to={{ name: 'product', productId: '3' }}>#3</Link>
                <span className="muted">— or the failure modes:</span>
                <Link to={{ name: 'product', productId: '9' }}>#9 (missing → 404)</Link>
                <Link to={{ name: 'store', productId: '2' }}>/store/2 (redirect → 301)</Link>
            </div>

            <div className="note">
                <span className="badge server">server</span> Every value above was resolved during
                the server render and embedded in the hydration payload; navigating between products
                re-resolves the waterfall for the new id. Product #9 throws{' '}
                <code>NotAvailableError</code> — the error slot below on the client, an HTTP 404 on
                the server. <code>/store/2</code> is a route-level redirect: the server answers 301
                before rendering; the client hops with a history replace.
            </div>
        </article>
    );
}

/**
 * The product route's error slot. `not-available` is the data-driven 404 (thrown by
 * fetchProduct for unknown ids); anything else is a transient failure with a retry.
 */
export function ProductError({ error, retry }: { error: SourceError; retry: () => void }) {
    if (error.code === 'not-available') {
        return (
            <article className="page">
                <Title>Product not found</Title>
                <h1>No such product</h1>
                <p className="lead">{error.message}</p>
                <div className="note">
                    <span className="badge err">404</span> The route matched but the data does not
                    exist — the server derived HTTP 404 from this same error code.
                </div>
            </article>
        );
    }
    return (
        <article className="page">
            <h1>Something broke</h1>
            <div className="bigvalue error">
                <span>{error.message ?? 'Load failed'}</span>
                <button className="btn" onClick={retry}>
                    Retry
                </button>
            </div>
        </article>
    );
}
