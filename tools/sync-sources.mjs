#!/usr/bin/env node
/**
 * Refreshes `data/prices.json` and `data/intelligence.json` from public mirrors.
 *
 * Sources (both served from aiapiindex.com's public-data manifest, which lists
 * upstream URL, license and fetch time for every file):
 *
 *   artificialanalysis  the Artificial Analysis leaderboard as one record per
 *                       (model, metric) — the intelligence index lives here for
 *                       ~130 models and effort variants.
 *   openrouter          all ~727 route slugs with USD/1M token prices.
 *   aiapiindex          its own 105-row price list, which additionally carries a
 *                       `bench` vector (elo, gpqa, hle, swe, …). Artificial
 *                       Analysis has not scored the newest models, so a model
 *                       with an HLE result gets a fitted intelligence estimate.
 *
 * The curated seed entries are kept: a source only fills a gap, or replaces an
 * entry that is strictly older. Scores that a source does not publish for a
 * model are inherited from its parent variant (e.g. `-fast` from the base
 * model) and marked `estimated`, so the panel can show them as "~".
 *
 *   node tools/sync-sources.mjs [--dry]
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PRICES_FILE = path.join(ROOT, 'data', 'prices.json')
const SCORES_FILE = path.join(ROOT, 'data', 'intelligence.json')
const MANIFEST_URL = 'https://aiapiindex.com/public-data/manifest.json'
const PRICES_URL = 'https://aiapiindex.com/prices.json'
const USER_AGENT = 'dsh-model-value sync'
const DRY = process.argv.includes('--dry')

const AA_SOURCE = 'artificialanalysis'
const OR_SOURCE = 'openrouter'
const AII_SOURCE = 'aiapiindex'

/**
 * AA index from the HLE share, fitted on the 65 models both sources publish
 * (R² 0.883, leave-one-out error 5.2 points) by `tools/fit-iq.mjs`.
 */
const IQ_FROM_HLE = { a: 7.6588, b: 0.115, c: 0.0113 }
const estimateIq = (hle) => IQ_FROM_HLE.a + IQ_FROM_HLE.b * hle + IQ_FROM_HLE.c * hle * hle

