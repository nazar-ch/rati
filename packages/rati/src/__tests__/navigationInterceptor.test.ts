import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { interceptNavigations, isNavigationApiAvailable } from '../common/navigationInterceptor';

interface FakeNavigateEvent {
    canIntercept: boolean;
    hashChange: boolean;
    downloadRequest: string | null;
    formData: unknown;
    destination: { url: string; getState(): unknown };
    intercept: ReturnType<typeof vi.fn>;
}

class FakeNavigation {
    private listeners = new Set<(e: FakeNavigateEvent) => void>();

    addEventListener(_type: 'navigate', listener: (e: FakeNavigateEvent) => void) {
        this.listeners.add(listener);
    }

    removeEventListener(_type: 'navigate', listener: (e: FakeNavigateEvent) => void) {
        this.listeners.delete(listener);
    }

    /** Test helper: dispatch a synthetic navigate event. */
    fire(event: Partial<FakeNavigateEvent> = {}): FakeNavigateEvent {
        const full: FakeNavigateEvent = {
            canIntercept: true,
            hashChange: false,
            downloadRequest: null,
            formData: null,
            destination: { url: 'http://localhost/somewhere', getState: () => null },
            intercept: vi.fn(),
            ...event,
        };
        for (const l of this.listeners) l(full);
        return full;
    }

    get listenerCount() {
        return this.listeners.size;
    }
}

beforeEach(() => {
    window.history.replaceState(null, '', 'http://localhost/');
});

afterEach(() => {
    delete (window as unknown as { navigation?: unknown }).navigation;
});

describe('isNavigationApiAvailable', () => {
    test('false when window.navigation is missing', () => {
        delete (window as unknown as { navigation?: unknown }).navigation;
        expect(isNavigationApiAvailable()).toBe(false);
    });

    test('true when window.navigation is present', () => {
        (window as unknown as { navigation: unknown }).navigation = new FakeNavigation();
        expect(isNavigationApiAvailable()).toBe(true);
    });
});

describe('interceptNavigations', () => {
    test('returns a no-op unsubscribe when the API is not available', () => {
        delete (window as unknown as { navigation?: unknown }).navigation;
        const handler = vi.fn();
        const unsubscribe = interceptNavigations(handler);
        expect(typeof unsubscribe).toBe('function');
        // Calling it must not throw.
        expect(() => unsubscribe()).not.toThrow();
    });

    test('intercepts plain same-origin navigations and forwards them to the handler', async () => {
        const nav = new FakeNavigation();
        (window as unknown as { navigation: FakeNavigation }).navigation = nav;
        const handler = vi.fn();
        interceptNavigations(handler);

        const event = nav.fire({
            destination: {
                url: 'http://localhost/foo?bar=1',
                getState: () => ({ count: 7 }),
            },
        });

        expect(event.intercept).toHaveBeenCalledOnce();
        // The handler runs inside the intercept handler — invoke it manually
        // to mirror what the browser would do.
        const interceptArgs = event.intercept.mock.calls[0]![0];
        await interceptArgs.handler();

        expect(handler).toHaveBeenCalledOnce();
        const passed = handler.mock.calls[0]![0];
        expect(passed.url.pathname).toBe('/foo');
        expect(passed.url.search).toBe('?bar=1');
        expect(passed.state).toEqual({ count: 7 });
    });

    test('skips events the platform marks non-interceptable', () => {
        const nav = new FakeNavigation();
        (window as unknown as { navigation: FakeNavigation }).navigation = nav;
        const handler = vi.fn();
        interceptNavigations(handler);

        const event = nav.fire({ canIntercept: false });
        expect(event.intercept).not.toHaveBeenCalled();
        expect(handler).not.toHaveBeenCalled();
    });

    test('skips same-document hash changes', () => {
        const nav = new FakeNavigation();
        (window as unknown as { navigation: FakeNavigation }).navigation = nav;
        const handler = vi.fn();
        interceptNavigations(handler);

        const event = nav.fire({ hashChange: true });
        expect(event.intercept).not.toHaveBeenCalled();
    });

    test('skips download requests', () => {
        const nav = new FakeNavigation();
        (window as unknown as { navigation: FakeNavigation }).navigation = nav;
        const handler = vi.fn();
        interceptNavigations(handler);

        const event = nav.fire({ downloadRequest: 'file.pdf' });
        expect(event.intercept).not.toHaveBeenCalled();
    });

    test('skips form submissions', () => {
        const nav = new FakeNavigation();
        (window as unknown as { navigation: FakeNavigation }).navigation = nav;
        const handler = vi.fn();
        interceptNavigations(handler);

        const event = nav.fire({ formData: new FormData() });
        expect(event.intercept).not.toHaveBeenCalled();
    });

    test('skips cross-origin destinations', () => {
        const nav = new FakeNavigation();
        (window as unknown as { navigation: FakeNavigation }).navigation = nav;
        const handler = vi.fn();
        interceptNavigations(handler);

        const event = nav.fire({
            destination: { url: 'https://example.com/x', getState: () => null },
        });
        expect(event.intercept).not.toHaveBeenCalled();
    });

    test('unsubscribe removes the navigate listener', () => {
        const nav = new FakeNavigation();
        (window as unknown as { navigation: FakeNavigation }).navigation = nav;
        const handler = vi.fn();
        const unsubscribe = interceptNavigations(handler);
        expect(nav.listenerCount).toBe(1);

        unsubscribe();
        expect(nav.listenerCount).toBe(0);
    });
});
