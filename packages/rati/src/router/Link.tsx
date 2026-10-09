import { createContext, memo, type PropsWithChildren, useCallback, useContext } from 'react';

import { type NameToRoute, type GenericRouteType, type UserRoutes } from './route.js';
import { useRouterStore } from './RouterProvider.js';
import { type RouterStore } from './store.js';

import { navTraceStart } from '../util/navTrace.js';

type GenericAnchorProps = Omit<
    React.DetailedHTMLProps<React.AnchorHTMLAttributes<HTMLAnchorElement>, HTMLAnchorElement>,
    'href'
>;

type RatiLinkBaseProps = {
    className?: string;
    activeClassName?: string;
    content?: { normal: React.ReactNode; active: React.ReactNode };
    /**
     * When true, start loading the destination route's chunk on hover/touch.
     * No-op for routes whose component isn't a `lazy()` component.
     */
    prefetch?: boolean;
};

type RatiLinkToProps<T extends readonly GenericRouteType[]> =
    | {
          to: NameToRoute<T>;
          href?: undefined;
      }
    | { href: string; to?: undefined };

type RatiGenericAnchorProps = RatiLinkBaseProps &
    GenericAnchorProps & { href: string; isActive: boolean };

type RatiRegularAnchorProps<T extends readonly GenericRouteType[]> = RatiLinkBaseProps &
    GenericAnchorProps &
    RatiLinkToProps<T>;

const GenericAnchor = function GenericAnchor({
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
    const router = useRouterStore();

    const handleOnClick = useCallback(
        (event: React.MouseEvent<HTMLAnchorElement, MouseEvent>) => {
            if (userOnClick) userOnClick(event);
            if (!shouldHandleLinkClick(event)) return;
            event.preventDefault();
            const path = anchorPath(event.currentTarget);
            navTraceStart(`click → ${path}`);
            router.navigate(path);
        },
        [userOnClick, router],
    );

    const handleMouseEnter = useCallback(
        (event: React.MouseEvent<HTMLAnchorElement, MouseEvent>) => {
            if (userOnMouseEnter) userOnMouseEnter(event);
            if (prefetch) void router.preloadRoute(anchorPath(event.currentTarget));
        },
        [prefetch, userOnMouseEnter, router],
    );

    const handleTouchStart = useCallback(
        (event: React.TouchEvent<HTMLAnchorElement>) => {
            if (userOnTouchStart) userOnTouchStart(event);
            if (prefetch) void router.preloadRoute(anchorPath(event.currentTarget));
        },
        [prefetch, userOnTouchStart, router],
    );

    return (
        <a
            {...props}
            href={`${href}`}
            aria-current={isActive ? 'page' : undefined}
            className={[className || null, isActive ? (activeClassName ?? 'active') : null]
                .filter((item) => item)
                .join(' ')}
            onClick={handleOnClick}
            onMouseEnter={handleMouseEnter}
            onTouchStart={handleTouchStart}
        >
            {children || (content && (isActive ? content.active : content.normal))}
        </a>
    );
};

export const Link = function Link({
    to,
    href,
    ...props
}: PropsWithChildren<RatiRegularAnchorProps<UserRoutes>>) {
    const router = useRouterStore();

    const resolvedHref = to ? router.getPath(to) : href!;
    const isActive = isHrefActive(router, resolvedHref);

    return <GenericAnchor {...props} {...{ isActive, href: resolvedHref }} />;
};

export const LinkContextProvider = memo(function LinkContextProvider({
    children,
    to,
}: {
    children: React.ReactNode;
    to: NameToRoute<UserRoutes> | string;
}) {
    const router = useRouterStore();

    return (
        <LinkContext.Provider value={new LinkContextStore(router, to)}>
            {children}
        </LinkContext.Provider>
    );
});

export const ContextualLink = function ContextualAnchor(
    props: PropsWithChildren<RatiLinkBaseProps & GenericAnchorProps>,
) {
    // Subscribe to the router so active state re-renders on navigation — the
    // LinkContextStore getters derive from it.
    useRouterStore();
    const linkContext = useLinkContext();

    return (
        <GenericAnchor {...props} {...{ isActive: linkContext.isActive, href: linkContext.href }} />
    );
};

/**
 * Where this anchor points, as an absolute path. `anchor.href` (the IDL property) is the
 * DOM's own resolution of the attribute, dot segments included, so a relative href resolves
 * with no resolution code in rati and an intercepted click lands where an unintercepted one
 * would.
 */
function anchorPath(anchor: HTMLAnchorElement): string {
    const url = new URL(anchor.href);
    return url.pathname + url.search + url.hash;
}

/**
 * Whether `href` names the route on screen, resolved before comparing: `href="c"` at
 * `/a/b/c` is the page it is on. Resolves against the placeholder origin, off `window`,
 * assuming no `<base href>`; an href leaving that origin is external, and one the parser
 * rejects is inactive.
 */
function isHrefActive(router: RouterStore<readonly GenericRouteType[]>, href: string): boolean {
    const base = PLACEHOLDER_ORIGIN + router.basename + router.path + router.search;
    let url: URL;
    try {
        url = new URL(href, base);
    } catch {
        return false;
    }
    if (url.origin !== PLACEHOLDER_ORIGIN) return false;
    return router.isPath(url.pathname + url.search + url.hash);
}

const PLACEHOLDER_ORIGIN = 'http://_';

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
        private router: RouterStore<readonly GenericRouteType[]>,
        private to: NameToRoute<T> | string,
    ) {}

    get isActive() {
        return isHrefActive(this.router, this.href);
    }

    get href() {
        return this.router.getPath(this.to);
    }
}

export function useLinkContext() {
    const context = useContext(LinkContext);
    if (!context) {
        throw new Error('Link context is not enabled. Add missing `LinkContextProvider` component');
    }
    return context;
}