/** Grader-friendly comparison form: case, spaces, dots and dashes all ignored. */
const squash = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
const tailSquash = (id) => squash(String(id).split('/').pop())
/** `deepseek-v4-1-flash-1017` → `deepseek-v4-1-flash` (keys.js does the same at runtime). */
const undated = (id) => String(id).replace(/-?(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$/, '')

/** AA publishes a display name plus a provider label; the label picks the vendor segment. */
const VENDOR_BY_PROVIDER = {
  anthropic: 'anthropic',
  openai: 'openai',
  google: 'google',
  xai: 'x-ai',
  deepseek: 'deepseek',
  'alibaba qwen': 'qwen',
  alibaba: 'qwen',
  'alibaba cloud': 'qwen',
  'moonshot ai': 'moonshotai',
  moonshot: 'moonshotai',
  moonshotai: 'moonshotai',
  kimi: 'moonshotai',
  'mistral ai': 'mistralai',
  mistral: 'mistralai',
  'zhipu ai (z.ai)': 'z-ai',
  'zhipu ai': 'z-ai',
  zhipu: 'z-ai',
  'z.ai': 'z-ai',
  minimax: 'minimax',
  'minimax ai': 'minimax',
  meta: 'meta',
  cohere: 'cohere',
  upstage: 'upstage',
  tencent: 'tencent',
  nvidia: 'nvidia',
  'thinking machines': 'thinkingmachines',
  inclusionai: 'inclusionai',
  stepfun: 'stepfun',
  xiaomi: 'xiaomi',
  meituan: 'meituan',
  baidu: 'baidu',
  amazon: 'amazon',
  'lg ai research': 'lg',
  naver: 'naver',
  'a.x': 'a-x',
  'a.x inc.': 'a-x',
  reflection: 'reflection',
  'north mini code': 'north',
}

/** A score variant inherits its parent's score; these suffixes mark "same model, other serving profile". */
const DERIVED_SUFFIXES = ['-fast', '-highspeed', '-ultraspeed', '-ultra', '-contributor', '-prime', '-preview', '-exp']

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const isoDate = (stamp) => (typeof stamp === 'string' && stamp.length >= 10 ? stamp.slice(0, 10) : '')

/**
 * Canonical key lookup shared by every importer: an upstream slug or an AA
 * display name resolves to the key already in the seed when their squashed
 * tails agree, so importing never creates a near-duplicate row.
 */
function createCanonicalizer(prices, scores) {
  const known = new Map()
  for (const key of [...Object.keys(prices), ...Object.keys(scores)]) {
    const clean = collapseVendor(key)
    known.set(tailSquash(clean), clean)
    known.set(tailSquash(undated(clean)), clean)
    /** `mistral-large-4-0` is the catalogue spelling of the vendors' `mistral-large-4`. */
    if (/-0$/.test(clean)) known.set(tailSquash(clean.slice(0, -2)), clean)
  }
  return (slug, provider) => {
    const existing = known.get(tailSquash(slug)) ?? known.get(tailSquash(undated(slug)))
    if (existing !== undefined) return existing
    /** OpenRouter ids already carry their vendor (`anthropic/claude-opus-5.5`), so never add it twice. */
    if (String(slug).includes('/')) return collapseVendor(String(slug).toLowerCase())
    const slugged = String(provider ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const vendor = VENDOR_BY_PROVIDER[String(provider ?? '').toLowerCase()] ?? (slugged || 'other')
    return `${vendor}/${slug}`
  }
}

/** `Kimi K2.6` → `kimi-k2.6`; display names keep dots, so the key stays readable. */
const slugify = (name) =>
  String(name ?? '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .trim()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-|-$/g, '')

/**
 * AA publishes one page per reasoning effort (`kimi-k3-low`, `glm-5-3-low`), and
 * the display name carries the effort in brackets. Drop that suffix so the
 * number lands on the model, not on one effort profile.
 */
function baseSlug(slug, model) {
  const marker = /\(([^()]+)\)\s*$/.exec(String(model ?? ''))?.[1]?.toLowerCase()
  if (marker === undefined) return slug
  const suffix = `-${marker.replace(/[^a-z0-9]+/g, '-')}`
  return slug.endsWith(suffix) ? slug.slice(0, -suffix.length) : slug
}

/** OpenRouter reuses one slug for facets that are not separate models. */
const OR_VARIANTS = /:(batch|extended|thinking|online)$/
const isPseudoSlug = (slug) => slug.startsWith('~') || OR_VARIANTS.test(slug)

/** `qwen/qwen/qwen3.7-flash` → `qwen/qwen3.7-flash` (a run of repeated vendor segments). */
function collapseVendor(key) {
  const parts = String(key).split('/')
  while (parts.length > 2 && parts[0].toLowerCase() === parts[1].toLowerCase()) parts.shift()
  return parts.join('/')
}

/** Downloads one manifest-declared file, returns `{ records, fetchedAt, license }`. */
async function fetchSource(manifest, id) {
  const source = manifest.sources.find((entry) => entry.id === id)
  if (source === undefined) throw new Error(`manifest has no source "${id}"`)
  const url = new URL(source.file, MANIFEST_URL.replace(/manifest\.json$/, '')).href
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`${id}: HTTP ${response.status}`)
  const body = JSON.parse(await response.text())
  const records = Array.isArray(body.records) ? body.records : []
  return { records, fetchedAt: isoDate(body.fetchedAt), license: body.license ?? '' }
}

/**
 * AA keeps one record per effort variant (`… (Max)`, `… (Low)`). The headline
 * number is the best effort, so keep the highest score per base slug.
 */
function collectScores(source, canonical) {
  const best = new Map()
  for (const record of source.records) {
    if (record.metric !== 'artificial_analysis_intelligence_index') continue
    if (typeof record.score !== 'number' || !Number.isFinite(record.score)) continue
    const raw = String(record.url ?? '').split('/models/')[1] ?? ''
    if (raw === '' || isPseudoSlug(raw)) continue
    const slug = baseSlug(raw, record.model)
    const key = canonical(slug, record.provider)
    const current = best.get(key)
    if (current === undefined || record.score > current.score) best.set(key, { record, slug, score: record.score })
  }
  return best
}

function collectPrices(source, canonical) {
  const out = new Map()
  for (const record of source.records) {
    const slug = String(record.upstreamId ?? '')
    const pricing = record.pricing ?? {}
    const input = typeof pricing.input === 'number' ? pricing.input : null
    const output = typeof pricing.output === 'number' ? pricing.output : null
    if (slug === '' || input === null || output === null) continue
    if (input <= 0 && output <= 0) continue
    if (isPseudoSlug(slug)) continue
    const key = canonical(slug, record.creator)
    if (out.has(key)) continue
    out.set(key, {
      input: round(input),
      output: round(output),
      cacheRead: typeof pricing.cachedInput === 'number' ? round(pricing.cachedInput) : 0,
      source: OR_SOURCE,
      url: record.url ?? `https://openrouter.ai/${slug}`,
      asOf: '',
      note: 'USD per 1M tokens; OpenRouter route',
    })
  }
  return out
}

const round = (value) => Math.round(value * 1e6) / 1e6

/** Adds scores the sources do not publish by lending the parent variant's number. */
function deriveScores(prices, scores) {
  const derived = []
  for (const key of Object.keys(prices)) {
    if (scores[key] !== undefined) continue
    const normalized = String(key).toLowerCase()
    const suffix = DERIVED_SUFFIXES.find((candidate) => normalized.endsWith(candidate))
    if (suffix === undefined) continue
    const parentKey = key.slice(0, key.length - suffix.length)
    const parent = scores[parentKey]
    if (parent === undefined || parent.estimated === true) continue
    scores[key] = {
      index: parent.index,
      url: parent.url ?? '',
      asOf: parent.asOf ?? '',
      estimated: true,
      note: `未单独发布分数，沿用 ${parentKey} 的分数（${suffix} 变体）`,
    }
    derived.push(key)
  }
  return derived
}

/**
 * The newest models have no Artificial Analysis score yet, but aiapiindex has
 * measured them on HLE, which predicts the index closely (see `IQ_FROM_HLE`).
 * Rows AA already scored are skipped, so an estimate never overrides a number.
 */
async function collectEstimates(canonical) {
  const response = await fetch(PRICES_URL, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error(`${AII_SOURCE}: HTTP ${response.status}`)
  const body = await response.json()
  const rows = Array.isArray(body.llm) ? body.llm : []
  const asOf = isoDate(body.asOf?.llm)
  const out = new Map()
  for (const row of rows) {
    const bench = row.bench ?? {}
    if (typeof bench.aa === 'number') continue
    if (typeof bench.hle !== 'number' || !Number.isFinite(bench.hle)) continue
    const slug = slugify(row.name)
    if (slug === '') continue
    const key = canonical(slug, row.provider)
    if (out.has(key)) continue
    out.set(key, { index: Math.round(estimateIq(bench.hle) * 10) / 10, hle: bench.hle, asOf })
  }
  return { out, asOf, records: rows.length }
}

async function main() {
  const manifestResponse = await fetch(MANIFEST_URL, { signal: AbortSignal.timeout(60_000) })
  if (!manifestResponse.ok) throw new Error(`manifest: HTTP ${manifestResponse.status}`)
  const manifest = await manifestResponse.json()

  const pricesDoc = readJson(PRICES_FILE)
  const scoresDoc = readJson(SCORES_FILE)
  const prices = normalizeKeys(pricesDoc.models ?? {})
  const scores = normalizeKeys(scoresDoc.scores ?? {})
  const canonical = createCanonicalizer(prices, scores)
  const before = { prices: Object.keys(prices).length, scores: Object.keys(scores).length }

  const [aa, or, estimates] = await Promise.all([
    fetchSource(manifest, AA_SOURCE),
    fetchSource(manifest, OR_SOURCE),
    collectEstimates(canonical),
  ])
  console.log(`sources: ${AA_SOURCE} ${aa.records.length} records (fetched ${aa.fetchedAt}), ${OR_SOURCE} ${or.records.length} records (fetched ${or.fetchedAt}), ${AII_SOURCE} ${estimates.records} rows (fetched ${estimates.asOf})`)

  const scoreHits = collectScores(aa, canonical)
  let addedScores = 0
  let refreshedScores = 0
  for (const [key, hit] of scoreHits) {
    const existing = scores[key]
    if (existing !== undefined && existing.estimated !== true && String(existing.asOf ?? '') >= aa.fetchedAt) continue
    scores[key] = {
      index: round(hit.score),
      url: hit.record.url ?? '',
      asOf: aa.fetchedAt,
      note: `Artificial Analysis Intelligence Index v${hit.record.config?.evaluationVersion ?? 5}（AA 页面镜像）`,
    }
    if (existing === undefined) addedScores += 1
    else refreshedScores += 1
  }

  let estimatedScores = 0
  for (const [key, hit] of estimates.out) {
    const existing = scores[key]
    /** A measured score always wins; an earlier estimate is just recomputed. */
    if (existing !== undefined && existing.estimated !== true) continue
    scores[key] = {
      index: hit.index,
      url: 'https://aiapiindex.com/prices.json',
      asOf: hit.asOf,
      estimated: true,
      note: `Artificial Analysis 未收录；按 HLE ${hit.hle}% 折算（拟合误差约 ±5）`,
    }
    estimatedScores += 1
  }

  const priceHits = collectPrices(or, canonical)
  let addedPrices = 0
  let refreshedPrices = 0
  for (const [key, price] of priceHits) {
    const existing = prices[key]
    if (existing !== undefined && String(existing.asOf ?? '') >= or.fetchedAt) continue
    if (existing !== undefined) refreshedPrices += 1
    else addedPrices += 1
    prices[key] = { ...price, asOf: or.fetchedAt }
  }

  const derived = deriveScores(prices, scores)
  const pruned = [...pruneEffortKeys(scores), ...pruneEffortKeys(prices)]

  const mounted = new Set(process.argv.filter((arg) => arg.startsWith('--mounted=')).map((arg) => arg.slice(10)).filter(Boolean))
  const priced = (key) => prices[key] !== undefined
  const scored = (key) => scores[key] !== undefined
  const both = Object.keys(prices).filter((key) => scored(key)).length

  console.log(`prices ${before.prices} → ${Object.keys(prices).length} (+${addedPrices} new, ${refreshedPrices} refreshed)`)
  console.log(`scores ${before.scores} → ${Object.keys(scores).length} (+${addedScores} new, ${refreshedScores} refreshed, ${derived.length} derived, ${estimatedScores} from HLE)`)
  console.log(`rankable (price + score): ${both}`)
  if (pruned.length > 0) console.log(`pruned ${pruned.length} effort-profile keys: ${pruned.slice(0, 4).join(', ')}${pruned.length > 4 ? ' …' : ''}`)
  if (mounted.size > 0) {
    const covered = [...mounted].filter((key) => priced(key) && scored(key)).length
    console.log(`mounted coverage: ${covered}/${mounted.size} have both price and score`)
  }

  if (DRY) {
    console.log('dry run — nothing written')
    return
  }

  pricesDoc.models = sortKeys(prices)
  pricesDoc.asOf = maxAsOf(pricesDoc.asOf, aa.fetchedAt, or.fetchedAt)
  scoresDoc.scores = sortKeys(scores)
  scoresDoc.asOf = maxAsOf(scoresDoc.asOf, aa.fetchedAt)
  scoresDoc.sourceUrl = 'https://artificialanalysis.ai/leaderboards/models'

  fs.writeFileSync(PRICES_FILE, `${JSON.stringify(pricesDoc, null, 2)}\n`)
  fs.writeFileSync(SCORES_FILE, `${JSON.stringify(scoresDoc, null, 2)}\n`)
  console.log(`wrote ${path.relative(ROOT, PRICES_FILE)} and ${path.relative(ROOT, SCORES_FILE)}`)
}

const sortKeys = (object) => Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)))
const maxAsOf = (...dates) => dates.filter((date) => typeof date === 'string' && date !== '').sort().pop() ?? ''

