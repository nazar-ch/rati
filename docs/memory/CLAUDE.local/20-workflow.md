## Workflow

- **rati declares no `verify:*` scripts and must not gain any** — the battery is the list.
- **`yarn ci` is the release ritual**, holding the two things the battery does not run: `fuzz` (the randomized suites at `FUZZ_RUNS=500`, deepened through the env) and `build` (library bundle + d.ts, then both examples). Run it before a release, and after touching the mandala engine or the packaging/build.
- Keep the canonical docs in sync with the behavior they describe — that tree is what the website renders.
- **A consumer-visible change takes a CHANGELOG.md `## Unreleased` bullet in the same commit** — anything a consumer acts on: a removal or rename (with its replacement), a behavior fix they were working around, new public surface. A release only retitles that section, so an entry missed here is an entry that never gets written; 0.7.0 shipped with none, and the consumer adopting it read `git log` instead. Purely internal work adds nothing.
- **rati's id prefixes:** **DATA** (the `rati/data` package), **DX** (testing + developer experience), **IMP** (improvement review), **REV** (production review), **SI** (scope/island).

## Restricted actions

- **Don't run `vp lint --fix` blindly** — `no-unnecessary-type-assertion`'s autofix breaks the typecheck, which is why that rule is off here and tsc is the authoritative gate; the detail is `$DOCTRINE/toolchain/lint.md`.
