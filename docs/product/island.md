# Island — product statements

¶¶ The product-level stances an island answers to: its slots, when its component renders, how it re-resolves, retries and refreshes, and what a subtree can read from it. What a scope declares is the Scope area's; the shape of a failure is the Errors area's.

¶¶ A statement binds from its approval token alone (jnana-kit:///plugin/docs/product.md §Lifecycle); a proposed one binds nothing until the user walks it. A statement carrying a horizon token before that one states its relation to the shipped package (jnana-kit:///plugin/docs/product.md §Horizon).

## Terms

- ⭑ISL-1 *island* is a scope mounted with a component and the slots shown while it loads or fails. {approved 2026-10-16}

## All or nothing

- ⭑ISL-2 An island renders its component only once every value its scope declares is ready. {approved 2026-10-16}
- ⭑ISL-3 Loading and failure are shown by an island's slots, never handled inside its component. {approved 2026-10-16}
