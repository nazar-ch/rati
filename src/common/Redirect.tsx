import { FC } from 'react';
import { useGenericStores } from './RootStore';

export const Redirect: FC<{ to: string }> = ({ to }) => {
    const { router } = useGenericStores();
    router.redirect(to);
    return null;
};
