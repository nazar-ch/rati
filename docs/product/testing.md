# Testing and tracing — product statements

¶¶ The product-level stances the test kit and the tracers answer to: what an app can drive by hand, what a test can prove, and what a developer can watch. How rati's own suites are organized is docs/current/internals.md §Testing, never this file.

¶¶ A statement binds from its approval token alone (jnana-kit:///plugin/docs/product.md §Lifecycle); a proposed one binds nothing until the user walks it.

## The test kit

- ⭑TST-1 rati ships the test kit its own suites use, so an app tests an island, a router or a server round-trip with no mocks of rati's internals. {proposed}
- ⭑TST-2 A test drives a load, a source or a data producer by hand and settles calls in any order. {proposed}
- ⭑TST-3 A test source counts its attaches and detaches, so a leak or a double attach is an assertion. {proposed}
- ⭑TST-4 A dead island never looks healthy: reading a slot the island crashed past throws. {proposed}
- ⭑TST-5 A hung server render fails within a budget, naming what is still pending and where. {proposed}
- ⭑TST-6 A server round-trip test throws on a hydration mismatch, naming it. {proposed}
- ⭑TST-7 The test kit works in a suite that leaves React's act environment unset, and never changes the runner's own. {proposed}

## Tracing

- ⭑TST-8 Navigation and data resolution can each be traced to the console, off unless switched on, switchable live, and free when off. {proposed}
- ⭑TST-9 The data trace shows the waterfall as it ran: each level's start, each value's settle with its cost, and the moment the component rendered. {proposed}
- ⭑TST-10 There is no devtools panel: tracing is the console's. {proposed}
