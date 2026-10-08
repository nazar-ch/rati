import { useContext } from 'react';

import { hook, input, scope } from 'rati';

import { RegionContext } from './appContext';
import { fetchProduct, fetchReviews } from './data';

// Scopes something below the route names: `useScope` keys on the scope, never a component,
// so a descendant imports this data module without the component that renders it.
// `productScope` lives here because routes.tsx imports ProductPage, which reads it.

// A waterfall whose `hook()` level injects the region from React context — the DI seam,
// with no `env` to thread. The promise levels dehydrate.
export const productScope = scope({ productId: input<string>() })
    .load({ region: hook(() => useContext(RegionContext)) })
    .load({ product: ({ productId, region }) => fetchProduct(productId, region) })
    .load({ reviews: ({ product }) => fetchReviews(product.id) });
