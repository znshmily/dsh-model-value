/**
 * The market section: models whose price and intelligence are both on file but
 * which this DSH has not connected.
 *
 * The set is *derived*, never listed: a model belongs here exactly as long as
 * none of the mounted providers offers it. Connecting one of these models later
 * moves it into the grouped table on its own, with no code change — which is
 * why there is no third seed file to keep in sync.
 */

import { scoreRows } from './rank.js'

/** Tokens that read as acronyms rather than words. */
const ACRONYMS = new Set(['gpt', 'glm', 'ai', 'vl', 'mcp', 'sdk'])

/**
 * `anthropic/claude-opus-5.5` → `Claude Opus 5.5`.
 *
 * Only used as a label: the slug is always shown in the row's tooltip, so a
 * cosmetic miss never hides which model a row refers to.
 * @param {string} key
 */
export function displayName(key) {
  const slug = String(key ?? '')
  const tail = slug.includes('/') ? slug.slice(slug.lastIndexOf('/') + 1) : slug
  return tail
    .split(/[-_]/)
    .filter((part) => part !== '')
    .map((part) => (ACRONYMS.has(part.toLowerCase()) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ')
}

/**
 * The priced-and-scored models no mounted provider offers.
 *
 * Split out of `buildMarket` because the panel's merged table needs the same
 * scan to build one ranking across connected and unconnected models: scanning
 * the price table twice would let the two lists drift apart.
 *
 * @param {{
 *   prices: Record<string, any>,
 *   scores: Record<string, any>,
 *   mountedKeys: Set<string>,
 * }} input
 */
export function buildMarketCandidates(input) {
  const { prices, scores, mountedKeys } = input
  /** @type {any[]} */
  const candidates = []
  /** Priced but never scored upstream — counted, not drawn: a value rank needs both. */
  let unscored = 0
  for (const [key, price] of Object.entries(prices)) {
    if (mountedKeys.has(key)) continue
    const score = scores[key]
    if (score === undefined) {
      unscored += 1
      continue
    }
    candidates.push({
      provider: 'market',
      providerName: 'Market',
      id: key,
      model: key,
      name: displayName(key),
      key,
      price,
      priceSource: price?.source ?? '',
      priceAsOf: price?.asOf ?? '',
      priceUrl: price?.url ?? '',
      iq: score?.index ?? null,
      iqEstimated: score?.estimated === true,
      iqNote: score?.note ?? '',
      iqUrl: score?.url ?? '',
      variant: 'standard',
    })
  }
  return { candidates, unscored }
}

/**
 * Adds ranks and medians to the market candidates.
 *
 * Pass `candidates` when the caller already scanned the price table (the panel
 * ranks the same set in one merged table); otherwise the table is scanned here.
 *
 * @param {{
 *   prices?: Record<string, any>,
 *   scores?: Record<string, any>,
 *   mountedKeys?: Set<string>,
 *   candidates?: any[],
 *   unscored?: number,
 *   weights: { input: number, output: number },
 *   cacheHitShare: number,
 *   sort: string,
 * }} input
 */
export function buildMarket(input) {
  const { weights, cacheHitShare, sort } = input
  const { candidates, unscored } =
    input.candidates !== undefined
      ? { candidates: input.candidates, unscored: input.unscored ?? 0 }
      : buildMarketCandidates(/** @type {any} */ (input))
  if (candidates.length === 0) return { rows: [], medianValue: null, counts: { models: 0, ranked: 0, unscored } }

  /**
   * Scored on its own median: this table answers "which external model is the
   * best deal", so a bar measured against the connected models would be
   * meaningless whenever the two sets sit at different price levels.
   */
  const scored = scoreRows(candidates, { weights, cacheHitShare, sort, includeFree: false })

  const rows = scored.rows.map((row) => ({
    ...row,
    group: 'market',
    /** Market rows have no channel, so a per-provider rank would be a constant 1. */
    groupRank: row.rank,
  }))

  return {
    rows,
    medianValue: scored.medianValue,
    counts: {
      models: rows.length,
      ranked: rows.length,
      unscored,
    },
  }
}
