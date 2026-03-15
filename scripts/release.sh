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

# Sync version to plugin.json and marketplace.json
jq --arg v "$VERSION" '.version = $v' .claude-plugin/plugin.json > .claude-plugin/plugin.json.tmp \
  && mv .claude-plugin/plugin.json.tmp .claude-plugin/plugin.json
jq --arg v "$VERSION" '.plugins[0].version = $v' .claude-plugin/marketplace.json > .claude-plugin/marketplace.json.tmp \
  && mv .claude-plugin/marketplace.json.tmp .claude-plugin/marketplace.json

echo ""
echo "  Publishing v$VERSION"
echo ""
read -p "Proceed? [y/N] " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

# Tag current commit (force-update if tag exists)
git tag -f "v$VERSION"

# Publish to npm
echo ""
echo "Publishing to npm..."
npm publish

# Push commit and tag (force-update remote tag if it exists)
git push
git push origin "v$VERSION" --force

echo ""
echo "Released v$VERSION"
echo "  npm: https://www.npmjs.com/package/revspec"
echo "  git: https://github.com/icyrainz/revspec/releases/tag/v$VERSION"
