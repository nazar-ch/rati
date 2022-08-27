export type ExtractKeyType<T, K> = K extends keyof T ? T[K] : never;

export type InstanceTypeWhenObject<T> = T extends new (...args: any) => any ? InstanceType<T> : T;

export type Maybe<T> = T | null;

// SOURCE: https://stackoverflow.com/questions/57683303/how-can-i-see-the-full-expanded-contract-of-a-typescript-type

// expands object types one level deep
export type Expand<T> = T extends infer O ? { [K in keyof O]: O[K] } : never;

// expands object types recursively
export type ExpandRecursively<T> = T extends object
    ? T extends infer O
        ? { [K in keyof O]: ExpandRecursively<O[K]> }
        : never
    : T;

export function isNonNull<T>(value: T | null | undefined): value is T {
    return value != null;
}

// Freshly added type to type-fest that is not available via npm
// https://github.com/sindresorhus/type-fest/blob/main/source/tuple-to-union.d.ts
// TODO: use type-fest version when it's available
export type TupleToUnion<ArrayType> = ArrayType extends readonly [infer Head, ...infer Rest]
    ? Head | TupleToUnion<Rest>
    : never;
