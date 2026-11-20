/**
 * Ranking arithmetic.
 *
 * Price side:
 *
 *   effectiveInput = input × (1 − cacheHitShare) + cacheRead × cacheHitShare
 *   blended        = effectiveInput × wInput + output × wOutput
 *
 * `cacheRead` is only applied when a table carries it; models without a
 * published cache price are charged the full input price.
 *
 * Value is intelligence per dollar (`iq / blended`). A free model has no finite
 * value, so free, unpriced and un-scored models are grouped out of the ranking
 * instead of being sorted next to finite numbers.
 */

/** @param {number} value @param {number} min @param {number} max */
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

/**
 * Normalises the configured input/output weights into fractions that sum to 1.
 * Both zero falls back to an even split.
 * @param {number} input
 * @param {number} output
 */
export function resolveWeights(input, output) {
  const wi = Number.isFinite(input) ? Math.max(0, input) : 0
  const wo = Number.isFinite(output) ? Math.max(0, output) : 0
  const total = wi + wo
  if (total <= 0) return { input: 0.5, output: 0.5, rawInput: 0, rawOutput: 0 }
  return { input: wi / total, output: wo / total, rawInput: wi, rawOutput: wo }
}

/**
 * @param {{ input?: number, output?: number, cacheRead?: number } | null | undefined} price
 * @param {{ input: number, output: number }} weights
 * @param {number} cacheHitShare
 * @returns {number | null}
 */
export function blendedPrice(price, weights, cacheHitShare) {
  if (price === null || price === undefined) return null
  const input = Number(price.input)
  const output = Number(price.output)
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null
  const cacheRead = Number(price.cacheRead)
  const share = clamp(Number.isFinite(cacheHitShare) ? cacheHitShare : 0, 0, 1)
  const effectiveInput =
    Number.isFinite(cacheRead) && cacheRead >= 0 ? input * (1 - share) + cacheRead * share : input
  return effectiveInput * weights.input + output * weights.output
}

/**
 * Intelligence per dollar. Zero price has infinite value and is never scored.
 * @param {number | null | undefined} iq
 * @param {number | null} blended
 */
export function valueOf(iq, blended) {
  if (iq === null || iq === undefined || !Number.isFinite(iq)) return null
  if (blended === null || !Number.isFinite(blended) || blended <= 0) return null
  return iq / blended
}

/** @param {number[]} values */
function median(values) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

/** Identity used when several rows are the same model on different providers. */
const modelKey = (row) => String(row.key ?? row.id ?? row.name ?? '')

const byName = (a, b) => String(a.name).localeCompare(String(b.name))

/** @param {number | null} value @param {number} digits */
function round(value, digits) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

const GROUP_ORDER = { ranked: 0, free: 1, unscored: 2, unpriced: 3 }

/**
 * Scores and groups rows.
 *
 * @param {Array<{
 *   provider: string, providerName?: string, id: string, name: string, key?: string,
 *   price: { input?: number, output?: number, cacheRead?: number } | null,
 *   priceSource?: string, priceAsOf?: string, priceUrl?: string,
 *   iq: number | null, iqEstimated?: boolean, iqNote?: string, iqUrl?: string,
 *   variant?: 'standard' | 'free',
 * }>} rows
 * @param {{
 *   weights: { input: number, output: number }, cacheHitShare: number,
 *   sort: string, includeFree: boolean,
 * }} options
 */
