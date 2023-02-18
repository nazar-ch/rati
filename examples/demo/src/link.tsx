import { createLinkComponent } from 'rati';

// This import is only to get correct types, any runtime usage will not
// work because of the circular dependency (components from the routes
// use components from this file)
import { routes } from './routes';

export const Link = createLinkComponent<typeof routes>();
