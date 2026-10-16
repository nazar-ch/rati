import { describe, test, expect } from 'vite-plus/test';

import { is } from '../../util/utils.js';

// `is.class` decides whether the resolver constructs a load entry or calls it, and a class
// invoked without `new` throws, so a wrong answer on a real build is fatal. The shapes below
// are the ones a bundler produces.

describe('is.class', () => {
    test('a named class declaration', () => {
        class Store {
            count = 0;
        }
        expect(is.class(Store)).toBe(true);
    });

    test('a minified anonymous class — `class{…}`, no space after the keyword', () => {
        // Built through `new Function` on purpose: written as a literal, the formatter
        // (or a future one) would re-insert the space and quietly retire the regression.
        const makeMinifiedClass = new Function('return class{count=0}') as () => unknown;
        const Minified = makeMinifiedClass();
        expect(Function.prototype.toString.call(Minified).startsWith('class{')).toBe(true);
        expect(is.class(Minified)).toBe(true);
    });

    test('an anonymous class expression written with the space', () => {
        expect(is.class(class {})).toBe(true);
    });

    test('a subclass expression — `class extends …`', () => {
        class Base {}
        expect(is.class(class extends Base {})).toBe(true);
    });

    test('an arrow function', () => {
        expect(is.class(() => 'nope')).toBe(false);
    });

    test('a plain function', () => {
        expect(
            is.class(function load() {
                return 'nope';
            }),
        ).toBe(false);
    });

    test('a function whose body string merely contains "class"', () => {
        expect(
            is.class(function load() {
                return 'class Store {}';
            }),
        ).toBe(false);
    });

    test('non-functions', () => {
        expect(is.class({})).toBe(false);
        expect(is.class('class Store {}')).toBe(false);
        expect(is.class(null)).toBe(false);
        expect(is.class(undefined)).toBe(false);
    });
});
