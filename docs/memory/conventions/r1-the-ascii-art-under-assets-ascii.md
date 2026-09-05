---
id: r1
kind: note
---

The ASCII art under assets/ascii/ is unused draft material for the website and CLI surfaces, kept to be picked from rather than shipped as-is.

## Details

`assets/ascii/*.txt` holds parrot marks, wordmarks, a departures board, transit and concept diagrams — raw material for the website, the root README, a dev banner, CLI output, 404 pages and code comments, wherever a plain-text mark fits. Nothing in `packages/` or `examples/` reads the directory; docs/planned/website/website-plan.md is the one doc that draws on it.

Every file is a draft: keep what works, redraw or delete the rest, and treat none of them as a fixed asset. They are pure ASCII unless the file says otherwise, and they only read correctly in a monospace font with no reflow — an editor or a renderer that wraps or re-indents destroys the drawing, so copy one verbatim or not at all.

Each filename names what it draws (`parrot-tiny.txt`, `board-404.txt`, `waterfall-levels.txt`), and the drawing itself is the rest of the description: `ls assets/ascii` plus `cat` is how you pick one.

## Without

A session that meets `assets/ascii/` while working on the website or the CLI either treats the drafts as shipped assets and preserves art nobody chose, or reads the directory as junk and deletes it — and reflowing one through a proportional-font edit silently breaks a drawing that still looks like text in the diff.
