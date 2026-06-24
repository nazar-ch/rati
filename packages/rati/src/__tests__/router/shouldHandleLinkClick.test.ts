import { describe, test, expect, beforeEach } from 'vite-plus/test';
import type React from 'react';
import { shouldHandleLinkClick } from '../../router/Link';

beforeEach(() => {
    window.history.replaceState(null, '', 'http://localhost/');
});

interface FakeEventOptions {
    defaultPrevented?: boolean;
    button?: number;
    metaKey?: boolean;
    altKey?: boolean;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    href?: string;
    target?: string | null;
    download?: boolean;
}

/**
 * Build a minimal MouseEvent stand-in. The real React.MouseEvent has dozens of
 * fields; `shouldHandleLinkClick` only reads a handful, so we shim those.
 */
function fakeClickEvent(opts: FakeEventOptions = {}): React.MouseEvent<HTMLAnchorElement> {
    const anchor = document.createElement('a');
    if (opts.href !== undefined) anchor.setAttribute('href', opts.href);
    if (opts.target !== undefined && opts.target !== null) {
        anchor.setAttribute('target', opts.target);
    }
    if (opts.download) anchor.setAttribute('download', '');

    return {
        defaultPrevented: opts.defaultPrevented ?? false,
        button: opts.button ?? 0,
        metaKey: opts.metaKey ?? false,
        altKey: opts.altKey ?? false,
        ctrlKey: opts.ctrlKey ?? false,
        shiftKey: opts.shiftKey ?? false,
        currentTarget: anchor,
    } as unknown as React.MouseEvent<HTMLAnchorElement>;
}

describe('shouldHandleLinkClick', () => {
    test('returns true for a plain left click on a same-origin link', () => {
        expect(shouldHandleLinkClick(fakeClickEvent({ href: '/foo' }))).toBe(true);
    });

    test('returns false when the event was already defaultPrevented', () => {
        expect(
            shouldHandleLinkClick(fakeClickEvent({ href: '/foo', defaultPrevented: true }))
        ).toBe(false);
    });

    test.each([
        ['middle click', { button: 1 }],
        ['right click', { button: 2 }],
    ])('returns false for %s', (_label, eventOpts) => {
        expect(shouldHandleLinkClick(fakeClickEvent({ href: '/foo', ...eventOpts }))).toBe(false);
    });

    test.each([
        ['meta', { metaKey: true }],
        ['ctrl', { ctrlKey: true }],
        ['alt', { altKey: true }],
        ['shift', { shiftKey: true }],
    ])('returns false when the %s modifier is held', (_label, eventOpts) => {
        expect(shouldHandleLinkClick(fakeClickEvent({ href: '/foo', ...eventOpts }))).toBe(false);
    });

    test('returns false for target="_blank"', () => {
        expect(shouldHandleLinkClick(fakeClickEvent({ href: '/foo', target: '_blank' }))).toBe(
            false
        );
    });

    test('returns false for target="_top"', () => {
        expect(shouldHandleLinkClick(fakeClickEvent({ href: '/foo', target: '_top' }))).toBe(false);
    });

    test('returns true for explicit target="_self"', () => {
        expect(shouldHandleLinkClick(fakeClickEvent({ href: '/foo', target: '_self' }))).toBe(true);
    });

    test('returns false for download links', () => {
        expect(shouldHandleLinkClick(fakeClickEvent({ href: '/file.pdf', download: true }))).toBe(
            false
        );
    });

    test('returns false for cross-origin links', () => {
        expect(shouldHandleLinkClick(fakeClickEvent({ href: 'https://example.com/x' }))).toBe(
            false
        );
    });

    test('returns true for same-origin absolute links', () => {
        expect(shouldHandleLinkClick(fakeClickEvent({ href: 'http://localhost/foo' }))).toBe(true);
    });
});
