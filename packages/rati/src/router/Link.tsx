import { createContext, memo, type PropsWithChildren, useCallback, useContext } from 'react';

import { type NameToRoute, type GenericRouteType, type UserRoutes } from './route';
import { type RouterStore } from './store';
import { useRouter } from '../stores/RootStore';
import { navTraceStart } from '../util/navTrace';

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
    const router = useRouter();

    const handleOnClick = useCallback(
        (event: React.MouseEvent<HTMLAnchorElement, MouseEvent>) => {
            if (userOnClick) userOnClick(event);
            if (!shouldHandleLinkClick(event)) return;
            event.preventDefault();
            navTraceStart(`click → ${href}`);
            router.navigate(href);
        },
        [href, userOnClick, router],
    );

    const handleMouseEnter = useCallback(
        (event: React.MouseEvent<HTMLAnchorElement, MouseEvent>) => {
            if (userOnMouseEnter) userOnMouseEnter(event);
            if (prefetch) void router.preloadRoute(href);
        },
        [href, prefetch, userOnMouseEnter, router],
    );

    const handleTouchStart = useCallback(
        (event: React.TouchEvent<HTMLAnchorElement>) => {
            if (userOnTouchStart) userOnTouchStart(event);
            if (prefetch) void router.preloadRoute(href);
        },
        [href, prefetch, userOnTouchStart, router],
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
    const router = useRouter();

    const resolvedHref = to ? router.getPath(to) : href!;
    const isActive = router.isPath(resolvedHref);

    return <GenericAnchor {...props} {...{ isActive, href: resolvedHref }} />;
};

export const LinkContextProvider = memo(function LinkContextProvider({
    children,
    to,
}: {
    children: React.ReactNode;
    to: NameToRoute<UserRoutes> | string;
}) {
    const router = useRouter();

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
    // LinkContextStore getters derive from it. Replaces the old mobx `observer`.
    useRouter();
    const linkContext = useLinkContext();

    return (
        <GenericAnchor {...props} {...{ isActive: linkContext.isActive, href: linkContext.href }} />
    );
};

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
        return this.router.isPath(this.href);
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
