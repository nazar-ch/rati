import { useContext } from 'react';
import { hook, input, scope } from 'rati';
import { RegionContext } from './appContext';
import { fetchProduct, fetchReviews } from './data';

/*
    Scopes that something below the route needs to name.

    A scope is a data module, so a descendant can import it without importing the component
    that renders it — which is the whole reason `useScope` / `useScopeControls` are keyed by
    the scope and not by a component reference. `productScope` lives here rather than in
    routes.tsx because ProductPage reads its own island's status through it, and routes.tsx
    imports ProductPage.
*/

// A waterfall: the `productId` input, a `hook()` load that injects the region from
// React context (the DI seam — no `env` to thread), then a dependent `product`
// load, then `reviews` keyed off the resolved product. The promise levels dehydrate.
export const productScope = scope({ productId: input<string>() })
    .load({ region: hook(() => useContext(RegionContext)) })
    .load({ product: ({ productId, region }) => fetchProduct(productId, region) })
    .load({ reviews: ({ product }) => fetchReviews(product.id) });
