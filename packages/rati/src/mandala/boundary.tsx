import { Component } from 'react';
import type { ComponentType, ErrorInfo, ReactNode } from 'react';

import type { RefreshController } from './refresh';
import type { RetryPolicy } from './retryPolicy';

import { asSourceError, type SourceError } from '../scope/source';

// Catches a rejected promise (`use()`) or a thrown source error and renders the mandala's
// error slot — or rethrows to the nearest outer boundary when there's no slot. `resetKey`
// (the live tree key) clears the error on retry / param change.
type ErrorBoundaryProps = {
    errorSlot:
        | ComponentType<{ inputs: unknown; error: SourceError; retry: () => void }>
        | undefined;
    inputs: unknown;
    retry: () => void;
    resetKey: unknown;
    /** Reports the error phase while the slot is up — see RefreshController.reportPhase. */
    controller: RefreshController;
    /** The `retry` option's driver, when the island has one — see RetryPolicy. */
    policy: RetryPolicy | null;
    /** What the island shows while it has no content of its own — the mandala's built slot
     *  (the loading slot, or a kept run standing in for it). Rendered in place of the error
     *  slot for as long as the policy is retrying. */
    slot: ReactNode;
    children: ReactNode;
};

type BoundaryState = { error: unknown; resetKey: unknown };

export class MandalaErrorBoundary extends Component<ErrorBoundaryProps, BoundaryState> {
    override state: BoundaryState = { error: null, resetKey: this.props.resetKey };

    static getDerivedStateFromError(error: unknown) {
        return { error: error ?? new Error('Mandala error') };
    }

    // A new tree (retry or param change) clears the caught error *in the same render pass*.
    // Clearing from componentDidUpdate instead leaves one committed render holding the old
    // error under the new resetKey — which the policy would read as the new generation
    // already failing: an attempt spent before its load ran, and a backoff counting down
    // concurrently with the attempt instead of after its failure.
    static getDerivedStateFromProps(props: ErrorBoundaryProps, state: BoundaryState) {
        if (state.resetKey !== props.resetKey) return { error: null, resetKey: props.resetKey };
        return null;
    }

    override componentDidUpdate() {
        // Backstop for the line in componentDidCatch: that one fires on the catch itself,
        // this one on any commit that follows. Idempotent, so a failure whose catching
        // render was discarded still gets its countdown at the next commit.
        this.props.policy?.arm();
    }

    override componentDidCatch(_error: unknown, _info: ErrorInfo) {
        // The error itself is swallowed: it is surfaced through the slot (or rethrown in
        // render). The one thing that happens here is the automatic retry's countdown —
        // commit-phase, which is what makes the policy client-only: a server render has no
        // commit, so it takes its one attempt and reports the failure like always.
        this.props.policy?.arm();
    }

    override render() {
        if (this.state.error !== null) {
            const { errorSlot: ErrorSlot, inputs, retry, policy } = this.props;
            // The whole error, not just its code: the policy gates on `retryable` (the
            // transient/terminal level) and falls back to the code only for a failure the
            // app never classified.
            const error = asSourceError(this.state.error);
            // An automatic attempt is not an error state — the island is still resolving —
            // so it shows what it shows while resolving. Decided here rather than from an
            // effect: the error slot would otherwise mount for a commit (running its
            // effects: the log, the toast, the Sentry report) before anything took it back.
            if (policy?.accept(error, this.props.resetKey)) {
                return this.props.slot;
            }
            // The slot replaces the whole inner tree, kept content included — an error is
            // not something stale content should sit in front of.
            this.props.controller.reportPhase('error', false);
            if (!ErrorSlot) {
                // No slot — propagate to the nearest outer ErrorBoundary.
                throw this.state.error;
            }
            return <ErrorSlot inputs={inputs} error={error} retry={retry} />;
        }
        return this.props.children;
    }
}
