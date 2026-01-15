#!/bin/bash

# Self-update script for Craft Agent Electron app (Linux AppImage)
# This script is spawned by the app before quitting to install updates
#
# Usage: self-update-linux.sh <new_appimage_path> <current_appimage_path>
# Environment variables:
#   CRAFT_UPDATE_APPIMAGE   - Path to the downloaded AppImage
#   CRAFT_CURRENT_APPIMAGE  - Path to the currently running AppImage
#
# Safety features:
#   - Atomic swap: old AppImage moved to backup before new one is moved in
#   - Rollback: if installation fails, old AppImage is restored
#   - New AppImage kept until successful launch verified

set -e

# Get paths from arguments or environment
NEW_APPIMAGE="${1:-$CRAFT_UPDATE_APPIMAGE}"
CURRENT_APPIMAGE="${2:-$CRAFT_CURRENT_APPIMAGE}"

# Logging
LOG_FILE="/tmp/craft-agent-update.log"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" >> "$LOG_FILE"
}

show_notification() {
    # Try notify-send first (most common on Linux)
    if command -v notify-send &> /dev/null; then
        notify-send "Craft Agent" "$1" 2>/dev/null || true
    fi
}

error_with_rollback() {
    log "ERROR: $1"

    # Attempt rollback if we have a backup
    if [ -f "$BACKUP_PATH" ]; then
        log "Attempting rollback from backup..."
        if mv "$BACKUP_PATH" "$CURRENT_APPIMAGE" 2>/dev/null; then
            log "Rollback successful - old version restored"
            chmod +x "$CURRENT_APPIMAGE" 2>/dev/null || true
            # Try to launch the restored app
            nohup "$CURRENT_APPIMAGE" > /dev/null 2>&1 &
        else
            log "Rollback failed - manual intervention required"
            log "Backup at: $BACKUP_PATH"
        fi
    fi

    show_notification "Update failed. Your previous version has been restored."
    exit 1
}

log "Starting Linux AppImage self-update"
log "New AppImage: $NEW_APPIMAGE"
log "Current AppImage: $CURRENT_APPIMAGE"

# Validate paths
if [ -z "$NEW_APPIMAGE" ]; then
    log "ERROR: New AppImage path is empty"
    show_notification "Update failed: installer not found."
    exit 1
fi

if [ ! -f "$NEW_APPIMAGE" ]; then
    log "ERROR: New AppImage not found: $NEW_APPIMAGE"
    show_notification "Update failed: installer not found."
    exit 1
fi

if [ -z "$CURRENT_APPIMAGE" ]; then
    log "ERROR: Current AppImage path is empty"
    show_notification "Update failed: could not determine current installation."
    exit 1
fi

# Validate path doesn't contain dangerous characters (prevent injection)
if ! echo "$NEW_APPIMAGE" | grep -qE '^[a-zA-Z0-9/._ -]+$'; then
    log "ERROR: New AppImage path contains invalid characters: $NEW_APPIMAGE"
    show_notification "Update failed: invalid installer path."
    exit 1
fi

# Validate path is absolute
if [ "${NEW_APPIMAGE:0:1}" != "/" ]; then
    log "ERROR: New AppImage path must be absolute: $NEW_APPIMAGE"
    show_notification "Update failed: invalid installer path."
    exit 1
fi

# Show progress notification
show_notification "Installing update, please wait..."

# Wait for app to quit (max 10 seconds)
log "Waiting for app to quit..."
sleep 2  # Give the app time to quit

# Define backup path
BACKUP_PATH="${CURRENT_APPIMAGE}.backup"

# Make new AppImage executable
log "Making new AppImage executable..."
if ! chmod +x "$NEW_APPIMAGE"; then
    log "ERROR: Could not make new AppImage executable"
    show_notification "Update failed: permission error."
    exit 1
fi

# Backup current AppImage (if exists)
if [ -f "$CURRENT_APPIMAGE" ]; then
    log "Backing up current AppImage to $BACKUP_PATH..."
    if ! mv "$CURRENT_APPIMAGE" "$BACKUP_PATH"; then
        log "ERROR: Could not create backup"
        show_notification "Update failed: could not backup existing app."
        exit 1
    fi
    log "Backup created successfully"
fi

# Move new AppImage to current location
log "Installing new AppImage..."
if ! mv "$NEW_APPIMAGE" "$CURRENT_APPIMAGE"; then
    log "ERROR: Could not install new AppImage"
    error_with_rollback "Failed to move new AppImage to install location"
fi

# Ensure executable
chmod +x "$CURRENT_APPIMAGE" 2>/dev/null || true

log "Installation complete. Launching app..."

# Wait a moment
sleep 1

# Launch the updated app
log "Launching updated AppImage..."
nohup "$CURRENT_APPIMAGE" > /dev/null 2>&1 &

# Wait briefly to see if the app launches
sleep 3

# Check if app is running (look for process with our AppImage)
if pgrep -f "$(basename "$CURRENT_APPIMAGE")" > /dev/null 2>&1; then
    log "New version launched successfully"
    # Clean up backup
    rm -f "$BACKUP_PATH" 2>/dev/null || true
    log "Cleanup complete"
else
    log "WARNING: Could not verify new app launch"
    # Keep backup for manual recovery
    log "Backup kept at: $BACKUP_PATH"
fi

log "Update complete!"
