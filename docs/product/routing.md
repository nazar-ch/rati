# Routing — product statements

¶¶ The product-level stances the router answers to: routes and their table, params, links and navigation, redirects, history and code splitting. What a route resolves before rendering is the Island area's; what the server answers for a route is the Server rendering area's.

¶¶ A statement binds from its approval token alone (jnana-kit:///plugin/docs/product.md §Lifecycle); a proposed one binds nothing until the user walks it. A statement carrying a horizon token before that one states its relation to the shipped package (jnana-kit:///plugin/docs/product.md §Horizon).

## Terms

- ⭑RT-1 *route* is an island bound to a URL. {approved 2026-10-16}
- ⭑RT-2 *param* is a segment of a route's path that the URL fills in and the route receives as a value. {proposed}
- ⭑RT-3 *route table* is the list of an app's routes, written once in app code. {proposed}

## The table

- ⭑RT-4 A route is an island in every respect: each island option holds on a route unchanged. {proposed}
- ⭑RT-5 The route table is a plain value in app code, never derived from files. {proposed}
- ⭑RT-6 One declaration of the route table types every link and every route read in the app. {proposed}
- ⭑RT-7 The component bound to a route is checked against the path's params when the app compiles. {proposed}
- ⭑RT-8 Shared presentation — a layout, a loading slot, an error slot — is declared once over a list of routes, and a route's own choice wins. {proposed}
- ⭑RT-9 An app mounts under a path prefix without its routes knowing it. {proposed}

## Params

- ⭑RT-10 A param reads back exactly as it was navigated with, whatever characters it holds; the app never encodes one itself. {proposed}
- ⭑RT-11 A param value that no URL can carry is refused when the path is built, rather than landing somewhere else. {proposed}

## Links and navigation

- ⭑RT-12 A link to a route is checked when the app compiles: the route must exist and every param must be supplied. {proposed}
- ⭑RT-13 A link lands where the browser would have taken it: an intercepted click resolves its target as an unintercepted one would. {proposed}
- ⭑RT-14 A click the browser would open elsewhere — modified, another target, a download, another origin — is left to the browser. {proposed}
- ⭑RT-15 A string the router navigates to names an absolute path inside the app; a relative reference or another origin is refused. {proposed}
- ⭑RT-16 The URL can change without re-resolving the mounted route, for a view that lives in the URL without being a screen. {proposed}
- ⭑RT-17 Per-entry state rides a navigation and comes back with back and forward. {proposed}
- ⭑RT-18 Navigating to the current path again does not re-resolve the route. {proposed}
- ⭑RT-19 A descendant reads what the active route's island provides by the route's name, importing nothing of that route. {proposed}
- ⭑RT-20 The router is a plain store an app holds anywhere, and holding it never imports the route table. {proposed}

## Redirects

- ⭑RT-21 A route can declare itself a redirect, and the redirecting URL never enters the back stack. {proposed}
- ⭑RT-22 A redirect can point at a same-origin path nothing in the table matches. {proposed}
- ⭑RT-23 A redirect chain that loops stops and renders the route instead. {proposed}
- ⭑RT-24 A redirect to another origin is never the route table's: it stays at the HTTP layer. {proposed}

## History and scroll

- ⭑RT-25 Back and forward return to an entry as it was, with its state. {proposed}
- ⭑RT-26 A navigation scrolls to the top, back and forward restore the saved position, and a hash scrolls to its anchor. {proposed}
- ⭑RT-27 Back and forward re-resolve a route's data: no result is retained across navigations. {proposed}

## Code splitting

- ⭑RT-28 A route's component can arrive as a separate chunk, fetched before the route renders, so the previous page stays up and no fallback flashes. {proposed}
- ⭑RT-29 A link can start fetching its route's chunk on hover or touch, off unless asked. {proposed}
- ⭑RT-30 A chunk is split where the app declares it; rati splits nothing on its own. {proposed}

## What the router is not

- ⭑RT-31 One route renders at a time: there are no parallel or intercepting routes. {proposed}

## Later

- ⭑RT-32 A route can refuse or redirect a navigation before it resolves. {deferred} {proposed}
- ⭑RT-33 Search params are typed as path params are. {deferred} {proposed}

⭑RT-33 Typed search params and the guard (⭑RT-32) wait for a consumer's need, and both have a consumer naming one: docs/research/router-extensions.md.
