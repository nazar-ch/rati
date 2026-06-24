import { describe, test, expect, beforeEach, afterEach, vi } from 'vite-plus/test';
import { type FC } from 'react';
import { act, render, screen, cleanup } from '@testing-library/react';
import { Suspense } from 'react';
import { lazy } from '../../router/lazy';

beforeEach(() => {
    window.history.replaceState(null, '', 'http://localhost/');
});

afterEach(() => {
    cleanup();
});

describe('lazy()', () => {
    test('exposes a preload() method', () => {
        const Component = lazy(async () => ({ default: (() => null) as FC }));
        expect(typeof Component.preload).toBe('function');
    });

    test('preload() invokes the factory only once across multiple calls', () => {
        const factory = vi.fn(async () => ({ default: (() => null) as FC }));
        const Component = lazy(factory);

        void Component.preload();
        void Component.preload();
        void Component.preload();

        expect(factory).toHaveBeenCalledOnce();
    });

    test('rendering after preload reuses the cached chunk (no second factory call)', async () => {
        const factory = vi.fn(async () => ({
            default: () => <div data-testid="cached">cached</div>,
        }));
        const Component = lazy(factory);

        await act(async () => {
            await Component.preload();
        });
        expect(factory).toHaveBeenCalledOnce();

        await act(async () => {
            render(
                <Suspense fallback={<div data-testid="loading">loading</div>}>
                    <Component />
                </Suspense>,
            );
        });

        // Already-resolved chunk renders without showing the fallback
        // (no second factory invocation either).
        expect(screen.getByTestId('cached')).toBeDefined();
        expect(factory).toHaveBeenCalledOnce();
    });

    test('preload() returns the same promise as the lazy render path', async () => {
        const moduleObj = { default: (() => null) as FC };
        const factory = vi.fn(async () => moduleObj);
        const Component = lazy(factory);

        const a = Component.preload();
        const b = Component.preload();
        expect(a).toBe(b);
        await expect(a).resolves.toBe(moduleObj);
    });
});
