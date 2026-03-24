# CLAUDE.md — Web UI (`apps/webui`)

## Purpose
Browser-accessible interface for Craft Agent, reusing the Electron renderer's components.
Served alongside the headless server for remote deployment.

## Architecture
- Vite + React app that aliases `@` → `apps/electron/src/renderer/`
- Web API adapter (`src/adapter/web-api.ts`) wraps `WsRpcClient` + `buildClientApi` + web stubs
- Cookie-based JWT session auth (HttpOnly, Secure, SameSite=Strict)
- Static login page (`src/login.html`) — no JS bundle needed for unauthenticated users

## Responsive Layout
WebUI responsiveness is handled by **container queries and `isAutoCompact`** in the shared
electron renderer components. No webui-specific CSS overrides are needed.

- `@container/shell` on `PanelStackContainer` — triggers auto-collapse of sidebar/navigator
- `@container/panel` on each `PanelSlot` — adapts dropdowns, settings rows, chat padding
- `isAutoCompact` in `AppShell` — derived from shell width via `ResizeObserver`
- `responsive.ts` exports only `useIsMobile()` — thin `matchMedia` hook for viewport-level concerns (touch, virtual keyboard)

**Do not add `!important` CSS overrides or `nth-child` selectors for layout.** If something doesn't adapt properly, fix it in the shared renderer components with container queries or `data-layout` attributes.

## Commands
From repo root:
```bash
bun run webui:dev          # Vite dev server on :5175
bun run webui:build        # Production build → apps/webui/dist/
bun run webui:typecheck    # TypeScript check
bun run server:dev:webui   # Build webui + start headless server with web UI
```

## Environment variables (on the headless server)
- `CRAFT_WEBUI_DIR` — path to built web UI dist/ (enables web UI on the RPC port)
- `CRAFT_WEBUI_PASSWORD` — optional shorter password for web login (falls back to `CRAFT_SERVER_TOKEN`)
- `CRAFT_WEBUI_SECURE_COOKIE` — optional `true` / `false` override for the session cookie `Secure` flag
- `CRAFT_WEBUI_WS_URL` — optional browser-facing `ws://` or `wss://` URL returned by `/api/config` (useful behind proxies)

## Key files
- `src/adapter/web-api.ts` — Web implementation of ElectronAPI (overrides LOCAL_ONLY methods)
- `src/App.tsx` — Fetches config, creates adapter, lazy-loads Electron App
- `src/responsive.ts` — Thin `useIsMobile()` hook (viewport detection only)
- `src/login.html` — Static login page (no React)
- `src/shims/` — Empty module replacements for Electron-specific imports

## Hard rules
- Never store the server token in localStorage or URL params
- Auth is cookie-based only (HttpOnly, no JS access)
- Web-specific overrides must satisfy the ElectronAPI interface
- Keep shims minimal — prefer no-ops over complex emulations
- **No webui-specific CSS layout overrides** — responsive behavior lives in the shared renderer
