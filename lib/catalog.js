/**
 * Live model catalog, read from the Host `llm` service.
 *
 * `llm.listModels(provider)` is a per-provider call and some adapters fan out to
 * a network request, so results are cached briefly and concurrent callers share
 * one in-flight build. Failures are reported per provider instead of failing the
 * whole ranking: a broken provider must not hide the models that do work.
 */

const DEFAULT_TTL_MS = 60_000
const PROVIDER_TIMEOUT_MS = 15_000

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} label
 */
function withTimeout(promise, ms, label) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    if (typeof timer === 'object' && timer !== null && 'unref' in timer) timer.unref()
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}

/**
 * @param {import('cordis').Context} ctx
 * @param {{ ttlMs?: number }} [options]
 */
export function createCatalog(ctx, options = {}) {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  /** @type {{ at: number, value: any } | null} */
  let cached = null
  /** @type {Promise<any> | null} */
  let inflight = null
  let generation = 0

  function llm() {
    try {
      return typeof ctx.get === 'function' ? ctx.get('llm') : undefined
    } catch {
      return undefined
    }
  }

  async function build() {
    const service = llm()
    /** @type {Array<{ id: string, name: string }>} */
    const failures = []
    if (service === undefined || service === null) {
      return {
        at: Date.now(),
        value: { groups: [], failures: [{ id: 'llm', name: 'llm', message: 'llm service is unavailable' }] },
      }
    }

    let providers = []
    try {
      providers = (await service.listProviders()) ?? []
    } catch (error) {
      return {
        at: Date.now(),
        value: {
          groups: [],
          failures: [{ id: 'llm', name: 'llm', message: messageOf(error) }],
        },
      }
    }

    /** @type {Array<{ id: string, name: string, models: any[] }>} */
    const groups = []
    for (const provider of providers) {
      if (provider === null || typeof provider !== 'object' || typeof provider.id !== 'string') continue
      try {
        const models = await withTimeout(
          Promise.resolve(service.listModels(provider.id)),
          PROVIDER_TIMEOUT_MS,
          `llm.listModels(${provider.id})`,
        )
        groups.push({
          id: provider.id,
          name: typeof provider.name === 'string' && provider.name !== '' ? provider.name : provider.id,
          models: Array.isArray(models) ? models.filter((model) => model !== null && typeof model.id === 'string') : [],
        })
      } catch (error) {
        failures.push({ id: provider.id, name: provider.name ?? provider.id, message: messageOf(error) })
      }
    }

    return { at: Date.now(), value: { groups, failures } }
  }

  return {
    /** @param {{ force?: boolean }} [request] */
    async get(request = {}) {
      if (request.force !== true && cached !== null && Date.now() - cached.at < ttlMs) return cached.value
      if (inflight !== null) return inflight
      const generationAtStart = generation
      inflight = build()
        .then((result) => {
          if (generationAtStart === generation) cached = result
          return result.value
        })
        .finally(() => {
          inflight = null
        })
      return inflight
    },
    invalidate() {
      generation += 1
      cached = null
      inflight = null
    },
  }
}

/** @param {unknown} error */
export function messageOf(error) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}
