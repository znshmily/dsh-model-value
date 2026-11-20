/**
 * Write endpoint for the user's pinned (checked) models.
 *
 * Mirrors `select.js`: a raw `WebRoute` (a resource route would 405 every POST)
 * with the same local-only guards, plus simple body validation. The actual
 * key normalization lives in `lib/pins.js`, which is the single source of
 * truth shared with the rank payload.
 */

import { jsonResponse, requireLocal } from './guards.js'
import { normalizePins } from './pins.js'

export const PINS_PATH = '/dsh-model-value/api/pins'

/**
 * Pure request handler so the guards and validation are testable without a
 * web server.
 *
 * @param {object} options
 * @param {import('./pins.js').PinStore} options.pins
 * @param {() => string} [options.origin]
 */
export function createPinsHandler({ pins, origin }) {
  return async (request) => {
    const forbidden = requireLocal(request, origin)
    if (forbidden !== null) return forbidden

    if (request.method !== 'POST') {
      return jsonResponse({ ok: false, error: { code: 'local/method', message: 'POST only' } }, 405)
    }

    let body
    try {
      body = await request.json()
    } catch {
      return jsonResponse({ ok: false, error: { code: 'local/bad-request', message: 'body must be JSON' } }, 400)
    }
    if (body === null || typeof body !== 'object' || !Array.isArray(body.keys)) {
      return jsonResponse({ ok: false, error: { code: 'local/bad-request', message: 'body.keys must be an array' } }, 400)
    }

    const selected = pins.set(body.keys)
    return jsonResponse({ ok: true, selected })
  }
}

/**
 * @param {import('cordis').Context} ctx
 * @param {import('./pins.js').PinStore} pins
 */
export function registerPinsRoute(ctx, pins) {
  return ctx.inject(['webServer'], (scope) => {
    const server = scope.webServer
    if (server === undefined || typeof server.register !== 'function') return
    const origin = () => {
      try {
        return typeof server.getOrigin === 'function' ? String(server.getOrigin()) : ''
      } catch {
        return ''
      }
    }
    const handle = createPinsHandler({ pins, origin })
    return server.register({
      kind: 'exact',
      path: PINS_PATH,
      handler: async (request, response) => {
        let answer
        try {
          answer = await handle(await toRequest(request))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          answer = jsonResponse({ ok: false, error: { code: 'internal', message } }, 500)
        }
        response.writeHead(answer.status, Object.fromEntries(answer.headers))
        response.end(Buffer.from(await answer.arrayBuffer()))
      },
    })
  })
}

/** Headers Node sets itself; copying them into a `Request` would fight undici. */
const DROPPED_HEADERS = new Set(['host', 'connection', 'content-length', 'transfer-encoding'])

/** @param {import('node:http').IncomingMessage} request */
async function toRequest(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = Buffer.concat(chunks)
  const headers = {}
  for (const [name, value] of Object.entries(request.headers)) {
    if (DROPPED_HEADERS.has(name) || value === undefined) continue
    headers[name] = Array.isArray(value) ? value.join(', ') : value
  }
  const method = request.method ?? 'GET'
  return new Request(`http://localhost${request.url ?? PINS_PATH}`, {
    method,
    headers,
    ...(method === 'GET' || method === 'HEAD' || body.length === 0 ? {} : { body }),
  })
}
