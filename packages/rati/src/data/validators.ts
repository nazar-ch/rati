import { type Validator } from './field';

/*
    The shipped validator kit — deliberately tiny; a validator is just a
    function. `required()` says what it does (there is no required-by-default
    magic); every other validator skips empty values (null / undefined / ''), so
    `[required(), minLength(3)]` composes without double-reporting emptiness and
    an optional field stays optional.
*/

const isEmpty = (value: unknown): boolean => value === null || value === undefined || value === '';

export function required<T>(message = 'Required'): Validator<T> {
    return (value) => (isEmpty(value) ? message : undefined);
}

export function minLength<T extends { length: number } | null | undefined>(
    min: number,
    message?: string,
): Validator<T> {
    return (value) =>
        !isEmpty(value) && (value as { length: number }).length < min
            ? (message ?? `Must be at least ${min} characters`)
            : undefined;
}

export function maxLength<T extends { length: number } | null | undefined>(
    max: number,
    message?: string,
): Validator<T> {
    return (value) =>
        !isEmpty(value) && (value as { length: number }).length > max
            ? (message ?? `Must be at most ${max} characters`)
            : undefined;
}

export function min<T extends number | null | undefined>(
    minimum: number,
    message?: string,
): Validator<T> {
    return (value) =>
        !isEmpty(value) && (value as number) < minimum
            ? (message ?? `Must be at least ${minimum}`)
            : undefined;
}

export function max<T extends number | null | undefined>(
    maximum: number,
    message?: string,
): Validator<T> {
    return (value) =>
        !isEmpty(value) && (value as number) > maximum
            ? (message ?? `Must be at most ${maximum}`)
            : undefined;
}

export function pattern<T extends string | null | undefined>(
    expression: RegExp,
    message = 'Invalid format',
): Validator<T> {
    return (value) => {
        if (isEmpty(value)) return undefined;
        // A global regex keeps lastIndex; anchor each test at the start.
        expression.lastIndex = 0;
        return expression.test(value as string) ? undefined : message;
    };
}
