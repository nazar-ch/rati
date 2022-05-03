export type ExtractKeyType<T, K> = K extends keyof T ? T[K] : never;

export type InstanceTypeWhenObject<T> = T extends new (...args: any) => any ? InstanceType<T> : T;

export type Maybe<T> = T | null;
