# Codex Beta Build

This document describes how to build, sign, notarize, and distribute a Codex beta build of Craft Agents.

## Prerequisites

1. **1Password CLI** (`op`) - for fetching signing credentials
2. **Xcode Command Line Tools** - for `codesign`, `xcrun notarytool`, `hdiutil`
3. **Wrangler CLI** - for uploading to Cloudflare R2
4. **Bun** - for building the app

## Build Steps

### 1. Update Version (if needed)

Edit `apps/electron/package.json` and set a version higher than production to prevent auto-update prompts:

```json
"version": "0.4.0"
```

### 2. Build the DMG

The build script handles everything: building, code signing, and notarization.

```bash
cd apps/electron
bash scripts/build-dmg.sh arm64
```

This will:
- Clean previous builds
- Install dependencies
- Download Bun binary
- Build the Electron app
- Sign with Developer ID (using `APPLE_SIGNING_IDENTITY` from 1Password)
- Notarize with Apple (using credentials from 1Password)
- Create a DMG with Applications symlink

Output: `apps/electron/release/Craft-Agents-arm64.dmg`

### 3. Upload to R2

```bash
npx wrangler r2 object put agents-craft-do/codex-beta/Craft\ Agents.dmg \
  --file="apps/electron/release/Craft-Agents-arm64.dmg" \
  --remote
```

### 4. Verify Download URL

The DMG is served via the `agents-router` worker:

**URL:** https://agents.craft.do/codex-beta/Craft%20Agents.dmg

## Credentials

All credentials are stored in 1Password vault `DEV_Craft_Agents`:

| Item | Fields |
|------|--------|
| Craft Agents Apple Signing - Gyula Halmos | `apple_id`, `team_id`, `app_specific_password`, `signing_identity` |

The build script automatically syncs these via `bun run sync-secrets`.

## Troubleshooting

### Codesign errSecInternalComponent

If you see `errSecInternalComponent` with "unable to build chain to self-signed root":

1. Check for custom trust settings:
   ```bash
   security dump-trust-settings
   ```

2. Remove any "TrustAsRoot" settings for Developer ID Certification Authority:
   ```bash
   security find-certificate -a -p -c "Developer ID Certification Authority" ~/Library/Keychains/login.keychain-db > /tmp/cert.pem
   security remove-trusted-cert /tmp/cert.pem
   ```

3. Ensure WWDR intermediate certificates are installed from https://www.apple.com/certificateauthority/

### App Crashes on Launch (V8/Electron)

If the app crashes during V8 initialization after manual signing:

**Cause:** Missing entitlements. Electron requires:
- `com.apple.security.cs.allow-jit`
- `com.apple.security.cs.allow-unsigned-executable-memory`
- `com.apple.security.cs.disable-library-validation`

**Fix:** Use `electron-builder` (via `scripts/build-dmg.sh`) which applies entitlements automatically.

### Gatekeeper Warning

If macOS shows "Apple could not verify...":

**Cause:** App not notarized.

**Fix:** The build script notarizes automatically. If manual signing was done, notarize with:
```bash
xcrun notarytool submit /path/to/app.zip \
  --apple-id "EMAIL" \
  --team-id "TEAM_ID" \
  --password "APP_SPECIFIC_PASSWORD" \
  --wait

xcrun stapler staple /path/to/App.app
```

## Infrastructure

### R2 Bucket
- **Bucket:** `agents-craft-do`
- **Path:** `codex-beta/Craft Agents.dmg`

### Cloudflare Worker
- **Worker:** `agents-router`
- **Route:** `agents.craft.do/*`
- **Binding:** `DOWNLOADS` → `agents-craft-do` bucket

The worker routes `/codex-beta/*` paths to the R2 bucket (added in `workers/agents-router/index.ts`).

## Version Strategy

- Production releases: `0.3.x` (auto-updater checks against these)
- Codex beta: `0.4.x` (higher than production, won't trigger "update available")
- Future production: When Codex ships, bump production to `0.4.x` or higher
