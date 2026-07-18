import { describe, test, expect, vi } from 'vite-plus/test';
import { field } from '../../data/field';
import { form, FormError } from '../../data/form';
import { maxLength, min, minLength, pattern, required } from '../../data/validators';

describe('field', () => {
    test('validates on demand, not on change — until it has errors, then every change re-checks', () => {
        const title = field('', { validate: required() });
        title.setValue(''); // no validation yet — nothing nags mid-typing
        expect(title.isInvalid).toBe(false);

        expect(title.validate()).toBe(false); // the submit-time check
        expect(title.errors).toEqual(['Required']);
        expect(title.props.errorMessage).toBe('Required');

        title.setValue('x'); // an invalid field re-validates on every change…
        expect(title.isInvalid).toBe(false); // …so the error clears the moment it's valid
    });

    test('dirty is a comparison against the baseline; reset is cancel; commit re-baselines', () => {
        const title = field('Alpha');
        expect(title.isDirty).toBe(false);

        title.setValue('Beta');
        expect(title.isDirty).toBe(true);
        title.reset();
        expect(title.value).toBe('Alpha');
        expect(title.isDirty).toBe(false);

        title.setValue('Gamma');
        title.commit();
        expect(title.isDirty).toBe(false);
        expect(title.value).toBe('Gamma');
        title.reset(); // reset now returns to the *new* baseline
        expect(title.value).toBe('Gamma');
    });

    test('props are RAC-shaped and drive the field', () => {
        const count = field(1, { validate: min(0) });
        expect(count.props.value).toBe(1);
        count.props.onChange(5);
        expect(count.value).toBe(5);
        expect(count.props.isInvalid).toBe(false);
    });

    test('the validator kit composes; non-required validators skip empty values', () => {
        const nickname = field('', {
            validate: [minLength(3), maxLength(5), pattern(/^[a-z]+$/)],
        });
        expect(nickname.validate()).toBe(true); // optional field stays optional

        nickname.setValue('ab');
        expect(nickname.validate()).toBe(false);
        expect(nickname.errors).toEqual(['Must be at least 3 characters']);

        nickname.setValue('abcdef');
        expect(nickname.errors).toEqual(['Must be at most 5 characters']);

        nickname.setValue('ABC');
        expect(nickname.errors).toEqual(['Invalid format']);

        nickname.setValue('abc');
        expect(nickname.isInvalid).toBe(false);
    });
});

describe('form', () => {
    function renameForm(initialTitle = 'Alpha') {
        return form({
            title: field(initialTitle, { validate: required() }),
            order: field(0),
        });
    }

    test('aggregates values (typed), dirtiness and validation over all fields', () => {
        const f = renameForm();
        expect(f.values).toEqual({ title: 'Alpha', order: 0 });
        expect(f.isDirty).toBe(false);

        f.fields.order.setValue(3);
        expect(f.isDirty).toBe(true);

        f.fields.title.setValue('');
        expect(f.validate()).toBe(false); // runs every field, no short-circuit
        expect(f.fields.title.isInvalid).toBe(true);
    });

    test('submit validates first and never reaches the handler when invalid', async () => {
        const handler = vi.fn(() => Promise.resolve());
        const f = renameForm('');
        const save = f.submit(handler);

        await save();
        expect(handler).not.toHaveBeenCalled();
        expect(f.fields.title.errors).toEqual(['Required']);
    });

    test('a successful submit commits — the baseline tracks saved truth', async () => {
        const f = renameForm();
        const save = f.submit(() => Promise.resolve());

        f.fields.title.setValue('Beta');
        expect(f.isDirty).toBe(true);
        await save();
        expect(f.isDirty).toBe(false); // committed, not reset
        expect(f.values.title).toBe('Beta');
    });

    test('isSubmitting spans the handler; re-entrant calls are ignored', async () => {
        let resolve!: () => void;
        const gate = new Promise<void>((res) => {
            resolve = res;
        });
        const handler = vi.fn(() => gate);
        const f = renameForm();
        const save = f.submit(handler);

        const first = save();
        expect(f.isSubmitting).toBe(true);
        const second = save(); // double-click
        resolve();
        await Promise.all([first, second]);
        expect(handler).toHaveBeenCalledTimes(1);
        expect(f.isSubmitting).toBe(false);
    });

    test('a FormError distributes onto matching fields; the rest lands on form.error', async () => {
        const f = renameForm();
        const save = f.submit(() =>
            Promise.reject(
                new FormError({
                    fieldErrors: { title: 'Already taken', missing: 'No such field here' },
                    message: 'Fix the highlighted fields',
                }),
            ),
        );

        await save(); // action-compatible: it does not rethrow
        expect(f.fields.title.errors).toEqual(['Already taken']);
        expect(f.error).toMatchObject({
            code: 'form',
            message: 'Fix the highlighted fields; No such field here',
        });

        // Server-sent errors clear like any other — on the next change.
        f.fields.title.setValue('Fresh');
        expect(f.fields.title.isInvalid).toBe(false);
    });

    test('any other failure lands on form.error as a SourceError; nothing commits', async () => {
        const f = renameForm();
        const save = f.submit(() => Promise.reject(new Error('HTTP 500')));

        f.fields.title.setValue('Beta');
        await save();
        expect(f.error).toMatchObject({ code: 'failed', message: 'HTTP 500' });
        expect(f.isDirty).toBe(true); // still staged; the user can retry or cancel
        expect(f.isSubmitting).toBe(false);

        f.reset();
        expect(f.values.title).toBe('Alpha');
        expect(f.error).toBeNull();
    });
});
