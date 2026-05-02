import { useEffect, type FC } from 'react';
import { useWebRouter } from '../stores/RootStore';

export const Redirect: FC<{ to: string }> = ({ to }) => {
    const webRouter = useWebRouter();
    useEffect(() => {
        webRouter.redirect(to);
    }, [webRouter, to]);
    return null;
};
