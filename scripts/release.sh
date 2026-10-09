#!/usr/bin/env bash
# why-shell: no shell license fits this batch of CLI calls with an exit-code roll-up (kit◊KC-53),
# so it converts to TypeScript the next time it changes for a reason of its own.
#
# Release script for the `rati` package.
#
# Usage:
#   scripts/release.sh [bump] [--yes] [--otp <code>] [--dry-run]
#
#   [bump]   patch (default) | minor | major | prepatch | preminor | premajor
#            | prerelease, or an explicit version like 0.5.0
#
# One-time setup: see docs/current/RELEASING.md.

set -euo pipefail

PACKAGE="rati"
KEYCHAIN_SERVICE="npm_token_rati"
RELEASE_BRANCH="main"
# yarn's default registry is its read-only mirror, so publishing points at npmjs
# through the YARN_NPM_PUBLISH_REGISTRY export.
PUBLISH_REGISTRY="https://registry.npmjs.org"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG_DIR="${REPO_ROOT}/packages/${PACKAGE}"

die()  { echo "✗ $*" >&2; exit 1; }
info() { echo "→ $*"; }

# Only a NON-FLAG first argument is the bump, so `release.sh --dry-run` keeps its flag.
BUMP="patch"
if [[ $# -gt 0 && "$1" != -* ]]; then
  BUMP="$1"
  shift
fi
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

command -v node     >/dev/null || die "node not found"
command -v yarn     >/dev/null || die "yarn not found"
command -v security >/dev/null || die "macOS 'security' tool not found (Keychain unavailable)"

cd "${REPO_ROOT}"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[[ "${BRANCH}" == "${RELEASE_BRANCH}" ]] || die "On branch '${BRANCH}', expected '${RELEASE_BRANCH}'."
[[ -z "$(git status --porcelain)" ]] || die "Working tree is dirty. Commit or stash first."

git fetch --quiet origin "${RELEASE_BRANCH}"
if UPSTREAM="$(git rev-parse --abbrev-ref '@{u}' 2>/dev/null)"; then
  [[ "$(git rev-parse @)" == "$(git rev-parse "${UPSTREAM}")" ]] \
    || die "Local '${RELEASE_BRANCH}' is not in sync with ${UPSTREAM}. Pull/push first."
fi

info "Reading npm token from Keychain (service: ${KEYCHAIN_SERVICE})…"
NPM_TOKEN="$(security find-generic-password -a "${USER}" -s "${KEYCHAIN_SERVICE}" -w 2>/dev/null || true)"
[[ -n "${NPM_TOKEN}" ]] || die "No token in Keychain. Run the one-time setup in docs/current/RELEASING.md."

# yarn reads these as its npmAuthToken / npmPublishRegistry config; the environment
# keeps the secret off disk and inside this process.
export YARN_NPM_AUTH_TOKEN="${NPM_TOKEN}"
export YARN_NPM_PUBLISH_REGISTRY="${PUBLISH_REGISTRY}"

yarn_pkg() { yarn workspace "${PACKAGE}" "$@"; }

# Gate on the exit code, not the output: `yarn npm whoami` prints its error to
# stdout (not stderr) and would otherwise masquerade as a username.
if ! WHO="$(yarn npm whoami --publish 2>/dev/null)"; then
  die "Token failed to authenticate (expired?). Rotate it — see docs/current/RELEASING.md."
fi
# The username is the FIRST line: `yarn npm whoami` appends a timing line carrying the
# same "➤ YN0000: " prefix.
WHO="${WHO%%$'\n'*}"
WHO="${WHO##*: }"
info "Authenticated as: ${WHO}"

# Before the bump, so a failing test or build leaves package.json alone.
info "Running tests…"
yarn_pkg test
info "Building…"
yarn_pkg build
[[ -d "${PKG_DIR}/dist" ]] || die "Build produced no dist/."

CURRENT="$(node -p "require('${PKG_DIR}/package.json').version")"

derive_tag() { # $1 = version -> echoes dist-tag
  if [[ "$1" == *-* ]]; then
    local t; t="$(printf '%s' "$1" | sed -E 's/^[0-9]+\.[0-9]+\.[0-9]+-([A-Za-z][A-Za-z0-9]*).*/\1/')"
    [[ "${t}" == "$1" ]] && t="next"; echo "${t}"
  else
    echo "latest"
  fi
}

if [[ ${DRY_RUN} -eq 1 ]]; then
  yarn_pkg version "${BUMP}" >/dev/null
  NEW_VERSION="$(node -p "require('${PKG_DIR}/package.json').version")"
  DIST_TAG="$(derive_tag "${NEW_VERSION}")"
  info "DRY RUN — would publish ${PACKAGE}@${NEW_VERSION} (dist-tag: ${DIST_TAG})"
  yarn_pkg npm publish --tag "${DIST_TAG}" --dry-run || true
  git checkout -- "${PKG_DIR}/package.json"
  info "Dry run complete — no commit, tag, publish, or push performed."
  exit 0
fi

# Only `yarn version` knows how a keyword resolves, so the bump is written here and
# read back for the prompt; the trap restores package.json on any exit before the commit.
restore_pkg_json() { git -C "${REPO_ROOT}" checkout -- "${PKG_DIR}/package.json" 2>/dev/null || true; }
yarn_pkg version "${BUMP}" >/dev/null
trap restore_pkg_json EXIT
NEW_VERSION="$(node -p "require('${PKG_DIR}/package.json').version")"
DIST_TAG="$(derive_tag "${NEW_VERSION}")"

info "${PACKAGE} ${CURRENT} → ${NEW_VERSION} (bump: ${BUMP} · dist-tag: ${DIST_TAG} · publisher: ${WHO})"
if [[ ${ASSUME_YES} -ne 1 ]]; then
  read -r -n 1 -p "Publish and push v${NEW_VERSION}? [y/N] " ans || ans=""
  echo
  [[ "${ans}" == "y" || "${ans}" == "Y" ]] || die "Aborted."
fi

# Braces keep the multibyte `…` out of the variable NAME, which `set -u` aborts on (kit◊KC-42).
info "Committing and tagging v${NEW_VERSION}…"
# `yarn version` writes package.json alone, never a commit or a tag.
git -C "${REPO_ROOT}" commit -q -m "release: ${PACKAGE} v${NEW_VERSION}" -- "${PKG_DIR}/package.json"
# Annotated: `git push --follow-tags` ignores a lightweight tag.
git -C "${REPO_ROOT}" tag -a "v${NEW_VERSION}" -m "release: ${PACKAGE} v${NEW_VERSION}"
trap - EXIT

info "Publishing ${PACKAGE}@${NEW_VERSION} (dist-tag: ${DIST_TAG})…"
PUB_ARGS=(npm publish --tag "${DIST_TAG}")
[[ -n "${OTP}" ]] && PUB_ARGS+=(--otp "${OTP}")
if ! yarn_pkg "${PUB_ARGS[@]}"; then
  die "Publish failed. The version commit/tag exist locally but were NOT pushed.
   Undo with:  git tag -d v${NEW_VERSION} && git reset --hard HEAD~1"
fi

info "Pushing commit + tag…"
git push --follow-tags origin "${RELEASE_BRANCH}"

echo
echo "✓ Published ${PACKAGE}@${NEW_VERSION}  (dist-tag: ${DIST_TAG})"
echo "  https://www.npmjs.com/package/${PACKAGE}/v/${NEW_VERSION}"
