# Server rendering — product statements

¶¶ The product-level stances server rendering answers to: the render model, what crosses to the client, response statuses, redirects, and the server pieces an app assembles. The document head is the Head area's; what a route is, the Routing area's.

¶¶ A statement binds from its approval token alone (jnana-kit:///plugin/docs/product.md §Lifecycle); a proposed one binds nothing until the user walks it. A statement carrying a horizon token before that one states its relation to the shipped package (jnana-kit:///plugin/docs/product.md §Horizon).

## The render

- ⭑SSR-3 A load written once runs on the server as it runs on the client. {proposed}
- ⭑SSR-1 A page the server rendered hydrates without re-running a load. {approved 2026-10-16}
- ⭑SSR-2 The server never streams: a response waits for every load on the page. {approved 2026-10-16}
- ⭑SSR-4 Resolved content sits in the HTML where it was declared, whatever the page weighs: nothing waits on a script to move it into place. {proposed}
- ⭑SSR-5 A server renders many requests in one process and shares nothing between them. {proposed}
- ⭑SSR-6 The server takes one attempt per load and never retries: a page that recovers later never held the response open. {proposed}

## What crosses to the client

- ⭑SSR-7 Only a value resolved asynchronously is carried to the client; a plain value is computed again there. {proposed}
- ⭑SSR-8 A source stays pending on the server: a live screen ships its loading slot and comes alive on hydration. {proposed}
- ⭑SSR-9 A source can opt into the server render: resolved once like a load, or seeded from the server's value and live on the client afterward. {proposed}
- ⭑SSR-10 The carried data is inert: it never executes and needs no script exemption. {proposed}
- ⭑SSR-11 Carried data a client cannot read is ignored, and the client resolves from scratch. {proposed}

## Sitting out

- ⭑SSR-12 An island can sit the server render out: the server ships its loading slot and starts none of its loads, and the browser resolves it after hydration. {proposed}
- ⭑SSR-13 An island that sat the server render out never affects the response status. {proposed}

## Statuses and failures

- ⭑SSR-14 The response status follows the data: a URL nothing matched or a thing that does not exist is not found, a failed load is a server error, and anything else is success. {proposed}
- ⭑SSR-15 A load that fails on the server ships the loading slot and the client re-runs it, so a transient server failure heals itself. {proposed}
- ⭑SSR-16 An island can instead ship its error slot from the server with the failure carried alongside, so the client hydrates onto the error. {proposed}
- ⭑SSR-17 A redirect a route declares is answered as a redirect response before anything renders. {proposed}
- ⭑SSR-18 A render that fails outside every island falls back to a client-rendered page rather than an error response. {proposed}

## The server pieces

- ⭑SSR-19 The server speaks the platform's request and response and depends on no server framework. {proposed}
- ⭑SSR-20 The server pieces nest: an app takes the whole handler or drops to any layer below it and keeps the rest. {proposed}
- ⭑SSR-21 An app writes no server for development or for the build: one plugin serves the app and builds both sides. {proposed}
- ⭑SSR-22 A server-rendered page names its route's chunk in its head, so the browser fetches it with the page rather than after it. {proposed}

## What server rendering is not

- ⭑SSR-23 There is no progressive enhancement: the server render is for first paint, and the page needs JavaScript to be used. {proposed}
- ⭑SSR-24 The server keeps no cache of rendered pages or of data: caching is the app's or the CDN's. {proposed}
- ⭑SSR-25 The server runs on Node; an edge runtime is not supported. {proposed}

## Later

- ⭑SSR-26 A page can be rendered at build time. {deferred} {proposed}
- ⭑SSR-27 A component can render on the server alone. {deferred} {proposed}

⭑SSR-27 Server components wait for the toolchain and for a consumer that needs server-only data (docs/research/postponed/rsc-support.md); build-time rendering (⭑SSR-26) is the nearer step and needs a design pass of its own (docs/research/ssg-and-rsc.md).
