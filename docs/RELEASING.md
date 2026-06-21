# Releasing `rati`

From the repo root, on a clean `main` that's in sync with origin:

```sh
./scripts/release.sh patch          # 0.4.9 -> 0.4.10
./scripts/release.sh minor          # -> 0.5.0
./scripts/release.sh prerelease     # 0.4.9-alpha.1 -> 0.4.9-alpha.2
./scripts/release.sh 0.5.0          # explicit version
```

Flags:

- `--dry-run` — bump package.json in memory, run `npm publish --dry-run`, then revert.
  No commit, tag, publish, or push.
- `--yes` — skip the confirmation prompt.
- `--otp <code>` — pass a 2FA one-time code (only if your token doesn't bypass 2FA).

### dist-tags are derived automatically

Prerelease versions (anything with a `-`, e.g. `0.4.9-alpha.2`) publish under their
prerelease tag (`alpha`, `beta`, `rc`, …), **not** `latest`. Stable versions publish
under `latest`. This keeps `npm install rati` on the last stable release.

## If a publish fails

Tests and build run *before* the version bump, so the usual failure window is the network
call to npm. If `npm publish` fails, the version commit and tag exist locally but were not
pushed. Undo them and retry:

```sh
git tag -d v<version>
git reset --hard HEAD~1
```
