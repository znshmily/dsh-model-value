/**
 * The online layer, on disk.
 *
 * A refresh replaces prices and scores in memory, and that used to be the whole
 * story: restart the Host and the panel fell back to the bundled snapshot, so a
 * refresh the user had already paid ~15 seconds for silently evaporated. This
 * file remembers it instead, under `<DSH_HOME>/plugin-data/dsh-model-value/online.json`,
 * next to the pinned-model list.
 *
 * Rules that keep it from lying:
 *
 *   - Per key, an entry only wins over the bundled snapshot when its `asOf` is
 *     newer. A plugin upgrade that ships a fresher snapshot therefore beats an
 *     older cache instead of being overwritten by it.
 *   - A failed write is not an error: a read-only home degrades to the previous
 *     behaviour (memory only), and ranking keeps working.
 *   - A corrupt or foreign file is ignored wholesale — never partially merged.
 */

import { mkdirSync, readFileSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pluginDataFile } from './home.js'

const CACHE_VERSION = 1

function cacheFile() {
  return pluginDataFile('online.json')
}

const asOfOf = (value) => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '')

/** @param {unknown} value */
function entryMap(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const out = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
    const asOf = asOfOf(/** @type {any} */ (entry).asOf)
    if (asOf === '') continue
    out[key] = { ...entry, asOf }
  }
  return out
}

/**
 * Drops cache entries the bundled snapshot already answers with something newer.
 * @param {Record<string, any>} cached
 * @param {Record<string, any>} seed
 */
export function fresherThanSeed(cached, seed) {
  const out = {}
  for (const [key, entry] of Object.entries(cached)) {
    const bundled = seed[key]
    if (bundled !== undefined && String(bundled.asOf ?? '') >= entry.asOf) continue
    out[key] = entry
  }
  return out
}

/** @returns {{ pricesAt: number, prices: Record<string, any>, scoresAt: number, scores: Record<string, any> }} */
export function readOnlineCache() {
  const empty = { pricesAt: 0, prices: {}, scoresAt: 0, scores: {} }
  try {
    const parsed = JSON.parse(readFileSync(cacheFile(), 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return empty
    if (parsed.version !== CACHE_VERSION) return empty
    const pricesAt = Number(parsed.pricesAt)
    const scoresAt = Number(parsed.scoresAt)
    const prices = entryMap(parsed.prices)
    const scores = entryMap(parsed.scores)
    if (Object.keys(prices).length === 0 && Object.keys(scores).length === 0) return empty
    return {
      /* A timestamp is only meaningful next to the entries it dates. */
      pricesAt: Object.keys(prices).length > 0 && Number.isFinite(pricesAt) ? pricesAt : 0,
      prices,
      scoresAt: Object.keys(scores).length > 0 && Number.isFinite(scoresAt) ? scoresAt : 0,
      scores,
    }
  } catch {
    return empty
  }
}

/**
 * Writes through a temporary file and renames: a crash mid-write cannot leave a
 * half-parsed cache behind. Never throws.
 */
export async function writeOnlineCache({ pricesAt, prices, scoresAt, scores }) {
  const target = cacheFile()
  const body = `${JSON.stringify({ version: CACHE_VERSION, pricesAt, prices, scoresAt, scores }, null, 2)}\n`
  try {
    mkdirSync(dirname(target), { recursive: true })
    const temporary = `${target}.${process.pid}.tmp`
    await writeFile(temporary, body, 'utf8')
    await rename(temporary, target)
  } catch {
    // A read-only home must not break ranking or refreshing.
  }
}
