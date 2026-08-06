# Releasing `rati`

**Before the version bump: retitle CHANGELOG.md's `## Unreleased` section to
`## <version> — <date>`, and open a fresh empty one above it.** The notes are written as the changes
land (rati's `CLAUDE.md` carries that rule), so releasing is a rename, not a writing session —
pre-1.0, a minor bump under `^` lands on consumers automatically, and the entry is the half of the
break the version number doesn't carry.

Two things to check while you are there, because a release is the last moment either is cheap: that
every removal is paired with its replacement, and that a rename keeping an old import resolving with
a *new* meaning is called out (the 0.6.3 `Router` entry is the worked example). An `## Unreleased`
that is genuinely empty releases as one line saying nothing consumer-visible changed — that is an
answer, not a gap.

From the repo root, on a clean `main` that's in sync with origin:

```sh
./scripts/release.sh                # patch, the default: 0.4.9 -> 0.4.10
./scripts/release.sh minor          # -> 0.5.0
./scripts/release.sh prerelease     # 0.4.9-alpha.1 -> 0.4.9-alpha.2
./scripts/release.sh 0.5.0          # explicit version
```

It resolves the bump, prints `rati <current> → <new>` with the dist-tag and publisher, and waits for
a single `y` — anything else aborts and puts `package.json` back. Nothing is committed, tagged,
published or pushed before that keypress.

Flags:

- `--dry-run` — bump package.json in memory, run `yarn npm publish --dry-run`, then revert. No
  commit, tag, publish, or push.
- `--yes` — skip the confirmation prompt.
- `--otp <code>` — pass a 2FA one-time code (only if your token doesn't bypass 2FA).

### dist-tags are derived automatically

Prerelease versions (anything with a `-`, e.g. `0.4.9-alpha.2`) publish under their prerelease tag
(`alpha`, `beta`, `rc`, …), **not** `latest`. Stable versions publish under `latest`. This keeps
`npm install rati` on the last stable release.

## If a publish fails

Tests and build run *before* the version bump, so the usual failure window is the network call to
the registry. If `yarn npm publish` fails, the version commit and tag exist locally but were not
pushed. Undo them and retry:

```sh
git tag -d v<version>
git reset --hard HEAD~1
```
