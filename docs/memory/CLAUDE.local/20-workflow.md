## Workflow

- **rati declares no `verify:*` scripts and must not gain any** — the battery is the list.
- **`yarn ci` is the release ritual**, running what the battery skips: `fuzz` (the randomized suites at `FUZZ_RUNS=500`) and `build` (library bundle + d.ts, then both examples). Run it before a public release, and after touching the mandala engine or the build.
- Keep the canonical docs in sync with the behavior they describe — that tree is what the website renders.

<!--r-->

- **A consumer-visible change takes a CHANGELOG.md `## Unreleased` bullet in the same commit** — a removal or rename with its replacement, a fix consumers worked around, new public API. A release retitles the section, so a missed entry is never written. A non-empty section at a branch's exit owes a release: `publish.ts prerelease --item <ID>` in `packages/rati`, `<X.Y.Z>-beta.1` opening a series.

evidence: 0.7.0 shipped with no `## Unreleased` entry, and the consumer adopting it read `git log` instead.

<!--/r-->

- **rati's id prefixes:** **DATA** (the `rati/data` package), **DX** (testing + developer experience), **IMP** (improvement review), **REV** (production review), **SI** (scope/island).

## Restricted actions

- **Don't run `vp lint --fix` blindly** — `no-unnecessary-type-assertion`'s autofix breaks the typecheck, which is why that rule is off here and tsc is the authoritative gate.
