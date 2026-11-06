# Head — product statements

¶¶ The product-level stances the document head answers to: the title and per-page metadata, which declaration wins, and what the server-rendered head means on the client. How the server assembles the page is the Server rendering area's.

¶¶ A statement binds from its approval token alone (jnana-kit:///plugin/docs/product.md §Lifecycle); a proposed one binds nothing until the user walks it.

## Declarations

- ⭑HD-1 The title and per-page metadata are declared from page content, and the deepest live declaration wins. {proposed}
- ⭑HD-2 When a declaration leaves, the next outer one takes over, and the default where none is left. {proposed}
- ⭑HD-3 A title template wraps every declared title and never the default title. {proposed}

## The document

- ⭑HD-4 On the client the document's head follows the declarations on hydration and on every navigation. {proposed}
- ⭑HD-5 On the server the winning declarations are rendered into the page's head. {proposed}
- ⭑HD-6 A server-rendered head stands until the page that declares it has hydrated: no default writes over it and nothing reconciles it away before its declarer speaks. {proposed}

## What the head layer is not

- ⭑HD-7 rati's head owns only what needs deduping across layers; a tag one place declares is React's own and needs nothing of rati's. {proposed}
