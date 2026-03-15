#!/bin/bash
set -e

# Usage: ./scripts/release.sh
# Publishes the version already set in package.json.
# Bump the version manually in package.json before running this.

# Ensure clean working tree
if [ -n "$(git status --porcelain)" ]; then
  echo "Error: working tree is dirty. Commit or stash changes first."
  exit 1
fi

# Ensure on main
BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "main" ]; then
  echo "Error: must be on main branch (currently on $BRANCH)"
  exit 1
fi

# Run tests
echo "Running tests..."
bun test || { echo "Tests failed. Aborting release."; exit 1; }

VERSION=$(jq -r '.version' package.json)

echo ""
echo "  Publishing v$VERSION"
echo ""
read -p "Proceed? [y/N] " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

# Tag if not already tagged
if ! git tag -l "v$VERSION" | grep -q .; then
  git tag "v$VERSION"
fi

# Publish to npm
echo ""
echo "Publishing to npm..."
npm publish

# Push
git push && git push origin "v$VERSION"

echo ""
echo "Released v$VERSION"
echo "  npm: https://www.npmjs.com/package/revspec"
echo "  git: https://github.com/icyrainz/revspec/releases/tag/v$VERSION"
