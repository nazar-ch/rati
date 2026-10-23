// The furniture scopeControls.dom.test.tsx and scopeControlsPins.dom.test.tsx share.

import { useLayoutEffect, type FC } from 'react';

import { useScopeControls, type ScopeControls } from '../../mandala/controls.js';
import { controllableSource, type ControllableSource } from '../../testing/index.js';

// A hand-driven source keyed into a shared attach/detach log, so a cascade's source swap is
// observable per generation (attach:s1 / detach:s1 / attach:s2): controllableSource with an
// id-keyed log wired through its lifecycle hooks.
export function testSource<T>(log: string[], id: string): ControllableSource<T> {
    return controllableSource<T>({
        onAttach: () => log.push(`attach:${id}`),
        onDetach: () => log.push(`detach:${id}`),
    });
}

// Renders inside the island's subtree and hands the test the current controls value.
export function probeControls<S extends Parameters<typeof useScopeControls>[0]>(testScope: S) {
    const captured: { current: ScopeControls<S> | null } = { current: null };
    const Probe: FC = () => {
        const controls = useScopeControls(testScope);
        useLayoutEffect(() => {
            captured.current = controls;
        });
        return null;
    };
    return { captured, Probe };
}
