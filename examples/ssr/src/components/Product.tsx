import { Link } from 'rati';
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
            </div>

            <div className="note">
                <span className="badge server">server</span> Every value above was resolved during
                the server render and embedded in <code>__RATI_STATE__</code>; navigating between
                products re-resolves the waterfall for the new id.
            </div>
        </article>
    );
}
