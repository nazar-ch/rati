import type { HydrationData, HydrationErrors, HydrationSection } from './hydration.js';

/*
    Unclaimed-hydration-data diagnostic, client side: when the server and client trees drift,
    the `useId` keys stop matching and every island resolves from scratch with no signal. A
    while after the last claim, any payload slice no island consumed is reported.
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
