# Island — product statements

¶¶ The product-level stances an island answers to: its slots, when its component renders, how it re-resolves, retries and refreshes, and what a subtree can read from it. What a scope declares is the Scope area's; the shape of a failure is the Errors area's; what an island does under a server render is the Server rendering area's.

¶¶ A statement binds from its approval token alone (jnana-kit:///plugin/docs/product.md §Lifecycle); a proposed one binds nothing until the user walks it. A statement carrying a horizon token before that one states its relation to the shipped package (jnana-kit:///plugin/docs/product.md §Horizon).

## Terms

- ⭑ISL-1 *island* is a scope mounted with a component and the slots shown while it loads or fails. {approved 2026-10-16}
- ⭑ISL-4 *slot* is a component an island shows in place of its own while it loads or fails. {proposed}
- ⭑ISL-5 *resolution* is one pass of an island over its scope, from the inputs it was given to the values its component renders. {proposed}

## All or nothing

- ⭑ISL-2 An island renders its component only once every value its scope declares is ready. {approved 2026-10-16}
- ⭑ISL-3 Loading and failure are shown by an island's slots, never handled inside its component. {approved 2026-10-16}
- ⭑ISL-6 A screen whose parts arrive separately is several islands, never one island showing parts. {proposed}
- ⭑ISL-7 At any moment an island shows exactly one of its slots or its component, and any descendant can ask which. {proposed}

## Lifetime

- ⭑ISL-8 An island re-resolves when one of its inputs changes. {proposed}
- ⭑ISL-9 A discarded resolution never reaches the screen: after an input change, a retry or a refresh mid-flight, only the newest resolution's values render. {proposed}
- ⭑ISL-10 When an island unmounts, everything its resolution started is released. {proposed}

## Reading from below

- ⭑ISL-11 Any descendant of an island reads what it provides by naming the scope, so a reader imports a data module and never the component that mounted it. {proposed}
- ⭑ISL-12 Where several islands over one scope stand above a reader, the nearest one answers. {proposed}

## Retry

- ⭑ISL-13 An island retries a failed load on its own only where the app marked that failure retryable. {proposed}
- ⭑ISL-14 An island that is retrying is loading: its error slot appears only once the attempts are spent. {proposed}
- ⭑ISL-15 A retry from the error slot re-resolves the whole island, and any descendant can trigger the same retry. {proposed}

## Refresh

- ⭑ISL-16 Any descendant of an island can re-resolve it in place, without the screen tearing down. {proposed}
- ⭑ISL-17 Refreshing one load re-runs that load alone, and its previous value stays on screen until the new one lands. {proposed}
- ⭑ISL-18 After one load is refreshed, a load downstream re-runs only where it read the refreshed value and that value changed. {proposed}
- ⭑ISL-19 A refreshed value equal to the previous one keeps the previous value, so nothing downstream moves. {proposed}
- ⭑ISL-20 An app defines per load what counts as a change, for a payload where a deep comparison costs too much. {proposed}
- ⭑ISL-21 A refresh of one load that fails keeps the previous value on screen. {proposed}
- ⭑ISL-22 A source is never refreshed: it is live and refreshes itself. {proposed}
- ⭑ISL-23 A refresh of the whole island re-resolves it through its loading slot, as a retry does. {proposed}

## Keeping content up

- ⭑ISL-24 An island can keep its previous content on screen while it re-resolves, reported as stale, instead of blanking to its loading slot. {proposed}
- ⭑ISL-25 Kept content is the previous resolution whole: its sources stay attached and its provided value stays readable until the new resolution commits. {proposed}
- ⭑ISL-26 A failure during a stale window shows the error slot: stale content never passes for current. {proposed}
- ⭑ISL-27 Continuity across a stale window is visual: component-local state does not survive it, and state that must survive belongs in a provided value or above the island. {proposed}
- ⭑ISL-28 An island can hold its loading slot back for a short window, so a resolution that beats the window never shows a spinner. {proposed}
- ⭑ISL-29 Once a loading slot is up it stays until content returns: a further re-resolve never blanks it or re-shows it. {proposed}
- ⭑ISL-30 Holding a loading slot back changes what an island shows, never what it reports: an island with nothing of its own on screen is loading. {proposed}

## Later

- ⭑ISL-31 A load that calls a hook without being declared as one is reported in development. {deferred} {proposed}
