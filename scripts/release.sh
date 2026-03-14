#!/bin/bash
set -e

# Usage: ./scripts/release.sh [patch|minor|major]
# Defaults to patch if no argument given

INCREMENT="${1:-patch}"

if [[ "$INCREMENT" != "patch" && "$INCREMENT" != "minor" && "$INCREMENT" != "major" ]]; then
  echo "Usage: ./scripts/release.sh [patch|minor|major]"
  exit 1
fi

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

# Bump version
OLD_VERSION=$(jq -r '.version' package.json)
IFS='.' read -r MAJOR MINOR PATCH <<< "$OLD_VERSION"

case "$INCREMENT" in
  patch) PATCH=$((PATCH + 1)) ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
esac

NEW_VERSION="$MAJOR.$MINOR.$PATCH"

echo ""
echo "  $OLD_VERSION → $NEW_VERSION ($INCREMENT)"
echo ""
read -p "Proceed? [y/N] " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

# Update package.json
jq --arg v "$NEW_VERSION" '.version = $v' package.json > package.json.tmp && mv package.json.tmp package.json

# Also update the --version output in bin/revspec.ts
sed -i '' "s/revspec $OLD_VERSION/revspec $NEW_VERSION/" bin/revspec.ts 2>/dev/null || \
sed -i "s/revspec $OLD_VERSION/revspec $NEW_VERSION/" bin/revspec.ts

# Commit and tag
git add package.json bin/revspec.ts
git commit -m "release: v$NEW_VERSION"
git tag "v$NEW_VERSION"

# Publish to npm
echo ""
echo "Publishing to npm..."
npm publish

# Push
git push && git push origin "v$NEW_VERSION"

echo ""
echo "✔ Released v$NEW_VERSION"
echo "  npm: https://www.npmjs.com/package/revspec"
echo "  git: https://github.com/icyrainz/revspec/releases/tag/v$NEW_VERSION"
