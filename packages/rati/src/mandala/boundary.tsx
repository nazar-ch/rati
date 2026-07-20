import { Component } from 'react';
import type { ComponentType, ErrorInfo, ReactNode } from 'react';
import { asSourceError, type SourceError } from '../scope/source';
import type { RefreshController } from './refresh';
import type { RetryPolicy } from './retryPolicy';

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

export class MandalaErrorBoundary extends Component<ErrorBoundaryProps, { error: unknown }> {
    override state: { error: unknown } = { error: null };

    static getDerivedStateFromError(error: unknown) {
        return { error: error ?? new Error('Mandala error') };
    }

    override componentDidUpdate(prev: ErrorBoundaryProps) {
        // A new tree (retry or param change) clears the caught error so the fresh
        // attempt renders.
        if (prev.resetKey !== this.props.resetKey && this.state.error !== null) {
            this.setState({ error: null });
        }
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
            // An automatic attempt is not an error state — the island is still resolving —
            // so it shows what it shows while resolving. Decided here rather than from an
            // effect: the error slot would otherwise mount for a commit (running its
            // effects: the log, the toast, the Sentry report) before anything took it back.
            if (policy?.accept(asSourceError(this.state.error).code, this.props.resetKey)) {
                return this.props.slot;
            }
            // The slot replaces the whole inner tree, kept content included — an error is
            // not something stale content should sit in front of.
            this.props.controller.reportPhase('error', false);
            if (!ErrorSlot) {
                // No slot — propagate to the nearest outer ErrorBoundary.
                throw this.state.error;
            }
            return (
                <ErrorSlot inputs={inputs} error={asSourceError(this.state.error)} retry={retry} />
            );
        }
        return this.props.children;
    }
}
