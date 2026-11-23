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
import { createKeyIndex, normalizeModelName, resolveByLabel, resolveKey } from './keys.js'
import { fresherThanSeed, readOnlineCache, writeOnlineCache } from './price-cache.js'

const SEED_PRICES = new URL('../data/prices.json', import.meta.url)
const SEED_SCORES = new URL('../data/intelligence.json', import.meta.url)

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1/models'
const FETCH_TIMEOUT_MS = 8000
const REFRESH_CONCURRENCY = 12

/**
 * The intelligence side of the online refresh.
 *
 * Artificial Analysis publishes the index through the same public-data manifest
 * `tools/sync-sources.mjs` reads, so the Host can re-read it without a rebuild:
 * one manifest request, one file, ~130 intelligence rows. Only models already in
 * the table are updated (a refresh never invents a row), and the effort variants
 * of one model collapse onto its base key, keeping the best score.
 */
const AA_MANIFEST_URL = 'https://aiapiindex.com/public-data/manifest.json'
const AA_SOURCE_ID = 'artificialanalysis'
const AA_SCORE_METRIC = 'artificial_analysis_intelligence_index'

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
/** An upstream `fetchedAt` (ISO datetime) reduced to the date the panel shows. */
const isoDateOf = (value) => {
  const text = typeof value === 'string' ? value.slice(0, 10) : ''
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null
}
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
  /**
   * What a refresh replaced. It starts from the on-disk cache — a refresh the
   * user already waited for must survive a Host restart — and is kept up to date
   * in memory as refreshes land. The bundled snapshot is the floor,
   * `overridesJson` the ceiling. Prices and scores carry their own timestamps
   * because they come from different feeds and one can succeed while the other
   * fails.
   */
  const cached = readOnlineCache()
  let online = {
    at: cached.pricesAt,
    prices: fresherThanSeed(cached.prices, seed.prices),
    scores: fresherThanSeed(cached.scores, seed.scores),
    scoreAt: cached.scoresAt,
    errors: [],
    scoreErrors: [],
  }
  /** @type {Promise<void> | null} */
  let refreshing = null

  /** Persists whichever half changed; failures are logged and ignored. */
  function persist() {
    void writeOnlineCache({ pricesAt: online.at, prices: online.prices, scoresAt: online.scoreAt, scores: online.scores })
  }

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

  /**
   * Intelligence scores from the Artificial Analysis mirror.
   *
   * The mirror is a manifest pointing at one dated file; its rows carry the
   * published model URL, which is the slug the runtime key index already
   * understands. Anything the index does not know is dropped — the same rule the
   * price refresh follows, so an upstream rename cannot add a phantom row.
   */
  async function fetchScores(keys) {
    /** @type {Record<string, any>} */
    const scores = {}
    const timeout = typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(20_000) : undefined
    try {
      const manifest = await (await fetch(AA_MANIFEST_URL, { headers: { accept: 'application/json' }, signal: timeout })).json()
      const sources = Array.isArray(manifest?.sources) ? manifest.sources : []
      const source = sources.find((entry) => entry?.id === AA_SOURCE_ID)
      if (source === undefined || typeof source.file !== 'string') throw new Error('manifest has no artificialanalysis source')
      const url = new URL(source.file, AA_MANIFEST_URL.replace(/manifest\.json$/, '')).href
      const body = await (await fetch(url, { headers: { accept: 'application/json' }, signal: timeout })).json()
      const records = Array.isArray(body?.records) ? body.records : []
      const index = createKeyIndex(keys)
      /** @type {Map<string, { score: number, url: string }>} */
      const best = new Map()
      for (const record of records) {
        if (record?.metric !== AA_SCORE_METRIC) continue
        const score = Number(record.score)
        if (!Number.isFinite(score)) continue
        const slug = String(record.url ?? '').split('/models/')[1] ?? ''
        const key =
          (slug === '' ? undefined : resolveKey(index, slug)) ?? resolveByLabel(index, normalizeModelName(record.model))
        if (key === undefined) continue
        const current = best.get(key)
        if (current === undefined || score > current.score) best.set(key, { score, url: String(record.url ?? '') })
      }
      for (const [key, entry] of best) {
        scores[key] = { index: entry.score, url: entry.url, asOf: isoDateOf(body?.fetchedAt) ?? today() }
      }
      return { scores, at: Date.now() }
    } catch (error) {
      return { scores, at: 0, error: messageOf(error) }
    }
  }

  function runRefresh(keys) {
    if (refreshing !== null) return refreshing
    /* Both feeds in parallel: the price side is ~50 small requests, the score
       side two, and a user waiting on the Refresh button should not pay for them
       one after the other. Each half reports its own outcome. */
    refreshing = Promise.all([fetchOpenRouter(keys), fetchScores(Object.keys(seed.scores))])
      .then(([priced, scored]) => {
        /* Only a run that actually replaced something may move its timestamp: a
           refresh where every key 404'd replaced nothing, and dating the panel
           with today would be a claim about data that never arrived. */
        online =
          Object.keys(priced.prices).length > 0
            ? { ...online, at: Date.now(), prices: priced.prices, errors: priced.errors }
            : { ...online, errors: priced.errors }
        online =
          Object.keys(scored.scores).length > 0
            ? { ...online, scoreAt: scored.at, scores: scored.scores, scoreErrors: scored.error ? [{ key: '*', message: scored.error }] : [] }
            : { ...online, scoreErrors: scored.error ? [{ key: '*', message: scored.error }] : [] }
        if (priced.errors.length > 0) log(`price refresh: ${priced.errors.length} of ${keys.length} keys failed`)
        if (scored.error) log(`score refresh failed: ${scored.error}`)
        /* Survive a restart: what the user just waited ~15 s for is worth a file. */
        if (Object.keys(priced.prices).length > 0 || Object.keys(scored.scores).length > 0) persist()
      })
      .catch((error) => {
        /* Nothing was replaced, so the timestamps of the data still in use must
           not move: the panel would then claim today's date for older numbers. */
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
    const scores = { ...seed.scores, ...online.scores, ...overrides.scores }
    /* The dates of the data actually in use. A timestamp only moves when a
       refresh really replaced something, so a failed run never claims freshness
       it does not have. Prices and scores are dated separately: they come from
       different feeds and either half can fail on its own. */
    const onlineDate = online.at === 0 ? null : new Date(online.at).toISOString().slice(0, 10)
    const scoreDate = online.scoreAt === 0 ? null : new Date(online.scoreAt).toISOString().slice(0, 10)
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
        scoreAt: online.scoreAt,
        scoreDate,
        scored: Object.keys(online.scores).length,
        scoreFailed: online.scoreErrors.length,
        scoreErrors: online.scoreErrors,
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
