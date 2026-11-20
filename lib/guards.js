/**
 * Shared local-only guards for the plugin's write routes.
 *
 * Plugin routes are NOT behind DSH's `/api/*` auth, so both the model-switch
 * route and the pins route require:
 *  - a custom `x-dsh-model-value` header, which a cross-origin page cannot send
 *    without a CORS preflight this server never answers;
 *  - an `Origin` check whenever the browser sends one.
 * Both together block drive-by writes from another local page.
 */

export const REQUIRED_HEADER = 'x-dsh-model-value'

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
}

/** @param {unknown} body @param {number} status */
export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

/**
 * Returns an error Response when the request fails a guard, or `null` when it
 * is allowed through. Kept as a pure function of the request + origin provider
 * so the routes can be tested without a web server.
 *
 * @param {Request} request
 * @param {() => string} [origin]
 */
export function requireLocal(request, origin) {
  if (request.headers.get(REQUIRED_HEADER) === null) {
    return jsonResponse({ ok: false, error: { code: 'local/forbidden', message: 'missing client header' } }, 403)
  }
  const sentFrom = request.headers.get('origin')
  if (sentFrom !== null && typeof origin === 'function') {
    const expected = origin()
    if (typeof expected === 'string' && expected !== '' && sentFrom !== expected) {
      return jsonResponse({ ok: false, error: { code: 'local/forbidden', message: 'cross-origin request' } }, 403)
    }
  }
  return null
}
