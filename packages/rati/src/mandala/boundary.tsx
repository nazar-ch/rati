import { Component } from 'react';
import type { ComponentType, ErrorInfo, ReactNode } from 'react';
import { toSourceError, type SourceError } from '../common/source';
import { is } from '../common/utils';

function asSourceError(thrown: unknown): SourceError {
    // A source error is already a SourceError (plain object with a string `code`); a
    // promise rejection is a raw Error / value — map it through toSourceError.
    if (
        is.object(thrown) &&
        !(thrown instanceof Error) &&
        typeof (thrown as { code?: unknown }).code === 'string'
    ) {
        return thrown as SourceError;
    }
    return toSourceError(thrown);
}

// Catches a rejected promise (`use()`) or a thrown source error and renders the mandala's
// error slot — or rethrows to the nearest outer boundary when there's no slot. `resetKey`
// (the live tree key) clears the error on retry / param change.
type ErrorBoundaryProps = {
    errorSlot:
        | ComponentType<{ params: unknown; error: SourceError; retry: () => void }>
        | undefined;
    params: unknown;
    retry: () => void;
    resetKey: unknown;
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
            const { errorSlot: ErrorSlot, params, retry } = this.props;
            if (!ErrorSlot) {
                // No slot — propagate to the nearest outer ErrorBoundary.
                throw this.state.error;
            }
            return (
                <ErrorSlot params={params} error={asSourceError(this.state.error)} retry={retry} />
            );
        }
        return this.props.children;
    }
}
