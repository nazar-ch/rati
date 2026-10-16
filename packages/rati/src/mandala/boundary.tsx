import { Component } from 'react';
import type { ComponentType, ErrorInfo, ReactNode } from 'react';

import type { RefreshController } from './refresh.js';
import type { RetryPolicy } from './retryPolicy.js';

import { asSourceError, type SourceError } from '../scope/source.js';

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

    // A new tree clears the caught error IN THE SAME RENDER PASS: cleared from
    // componentDidUpdate, one committed render holds the old error under the new resetKey,
    // which the policy reads as the new generation failing.
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
        // The error itself is swallowed: the slot surfaces it, or render rethrows it. Arming
        // here is commit-phase, which keeps the policy client-only.
        this.props.policy?.arm();
    }

    override render() {
        if (this.state.error !== null) {
            const { errorSlot: ErrorSlot, inputs, retry, policy } = this.props;
            // The whole error, not just its code: the policy gates on `retryable` (the
            // transient/terminal level) and falls back to the code only for a failure the
            // app never classified.
            const error = asSourceError(this.state.error);
            // An automatic attempt is not an error state, so the island shows what it shows
            // while resolving. Decided in render: from an effect, the error slot mounts for a
            // commit, its effects included.
            if (policy?.accept(error, this.props.resetKey)) {
                return this.props.slot;
            }
            // The slot replaces the whole inner tree, kept content included: stale content
            // never sits in front of an error.
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
