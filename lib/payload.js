/**
 * Builds the ranking payload the client and the agent tool both consume.
 *
 * The Host does the join and the arithmetic so the hand-written client bundle
 * only renders: catalog (live `llm` service) × price table × intelligence table.
 */

import { createKeyIndex, normalizeModelId, resolveByLabel, resolveKey, resolveKeyWithVariant, variantOf } from './keys.js'
import { buildProviderGroups, resolveWeights, scoreRows } from './rank.js'
import { buildMarket, buildMarketCandidates } from './market.js'

const round = (value, digits) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/**
 * Query parameters override the configured defaults, so a user can compare a
 * chat mix with a coding mix without touching Settings.
 * @param {URL} url
 * @param {ReturnType<import('./config.js').normalizeConfig>} config
 */
export function parseQuery(url, config) {
  const params = url.searchParams
  let weightInput = config.weightInput
  let weightOutput = config.weightOutput
  const weights = params.get('weights')
  if (weights !== null && /^\d+(\.\d+)?:\d+(\.\d+)?$/.test(weights.trim())) {
    const [rawIn, rawOut] = weights.split(':')
    weightInput = Number(rawIn)
    weightOutput = Number(rawOut)
  }
  const cache = params.get('cache')
  const cacheHitShare = cache !== null && Number.isFinite(Number(cache)) ? Number(cache) : config.cacheHitShare
  const currencyRaw = (params.get('currency') ?? config.currency).toUpperCase()
  const free = params.get('free')
  const sortRaw = params.get('sort') ?? 'value'
  return {
    weightInput,
    weightOutput,
    cacheHitShare,
    currency: currencyRaw === 'CNY' || currencyRaw === 'RMB' ? 'CNY' : 'USD',
    includeFree: free === null ? config.includeFree : free !== '0' && free !== 'false',
    sort: ['value', 'price', 'iq'].includes(sortRaw) ? sortRaw : 'value',
    includeMarket: params.get('market') !== '0' && params.get('market') !== 'false',
    force: params.get('refresh') === '1',
  }
}

/**
 * @param {ReturnType<typeof parseQuery>} query
 * @param {ReturnType<import('./config.js').normalizeConfig>} config
 */
function currencyOf(query, config) {
  if (query.currency === 'CNY') return { code: 'CNY', symbol: '¥', rate: config.fx }
  return { code: 'USD', symbol: '$', rate: 1 }
}

/**
 * @param {{
 *   catalog: { get: (request?: { force?: boolean }) => Promise<any> },
 *   data: { view: () => any },
 *   config: ReturnType<import('./config.js').normalizeConfig>,
 *   query?: URL | ReturnType<typeof parseQuery>,
 *   selected?: string[],
 * }} input
 */
