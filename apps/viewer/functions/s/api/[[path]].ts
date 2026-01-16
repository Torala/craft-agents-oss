/**
 * Cloudflare Pages Function for session storage
 *
 * Routes:
 * - POST /s/api - Create new session, upload JSON
 * - PUT /s/api/{id} - Update existing session
 * - GET /s/api/{id} - Fetch session JSON
 * - DELETE /s/api/{id} - Delete session
 *
 * Security:
 * - 21-char nanoid for session IDs (126 bits entropy)
 * - Content-Type must be application/json
 * - Max payload size: 5MB
 * - Session validation: requires id (string) and messages (array)
 *
 * Rate limiting (configure in Cloudflare Dashboard > Security > WAF > Rate limiting rules):
 * - Recommended: 10 POST requests/minute per IP to /s/api
 * - Recommended: 1000 POST requests/minute globally to /s/api
 */

interface Env {
  SESSIONS: R2Bucket
}

// Security constants
const MAX_PAYLOAD_SIZE = 5 * 1024 * 1024 // 5MB

// nanoid implementation (no external deps in CF Functions)
const urlAlphabet = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict'
function nanoid(size = 21): string {
  let id = ''
  const bytes = crypto.getRandomValues(new Uint8Array(size))
  for (let i = 0; i < size; i++) {
    id += urlAlphabet[bytes[i] & 63]
  }
  return id
}

/**
 * Validates Content-Type header is application/json
 */
function isValidContentType(request: Request): boolean {
  const contentType = request.headers.get('Content-Type')
  return contentType?.includes('application/json') ?? false
}

/**
 * Checks if payload size exceeds limit using Content-Length header
 */
function isPayloadTooLarge(request: Request): boolean {
  const contentLength = request.headers.get('Content-Length')
  if (!contentLength) return false // Will be caught later if actually too large
  return parseInt(contentLength, 10) > MAX_PAYLOAD_SIZE
}

/**
 * Lightweight validation: session must have id (string) and messages (array)
 */
function isValidSession(body: unknown): body is { id: string; messages: unknown[] } {
  if (!body || typeof body !== 'object') return false
  const obj = body as Record<string, unknown>
  return typeof obj.id === 'string' && Array.isArray(obj.messages)
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context
  const method = request.method
  const pathParts = (params.path as string[]) || []

  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }

  // Handle preflight
  if (method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    // POST /s/api - Create new session
    if (method === 'POST' && pathParts.length === 0) {
      // Validate Content-Type
      if (!isValidContentType(request)) {
        return Response.json({ error: 'Content-Type must be application/json' }, { status: 415, headers: corsHeaders })
      }

      // Check payload size before parsing
      if (isPayloadTooLarge(request)) {
        return Response.json({ error: 'Payload too large (max 5MB)' }, { status: 413, headers: corsHeaders })
      }

      const body = await request.json()

      // Validate session structure (id + messages array)
      if (!isValidSession(body)) {
        return Response.json({ error: 'Invalid session: must have id (string) and messages (array)' }, { status: 400, headers: corsHeaders })
      }

      const id = nanoid()
      const key = `${id}.json`

      await env.SESSIONS.put(key, JSON.stringify(body), {
        httpMetadata: { contentType: 'application/json' },
      })

      // Use public URL (not the Pages URL) for the response
      const publicUrl = 'https://agents.craft.do'
      return Response.json(
        {
          id,
          url: `${publicUrl}/s/${id}`,
        },
        { headers: corsHeaders }
      )
    }

    // PUT /s/api/{id} - Update existing session
    if (method === 'PUT' && pathParts.length === 1) {
      // Validate Content-Type
      if (!isValidContentType(request)) {
        return Response.json({ error: 'Content-Type must be application/json' }, { status: 415, headers: corsHeaders })
      }

      // Check payload size before parsing
      if (isPayloadTooLarge(request)) {
        return Response.json({ error: 'Payload too large (max 5MB)' }, { status: 413, headers: corsHeaders })
      }

      const id = pathParts[0]
      const key = `${id}.json`

      // Check if exists first
      const existing = await env.SESSIONS.head(key)
      if (!existing) {
        return Response.json({ error: 'Session not found' }, { status: 404, headers: corsHeaders })
      }

      const body = await request.json()

      // Validate session structure (id + messages array)
      if (!isValidSession(body)) {
        return Response.json({ error: 'Invalid session: must have id (string) and messages (array)' }, { status: 400, headers: corsHeaders })
      }

      await env.SESSIONS.put(key, JSON.stringify(body), {
        httpMetadata: { contentType: 'application/json' },
      })

      return Response.json({ success: true }, { headers: corsHeaders })
    }

    // GET /s/api/{id} - Fetch session
    if (method === 'GET' && pathParts.length === 1) {
      const id = pathParts[0]
      const key = `${id}.json`

      const object = await env.SESSIONS.get(key)
      if (!object) {
        return Response.json({ error: 'Session not found' }, { status: 404, headers: corsHeaders })
      }

      const data = await object.text()
      return new Response(data, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=60',
        },
      })
    }

    // DELETE /s/api/{id} - Delete session
    if (method === 'DELETE' && pathParts.length === 1) {
      const id = pathParts[0]
      const key = `${id}.json`

      // Check if exists first
      const object = await env.SESSIONS.head(key)
      if (!object) {
        return Response.json({ error: 'Session not found' }, { status: 404, headers: corsHeaders })
      }

      // Delete from R2
      await env.SESSIONS.delete(key)

      // Purge from edge cache so deletion is immediate
      const cache = caches.default
      const cacheKey = new URL(`/s/api/${id}`, request.url).toString()
      await cache.delete(cacheKey)

      return Response.json({ success: true }, { headers: corsHeaders })
    }

    return Response.json({ error: 'Not found' }, { status: 404, headers: corsHeaders })
  } catch (error) {
    console.error('Session API error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500, headers: corsHeaders })
  }
}
