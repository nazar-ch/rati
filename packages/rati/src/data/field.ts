import { observable, runInAction } from 'mobx';

/*
    `field` — one staged value: current + baseline + validation + binding props.
    Design record: docs/archive/directions-2026-07/data-package.md §5.

    One generic field, zero widget subclasses — widget kind is the component's
    business; with React Aria Components the widgets already speak domain types,
    so the field stores one type and `props` binds directly.

    One validation-timing policy, no configuration: validate on submit (the
    form's `validate()`); a field that currently has errors re-validates on every
    change, so errors disappear the moment the input becomes valid.

    Baseline semantics (the `ActiveData` distillation): `field(space.title)` —
    building a field from an entity *is* the draft; `isDirty` compares against
    the baseline, `reset()` is cancel, `commit()` re-baselines (the form calls it
    after a successful save).
*/

export type Validator<T> = (value: T) => string | undefined;

export interface FieldOptions<T> {
    validate?: Validator<T> | readonly Validator<T>[];
    /** Dirty comparison vs the baseline. Default: `Object.is`. */
    equals?: (a: T, b: T) => boolean;
}

/** React Aria Components-shaped binding: `<TextField {...field.props} />`. */
export interface FieldProps<T> {
    value: T;
    onChange: (value: T) => void;
    isInvalid: boolean;
    errorMessage: string | undefined;
}

export interface Field<T> {
    /** Observable, widget-facing. */
    readonly value: T;
    /** Action; re-validates if the field currently has errors. */
    setValue(value: T): void;
    readonly errors: readonly string[];
    readonly isInvalid: boolean;
    /** vs baseline. */
    readonly isDirty: boolean;
    validate(): boolean;
    /** Back to baseline; clears errors. */
    reset(): void;
    /** Baseline = current value (after a successful save). */
    commit(): void;
    readonly props: FieldProps<T>;
}

/**
 * Package-internal seam: `form` distributes a `FormError`'s field errors through
 * this method — server-sent messages the field can't re-derive (they clear on
 * the next change like any error).
 */
export const FieldExternalErrors: unique symbol = Symbol('rati.data.fieldExternalErrors');

export interface FieldInternal<T> extends Field<T> {
    [FieldExternalErrors](messages: readonly string[]): void;
}

// NoInfer: only `initial` drives T — otherwise a literal initial (`field('')`)
// can get pinned to its literal type by a validator's generic constraint.
export function field<T>(initial: T, options: FieldOptions<NoInfer<T>> = {}): Field<T> {
    const validators: readonly Validator<T>[] =
        options.validate === undefined
            ? []
            : Array.isArray(options.validate)
              ? (options.validate as readonly Validator<T>[])
              : [options.validate as Validator<T>];
    const equalsFn = options.equals ?? Object.is;
    const state = observable(
        { value: initial, baseline: initial, errors: [] as readonly string[] },
        { value: observable.ref, baseline: observable.ref, errors: observable.ref },
        { deep: false },
    );

    const runValidators = (value: T): readonly string[] =>
        validators
            .map((validate) => validate(value))
            .filter((message): message is string => message !== undefined);

    const setValue = (value: T): void => {
        runInAction(() => {
            state.value = value;
            if (state.errors.length > 0) state.errors = runValidators(value);
        });
    };

    const self: FieldInternal<T> = {
        get value() {
            return state.value;
        },
        setValue,
        get errors() {
            return state.errors;
        },
        get isInvalid() {
            return state.errors.length > 0;
        },
        get isDirty() {
            return !equalsFn(state.value, state.baseline);
        },
        validate() {
            const errors = runValidators(state.value);
            runInAction(() => {
                state.errors = errors;
            });
            return errors.length === 0;
        },
        reset() {
            runInAction(() => {
                state.value = state.baseline;
                state.errors = [];
            });
        },
        commit() {
            runInAction(() => {
                state.baseline = state.value;
            });
        },
        get props(): FieldProps<T> {
            return {
                value: state.value,
                onChange: setValue,
                isInvalid: state.errors.length > 0,
                errorMessage: state.errors[0],
            };
        },
        [FieldExternalErrors](messages) {
            runInAction(() => {
                state.errors = messages;
            });
        },
    };
    return self;
}
