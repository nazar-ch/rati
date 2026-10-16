# Scope — product statements

¶¶ The product-level stances a scope answers to: what a screen declares, how its loads are scheduled, what a load can be, and what a load's result is not. How an island shows a scope resolving is the Island area's; how a failure is shaped is the Errors area's.

¶¶ A statement binds from its approval token alone (jnana-kit:///plugin/docs/product.md §Lifecycle); a proposed one binds nothing until the user walks it. A statement carrying a horizon token before that one states its relation to the shipped package (jnana-kit:///plugin/docs/product.md §Horizon).

## Terms

- ⭑SC-1 *scope* is the declaration of which data a screen needs and in what order. {approved 2026-10-16}
- ⭑SC-2 *source* is a load whose value keeps changing after it first becomes ready. {approved 2026-10-16}
- ⭑SC-6 *input* is a value a scope is given rather than loads: an island's prop, or a route's param. {proposed}
- ⭑SC-7 *load* is one value a scope resolves, named by its key. {proposed}
- ⭑SC-8 *level* is a group of loads a scope resolves together. {proposed}

## The declaration

- ⭑SC-9 A scope is a plain value: declared in a data module, imported by anything, and readable without rendering. {proposed}
- ⭑SC-10 A load reads every value the levels before it resolved, and nothing else. {proposed}
- ⭑SC-11 A component receives a load's settled value, never the thing that produced it. {proposed}
- ⭑SC-12 A load declared as a class becomes an instance built from the values resolved before it. {proposed}
- ⭑SC-13 A load can read React context or a library that offers only hooks, so an existing data library coexists with rati instead of being replaced. {proposed}
- ⭑SC-14 A scope provides to the subtree under its island either its resolved values or one value derived from them. {proposed}
- ⭑SC-15 A provided value that can be disposed is disposed when its island tears down, before the data it was built over is released. {proposed}

## The waterfall

- ⭑SC-3 Where a load is declared is when it runs: loads on one level run together, and a level runs after every level before it. {approved 2026-10-16}
- ⭑SC-16 A load runs at most once per resolution, however many times React renders, replays or discards the tree. {proposed}
- ⭑SC-17 A load is told when the resolution it belongs to is discarded, so a request the user navigated past can stop. {proposed}

## Sources

- ⭑SC-18 A source is attached when its island mounts and detached when the island unmounts: the connection lives as long as the screen. {proposed}
- ⭑SC-19 A source that drops back to pending puts its island back into loading. {proposed}

## Types

- ⭑SC-4 Loaded data is typed once, where it comes from: a component reads its prop types off the scope and declares none. {approved 2026-10-16}
- ⭑SC-20 A load that reads a value no earlier level resolved does not compile. {proposed}

## What a scope is not

- ⭑SC-5 rati is not a request cache: a load's result lives with the island instance that resolved it and nowhere else. {approved 2026-10-16}
- ⭑SC-21 rati is not a fetch client: a load is any function that returns the data, and the API client is the app's. {proposed}
- ⭑SC-22 A resolved set never carries placeholder or initial data: nothing renders first to be corrected later. {proposed}

## Later

- ⭑SC-23 A scope can be built on another scope, sharing its declaration. {deferred} {proposed}

⭑SC-23 Designed and deferred until a real need, with the identity and channel questions open: docs/research/undecided/deferred-scope-features.md.
