import { FC } from 'react';
import { useWebRouter } from '../stores/RootStore';

export const Redirect: FC<{ to: string }> = ({ to }) => {
    const webRouter = useWebRouter();
    webRouter.redirect(to);
    return null;
};
