import { ActiveData } from './ActiveData';

// This uses TypeScript 4.7 feature that is not supported by Babel and Eslint. Keep
// this in a separate file to not break builds. (@ May '22)
export type ActiveDataInstanceType<T extends { __dataType: object; }> = ReturnType<typeof ActiveData.create<T>>; // (value: T) => { value: T }

