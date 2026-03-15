#!/bin/bash
# Syncs version from package.json to plugin.json and marketplace.json.
# Used as a pre-commit hook and by release.sh.

VERSION=$(jq -r '.version' package.json)
PLUGIN_VERSION=$(jq -r '.version' .claude-plugin/plugin.json)
MARKETPLACE_VERSION=$(jq -r '.plugins[0].version' .claude-plugin/marketplace.json)

CHANGED=0

if [ "$PLUGIN_VERSION" != "$VERSION" ]; then
  jq --arg v "$VERSION" '.version = $v' .claude-plugin/plugin.json > .claude-plugin/plugin.json.tmp \
    && mv .claude-plugin/plugin.json.tmp .claude-plugin/plugin.json
  git add .claude-plugin/plugin.json
  CHANGED=1
fi

if [ "$MARKETPLACE_VERSION" != "$VERSION" ]; then
  jq --arg v "$VERSION" '.plugins[0].version = $v' .claude-plugin/marketplace.json > .claude-plugin/marketplace.json.tmp \
    && mv .claude-plugin/marketplace.json.tmp .claude-plugin/marketplace.json
  git add .claude-plugin/marketplace.json
  CHANGED=1
fi

if [ "$CHANGED" -eq 1 ]; then
  echo "Synced plugin versions to $VERSION"
fi