export function scoreRows(rows, options) {
  const { weights, cacheHitShare, sort, includeFree } = options

  const scored = rows.map((row) => {
    const blended = blendedPrice(row.price, weights, cacheHitShare)
    const iq = row.iq === null || row.iq === undefined ? null : Number(row.iq)
    const value = valueOf(iq, blended)
    /** @type {'ranked' | 'free' | 'unscored' | 'unpriced'} */
    let group
    if (row.price === null || row.price === undefined || blended === null) group = 'unpriced'
    else if (blended <= 0) group = 'free'
    else if (iq === null || !Number.isFinite(iq)) group = 'unscored'
    else group = 'ranked'
    return { ...row, blended, iq: iq !== null && Number.isFinite(iq) ? iq : null, value, group }
  })

  const rankedValues = scored.filter((row) => row.group === 'ranked' && row.value !== null).map((row) => row.value)
  const medianValue = median(/** @type {number[]} */ (rankedValues))

  const comparators = {
    value: (a, b) => (b.value ?? 0) - (a.value ?? 0),
    price: (a, b) => (a.blended ?? Infinity) - (b.blended ?? Infinity),
    iq: (a, b) => (b.iq ?? -Infinity) - (a.iq ?? -Infinity),
  }
  const comparator = comparators[sort] ?? comparators.value

  const out = []
  for (const row of scored) {
    if (row.group === 'free' && !includeFree) continue
    const valueIndex = row.value !== null && medianValue !== null && medianValue > 0 ? row.value / medianValue : null
    out.push({ ...row, valueIndex, rank: null, groupRank: null })
  }

  const ranked = out.filter((row) => row.group === 'ranked').sort(comparator)
  /**
   * One model can arrive through several providers: those rows share a rank
   * instead of filling neighbouring positions, so the list reads as "the 3rd
   * best model", not "the 3rd and 4th best route".
   */
  let rank = 0
  let lastKey
  for (const row of ranked) {
    const key = modelKey(row)
    if (key !== lastKey) {
      rank += 1
      lastKey = key
    }
    row.rank = rank
  }
  /**
   * The panel groups rows by provider, and a group needs its own 1..n counter:
   * "the best model on this channel" is a different question from "the best
   * model overall", and both numbers are useful side by side. Rows that share a
   * canonical key share the group rank too, exactly like the global rank.
   */
  /** @type {Map<string, { rank: number, lastKey: string | undefined }>} */
  const perProvider = new Map()
  for (const row of ranked) {
    const state = perProvider.get(row.provider) ?? { rank: 0, lastKey: undefined }
    const key = modelKey(row)
    if (key !== state.lastKey) {
      state.rank += 1
      state.lastKey = key
    }
    perProvider.set(row.provider, state)
    row.groupRank = state.rank
  }
  const rest = out.filter((row) => row.group !== 'ranked').sort(byName)

  /** Every label the UI spells out says 「个模型」, so this count must be
   *  distinct models, not routes. */
  const distinctKeys = (rows) => new Set(rows.map((row) => modelKey(row))).size

  return {
    rows: [...ranked, ...rest],
    medianValue,
    counts: {
      models: out.length,
      ranked: ranked.length,
      distinct: distinctKeys(ranked),
      free: out.filter((row) => row.group === 'free').length,
      unscored: out.filter((row) => row.group === 'unscored').length,
      unpriced: out.filter((row) => row.group === 'unpriced').length,
    },
  }
}

/**
 * Groups the ranked rows by provider so the panel can render one block per
 * channel. Groups are ordered by their best value, which puts the channel that
 * offers the best deal first — the question a user actually asks ("where should
 * I buy?") rather than an alphabetical accident.
 *
 * @param {Array<{ provider: string, providerName?: string, group: string, value: number | null, iq: number | null, key?: string, id?: string, name?: string }>} rows
 */
export function buildProviderGroups(rows) {
  /** @type {Map<string, { id: string, name: string, models: number, ranked: number, bestValue: number | null, bestIq: number | null, keys: Set<string> }>} */
  const groups = new Map()
  for (const row of rows) {
    if (row.group !== 'ranked') continue
    let entry = groups.get(row.provider)
    if (entry === undefined) {
      entry = {
        id: row.provider,
        name: row.providerName ?? row.provider,
        models: 0,
        ranked: 0,
        bestValue: null,
        bestIq: null,
        keys: new Set(),
      }
      groups.set(row.provider, entry)
    }
    entry.ranked += 1
    entry.keys.add(modelKey(row))
    if (row.value !== null && (entry.bestValue === null || row.value > entry.bestValue)) entry.bestValue = row.value
    if (row.iq !== null && (entry.bestIq === null || row.iq > entry.bestIq)) entry.bestIq = row.iq
  }
  return [...groups.values()]
    .map(({ keys, ...entry }) => ({ ...entry, models: keys.size }))
    .sort((a, b) => {
      const left = a.bestValue ?? -Infinity
      const right = b.bestValue ?? -Infinity
      if (right !== left) return right - left
      return String(a.name).localeCompare(String(b.name))
    })
}

export { round }
