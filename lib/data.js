/**
 * Price and intelligence data.
 *
 * DSH itself knows nothing about token prices: the Host `llm` service exposes
 * no pricing field at all (only `imageRequestPricing`, for images). So this
 * plugin owns its tables:
 *
 *   data/prices.json       USD per 1M tokens, one row per canonical model id
 *   data/intelligence.json a dated Artificial Analysis Intelligence Index snapshot
 *   Config.overridesJson   user-supplied corrections, merged last
 *   OpenRouter             optional online refresh for the keys already on file
 *
 * A shipped snapshot keeps the plugin useful with no network and no API key; the
 * online feed only ever updates rows that already exist, so a bad fetch cannot
 * invent a model.
 */

import { readFileSync } from 'node:fs'
import { messageOf } from './catalog.js'

const SEED_PRICES = new URL('../data/prices.json', import.meta.url)
const SEED_SCORES = new URL('../data/intelligence.json', import.meta.url)

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1/models'
const FETCH_TIMEOUT_MS = 8000
const REFRESH_CONCURRENCY = 6

/** @param {URL} url */
function readJson(url) {
  try {
    return JSON.parse(readFileSync(url, 'utf8'))
  } catch {
    return null
  }
}

const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
const round6 = (value) => Math.round(value * 1e6) / 1e6
const today = () => new Date().toISOString().slice(0, 10)
/** Only a real calendar date is a usable `asOf`; empty or free-form strings would
 *  leak into the panel's "数据时间" line and make provenance meaningless. */
const asOfOf = (value) => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined)

/**
 * @param {unknown} models
 * @returns {Record<string, { input: number, output: number, cacheRead?: number, source?: string, url?: string, asOf?: string, note?: string }>}
 */
function sanitizePrices(models) {
  /** @type {any} */
  const out = {}
  if (models === null || typeof models !== 'object' || Array.isArray(models)) return out
  for (const [key, row] of Object.entries(models)) {
    if (row === null || typeof row !== 'object') continue
    const input = finite(/** @type {any} */ (row).input)
    const output = finite(/** @type {any} */ (row).output)
    if (input === undefined || output === undefined) continue
    out[key] = {
      input,
      output,
      ...(finite(/** @type {any} */ (row).cacheRead) === undefined ? {} : { cacheRead: finite(/** @type {any} */ (row).cacheRead) }),
      ...(typeof /** @type {any} */ (row).source === 'string' ? { source: /** @type {any} */ (row).source } : {}),
      ...(typeof /** @type {any} */ (row).url === 'string' ? { url: /** @type {any} */ (row).url } : {}),
      ...(asOfOf(/** @type {any} */ (row).asOf) === undefined ? {} : { asOf: asOfOf(/** @type {any} */ (row).asOf) }),
      ...(typeof /** @type {any} */ (row).note === 'string' ? { note: /** @type {any} */ (row).note } : {}),
    }
  }
  return out
}

/** @param {unknown} scores */
function sanitizeScores(scores) {
  /** @type {any} */
  const out = {}
  if (scores === null || typeof scores !== 'object' || Array.isArray(scores)) return out
  for (const [key, row] of Object.entries(scores)) {
    if (row === null || typeof row !== 'object') continue
    const index = finite(/** @type {any} */ (row).index)
    if (index === undefined) continue
    out[key] = {
      index,
      ...(typeof /** @type {any} */ (row).url === 'string' ? { url: /** @type {any} */ (row).url } : {}),
      ...(asOfOf(/** @type {any} */ (row).asOf) === undefined ? {} : { asOf: asOfOf(/** @type {any} */ (row).asOf) }),
      ...(/** @type {any} */ (row).estimated === true ? { estimated: true } : {}),
      ...(typeof /** @type {any} */ (row).note === 'string' ? { note: /** @type {any} */ (row).note } : {}),
    }
  }
  return out
}

/** The data shipped with the plugin, read once. */
function loadSeed() {
  const prices = readJson(SEED_PRICES)
  const scores = readJson(SEED_SCORES)
  return {
    prices: sanitizePrices(prices?.models),
    pricesAsOf: typeof prices?.asOf === 'string' ? prices.asOf : '',
    scores: sanitizeScores(scores?.scores),
    scoresAsOf: typeof scores?.asOf === 'string' ? scores.asOf : '',
    index: {
      name: typeof scores?.indexName === 'string' ? scores.indexName : 'Artificial Analysis Intelligence Index',
      version: typeof scores?.indexVersion === 'string' ? scores.indexVersion : '',
      url: typeof scores?.sourceUrl === 'string' ? scores.sourceUrl : 'https://artificialanalysis.ai/leaderboards/models',
    },
  }
}