/** Re-keys a table, keeping the freshest entry when two spellings collapse together. */
function normalizeKeys(table) {
  const out = {}
  for (const [key, value] of Object.entries(table)) {
    if (String(key).includes('~') || isPseudoSlug(String(key).split('/').pop())) continue
    const clean = vendorNorm(collapseVendor(key))
    const previous = out[clean]
    if (previous === undefined || String(value?.asOf ?? '') > String(previous?.asOf ?? '')) out[clean] = value
  }
  return out
}

/** `kimi/kimi-k3-low` → `moonshotai/kimi-k3-low`: the vendor segment follows the provider label. */
function vendorNorm(key) {
  const parts = String(key).split('/')
  const vendor = VENDOR_BY_PROVIDER[parts[0].toLowerCase()]
  if (vendor === undefined || parts.length < 2) return key
  return [vendor, ...parts.slice(1)].join('/')
}

/**
 * Drops one-effort-profile entries (`kimi/kimi-k3-low`) once the model itself is
 * scored, so a single model never occupies two rows in the data files.
 */
function pruneEffortKeys(table) {
  const dropped = []
  for (const key of Object.keys(table)) {
    const slash = key.lastIndexOf('/')
    const leaf = key.slice(slash + 1)
    const marker = EFFORT_SUFFIXES.find((suffix) => leaf.endsWith(suffix))
    if (marker === undefined) continue
    if (table[`${key.slice(0, slash + 1)}${leaf.slice(0, -marker.length)}`] !== undefined) {
      delete table[key]
      dropped.push(key)
    }
  }
  return dropped
}

const EFFORT_SUFFIXES = ['-low', '-medium', '-high', '-xhigh', '-non-reasoning', '-default-fallback']

await main()
