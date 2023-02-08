/*

Based on https://github.com/ReactTraining/react-router/blob/master/packages/react-router-dom/modules/Link.js

MIT License

Copyright (c) React Training 2016-2018
Copyright (c) Nazar Chobaniuk 2021-2022
Copyright (c) 2022 Inside Labs AG

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/

import { useObserver } from 'mobx-react-lite';
import { PropsWithChildren } from 'react';

import { NameToRoute, GenericRouteType, WebRouter } from '../stores/WebRouter';
import { useWebRouter } from './RootStore';

// TODO: replace with FC<{ name: 'name1' } | { name: 'name2', params: { x: string }} | ...>
type GenericLinkProps<T extends readonly GenericRouteType[]> = PropsWithChildren<{
    to: NameToRoute<T> | string;
    className?: string;
    activeClassName?: string;
    content?: React.ReactNode;
    activeContent?: React.ReactNode;
    // TODO: "exact" prop to match active path exactly or compare with startWith
    [prop: string]: unknown;
}>;

export function createLinkComponent<T extends readonly GenericRouteType[] = []>(
    componentClassName?: string
) {
    function GenericLink({
        to,
        className,
        activeClassName,
        content,
        activeContent,
        children,
        ...props
    }: GenericLinkProps<T>) {
        const webRouter = useWebRouter();

        return useObserver(() => {
            const link =
                typeof to === 'string'
                    ? to
                    : webRouter.getPath(
                          // We don't have this type here, it's available only on a project level
                          // @ts-expect-error
                          to as any
                      );
            const active = webRouter.path === link;

            return (
                // TODO: memoize onClick?
                <a
                    {...props}
                    href={`${link}`}
                    className={[
                        componentClassName,
                        className,
                        active && (activeClassName ?? 'active'),
                    ].join(' ')}
                    onClick={(event) => {
                        if (allowAction(event)) {
                            event.preventDefault();
                            webRouter.history.push(link);
                        }
                    }}
                >
                    {children || (active ? activeContent : content)}
                </a>
            );
        });
    }

    return GenericLink;
}

function allowAction(event: React.MouseEvent) {
    return (
        !event.defaultPrevented && // onClick prevented default
        event.button === 0 && // ignore everything but left clicks
        // FIXME:
        // (!target || target === "_self") && // let browser handle "target=_blank" etc.
        !isModifiedEvent(event) // ignore clicks with modifier keys
    );
}

function isModifiedEvent(event: React.MouseEvent) {
    return !!(event.metaKey || event.altKey || event.ctrlKey || event.shiftKey);
}
