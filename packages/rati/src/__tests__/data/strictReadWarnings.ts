import { vi } from 'vite-plus/test';

import { configure } from 'mobx';

/**
 * The `[mobx]` warnings `run` raises under `observableRequiresReaction`, the strictness an app
 * turns on, called from no reaction — the way an event handler, an effect or a scope load calls a
 * primitive's imperative entry point.
 */
export async function strictReadWarnings(run: () => unknown): Promise<string[]> {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    configure({ observableRequiresReaction: true });
    try {
        await run();
        return warn.mock.calls
            .map(([message]) => String(message))
            .filter((message) => message.startsWith('[mobx]'));
    } finally {
        configure({ observableRequiresReaction: false });
        warn.mockRestore();
    }
}
