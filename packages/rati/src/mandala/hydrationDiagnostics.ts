import type { HydrationData, HydrationErrors, HydrationSection } from './hydration.js';

/*
    Unclaimed-hydration-data diagnostic (client side).

    The registry is keyed by `useId`, which is stable only while the server and client
    render the same tree. When the trees drift, nothing crashes — every island quietly
    resolves from scratch and the page still works, so SSR has effectively turned
    itself off with no visible signal. This watchdog makes that failure loud: a while
    after the last claim, any payload slice no island ever consumed is reported.

    The delay resets on every claim so islands that mount late (a lazy route chunk
    still downloading) get their window; a slice claimed after the warning fired was a
    false alarm — the message says so.
*/

const GRACE_MS = 3000;

type Payload = {
    data?: HydrationData | undefined;
    seeds?: HydrationData | undefined;
    errors?: HydrationErrors | undefined;
};

export type HydrationClaims = {
    claim: (mandalaId: string, key: string, section: HydrationSection) => void;
    /** Arm the watchdog (from the provider's effect); returns the disarm cleanup. */
    arm: (
        data: HydrationData | undefined,
        seeds: HydrationData | undefined,
        errors: HydrationErrors | undefined,
    ) => () => void;
};

export function createHydrationClaims(): HydrationClaims {
    const claimed = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let payload: Payload = {};

    const check = () => {
        timer = null;
        const unclaimed: string[] = [];
        const sections = [
            ['data', payload.data],
            ['seeds', payload.seeds],
            ['errors', payload.errors],
        ] as const;
        for (const [section, registry] of sections) {
            for (const [mandalaId, slice] of Object.entries(registry ?? {})) {
                for (const key of Object.keys(slice)) {
                    if (!claimed.has(`${section}\x00${mandalaId}\x00${key}`)) {
                        unclaimed.push(`${section}[${JSON.stringify(mandalaId)}].${key}`);
                    }
                }
            }
        }
        if (unclaimed.length) {
            console.warn(
                `[rati] server-dehydrated data was never claimed by an island: ` +
                    `${unclaimed.join(', ')}. The affected islands re-ran their loads on the ` +
                    `client, so server rendering bought nothing there. Usual cause: the server ` +
                    `and client render different trees, shifting the useId registry keys. ` +
                    `(If the island simply mounts later than ${GRACE_MS}ms — a slow lazy chunk — ` +
                    `this is a false alarm.)`,
            );
        }
    };

    const schedule = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(check, GRACE_MS);
    };

    return {
        claim(mandalaId, key, section) {
            claimed.add(`${section}\x00${mandalaId}\x00${key}`);
            // Reset the countdown only once armed — claims during the initial
            // hydration render happen before the provider's effect runs.
            if (timer) schedule();
        },
        arm(data, seeds, errors) {
            payload = { data, seeds, errors };
            schedule();
            return () => {
                if (timer) clearTimeout(timer);
                timer = null;
            };
        },
    };
}
