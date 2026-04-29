/*

Based on https://github.com/ReactTraining/react-router/blob/master/packages/react-router-dom/modules/Link.js

MIT License

Copyright (c) React Training 2016-2018
Copyright (c) Nazar Chobaniuk 2021-2022

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

import { observer } from 'mobx-react-lite';
import { createContext, memo, PropsWithChildren, useCallback, useContext } from 'react';

import { NameToRoute, GenericRouteType, WebRouterStore } from '../stores/WebRouterStore';
import { useWebRouter } from '../stores/RootStore';
import { computed } from 'mobx';

type GenericAnchorProps = Omit<
    React.DetailedHTMLProps<React.AnchorHTMLAttributes<HTMLAnchorElement>, HTMLAnchorElement>,
    'href'
>;

// TODO: replace with FC<{ name: 'name1' } | { name: 'name2', params: { x: string }} | ...>
type RatiLinkBaseProps = {
    className?: string;
    activeClassName?: string;
    content?: { normal: React.ReactNode; active: React.ReactNode };
    /**
     * When true, start loading the destination route's chunk on hover/touch.
     * No-op for routes whose component isn't a `lazy()` component.
     */
    prefetch?: boolean;
    // TODO: "exact" prop to match active path exactly or compare with startWith
};

type RatiLinkToProps<T extends readonly GenericRouteType[]> = {
    to: NameToRoute<T> | string;
};

type RatiGenericAnchorProps = RatiLinkBaseProps &
    GenericAnchorProps & { href: string; isActive: boolean };

type RatiRegularAnchorProps<T extends readonly GenericRouteType[]> = RatiLinkBaseProps &
    GenericAnchorProps &
    RatiLinkToProps<T>;

export function createLinkComponent(componentClassName?: string) {
    const GenericAnchor = observer(function GenericAnchor({
        className,
        activeClassName,
        content,
        isActive,
        href,
        prefetch,
        children,
        onClick: userOnClick,
        onMouseEnter: userOnMouseEnter,
        onTouchStart: userOnTouchStart,
        ...props
    }: PropsWithChildren<RatiGenericAnchorProps>) {
        const webRouter = useWebRouter();

        const handleOnClick = useCallback(
            (event: React.MouseEvent<HTMLAnchorElement, MouseEvent>) => {
                if (userOnClick) userOnClick(event);
                // When the Navigation API is wired up at the store level, the
                // browser will fire `navigate` for this click and run our
                // interceptor — handling modifiers, target, download, and
                // cross-origin without us. Doing it here too would double-fire.
                if (webRouter.hasNavigationApi) return;
                if (!shouldHandleLinkClick(event)) return;
                event.preventDefault();
                webRouter.history.push(href);
            },
            [href, userOnClick, webRouter]
        );

        const handleMouseEnter = useCallback(
            (event: React.MouseEvent<HTMLAnchorElement, MouseEvent>) => {
                if (userOnMouseEnter) userOnMouseEnter(event);
                if (prefetch) webRouter.preloadRoute(href);
            },
            [href, prefetch, userOnMouseEnter, webRouter]
        );

        const handleTouchStart = useCallback(
            (event: React.TouchEvent<HTMLAnchorElement>) => {
                if (userOnTouchStart) userOnTouchStart(event);
                if (prefetch) webRouter.preloadRoute(href);
            },
            [href, prefetch, userOnTouchStart, webRouter]
        );

        return (
            <a
                {...props}
                href={`${href}`}
                aria-current={isActive ? 'page' : undefined}
                className={[
                    componentClassName || null,
                    className || null,
                    isActive ? activeClassName ?? 'active' : null,
                ]
                    .filter((item) => item)
                    .join(' ')}
                onClick={handleOnClick}
                onMouseEnter={handleMouseEnter}
                onTouchStart={handleTouchStart}
            >
                {children || (content && (isActive ? content.active : content.normal))}
            </a>
        );
    });

    const RegularAnchor = observer(function RegularAnchor<T extends readonly GenericRouteType[]>({
        to,
        ...props
    }: PropsWithChildren<RatiRegularAnchorProps<T>>) {
        const webRouter = useWebRouter();

        const href = webRouter.getPath(to);
        const isActive = webRouter.isPath(href);

        return <GenericAnchor {...props} {...{ isActive, href }} />;
    });

    const LinkContextProvider = memo(function LinkContextProvider<
        T extends readonly GenericRouteType[],
    >({ children, to }: { children: React.ReactNode; to: NameToRoute<T> | string }) {
        const webRouter = useWebRouter();

        return (
            <LinkContext.Provider value={new LinkContextStore(webRouter, to)}>
                {children}
            </LinkContext.Provider>
        );
    });

    const ContextualAnchor = observer(function ContextualAnchor({
        ...props
    }: PropsWithChildren<RatiLinkBaseProps & GenericAnchorProps>) {
        const linkContext = useLinkContext();

        return (
            <GenericAnchor
                {...props}
                {...{ isActive: linkContext.isActive, href: linkContext.href }}
            />
        );
    });

    return {
        Link: RegularAnchor,
        ContextualLink: ContextualAnchor,
        LinkContextProvider,
        useLinkContext,
    };
}

/**
 * Decide whether to intercept this link click for SPA navigation, or let the
 * browser do its default thing (open in new tab, download, follow external
 * URL, etc.). Mirrors the checks the Navigation API does natively, for
 * browsers that don't have it.
 */
export function shouldHandleLinkClick(event: React.MouseEvent<HTMLAnchorElement>): boolean {
    if (event.defaultPrevented) return false;
    if (event.button !== 0) return false; // ignore middle/right clicks
    if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return false;

    const anchor = event.currentTarget;
    const target = anchor.getAttribute('target');
    if (target && target !== '_self') return false;
    if (anchor.hasAttribute('download')) return false;

    // Cross-origin links go to the browser. `anchor.href` is the resolved URL.
    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin) return false;

    return true;
}

const LinkContext = createContext<LinkContextStore<any> | null>(null);

class LinkContextStore<T extends readonly GenericRouteType[]> {
    constructor(
        private webRouter: WebRouterStore<readonly GenericRouteType[]>,
        private to: NameToRoute<T> | string
    ) {}

    @computed get isActive() {
        return this.webRouter.isPath(this.href);
    }

    @computed get href() {
        return this.webRouter.getPath(this.to);
    }
}

export function useLinkContext() {
    const context = useContext(LinkContext);
    if (!context) {
        throw new Error('Link context is not enabled. Add missing `LinkContextProvider` component');
    }
    return context;
}
