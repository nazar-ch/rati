import { createLinkComponent } from 'rati';
import type { routes } from './routes';

export const { Link } = createLinkComponent<typeof routes>();
