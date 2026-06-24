#!/usr/bin/env bash
#
# Release script for the `rati` package.
#
# Usage:
#   scripts/release.sh <bump> [--yes] [--otp <code>] [--dry-run]
#
#   <bump>   patch | minor | major | prepatch | preminor | premajor | prerelease
#            or an explicit version like 0.5.0
#
# One-time setup: see docs/RELEASING.md.

set -euo pipefail

# --- config ---------------------------------------------------------------
PACKAGE="rati"
KEYCHAIN_SERVICE="npm_token_rati"
RELEASE_BRANCH="main"
# yarn's default registry is its read-only mirror, so publishing must be pointed
# explicitly at npmjs (see the YARN_NPM_PUBLISH_REGISTRY export below).
PUBLISH_REGISTRY="https://registry.npmjs.org"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG_DIR="$REPO_ROOT/packages/$PACKAGE"

die()  { echo "✗ $*" >&2; exit 1; }
info() { echo "→ $*"; }

# --- args -----------------------------------------------------------------
BUMP="${1:-}"
shift || true
ASSUME_YES=0
OTP=""
DRY_RUN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    -y|--yes)  ASSUME_YES=1 ;;
    --otp)     OTP="${2:-}"; shift ;;
    --dry-run) DRY_RUN=1 ;;
    *) die "Unknown option: $1" ;;
  esac
  shift
done

[[ -n "$BUMP" ]] || die "Usage: scripts/release.sh <patch|minor|major|prerelease|x.y.z> [--yes] [--otp <code>] [--dry-run]"

# --- preflight ------------------------------------------------------------
command -v node     >/dev/null || die "node not found"
command -v yarn     >/dev/null || die "yarn not found"
command -v security >/dev/null || die "macOS 'security' tool not found (Keychain unavailable)"

cd "$REPO_ROOT"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[[ "$BRANCH" == "$RELEASE_BRANCH" ]] || die "On branch '$BRANCH', expected '$RELEASE_BRANCH'."
[[ -z "$(git status --porcelain)" ]] || die "Working tree is dirty. Commit or stash first."

git fetch --quiet origin "$RELEASE_BRANCH"
if UPSTREAM="$(git rev-parse --abbrev-ref '@{u}' 2>/dev/null)"; then
  [[ "$(git rev-parse @)" == "$(git rev-parse "$UPSTREAM")" ]] \
    || die "Local '$RELEASE_BRANCH' is not in sync with $UPSTREAM. Pull/push first."
fi

# --- token from Keychain --------------------------------------------------
info "Reading npm token from Keychain (service: $KEYCHAIN_SERVICE)…"
NPM_TOKEN="$(security find-generic-password -a "$USER" -s "$KEYCHAIN_SERVICE" -w 2>/dev/null || true)"
[[ -n "$NPM_TOKEN" ]] || die "No token in Keychain. Run the one-time setup in docs/RELEASING.md."

# Hand the token + publish target to `yarn npm …` via env (yarn reads these as
# the npmAuthToken / npmPublishRegistry config). Passing them through the
# environment keeps the secret off disk, and scopes it to this process only.
export YARN_NPM_AUTH_TOKEN="$NPM_TOKEN"
export YARN_NPM_PUBLISH_REGISTRY="$PUBLISH_REGISTRY"

# Run a command in the $PACKAGE workspace from anywhere in the repo.
yarn_pkg() { yarn workspace "$PACKAGE" "$@"; }

# Gate on the exit code, not the output: `yarn npm whoami` prints its error to
# stdout (not stderr) and would otherwise masquerade as a username.
if ! WHO="$(yarn npm whoami --publish 2>/dev/null)"; then
  die "Token failed to authenticate (expired?). Rotate it — see docs/RELEASING.md."
fi
WHO="${WHO##*: }"   # strip yarn's "➤ YN0000: " report prefix, leaving the username
info "Authenticated as: $WHO"

# --- test + build (fail before bumping) -----------------------------------
info "Running tests…"
yarn_pkg test
info "Building…"
yarn_pkg build
[[ -d "$PKG_DIR/dist" ]] || die "Build produced no dist/."

CURRENT="$(node -p "require('$PKG_DIR/package.json').version")"

derive_tag() { # $1 = version -> echoes dist-tag
  if [[ "$1" == *-* ]]; then
    local t; t="$(printf '%s' "$1" | sed -E 's/^[0-9]+\.[0-9]+\.[0-9]+-([A-Za-z][A-Za-z0-9]*).*/\1/')"
    [[ "$t" == "$1" ]] && t="next"; echo "$t"
  else
    echo "latest"
  fi
}

# --- dry run: bump package.json only, publish --dry-run, then revert -------
if [[ $DRY_RUN -eq 1 ]]; then
  yarn_pkg version "$BUMP" >/dev/null
  NEW_VERSION="$(node -p "require('$PKG_DIR/package.json').version")"
  DIST_TAG="$(derive_tag "$NEW_VERSION")"
  info "DRY RUN — would publish $PACKAGE@$NEW_VERSION (dist-tag: $DIST_TAG)"
  yarn_pkg npm publish --tag "$DIST_TAG" --dry-run || true
  git checkout -- "$PKG_DIR/package.json"
  info "Dry run complete — no commit, tag, publish, or push performed."
  exit 0
fi

# --- confirm --------------------------------------------------------------
info "Current version: $CURRENT — bump: $BUMP — publisher: $WHO"
if [[ $ASSUME_YES -ne 1 ]]; then
  read -r -p "Bump, publish, and push $PACKAGE? [y/N] " ans
  [[ "$ans" == "y" || "$ans" == "Y" ]] || die "Aborted."
fi

# --- bump (commit + tag) --------------------------------------------------
# `yarn version` only writes the new version into package.json; it does not
# create the git commit/tag we rely on below, so we make them ourselves.
# (The tag must be annotated: `git push --follow-tags` ignores lightweight ones.)
info "Bumping version ($BUMP)…"
yarn_pkg version "$BUMP" >/dev/null
NEW_VERSION="$(node -p "require('$PKG_DIR/package.json').version")"
DIST_TAG="$(derive_tag "$NEW_VERSION")"
git -C "$REPO_ROOT" commit -q -m "release: $PACKAGE v$NEW_VERSION" -- "$PKG_DIR/package.json"
git -C "$REPO_ROOT" tag -a "v$NEW_VERSION" -m "release: $PACKAGE v$NEW_VERSION"

# --- publish --------------------------------------------------------------
info "Publishing $PACKAGE@$NEW_VERSION (dist-tag: $DIST_TAG)…"
PUB_ARGS=(npm publish --tag "$DIST_TAG")
[[ -n "$OTP" ]] && PUB_ARGS+=(--otp "$OTP")
if ! yarn_pkg "${PUB_ARGS[@]}"; then
  die "Publish failed. The version commit/tag exist locally but were NOT pushed.
   Undo with:  git tag -d v$NEW_VERSION && git reset --hard HEAD~1"
fi

# --- push -----------------------------------------------------------------
info "Pushing commit + tag…"
git push --follow-tags origin "$RELEASE_BRANCH"

echo
echo "✓ Published $PACKAGE@$NEW_VERSION  (dist-tag: $DIST_TAG)"
echo "  https://www.npmjs.com/package/$PACKAGE/v/$NEW_VERSION"