/**
 * Parses the Config `overridesJson` text. Never throws: a broken blob is
 * reported as a warning and ignored, because a typo must not take the ranking
 * down.
 * @param {string} text
 */
export function parseOverrides(text) {
  const trimmed = String(text ?? '').trim()
  if (trimmed === '') return { prices: {}, scores: {}, error: '' }
  try {
    const parsed = JSON.parse(trimmed)
    return {
      prices: sanitizePrices(parsed?.models),
      scores: sanitizeScores(
        Object.fromEntries(
          Object.entries(parsed?.scores ?? {}).map(([key, value]) => [
            key,
            typeof value === 'number' ? { index: value } : value,
          ]),
        ),
      ),
      error: '',
    }
  } catch (error) {
    return { prices: {}, scores: {}, error: `overridesJson 解析失败：${messageOf(error)}` }
  }
}

/**
 * Chooses the most common endpoint price. OpenRouter reports many endpoints per
 * model; the modal rate is the one a user actually pays at most providers.
 * @param {any} payload
 */
export function pickOpenRouterPrice(payload) {
  const endpoints = payload?.data?.endpoints
  if (!Array.isArray(endpoints)) return null
  /** @type {Map<string, { count: number, prompt: number, completion: number, cacheRead?: number }>} */
  const tally = new Map()
  for (const endpoint of endpoints) {
    const pricing = endpoint?.pricing
    if (pricing === null || typeof pricing !== 'object') continue
    const prompt = finite(Number(pricing.prompt))
    const completion = finite(Number(pricing.completion))
    if (prompt === undefined || completion === undefined) continue
    const cacheRead = finite(Number(pricing.input_cache_read))
    const key = `${prompt}|${completion}|${cacheRead ?? ''}`
    const entry = tally.get(key) ?? { count: 0, prompt, completion, ...(cacheRead === undefined ? {} : { cacheRead }) }
    entry.count += 1
    tally.set(key, entry)
  }
  let best
  for (const entry of tally.values()) if (best === undefined || entry.count > best.count) best = entry
  if (best === undefined) return null
  return {
    input: round6(best.prompt * 1e6),
    output: round6(best.completion * 1e6),
    ...(best.cacheRead === undefined ? {} : { cacheRead: round6(best.cacheRead * 1e6) }),
  }
}

/**
 * @param {import('cordis').Context} ctx
 * @param {() => ReturnType<import('./config.js').normalizeConfig>} config
 */
