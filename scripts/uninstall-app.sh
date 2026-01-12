#!/bin/bash
#
# Craft Agent Desktop App Uninstaller
# Removes Craft Agent.app from /Applications
#
# Usage: bash scripts/uninstall-app.sh
#

set -e

APP_NAME="Craft Agent.app"
INSTALL_DIR="/Applications"
CONFIG_DIR="$HOME/.craft-agent"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

info() { printf "%b\n" "${BLUE}>${NC} $1"; }
success() { printf "%b\n" "${GREEN}>${NC} $1"; }
warn() { printf "%b\n" "${YELLOW}!${NC} $1"; }

echo ""
echo "─────────────────────────────────────────────────────────────────────────"
printf "%b\n" "  ${BOLD}Craft Agent Desktop Uninstaller${NC}"
echo "─────────────────────────────────────────────────────────────────────────"
echo ""

# Check for macOS
if [ "$(uname -s)" != "Darwin" ]; then
    echo "This uninstaller is for macOS only."
    exit 1
fi

# 1. Remove app from /Applications
if [ -d "$INSTALL_DIR/$APP_NAME" ]; then
    rm -rf "$INSTALL_DIR/$APP_NAME"
    success "Removed $INSTALL_DIR/$APP_NAME"
else
    info "No app at $INSTALL_DIR/$APP_NAME"
fi

# 2. Ask about config directory
if [ -d "$CONFIG_DIR" ]; then
    echo ""
    warn "Configuration directory exists at $CONFIG_DIR"
    printf "%b\n" "  This contains your workspaces, credentials, and settings."
    echo ""
    printf "%b" "  Do you want to remove it? [y/N] "
    read -r response
    if [[ "$response" =~ ^[Yy]$ ]]; then
        rm -rf "$CONFIG_DIR"
        success "Removed $CONFIG_DIR"
    else
        info "Keeping $CONFIG_DIR"
    fi
else
    info "No configuration directory at $CONFIG_DIR"
fi

echo ""
echo "─────────────────────────────────────────────────────────────────────────"
success "Uninstall complete!"
echo ""
printf "%b\n" "  ${BOLD}To reinstall:${NC}"
echo ""
printf "%b\n" "     ${BOLD}curl -fsSL https://agents.craft.do/install-app.sh | bash${NC}"
echo ""
echo "─────────────────────────────────────────────────────────────────────────"
echo ""
