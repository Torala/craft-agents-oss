/**
 * Router for agents.craft.do
 *
 * Routes:
 * - /electron/* → R2 bucket (installers, manifests)
 * - /install-app.sh → R2 bucket (macOS/Linux install script)
 * - /install-app.ps1 → R2 bucket (Windows install script)
 * - /* → Proxy to Pages marketing site
 */

interface Env {
  DOWNLOADS: R2Bucket;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // R2 paths: serve from bucket
    if (path.startsWith('/electron/') || path === '/install-app.sh' || path === '/install-app.ps1') {
      const key = path.slice(1);
      const object = await env.DOWNLOADS.get(key);

      if (!object) {
        return new Response('Not Found', { status: 404 });
      }

      const headers = new Headers();
      headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
      headers.set('Cache-Control', object.httpMetadata?.cacheControl || 'no-cache');
      if (object.httpMetadata?.contentDisposition) {
        headers.set('Content-Disposition', object.httpMetadata.contentDisposition);
      }

      return new Response(object.body, { headers });
    }

    // Everything else → Pages marketing site
    return fetch(`https://craft-agents-marketing.pages.dev${path}${url.search}`);
  },
};
