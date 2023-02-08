import { Expand } from '../types/generic';

export type ActiveDataInstanceType<T extends { __dataType: object }> = Expand<
    Omit<T, 'data' | '__dataType'> & Readonly<Omit<T['__dataType'], keyof T>>
>;
