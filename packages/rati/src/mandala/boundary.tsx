import { Component } from 'react';
import type { ComponentType, ErrorInfo, ReactNode } from 'react';
import { asSourceError, type SourceError } from '../scope/source';
import type { RefreshController } from './refresh';

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
    }

    override componentDidCatch(_error: unknown, _info: ErrorInfo) {
        // Swallowed: the error is surfaced through the slot (or rethrown in render).
    }

    override render() {
        if (this.state.error !== null) {
            const { errorSlot: ErrorSlot, inputs, retry } = this.props;
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
