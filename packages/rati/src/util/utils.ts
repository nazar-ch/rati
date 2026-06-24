export function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
        // NaN
        return a !== a && b !== b;
    }
    if (Array.isArray(a)) {
        if (!Array.isArray(b) || a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (!deepEqual(a[i], b[i])) return false;
        }
        return true;
    }
    if (Array.isArray(b)) return false;
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const k of aKeys) {
        if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
        if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) {
            return false;
        }
    }
    return true;
}

// Recursively merges plain objects. Arrays from later sources replace arrays
// in the target wholesale (no element-wise merge).
export function deepMergeReplaceArrays<T>(target: T, ...sources: Array<Partial<T> | undefined>): T {
    const out: Record<string, unknown> = Array.isArray(target)
        ? ([...(target as unknown as unknown[])] as unknown as Record<string, unknown>)
        : { ...(target as Record<string, unknown>) };
    for (const src of sources) {
        if (!src) continue;
        for (const key of Object.keys(src)) {
            const sv = (src as Record<string, unknown>)[key];
            const tv = out[key];
            if (Array.isArray(sv)) {
                out[key] = sv;
            } else if (
                sv &&
                typeof sv === 'object' &&
                tv &&
                typeof tv === 'object' &&
                !Array.isArray(tv)
            ) {
                out[key] = deepMergeReplaceArrays(tv, sv as Partial<typeof tv>);
            } else {
                out[key] = sv;
            }
        }
    }
    return out as T;
}

// Based on @sindresorhus/is
// MIT License
// Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
export const is = {
    object: (value: unknown): value is object =>
        value !== null && (typeof value === 'object' || typeof value === 'function'),
    promise: (value: unknown): value is Promise<unknown> =>
        value instanceof Promise ||
        (typeof (value as { then?: unknown })?.then === 'function' &&
            typeof (value as { catch?: unknown })?.catch === 'function'),
    function: (value: unknown): value is (...args: unknown[]) => unknown =>
        typeof value === 'function',
    class: (value: unknown): value is new (...args: unknown[]) => unknown =>
        typeof value === 'function' && Function.prototype.toString.call(value).startsWith('class '),
};
