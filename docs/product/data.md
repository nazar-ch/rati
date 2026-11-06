# Data — product statements

¶¶ The product-level stances the data primitives answer to: what each owns, where data lives, how a refresh and a write behave, how a primitive enters a scope, and what a form is. What an island does with the first load is the Island area's; the shape of a failure is the Errors area's.

¶¶ A statement binds from its approval token alone (jnana-kit:///plugin/docs/product.md §Lifecycle); a proposed one binds nothing until the user walks it. A statement carrying a horizon token before that one states its relation to the shipped package (jnana-kit:///plugin/docs/product.md §Horizon).

## Terms

- ⭑DATA-1 *query* is one value that refreshes. {proposed}
- ⭑DATA-2 *collection* is a keyed list whose rows keep their identity across refreshes. {proposed}
- ⭑DATA-3 *mutation* is a write that patches optimistically and refreshes afterward. {proposed}
- ⭑DATA-4 *form* is a draft of edits staged locally before a save. {proposed}

## Where data lives

- ⭑DATA-5 The data primitives are an optional entry; the core never depends on them. {proposed}
- ⭑DATA-6 A primitive is an instance the app's store graph owns, and sharing data is sharing the instance. {proposed}
- ⭑DATA-7 There is no normalized entity cache: the same entity reached through two keys is two objects. {proposed}
- ⭑DATA-8 A keyed map holds one instance per key for its lifetime and never evicts, so it fits a key space something real bounds. {proposed}
- ⭑DATA-9 Dropping a key from a keyed map drops the reference and calls nothing on the instance. {proposed}
- ⭑DATA-10 The data primitives speak no HTTP: a producer is any function returning a promise, and the transport is the app's. {proposed}
- ⭑DATA-11 Under the server render the data primitives stay pending: they serve the interactive app, and server-rendered content is a plain load. {proposed}

## Reading

- ⭑DATA-12 A refresh keeps the current data on screen while it re-fetches, and through a refresh that fails. {proposed}
- ⭑DATA-13 An older fetch never overwrites a newer one. {proposed}
- ⭑DATA-14 A primitive re-fetches on its own only where the app asked for it: a value in the URL is the scope's to re-resolve, and a value in a store is a reactive query's to re-fetch. {proposed}
- ⭑DATA-15 Rows keep their identity across refreshes: a changed row updates in place, and unchanged rows keep their object and their array. {proposed}
- ⭑DATA-16 Membership and order follow the server's latest answer. {proposed}
- ⭑DATA-17 The list half of a composite payload gets the same row identity over rows the app already holds, with no fetch of its own. {proposed}
- ⭑DATA-18 A paged list is pages of queries, each with its own phase, and a change of what is listed resets it to the first page. {proposed}

## Writing

- ⭑DATA-19 An optimistic edit applies at once to every observer of the data. {proposed}
- ⭑DATA-20 After a write, the data it declared is refreshed from the server on success and on failure alike, so server truth is the recovery. {proposed}
- ⭑DATA-21 A write refreshes only the data it declared, down to the one keyed instance the call names. {proposed}
- ⭑DATA-22 A local write is no evidence of recovery: it clears no standing error. {proposed}
- ⭑DATA-23 A local edit made while a refresh is in flight is replaced when the refresh settles. {proposed}

## Into a scope

- ⭑DATA-24 A primitive enters a scope as a source that is ready once its first load lands and stays ready with the instance itself; later refreshes and their failures never re-trip the island. {proposed}
- ⭑DATA-25 A query that entered a scope is typed with its data present: the component never guards a value whose presence is why it rendered. {proposed}

## Forms

- ⭑DATA-26 A form never touches the island: it is local state seeded from data already resolved. {proposed}
- ⭑DATA-27 A form is the draft: it reports what differs from its baseline, cancels back to it, and commits a new one on success. {proposed}
- ⭑DATA-28 A form validates when submitted, not on every keystroke, until a field has an error; from then on that field re-checks on every change. {proposed}
- ⭑DATA-29 A submit never rejects: validation failures land on the fields, server field errors on their fields, and anything else on the form. {proposed}
- ⭑DATA-30 A field binds to an input as one spread, in one shape for every kind of input. {proposed}

## What the data primitives are not

- ⭑DATA-31 React's own form action and optimistic hooks are not adopted: state lives in the store, where every observer sees it. {proposed}

## Later

- ⭑DATA-32 The data primitives are a package of their own. {deferred} {proposed}
