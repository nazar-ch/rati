# Releasing `rati`

**Before the version bump: retitle CHANGELOG.md's `## Unreleased` section to `## <version> — <date>`, and open a fresh empty one above it.** The notes are written as the changes land (rati's always-loaded layer carries that rule), so releasing is a rename, not a writing session — pre-1.0, a minor bump under `^` lands on consumers automatically, and the entry is the half of the break the version number doesn't carry.

Two things to check while you are there, because a release is the last moment either is cheap: that every removal is paired with its replacement, and that a rename keeping an old import resolving with a *new* meaning is called out (the 0.6.3 `Router` entry is the worked example). An `## Unreleased` that is genuinely empty releases as one line saying nothing consumer-visible changed — that is an answer, not a gap.

## One-time setup, and rotating the token

The script reads the npm token from the macOS Keychain: a generic-password entry under the service `npm_token_rati` and your login name. Create an npm access token that can publish `rati`, then store it:

```sh
security add-generic-password -U -a "$USER" -s npm_token_rati -w
```

With `-w` last, `security` prompts for the token, so the token never reaches your shell history. `-U` replaces an existing entry, which is how an expired token is rotated.

## Releasing

**`release.ts` refuses at the Keychain read, before anything is bumped, committed or published**: no operation of `@jnana-app/commands` 0.0.1 starts `security find-generic-password`, so the script cannot read its token, and a release waits on the package shipping that operation and one emitting `packages/rati`'s d.ts (kit◊CK-14).

From the repo root, on a clean `main` that's in sync with origin:

```sh
./scripts/release.ts                # patch, the default: 0.4.9 -> 0.4.10
./scripts/release.ts minor          # -> 0.5.0
./scripts/release.ts prerelease     # 0.4.9-alpha.1 -> 0.4.9-alpha.2
./scripts/release.ts 0.5.0          # explicit version
```

It resolves the bump, prints `rati <current> → <new>` with the dist-tag and publisher, and waits for a single `y` — anything else aborts and puts `package.json` back. Nothing is committed, tagged, published or pushed before that keypress.

Flags:

- `--dry-run` — after every check a release runs, the Keychain token and the tests and build included, write the bump to package.json, print the version and dist-tag it would publish, run `yarn npm publish --dry-run`, then restore package.json. No commit, tag, publish, or push.
- `--yes` — skip the confirmation prompt.
- `--otp <code>` — pass a 2FA one-time code (only if your token doesn't bypass 2FA).

### dist-tags are derived automatically

Prerelease versions (anything with a `-`, e.g. `0.4.9-alpha.2`) publish under their prerelease tag (`alpha`, `beta`, `rc`, …), **not** `latest`. Stable versions publish under `latest`. This keeps `npm install rati` on the last stable release.

## If a publish fails

Tests and build run *before* the version bump, so the usual failure window is the network call to the registry. If `yarn npm publish` fails, the version commit and tag exist locally but were not pushed. Undo them and retry:

```sh
git tag -d v<version>
git reset --hard HEAD~1
```
