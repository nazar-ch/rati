import { useEffect, type FC } from 'react';
import { useRouter } from '../stores/RootStore';

/**
 * Calls `router.replace(to)` on mount. Render this when a component decides
 * the user belongs on a different route (e.g. an auth gate or a moved page).
 */
export const Navigate: FC<{ to: string }> = ({ to }) => {
    const router = useRouter();
    useEffect(() => {
        router.replace(to);
    }, [router, to]);
    return null;
};