export async function buildPayload(input) {
  const { catalog, data, config } = input
  /** The user's pinned canonical keys, shared by the panel and the popover. */
  const selected = Array.isArray(input.selected) ? [...new Set(input.selected.filter((key) => typeof key === 'string' && key !== ''))] : []
  const query = input.query instanceof URL ? parseQuery(input.query, config) : input.query ?? parseQuery(new URL('http://x/'), config)
  const live = await catalog.get({ force: query.force === true })
  const view = data.view()
  const currency = currencyOf(query, config)
  const weights = resolveWeights(query.weightInput, query.weightOutput)

  const priceIndex = createKeyIndex(Object.keys(view.prices))
  const scoreIndex = createKeyIndex(Object.keys(view.scores))

  /** A free replica is billed at zero even though only the paid model is priced. */
  const ZERO_PRICE = Object.freeze({ input: 0, output: 0, cacheRead: 0, source: 'free', asOf: '', url: '', note: '' })

  /**
   * Ids are the first choice; providers that hide the id behind an opaque
   * `proxy_<hash>` still expose a readable display name, so fall back to it.
   * A serving-profile variant (`…-fast`, `…-contributor`) may inherit its
   * parent's numbers, which the row then marks as an estimate.
   */
  const hit = (index, model) => {
    const byId = resolveKeyWithVariant(index, model.id)
    if (byId.key !== undefined) return { key: byId.key, matchedBy: 'id', derived: byId.derived }
    const byName = resolveByLabel(index, model.name ?? '')
    if (byName !== undefined) return { key: byName, matchedBy: 'name', derived: false }
    return { key: undefined, matchedBy: '', derived: false }
  }

  /** @type {any[]} */
  const rows = []
  for (const group of live.groups ?? []) {
    for (const model of group.models ?? []) {
      const normalizedId = normalizeModelId(model.id)
      const variant = variantOf(normalizedId)
      const priceHit = hit(priceIndex, model)
      const scoreHit = hit(scoreIndex, model)
      let priceRow = priceHit.key === undefined ? null : view.prices[priceHit.key] ?? null
      /** A free replica is billed at zero even though only the paid model is priced. */
      const sameKey = priceHit.key !== undefined && normalizeModelId(priceHit.key) === normalizedId
      if (variant === 'free' && !sameKey) priceRow = ZERO_PRICE
      const priceDerived = priceRow !== null && priceHit.derived && !(variant === 'free' && !sameKey)
      const scoreFromPrice = priceHit.key !== undefined ? view.scores[priceHit.key] : undefined
      const scoreFromScore = scoreHit.key !== undefined ? view.scores[scoreHit.key] : undefined
      const scoreRow = scoreFromPrice ?? scoreFromScore ?? null
      const scoreDerived = scoreFromPrice !== undefined ? priceHit.derived : scoreFromScore !== undefined ? scoreHit.derived : false
      rows.push({
        provider: group.id,
        providerName: group.name ?? group.id,
        id: model.id,
        name: typeof model.name === 'string' && model.name !== '' ? model.name : model.id,
        key: priceHit.key ?? scoreHit.key ?? normalizedId,
        matchedBy: priceHit.matchedBy || scoreHit.matchedBy,
        variant,
        price: priceRow,
        priceEstimated: priceDerived,
        priceNote: priceRow?.note ?? (priceDerived ? `按 ${priceHit.key} 的价格推算` : ''),
        priceSource: priceRow?.source ?? '',
        priceAsOf: priceRow?.asOf ?? '',
        priceUrl: priceRow?.url ?? '',
        iq: scoreRow?.index ?? null,
        iqEstimated: scoreRow?.estimated === true || scoreDerived,
        iqNote: scoreRow?.note ?? (scoreDerived ? `按 ${scoreHit.key ?? priceHit.key} 的分数推算` : ''),
        iqUrl: scoreRow?.url ?? '',
      })
    }
  }

  const scored = scoreRows(rows, {
    weights,
    cacheHitShare: query.cacheHitShare,
    sort: query.sort,
    includeFree: query.includeFree,
  })

  const convert = (value) => round(value === null || value === undefined ? null : value * currency.rate, 4)

  const outRows = scored.rows.map((row) => ({
    provider: row.provider,
    providerName: row.providerName,
    providerId: row.provider,
    model: row.id,
    name: row.name,
    key: row.key,
    matchedBy: row.matchedBy,
    group: row.group,
    rank: row.rank,
    groupRank: row.groupRank,
    price:
      row.price === null
        ? null
        : {
            input: convert(row.price.input),
            output: convert(row.price.output),
            cacheRead: convert(row.price.cacheRead),
          },
    blended: convert(row.blended),
    iq: row.iq,
    iqEstimated: row.iqEstimated === true,
    iqNote: row.iqNote,
    iqUrl: row.iqUrl,
    priceEstimated: row.priceEstimated === true,
    priceNote: row.priceNote ?? '',
    value: round(row.value === null ? null : row.value / currency.rate, 4),
    valueIndex: round(row.valueIndex, 2),
    priceSource: row.priceSource,
    priceAsOf: row.priceAsOf,
    priceUrl: row.priceUrl,
  }))

  /** How many providers offer the same underlying model, so the UI can say "×3". */
  const keyCounts = new Map()
  for (const row of outRows) keyCounts.set(row.key, (keyCounts.get(row.key) ?? 0) + 1)
  for (const row of outRows) row.keyCount = keyCounts.get(row.key) ?? 1

  /**
   * Every canonical key some mounted provider actually offers.
   *
   * Taken from the raw channel rows, not from `outRows`: `scoreRows` drops free
   * rows when `includeFree` is off, and a model mounted only as a free replica
   * would then reappear below as "not connected".
   */
  const mountedKeys = new Set(rows.map((row) => row.key))

  const scanned = query.includeMarket
    ? buildMarketCandidates({ prices: view.prices, scores: view.scores, mountedKeys })
    : { candidates: [], unscored: 0 }

  const market = query.includeMarket
    ? buildMarket({
        candidates: scanned.candidates,
        unscored: scanned.unscored,
        weights,
        cacheHitShare: query.cacheHitShare,
        sort: query.sort,
      })
    : { rows: [], medianValue: null, counts: { models: 0, ranked: 0, unscored: 0 } }

  const marketRows = market.rows.map((row) => ({
    model: row.model,
    name: row.name,
    key: row.key,
    group: row.group,
    rank: row.rank,
    price:
      row.price === null
        ? null
        : {
            input: convert(row.price.input),
            output: convert(row.price.output),
            cacheRead: convert(row.price.cacheRead),
          },
    blended: convert(row.blended),
    iq: row.iq,
    iqEstimated: row.iqEstimated === true,
    iqNote: row.iqNote,
    iqUrl: row.iqUrl,
    priceEstimated: row.priceEstimated === true,
    priceNote: row.priceNote ?? '',
    value: round(row.value === null ? null : row.value / currency.rate, 4),
    valueIndex: round(row.valueIndex, 2),
    priceSource: row.priceSource,
    priceAsOf: row.priceAsOf,
    priceUrl: row.priceUrl,
  }))

  /**
   * One ranking across everything the panel can draw: the connected channels
   * plus the market models. The merged table needs a single numbering, and the
   * client must not invent one, so `allRank` is scored here with the same
   * `scoreRows` the two separate lists already use. `rank` (connected only)
   * stays untouched: the composer menu and the tool are built on it.
   */
  const union = scoreRows([...rows, ...scanned.candidates], {
    weights,
    cacheHitShare: query.cacheHitShare,
    sort: query.sort,
    includeFree: query.includeFree,
  })
  const unionById = new Map()
  for (const row of union.rows) {
    const id = row.provider === 'market' ? `market\u0000${row.key}` : `${row.provider}\u0000${row.id}`
    unionById.set(id, row)
  }
  const attachUnion = (target, id) => {
    const hit = unionById.get(id)
    target.allRank = hit === undefined ? null : hit.rank
    target.allValueIndex = round(hit === undefined ? null : hit.valueIndex, 2)
  }
  for (const row of outRows) attachUnion(row, `${row.provider}\u0000${row.model}`)
  for (const row of marketRows) attachUnion(row, `market\u0000${row.key}`)

  const warnings = []
  if (view.overrides.error) warnings.push(view.overrides.error)
  /**
   * The seed now carries every model we have a verified price for, including
   * ones OpenRouter does not list, so a refresh can legitimately fail on a
   * dozen keys at once. One line per key would drown the panel; keep the detail
   * in `failures` and collapse the summary.
   */
  const onlineErrors = view.online.errors ?? []
  if (onlineErrors.length === 1) {
    warnings.push(`在线价格 ${onlineErrors[0].key}：${onlineErrors[0].message}`)
  } else if (onlineErrors.length > 1) {
    const sample = onlineErrors.slice(0, 3).map((error) => error.key).join('、')
    warnings.push(`在线价格：${onlineErrors.length} 个模型刷新失败（${sample} 等），继续使用快照价`)
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    /**
     * Two dates, because two datasets age differently: the price snapshot ships
     * with the release, the intelligence index is bundled and cannot be refreshed
     * from the UI at all, and an online refresh adds a third, newer date for the
     * keys OpenRouter still prices. `effective`/`effectiveSource` state which one
     * the numbers on screen came from, so the client renders a fact instead of
     * guessing.
     */
    asOf: {
      prices: view.pricesAsOf,
      scores: view.scoresAsOf,
      online: view.online.at || null,
      onlineDate: view.online.date ?? null,
      onlineModels: view.online.priced ?? 0,
      onlineFailed: view.online.failed ?? 0,
      effective: view.online.date ?? view.pricesAsOf,
      effectiveSource: view.online.date === null || view.online.date === undefined ? 'snapshot' : 'online',
    },
    index: view.index,
    currency,
    weights: { input: weights.input, output: weights.output, rawInput: weights.rawInput, rawOutput: weights.rawOutput, cacheHitShare: query.cacheHitShare },
    sort: query.sort,
    counts: {
      ...scored.counts,
      providers: (live.groups ?? []).length,
      failures: (live.failures ?? []).length,
      market: market.counts,
      /** Connected + market: the size of the merged table, and its own distinct count. */
      all: { models: union.rows.length, ranked: union.counts.ranked, distinct: union.counts.distinct },
    },
    medianValue: convert(scored.medianValue),
    marketMedianValue: convert(market.medianValue),
    medianValueAll: convert(union.medianValue),
    selected,
    providers: buildProviderGroups(outRows),
    rows: outRows,
    market: marketRows,
    failures: live.failures ?? [],
    warnings,
  }
}
