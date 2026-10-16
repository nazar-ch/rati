# Scope — product statements

¶¶ The product-level stances a scope answers to: what a screen declares, how its loads are scheduled, what a load can be, and what a load's result is not. How an island shows a scope resolving is the Island area's; how a failure is shaped is the Errors area's.

¶¶ A statement binds from its approval token alone (jnana-kit:///plugin/docs/product.md §Lifecycle); a proposed one binds nothing until the user walks it. A statement carrying a horizon token before that one states its relation to the shipped package (jnana-kit:///plugin/docs/product.md §Horizon).

## Terms

- ⭑SC-1 *scope* is the declaration of which data a screen needs and in what order. {approved 2026-10-16}
- ⭑SC-2 *source* is a load whose value keeps changing after it first becomes ready. {approved 2026-10-16}

## The waterfall

- ⭑SC-3 Where a load is declared is when it runs: loads on one level run together, and a level runs after every level before it. {approved 2026-10-16}

## Types

- ⭑SC-4 Loaded data is typed once, where it comes from: a component reads its prop types off the scope and declares none. {approved 2026-10-16}

## What a scope is not

- ⭑SC-5 rati is not a request cache: a load's result lives with the island instance that resolved it and nowhere else. {approved 2026-10-16}
