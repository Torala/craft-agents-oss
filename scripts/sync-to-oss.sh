#!/bin/bash
set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ALLOW_LIST="$SCRIPT_DIR/oss-allow-list.txt"
DEFAULT_TARGET="git@github.com:lukilabs/craft-agents-oss.git"
TEMP_DIR=""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Parse arguments
TARGET_REPO="$DEFAULT_TARGET"
DRY_RUN=false
BRANCH="main"

while [[ $# -gt 0 ]]; do
  case $1 in
    --target)
      TARGET_REPO="$2"
      shift 2
      ;;
    --branch)
      BRANCH="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --help)
      echo "Usage: $0 [--target <repo-url>] [--branch <branch>] [--dry-run]"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Cleanup function
cleanup() {
  if [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]]; then
    rm -rf "$TEMP_DIR"
  fi
}
trap cleanup EXIT

# Build rsync include/exclude patterns from allow-list
build_rsync_patterns() {
  local patterns=()

  # Always include parent directories for nested paths
  while IFS= read -r line; do
    # Skip comments and empty lines
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// /}" ]] && continue

    local pattern="${line%"${line##*[![:space:]]}"}"  # Trim trailing whitespace

    # Handle ** glob patterns
    if [[ "$pattern" == *"/**/*" ]]; then
      # Convert apps/electron/src/**/* to --include='/apps/electron/src/***'
      local base="${pattern%/**/*}"
      patterns+=("--include=/${base}/***")
    elif [[ "$pattern" == *"/**" ]]; then
      local base="${pattern%/**}"
      patterns+=("--include=/${base}/***")
    else
      # Exact file match
      patterns+=("--include=/${pattern}")
    fi
  done < "$ALLOW_LIST"

  # Exclude everything else
  patterns+=("--exclude=*")

  printf '%s\n' "${patterns[@]}"
}

# Main sync logic
main() {
  echo -e "${GREEN}OSS Sync Script${NC}"
  echo "Source: $REPO_ROOT"
  echo "Target: $TARGET_REPO"
  echo "Branch: $BRANCH"
  echo ""

  cd "$REPO_ROOT"

  # Get all git-tracked files
  local all_files
  all_files=$(git ls-files)

  # Read allow-list patterns (non-comment, non-empty lines)
  local patterns=()
  while IFS= read -r line; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// /}" ]] && continue
    line="${line%"${line##*[![:space:]]}"}"  # Trim trailing whitespace
    patterns+=("$line")
  done < "$ALLOW_LIST"

  # Filter files by allow-list
  local allowed_files=()
  local excluded_files=()

  while IFS= read -r file; do
    local matched=false
    for pattern in "${patterns[@]}"; do
      # Handle ** glob patterns
      if [[ "$pattern" == *"/**/*" ]]; then
        local base="${pattern%/**/*}"
        if [[ "$file" == "$base/"* ]]; then
          matched=true
          break
        fi
      elif [[ "$pattern" == *"/**" ]]; then
        local base="${pattern%/**}"
        if [[ "$file" == "$base/"* ]]; then
          matched=true
          break
        fi
      elif [[ "$file" == "$pattern" ]]; then
        # Exact match
        matched=true
        break
      fi
    done

    if $matched; then
      allowed_files+=("$file")
    else
      excluded_files+=("$file")
    fi
  done <<< "$all_files"

  echo -e "${GREEN}Files to sync:${NC} ${#allowed_files[@]}"
  echo -e "${YELLOW}Files excluded:${NC} ${#excluded_files[@]}"
  echo ""

  if $DRY_RUN; then
    echo -e "${YELLOW}=== DRY RUN ===${NC}"
    echo ""
    echo "Files that WOULD be synced:"
    printf '  %s\n' "${allowed_files[@]}" | head -50
    [[ ${#allowed_files[@]} -gt 50 ]] && echo "  ... and $((${#allowed_files[@]} - 50)) more"
    echo ""
    echo "Files that are EXCLUDED:"
    printf '  %s\n' "${excluded_files[@]}"
    exit 0
  fi

  # Create temp directory for sync
  TEMP_DIR=$(mktemp -d)
  echo "Working directory: $TEMP_DIR"

  # Clone target repo
  echo "Cloning target repository..."
  git clone --depth=1 --branch="$BRANCH" "$TARGET_REPO" "$TEMP_DIR/target" 2>/dev/null || \
    git clone "$TARGET_REPO" "$TEMP_DIR/target"

  # Remove all files in target (except .git)
  echo "Cleaning target..."
  find "$TEMP_DIR/target" -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +

  # Copy allowed files
  echo "Copying allowed files..."
  for file in "${allowed_files[@]}"; do
    local dest="$TEMP_DIR/target/$file"
    mkdir -p "$(dirname "$dest")"
    cp "$REPO_ROOT/$file" "$dest"
  done

  # Show diff
  cd "$TEMP_DIR/target"
  echo ""
  echo -e "${GREEN}=== Changes ===${NC}"
  git status --short

  # Confirm push
  echo ""
  read -p "Push these changes to $TARGET_REPO? [y/N] " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    git add -A
    git commit -m "Sync from internal repository

Synced $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    git push origin "$BRANCH"
    echo -e "${GREEN}Sync complete!${NC}"
  else
    echo "Aborted."
    exit 1
  fi
}

main "$@"
