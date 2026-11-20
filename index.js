/**
 * dsh-model-value — price, intelligence and value-for-money ranking for every
 * model connected to this DSH.
 *
 * Three seams:
 *   - Config — weights, currency, cache share, overrides; edited from Settings,
 *     applied live through `liveConfig`.
 *   - One HTTP route (`/dsh-model-value/api/rank`) — the join and the arithmetic
 *     live here, on the Host, so the client bundle only renders.
 *   - One POST route (`/dsh-model-value/api/select`) — switching a session's
 *     model, because a workspace bundle cannot reach the client `remote`
 *     namespace; the Host owns the `sessionController` anyway.
 *   - One POST route (`/dsh-model-value/api/pins`) — the user's checked models,
 *     persisted host-side; the ranking payload echoes them back so the client
 *     can filter the model popover and tick the panel.
 *   - One tool (`model_value_rank`) — the same table for a chat turn.
 *
 * DSH publishes no token prices, so the plugin owns its tables: a dated snapshot
 * in `data/`, optional online refresh from OpenRouter, and user overrides merged
 * last. Models with no trusted price or score are grouped out, never guessed.
 */

import { Config, configHasForm, configImportError, liveConfig } from './lib/config.js'
import { createCatalog } from './lib/catalog.js'
import { createDataStore } from './lib/data.js'
import { buildPayload, parseQuery } from './lib/payload.js'
import { ROUTE_PATH, registerRoute } from './lib/route.js'
import { SELECT_PATH, registerSelectRoute } from './lib/select.js'
import { PINS_PATH, registerPinsRoute } from './lib/pins-route.js'
import { openPins } from './lib/pins.js'
import { TOOL_NAME, registerTool } from './lib/tool.js'

export const name = 'model-value'
export const inject = ['llm']
export { Config }

/**
 * @param {import('cordis').Context} ctx
 * @param {unknown} rawConfig
 */
export function apply(ctx, rawConfig) {
  const config = liveConfig(rawConfig)
  const catalog = createCatalog(ctx)
  const data = createDataStore(ctx, () => config)
  /** One global pin list, read once; writes happen through the pins route. */
  const pins = openPins()

  /** Ranks with an explicit query (agent tool path). */
  const rank = (query) => buildPayload({ catalog, data, config, query, selected: pins.get() })

  /** Ranks from an incoming URL (client path). */
  const handle = async (url) => {
    const query = parseQuery(url, config)
    /** A forced refresh must finish before the payload is built, or `?refresh=1`
     *  answers with the previous snapshot — the opposite of what the button and
     *  the docs promise. Routine (non-forced) refreshes are intentionally not
     *  awaited: `ensureFresh` starts them in the background and returns early. */
    await data.ensureFresh(query.force === true)
    return buildPayload({ catalog, data, config, query, selected: pins.get() })
  }

  /** Captured lazily: the controller mounts after this plugin, or not at all. */
  let controller
  ctx.effect(
    () =>
      ctx.inject(['sessionController'], (scope) => {
        controller = scope.sessionController
        return () => {
          controller = undefined
        }
      }),
    'dsh-model-value: session controller',
  )

  ctx.effect(() => registerRoute(ctx, handle), 'dsh-model-value: ranking route')
  ctx.effect(() => registerSelectRoute(ctx, () => controller), 'dsh-model-value: select route')
  ctx.effect(() => registerPinsRoute(ctx, pins), 'dsh-model-value: pins route')
  ctx.effect(() => registerTool(ctx, rank), 'dsh-model-value: ranking tool')

  try {
    ctx.logger?.info?.(
      `dsh-model-value ready: ${ROUTE_PATH}, ${SELECT_PATH}, ${PINS_PATH}, tool ${TOOL_NAME}` +
        (configHasForm ? '' : `, settings form unavailable (${configImportError || 'no schemastery'})`),
    )
  } catch {
    // logging must never break mount
  }
}

export { configHasForm, configImportError }
