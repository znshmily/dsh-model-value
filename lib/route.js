/**
 * The HTTP endpoint the client bundle reads.
 *
 * A `WebResourceRoute` (WHATWG Request/Response) rather than a raw
 * `WebRoute`, because the framework then handles method negotiation: GET and
 * HEAD are answered here, anything else gets 405 with an `Allow` header before
 * the handler runs. The route is same-origin with the Web GUI, so the client can
 * fetch a relative path with no CORS or token plumbing.
 */

export const ROUTE_PATH = '/dsh-model-value/api/rank'

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
}

/** @param {unknown} body @param {number} status */
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

/**
 * @param {import('cordis').Context} ctx
 * @param {(url: URL) => Promise<unknown>} handler
 */
export function registerRoute(ctx, handler) {
  return ctx.inject(['webServer'], (scope) => {
    const server = scope.webServer
    if (server === undefined || typeof server.register !== 'function') return
    return server.register({
      kind: 'exact',
      path: ROUTE_PATH,
      resource: async (request) => {
        try {
          return jsonResponse(await handler(new URL(request.url)))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          try {
            ctx.logger?.warn?.(`dsh-model-value: ranking failed: ${message}`)
          } catch {
            // logging must never break the response
          }
          return jsonResponse({ ok: false, error: { code: 'internal', message } }, 500)
        }
      },
    })
  })
}
