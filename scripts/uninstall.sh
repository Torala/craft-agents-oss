#!/bin/bash
#
# Craft Agent Uninstaller
# Completely removes Craft Agent for testing fresh installs
#
# Usage: bash scripts/uninstall.sh
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

info() { printf "%b\n" "${BLUE}→${NC} $1"; }
success() { printf "%b\n" "${GREEN}✓${NC} $1"; }
warn() { printf "%b\n" "${YELLOW}!${NC} $1"; }

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
printf "%b\n" "  ${BOLD}Craft Agent Uninstaller${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 1. Remove binary from ~/.local/bin
if [ -f "$HOME/.local/bin/craft" ]; then
    rm -f "$HOME/.local/bin/craft"
    success "Removed ~/.local/bin/craft"
else
    info "No binary at ~/.local/bin/craft"
fi

# 2. Remove bun-linked version
if command -v bun >/dev/null 2>&1; then
    if [ -f "$HOME/.bun/bin/craft" ]; then
        bun unlink 2>/dev/null || rm -f "$HOME/.bun/bin/craft"
        success "Removed bun-linked craft"
    else
        info "No bun-linked craft"
    fi
fi

# 3. Remove config and credentials
if [ -d "$HOME/.craft-agent" ]; then
    rm -rf "$HOME/.craft-agent"
    success "Removed ~/.craft-agent (config & credentials)"
else
    info "No ~/.craft-agent directory"
fi

# 4. Remove PATH from shell configs
remove_path_from_config() {
    local config_file="$1"
    local config_name="$2"

    if [ -f "$config_file" ]; then
        if grep -q "# Added by Craft Agent installer" "$config_file" 2>/dev/null; then
            # macOS sed requires '' after -i, Linux doesn't
            if [[ "$OSTYPE" == "darwin"* ]]; then
                sed -i '' '/# Added by Craft Agent installer/d' "$config_file"
                sed -i '' '/export PATH="\$HOME\/.local\/bin:\$PATH"/d' "$config_file"
            else
                sed -i '/# Added by Craft Agent installer/d' "$config_file"
                sed -i '/export PATH="\$HOME\/.local\/bin:\$PATH"/d' "$config_file"
            fi
            success "Removed PATH from $config_name"
        else
            info "No Craft PATH entry in $config_name"
        fi
    fi
}

remove_path_from_config "$HOME/.zshrc" ".zshrc"
remove_path_from_config "$HOME/.bashrc" ".bashrc"
remove_path_from_config "$HOME/.bash_profile" ".bash_profile"
remove_path_from_config "$HOME/.profile" ".profile"

# 5. Clear command hash
hash -r 2>/dev/null || true

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
success "Uninstall complete!"
echo ""

# Verify
if command -v craft >/dev/null 2>&1; then
    warn "craft command still found at: $(which craft)"
    printf "%b\n" "  This may be from another source or cached."
    printf "%b\n" "  Open a ${BOLD}new terminal${NC} to verify removal."
else
    success "craft command not found (good!)"
fi

echo ""
printf "%b\n" "  ${BOLD}To test fresh install:${NC}"
echo ""
printf "%b\n" "  1. Open a ${BOLD}new terminal window${NC}"
echo "  2. Run:"
echo ""
printf "%b\n" "     ${BOLD}curl -fsSL https://agents.craft.do/install.sh | bash${NC}"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