export function createDataStore(ctx, config) {
  const seed = loadSeed()
  /** @type {{ at: number, prices: Record<string, any>, errors: Array<{ key: string, message: string }> }} */
  let online = { at: 0, prices: {}, errors: [] }
  /** @type {Promise<void> | null} */
  let refreshing = null

  const log = (...args) => {
    try {
      ctx.logger?.info?.(...args)
    } catch {
      // logging must never break a request
    }
  }

  /**
   * One request per key, a few at a time: sequential lookups over fifty keys
   * took long enough that an explicit `?refresh=1` could not be awaited.
   */
  async function fetchOpenRouter(keys) {
    /** @type {Record<string, any>} */
    const prices = {}
    /** @type {Array<{ key: string, message: string }>} */
    const errors = []
    const queue = keys.filter((key) => /^[a-z0-9][a-z0-9._+-]*\/[a-z0-9][a-z0-9._:+-]*$/i.test(key))
    let cursor = 0
    const worker = async () => {
      while (cursor < queue.length) {
        const key = queue[cursor]
        cursor += 1
        const url = `${OPENROUTER_BASE}/${key}/endpoints`
        try {
          const response = await fetch(url, {
            headers: { accept: 'application/json' },
            signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(FETCH_TIMEOUT_MS) : undefined,
          })
          if (!response.ok) {
            errors.push({ key, message: `HTTP ${response.status}` })
            continue
          }
          const price = pickOpenRouterPrice(await response.json())
          if (price === null) {
            errors.push({ key, message: 'no endpoint pricing in response' })
            continue
          }
          prices[key] = { ...price, source: 'openrouter', url, asOf: today() }
        } catch (error) {
          errors.push({ key, message: messageOf(error) })
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(REFRESH_CONCURRENCY, queue.length) }, worker))
    return { prices, errors }
  }

  function runRefresh(keys) {
    if (refreshing !== null) return refreshing
    refreshing = fetchOpenRouter(keys)
      .then((result) => {
        /* Only a run that actually priced something may move the timestamp: a
           refresh where every key 404'd replaced nothing, and dating the panel
           with today would be a claim about data that never arrived. */
        online =
          Object.keys(result.prices).length > 0
            ? { at: Date.now(), prices: result.prices, errors: result.errors }
            : { ...online, errors: result.errors }
        if (result.errors.length > 0) log(`price refresh: ${result.errors.length} of ${keys.length} keys failed`)
      })
      .catch((error) => {
        /* Nothing was replaced, so the timestamp of the prices still in use must
           not move: the panel would then claim today's date for yesterday's
           numbers. Only the failure list changes. */
        online = { ...online, errors: [{ key: '*', message: messageOf(error) }] }
      })
      .finally(() => {
        refreshing = null
      })
    return refreshing
  }

  /** Merged view: seed ← online ← overrides. */
  function view() {
    const current = config()
    const overrides = parseOverrides(current.overridesJson)
    const prices = { ...seed.prices, ...online.prices, ...overrides.prices }
    const scores = { ...seed.scores, ...overrides.scores }
    /* The date of the prices that are actually in use. `at` only moves when a
       refresh really replaced them, so a failed refresh never claims freshness
       it does not have. */
    const onlineDate = online.at === 0 ? null : new Date(online.at).toISOString().slice(0, 10)
    return {
      prices,
      scores,
      index: seed.index,
      pricesAsOf: seed.pricesAsOf,
      scoresAsOf: seed.scoresAsOf,
      online: {
        at: online.at,
        date: onlineDate,
        priced: Object.keys(online.prices).length,
        failed: online.errors.length,
        errors: online.errors,
      },
      overrides: { error: overrides.error, models: Object.keys(overrides.prices).length, scores: Object.keys(overrides.scores).length },
    }
  }

  /**
   * Only the keys that OpenRouter is known to price are worth a request. The
   * seed also carries models whose price was verified on another index
   * (`source: 'aiapiindex'`); those have no OpenRouter page at all, so asking
   * for them burned a request and produced a 404 every single refresh.
   * Hand-typed overrides stay in the list because the user asked for them.
   */
  function refreshKeys(current) {
    const overrides = parseOverrides(current.overridesJson).prices
    /** @type {string[]} */
    const keys = []
    for (const [key, price] of Object.entries(seed.prices)) {
      if (price.source !== 'openrouter') continue
      keys.push(key)
    }
    for (const key of Object.keys(overrides)) if (!keys.includes(key)) keys.push(key)
    return keys
  }

  return {
    view,
    seed,
    /**
     * Starts a refresh when one is due. `force` (the panel's refresh button and
     * `?refresh=1`) waits for it, so the answer reflects the new prices; a
     * routine background refresh is never awaited by a request.
     */
    async ensureFresh(force = false) {
      const current = config()
      if (!current.onlineRefresh && !force) return
      const keys = refreshKeys(current)
      if (keys.length === 0) return
      /** Online prices are re-read at most once a day; `refresh=1` forces one. */
      const ttl = 24 * 3_600_000
      if (!force && online.at !== 0 && Date.now() - online.at < ttl) return
      const pending = runRefresh(keys)
      if (force) await pending
    },
    async refreshNow() {
      const current = config()
      const keys = refreshKeys(current)
      if (keys.length === 0) return { updated: 0, errors: [] }
      await runRefresh(keys)
      return { updated: Object.keys(online.prices).length, errors: online.errors }
    },
    status() {
      const current = config()
      return {
        seedModels: Object.keys(seed.prices).length,
        onlineAt: online.at,
        onlineErrors: online.errors,
        /** Why no refresh happened: the user disabled it, or the managed keys
         *  list was empty. Both are otherwise silent, which makes a stale price
         *  look like a bug in the ranking rather than a configuration choice. */
        onlineRefreshEnabled: current.onlineRefresh === true,
        refreshableKeys: refreshKeys(current).length,
      }
    },
  }
}
