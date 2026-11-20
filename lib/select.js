/**
 * Model switching endpoint.
 *
 * The client half cannot switch models itself: the browser-side `remote`
 * namespace is not reachable from a plugin context (`ctx.remote` stays
 * undefined even with `inject: ['remote']`), so the switch is performed
 * host-side, where the `sessionController` service lives, and the client only
 * POSTs.
 *
 * The local-only guards are shared with the pins route in `lib/guards.js`.
 */

import { jsonResponse, requireLocal } from './guards.js'

export const SELECT_PATH = '/dsh-model-value/api/select'

/**
 * Pure request handler, so the guards can be tested without a web server.
 *
 * @param {object} options
 * @param {() => { selectModel(request: object): Promise<unknown> } | undefined} options.controller
 * @param {() => string} [options.origin]
 */
export function createSelectHandler({ controller, origin }) {
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
    if (body === null || typeof body !== 'object') {
      return jsonResponse({ ok: false, error: { code: 'local/bad-request', message: 'body must be an object' } }, 400)
    }

    const { sessionId, provider, model, reasoningEffort } = body
    if (typeof sessionId !== 'string' || sessionId === '' || typeof provider !== 'string' || provider === '' || typeof model !== 'string' || model === '') {
      return jsonResponse(
        { ok: false, error: { code: 'local/bad-request', message: 'sessionId, provider and model are required' } },
        400,
      )
    }

    const active = controller()
    if (active === undefined || typeof active.selectModel !== 'function') {
      return jsonResponse(
        { ok: false, error: { code: 'local/unavailable', message: 'the session controller is not mounted' } },
        503,
      )
    }

    const request_ = { sessionId, provider, model }
    if (typeof reasoningEffort === 'string' && reasoningEffort !== '') request_.reasoningEffort = reasoningEffort

    try {
      const selected = await active.selectModel(request_)
      return jsonResponse({ ok: true, value: selected ?? null })
    } catch (error) {
      /** RemoteError carries the same `code` the client would have seen. */
      const code = typeof error?.code === 'string' && error.code !== '' ? error.code : 'session/switch-failed'
      const message = typeof error?.message === 'string' && error.message !== '' ? error.message : String(error)
      return jsonResponse({ ok: false, error: { code, message } })
    }
  }
}

/**
 * @param {import('cordis').Context} ctx
 * @param {() => { selectModel(request: object): Promise<unknown> } | undefined} controller
 */
export function registerSelectRoute(ctx, controller) {
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
    const handle = createSelectHandler({ controller, origin })
    /**
     * A raw `WebRoute`, not a `WebResourceRoute`: a resource route only answers
     * GET and HEAD and turns every POST into a 405 before the handler runs.
     */
    return server.register({
      kind: 'exact',
      path: SELECT_PATH,
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

/**
 * Adapt a Node `IncomingMessage` to the WHATWG `Request` the handler expects,
 * so the guards are written once and stay testable without a server.
 *
 * @param {import('node:http').IncomingMessage} request
 */
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
  return new Request(`http://localhost${request.url ?? SELECT_PATH}`, {
    method,
    headers,
    ...(method === 'GET' || method === 'HEAD' || body.length === 0 ? {} : { body }),
  })
}
