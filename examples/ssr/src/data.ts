import { NotAvailableError } from 'rati';
import { sleep } from './util';

// Fake "backend" calls — deterministic (same inputs → same output) so the SSR
// payload a request dehydrates always matches what it rendered.

export interface Product {
    id: string;
    name: string;
    priceCents: number;
    region: string;
}

export interface Review {
    author: string;
    stars: number;
    text: string;
}

export interface Profile {
    userId: string;
    name: string;
    bio: string;
    joined: string;
}

const CATALOG: Record<string, { name: string; priceCents: number }> = {
    '1': { name: 'AeroPress Go', priceCents: 3900 },
    '2': { name: 'Hario V60', priceCents: 2500 },
    '3': { name: 'Fellow Stagg Kettle', priceCents: 16500 },
};

export async function fetchProduct(id: string, region: string): Promise<Product> {
    // Pretend this hits a regional catalog service.
    await sleep(120);
    const entry = CATALOG[id];
    // The data-driven 404: the route matched, the entity doesn't exist. The error
    // slot receives code 'not-available'; under SSR the collector records it and
    // renderApp derives a 404 response status from it.
    if (!entry) throw new NotAvailableError(`Product ${id} does not exist`);
    // A small regional adjustment so `region` (injected via hook) visibly matters.
    const priceCents = region === 'EU' ? Math.round(entry.priceCents * 1.1) : entry.priceCents;
    return { id, name: entry.name, priceCents, region };
}

export async function fetchReviews(productId: string): Promise<Review[]> {
    await sleep(90);
    const noun = productId === '3' ? 'kettle' : 'brewer';
    return [
        { author: 'Mira', stars: 5, text: `Best ${noun} I have owned.` },
        { author: 'Devin', stars: 4, text: 'Solid build, would buy again.' },
    ];
}

export async function fetchProfile(userId: string): Promise<Profile> {
    await sleep(110);
    return {
        userId,
        name: `User ${userId}`,
        bio: 'A rati explorer poking at scopes, sources, and the value channel.',
        joined: '2026',
    };
}
