# Releasing `rati`

rati releases on two channels: every release the family installs is a prerelease that `publish.ts` cuts into the package bucket, and a public version reaches npm only by the maintainer's own command on the host (⭑DEV-20). Each release retitles CHANGELOG.md's `## Unreleased` section, whose entries land with the change (⭑DEV-11).

Before either release, read the `## Unreleased` entries: every removal names its replacement, and a rename that keeps an old import resolving with a new meaning says so — the 0.6.3 `Router` entry is the worked example. An empty `## Unreleased` releases as one line saying nothing consumer-visible changed.

## A release for the family

- **A non-empty `## Unreleased` at a branch's exit is a release owed**, cut on that branch before its pull request.
- **`publish.ts 0.7.2-beta.1 --item <ID>`, run from `packages/rati`, opens a series** at the smallest bump over the last public version that the entries justify.
- **`publish.ts prerelease --item <ID>` increments an open series** — `0.7.2-beta.1` to `0.7.2-beta.2`.
- **`--dry-run` prints the version, the archive name and the changelog heading the run would write**, and writes nothing.

The tool uploads the archive and reads it back over its public URL before it commits anything. It then makes one commit, `<ID>: Release rati v<version>`, carrying:

- the version in packages/rati/package.json;
- CHANGELOG.md with `## Unreleased` retitled to `## <version> — <UTC day>` under a fresh `## Unreleased`;
- the row it prepends to `packages/rati/manifest.json`, whose `url` is what a consumer pins.

A run bumps its consumers to that `url` inside the run, before the release's pull request merges. A session leaves the bump to preflight's pin row in each consumer.

## A public release

On the user's word, an agent runs `yarn ci`, then `publish.ts X.Y.Z --item <ID>` from `packages/rati`, then tags `vX.Y.Z` at the record commit and pushes the branch and the tag. The user then publishes on the host, at that commit:

```sh
YARN_NPM_AUTH_TOKEN="$(security find-generic-password -a "$USER" -s npm_token_rati -w)" yarn workspace rati npm publish --otp <code>
```

`.yarnrc.yml` names `https://registry.npmjs.org` as the publish registry, and the pack runs the package's `prepack` build.

The token lives in the host's Keychain under the service `npm_token_rati` and the login name. Store one, or rotate an expired one, with this command, which prompts for the token so it never reaches the shell history:

```sh
security add-generic-password -U -a "$USER" -s npm_token_rati -w
```

## If a publish fails

`publish.ts` commits nothing before the upload is proven, and every exit short of the release commit puts `package.json` and `CHANGELOG.md` back. A failed run leaves nothing to undo: fix what its last lines name and run the same command again. A failed `npm publish` leaves the release commits and the tag in place, so run the host command again; npm refuses a version it already holds.
