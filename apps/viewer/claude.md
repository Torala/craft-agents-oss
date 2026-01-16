# Craft Agent Session Viewer

A minimal, read-only web application for viewing and sharing Craft Agent session transcripts.

## Purpose

Users can:
- Upload local session JSON files (drag-drop, file browser, or clipboard paste)
- View shared sessions via direct URL (`/s/{sessionId}`)
- All processing happens client-side - no data uploaded to servers (for local files)

## Tech Stack

**Frontend:**
- React 18 + TypeScript
- Vite 6
- Tailwind CSS 4
- Lucide React (icons)
- react-markdown with GFM, syntax highlighting via Shiki
- Motion library (animations)

**Backend:**
- Cloudflare Pages Functions
- Cloudflare R2 (object storage)

## Project Structure

```
apps/viewer/
├── src/
│   ├── components/
│   │   ├── Header.tsx          # App header with logo, clear button, theme toggle
│   │   ├── SessionUpload.tsx   # File upload UI (drag-drop, paste, browse)
│   │   └── index.ts
│   ├── App.tsx                 # Main app (routing, state, overlays)
│   ├── main.tsx                # React entry point
│   └── index.css               # Tailwind + custom drop-zone styles
├── functions/
│   └── s/api/
│       └── [[path]].ts         # Cloudflare Pages Function (session API)
├── wrangler.toml               # Cloudflare config (R2 bucket binding)
├── vite.config.ts              # Dev server, API proxy
└── index.html
```

## UI Architecture

```
┌─────────────────────────────────────────┐
│ Header                                  │
│  ├─ Logo + "Session Viewer" branding    │
│  ├─ Clear button (when session loaded)  │
│  └─ Theme toggle (sun/moon)             │
├─────────────────────────────────────────┤
│ Main Content (flex-1)                   │
│  ├─ Loading state (pulse animation)     │
│  ├─ Error state (with retry)            │
│  ├─ SessionUpload (centered upload UI)  │
│  └─ SessionViewer (transcript display)  │
├─────────────────────────────────────────┤
│ Modal Overlays (z-indexed)              │
│  ├─ CodePreviewOverlay (Read/Write)     │
│  ├─ DiffPreviewOverlay (Edit)           │
│  ├─ TerminalPreviewOverlay (Bash/Grep)  │
│  └─ GenericOverlay (fallback)           │
└─────────────────────────────────────────┘
```

## Key Components

### Header (`Header.tsx`)
- Craft Agent logo (purple #9570BE SVG)
- Conditional clear button to reset session
- Theme toggle with system preference detection

### SessionUpload (`SessionUpload.tsx`)
- Drag-and-drop zone with visual feedback (icon changes when dragging)
- Click-to-browse file input
- Clipboard paste detection for JSON
- Validates JSON has `id` and `messages` array
- Privacy notice displayed

### Shared Components (from `@craft-agent/ui`)
- `SessionViewer` - displays session transcript in read-only mode
- `CodePreviewOverlay`, `DiffPreviewOverlay`, `TerminalPreviewOverlay` - modal overlays for tool inspection

## State Management

Minimal hook-based local state in `App.tsx`:

```typescript
session: StoredSession | null
sessionId: string | null  // derived from URL /s/{id}
isLoading: boolean
error: string | null
isDark: boolean           // theme, synced with system preference
overlayActivity: ActivityItem | null
```

## Backend API

Cloudflare Pages Function at `functions/s/api/[[path]].ts` with R2 storage.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/s/api` | Create session - generates 15-char nanoid, stores in R2, returns `{ id, url }` |
| `GET` | `/s/api/{id}` | Fetch session - returns JSON with 60s cache |
| `PUT` | `/s/api/{id}` | Update session - validates existence, updates R2 |
| `DELETE` | `/s/api/{id}` | Delete session - removes from R2, purges edge cache |

### Storage

- **Bucket:** `craft-agent-sessions` (Cloudflare R2)
- **Binding:** `SESSIONS` in worker environment
- **Files:** `{sessionId}.json`

### Security

- No authentication - relies on nanoid entropy for session ID privacy
- Open CORS (allows any origin)
- Session ID acts as bearer token

## Development

```bash
# From repo root
pnpm viewer:dev      # Dev server on port 5174, opens test session

# From this directory
pnpm dev             # Dev server
pnpm build           # Production build to dist/
pnpm typecheck       # TypeScript checking
```

### Configuration

- **Dev port:** 5174
- **API proxy:** Dev server proxies `/s/api/*` to `https://agents.craft.do`
- **Test session:** `tz5-13I84pwK_he`
- **Remote dev:** `wrangler.toml` uses `remote = true` to access real R2 bucket

## Deployment

Deployed as Cloudflare Pages:
- Frontend: Vite build to `dist/`
- Backend: Pages Functions auto-deployed from `functions/`
- Domain: `agents.craft.do`

## Workspace Dependencies

```
@craft-agent/core   # StoredSession type
@craft-agent/ui     # SessionViewer, overlays, shared styles
```
