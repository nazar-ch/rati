import { describe, test, expect } from 'vite-plus/test';
import { is } from '../../util/utils';

// `is.class` decides whether the resolver constructs a load entry (`new Entry(props)`)
// or calls it (`Entry(props)`), so getting it wrong on a real build is fatal: a class
// invoked without `new` throws "Class constructor … cannot be invoked without 'new'",
// which blanked the ssr example's /counter in every production build (FND-03). The
// shapes below are the ones a bundler actually produces.

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
