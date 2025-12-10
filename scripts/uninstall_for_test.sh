#!/bin/bash
# Craft TUI Agent - Clean uninstall script
# Removes all binaries, config, cache, and keychain entries

set -e

echo "Craft TUI Agent - Clean Uninstall"
echo "=================================="

# 1. Remove symlink from PATH
if [ -L ~/.local/bin/craft ]; then
  echo "Removing ~/.local/bin/craft symlink..."
  rm -f ~/.local/bin/craft
  echo "  Done"
else
  echo "~/.local/bin/craft symlink not found (already clean)"
fi

# 2. Remove installed versions
if [ -d ~/.local/share/craft ]; then
  echo "Removing ~/.local/share/craft (installed versions)..."
  rm -rf ~/.local/share/craft
  echo "  Done"
else
  echo "~/.local/share/craft not found (already clean)"
fi

# 3. Remove config directory
if [ -d ~/.craft-agent ]; then
  echo "Removing ~/.craft-agent (config and cache)..."
  rm -rf ~/.craft-agent
  echo "  Done"
else
  echo "~/.craft-agent not found (already clean)"
fi

# 4. Remove keychain entries (macOS only)
if [[ "$OSTYPE" == "darwin"* ]]; then
  echo "Removing keychain entries..."

  # Global credentials
  security delete-generic-password -s "craft-tui-agent" -a "anthropic_api_key::global" 2>/dev/null && echo "  Removed: anthropic_api_key" || true
  security delete-generic-password -s "craft-tui-agent" -a "claude_oauth::global" 2>/dev/null && echo "  Removed: claude_oauth" || true
  security delete-generic-password -s "craft-tui-agent" -a "craft_oauth::global" 2>/dev/null && echo "  Removed: craft_oauth" || true

  # Workspace and agent credentials (pattern match)
  # List all craft-tui-agent entries and delete them
  for account in $(security dump-keychain 2>/dev/null | grep -A4 '"craft-tui-agent"' | grep '"acct"' | sed 's/.*="//;s/".*//'); do
    security delete-generic-password -s "craft-tui-agent" -a "$account" 2>/dev/null && echo "  Removed: $account" || true
  done

  echo "  Done"
else
  echo "Skipping keychain cleanup (not macOS)"
fi

echo ""
echo "Uninstall complete. Craft has been fully removed."
