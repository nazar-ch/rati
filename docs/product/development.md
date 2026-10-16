# Development — product statements

¶¶ The engineering-direction stances the package answers to: what rati is built for, how its surface is named, what the core depends on, and how a change reaches consumers. The behavior of any one feature is its own area's.

¶¶ A statement binds from its approval token alone (jnana-kit:///plugin/docs/product.md §Lifecycle); a proposed one binds nothing until the user walks it. A statement carrying a horizon token before that one states its relation to the shipped package (jnana-kit:///plugin/docs/product.md §Horizon).

## What rati is built for

- ⭑DEV-2 rati is built alongside one production app, whose needs drive its design. {proposed}
- ⭑DEV-3 A feature waits for a real need; a speculative one is noted, never designed. {proposed}
- ⭑DEV-4 rati is headless and stack-neutral: no UI dependency, no adapter, nothing in it that knows what a text field is. {proposed}

## Naming

- ⭑DEV-1 The public surface reuses words React developers already know. {approved 2026-10-16}

⭑DEV-1 The user, on dropping a ban on coining terms from this line: "`scope` is borderline and "no terms" it's not a hard restriction" (2026-10-16).

- ⭑DEV-5 The engine has a name inside the package and none outside: a caller sees islands and routes. {proposed}

## Dependencies

- ⭑DEV-6 The core has no runtime dependency beyond React. {proposed}
- ⭑DEV-7 Each optional dependency has an entry of its own, so an app that never uses one installs nothing for it. {proposed}
- ⭑DEV-8 Server rendering, the build plugin, the server, the data primitives and the test kit are entries of the one package. {proposed}
- ⭑DEV-9 There are no decorators anywhere: observable state is plain objects from factories. {proposed}

## Reaching consumers

- ⭑DEV-10 A consumer type-checks and bundles rati's source in development, so an edit to rati needs no build to reach it. {proposed}
- ⭑DEV-11 Every consumer-visible change carries its changelog entry in the commit that makes it. {proposed}
- ⭑DEV-12 A removal or a rename ships with its replacement named. {proposed}
- ⭑DEV-13 A fix a consumer is blocked on ships as a release of its own, before the consumer's change. {proposed}
- ⭑DEV-14 Both example apps stay on the current API and pass the gates the package passes. {proposed}
- ⭑DEV-15 Public surface is documented in the public docs, the tree the website renders, and nowhere else. {proposed}

## Testing direction

- ⭑DEV-16 A test checks the observable contract, never the mechanics behind it. {proposed}
- ⭑DEV-17 The engine is held by generated tests: any scope under any sequence of events converges. {proposed}

## What rati is not

- ⭑DEV-18 rati is not a state manager: client state is the app's, and the optional bindings are an entry apart. {proposed}
- ⭑DEV-19 rati ships no store container: an app's store graph is app code, and the router is the one store rati provides. {proposed}
