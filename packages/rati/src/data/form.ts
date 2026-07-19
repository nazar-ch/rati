import { observable, runInAction } from 'mobx';
import { toSourceError, type SourceError } from '../scope/source';
import { FieldExternalErrors, type Field, type FieldInternal } from './field';

/*
    `form` — an aggregate over fields: staged edits with one submit seam. Design
    record: docs/archive/directions-2026-07/data-package.md §5–6.

    The form is the draft: fields enumerate the edited set explicitly, the
    baseline lives per field, dirty is a comparison, not an overlay. Before
    submit, optimism is the form (staged edits nobody else sees; cancel =
    `reset()`); after submit it is the mutation's optimistic patch — each side
    stays small because the other exists.

    `submit(handler)` returns an **action-compatible** function: usable as
    `<form action={store.save}>`, so `useFormStatus().pending` agrees with
    `isSubmitting` by construction. It therefore never rejects — failures land on
    the fields (a thrown `FormError`'s `fieldErrors`) or on `form.error` as a
    `SourceError`; success commits (the baseline tracks saved truth).
*/

/** Thrown by a submit handler (typically built by the API layer from a 422). */
export class FormError extends Error {
    readonly fieldErrors: Readonly<Record<string, string>> | undefined;
    /** The form-level message, only if one was explicitly given. */
    readonly formMessage: string | undefined;

    constructor(
        options: { fieldErrors?: Record<string, string>; message?: string; cause?: unknown } = {},
    ) {
        super(options.message ?? 'Submit failed', { cause: options.cause });
        this.name = 'FormError';
        this.fieldErrors = options.fieldErrors;
        this.formMessage = options.message;
    }
}

export type FormValues<F extends Record<string, Field<any>>> = {
    [K in keyof F]: F[K] extends Field<infer T> ? T : never;
};

export interface Form<F extends Record<string, Field<any>>> {
    readonly fields: F;
    readonly values: FormValues<F>;
    /** Any field dirty. */
    readonly isDirty: boolean;
    readonly isSubmitting: boolean;
    /** Form-level (non-field) submit error. */
    readonly error: SourceError | null;
    /** Validates every field (all of them — no short-circuit). */
    validate(): boolean;
    /** All fields to baseline; clears the form error. */
    reset(): void;
    /** Baseline = current values (after a successful save). */
    commit(): void;
    submit(handler: (values: FormValues<F>) => Promise<void>): () => Promise<void>;
}

export function form<F extends Record<string, Field<any>>>(fields: F): Form<F> {
    const state = observable(
        { isSubmitting: false, error: null as SourceError | null },
        { error: observable.ref },
        { deep: false },
    );
    const fieldList = Object.values(fields) as FieldInternal<unknown>[];

    const applyFormError = (thrown: FormError): void => {
        const unmatched: string[] = [];
        for (const [key, message] of Object.entries(thrown.fieldErrors ?? {})) {
            const target = fields[key] as FieldInternal<unknown> | undefined;
            if (target) target[FieldExternalErrors]([message]);
            else unmatched.push(message);
        }
        const messages = [
            ...(thrown.formMessage === undefined ? [] : [thrown.formMessage]),
            ...unmatched, // a server error for a field this form doesn't stage still surfaces
        ];
        state.error = messages.length > 0 ? { code: 'form', message: messages.join('; ') } : null;
    };

    const self: Form<F> = {
        fields,
        get values() {
            const values: Record<string, unknown> = {};
            for (const [key, current] of Object.entries(fields)) {
                values[key] = (current as Field<unknown>).value;
            }
            return values as FormValues<F>;
        },
        get isDirty() {
            return fieldList.some((current) => current.isDirty);
        },
        get isSubmitting() {
            return state.isSubmitting;
        },
        get error() {
            return state.error;
        },
        validate() {
            let valid = true;
            for (const current of fieldList) {
                if (!current.validate()) valid = false;
            }
            return valid;
        },
        reset() {
            runInAction(() => {
                for (const current of fieldList) current.reset();
                state.error = null;
            });
        },
        commit() {
            runInAction(() => {
                for (const current of fieldList) current.commit();
            });
        },
        submit(handler) {
            return async () => {
                if (state.isSubmitting) return; // re-entrant double-click: one submit
                if (!self.validate()) return;
                runInAction(() => {
                    state.isSubmitting = true;
                    state.error = null;
                });
                try {
                    await handler(self.values);
                    self.commit();
                } catch (thrown) {
                    runInAction(() => {
                        if (thrown instanceof FormError) applyFormError(thrown);
                        else state.error = toSourceError(thrown);
                    });
                } finally {
                    runInAction(() => {
                        state.isSubmitting = false;
                    });
                }
            };
        },
    };
    return self;
}
