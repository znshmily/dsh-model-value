/**
 * Model identity matching.
 *
 * The same model shows up under different ids depending on which provider
 * plugin surfaces it:
 *
 *   deepseek/deepseek-v4.1-flash        (Command Code, orca-router)
 *   deepseek-ai/DeepSeek-V4.1-Flash     (SiliconFlow)
 *   deepseek-v4.1-flash                 (bare id)
 *   deepseek/deepseek-v4.1-flash:free   (free variant)
 *
 * Price and intelligence tables are keyed by the canonical `vendor/model` id
 * (lower case). Matching therefore tries, in order: the normalised id, the id
 * with its free/variant suffix removed, then any table key with the same final
 * path segment (preferring one whose vendor agrees with the provider hint).
 */

/** @param {string} id */
export function normalizeModelId(id) {
  return String(id ?? '').trim().toLowerCase().replace(/\s+/g, '')
}

const FREE_SUFFIX = /(?::free|-free|\/free|\(free\))$/

/** A price-bearing variant marker that must not take part in matching. */
const VARIANT_SUFFIX = /(?::free|-free|\/free|\(free\)|-paid)$/

/** `'free'` for a zero-price variant, `'standard'` otherwise. */
export function variantOf(normalizedId) {
  return FREE_SUFFIX.test(normalizedId) ? 'free' : 'standard'
}

/** The id with its free/paid suffix removed, e.g. `deepseek/x:free` → `deepseek/x`. */
export function baseModelId(normalizedId) {
  return normalizedId.replace(VARIANT_SUFFIX, '')
}

/**
 * OpenRouter stamps revisions as `-MMDD` (`qwen3.8-max-0902`, `ling-3.1-flash-1019`)
 * and either side of a pair may carry it, so both are matched undated.
 */
const DATE_SUFFIX = /-(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/

/** `qwen/qwen3.8-max-0902` → `qwen/qwen3.8-max`. */
function undatedModelId(normalizedId) {
  return normalizedId.replace(DATE_SUFFIX, '')
}

/**
 * Turns a display name into something comparable with a table tail, e.g.
 * `Z.ai: GLM 5.3 Flash (CC)` → `glm-5.3-flash`.
 * @param {string} name
 */
export function normalizeModelName(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/^.*[:：]/g, ' ')
    .replace(/[^a-z0-9./+-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Last-resort match for providers that hide the real id behind an opaque one
 * (comate's `proxy_<hash>` rows) — the display name is all we have. Picks the
 * longest table tail the label ends with, so `hy3` cannot win over `hy3-preview`.
 * @param {ReturnType<typeof createKeyIndex>} index
 * @param {string} label
 * @returns {string | undefined}
 */
export function resolveByLabel(index, label) {
  const normalized = baseModelId(normalizeModelName(label))
  if (normalized === '') return undefined
  for (const form of labelForms(normalized)) {
    const byTail = matchTail(index, form)
    if (byTail !== undefined) return byTail
    const bySquash = matchSquash(index, form)
    if (bySquash !== undefined) return bySquash
  }
  return undefined
}

/** Capacity and state markers that ride along in a display label but never in an id. */
const LABEL_MARKERS = Object.freeze([
  '256k', '200k', '180k', '128k', '64k', '32k', '16k', '1m', 'free', 'paid', 'beta', 'alpha', 'preview', 'exp', 'latest',
])

/** `deepseek-v4-flash-256k` → [`deepseek-v4-flash-256k`, `deepseek-v4-flash`]. */
function labelForms(normalized) {
  const forms = [normalized]
  let trimmed = normalized
  for (;;) {
    const at = trimmed.lastIndexOf('-')
    if (at <= 0) break
    if (!LABEL_MARKERS.includes(trimmed.slice(at + 1))) break
    trimmed = trimmed.slice(0, at)
    if (trimmed === '') break
    forms.push(trimmed)
  }
  return forms
}

/** Longest table tail the id ends with, so `hy3` cannot win over `hy3-preview`. */
function matchTail(index, normalized) {
  let best
  let bestLength = 0
  for (const [tail, keys] of index.byTail) {
    if (normalized !== tail && !normalized.endsWith(`-${tail}`)) continue
    if (tail.length <= bestLength) continue
    best = keys[0]
    bestLength = tail.length
  }
  return best
}

/** Same comparison with dots, dashes and spaces removed (`GLM5.2` ≡ `glm-5.2`). */
function matchSquash(index, normalized) {
  const squashed = squashId(normalized)
  let best
  let bestLength = 0
  for (const [form, keys] of index.bySquash) {
    if (squashed !== form && !squashed.endsWith(form)) continue
    if (form.length <= bestLength) continue
    best = keys[0]
    bestLength = form.length
  }
  return best
}

/** The final path segment, e.g. `deepseek-ai/DeepSeek-V4.1-Flash` → `deepseek-v4.1-flash`. */
function tailOf(normalizedId) {
  const at = normalizedId.lastIndexOf('/')
  return at < 0 ? normalizedId : normalizedId.slice(at + 1)
}

/**
 * Separator-free form: `glm-5.2`, `GLM5.2` and `glm52` all become `glm52`.
 * Providers disagree about dots and dashes (`zai-org/GLM-5.2`,
 * `z-ai/glm-5.2`, `MiniMaxAI/MiniMax-M2.5`, comate's Chinese labels), so this
 * is the fallback that survives the vendor's spelling.
 */
function squashId(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/**
 * Builds the lookup structures for one table of canonical keys.
 * @param {Iterable<string>} keys
 */
export function createKeyIndex(keys) {
  /** @type {Map<string, string>} */
  const exact = new Map()
  /** @type {Map<string, string[]>} */
  const byTail = new Map()
  /** @type {Map<string, string[]>} */
  const bySquash = new Map()
  const addSquash = (form, key) => {
    const list = bySquash.get(form)
    if (list === undefined) bySquash.set(form, [key])
    else if (!list.includes(key)) list.push(key)
  }
  for (const key of keys) {
    const normalized = normalizeModelId(key)
    if (normalized === '') continue
    exact.set(normalized, key)
    const undated = undatedModelId(normalized)
    if (undated !== normalized && !exact.has(undated)) exact.set(undated, key)
    const tail = tailOf(normalized)
    const list = byTail.get(tail)
    if (list === undefined) byTail.set(tail, [key])
    else if (!list.includes(key)) list.push(key)
    addSquash(squashId(tail), key)
    const undatedTail = tailOf(undated)
    if (undatedTail !== tail) addSquash(squashId(undatedTail), key)
  }
  return { exact, byTail, bySquash }
}

/**
 * Resolves a provider/model pair to a canonical table key.
 * @param {ReturnType<typeof createKeyIndex>} index
 * @param {string} modelId
 * @returns {string | undefined}
 */
export function resolveKey(index, modelId) {
  const normalized = normalizeModelId(modelId)
  if (normalized === '') return undefined
  const base = baseModelId(normalized)

  /** Full id first, then the suffix-stripped and date-stripped forms. */
  const candidates = []
  for (const candidate of normalized === base ? [normalized] : [normalized, base]) {
    candidates.push(candidate)
    const undated = undatedModelId(candidate)
    if (undated !== candidate) candidates.push(undated)
  }

  for (const candidate of candidates) {
    const hit = index.exact.get(candidate)
    if (hit !== undefined) return hit
  }

  for (const candidate of candidates) {
    const list = index.byTail.get(tailOf(candidate))
    if (list === undefined || list.length === 0) continue
    if (list.length === 1) return list[0]
    const vendor = candidate.includes('/') ? candidate.slice(0, candidate.indexOf('/')) : ''
    const preferred = vendor === '' ? undefined : list.find((key) => key.toLowerCase().startsWith(`${vendor}/`))
    return preferred ?? [...list].sort()[0]
  }

  /** Last resort: the same model spelled with dots where the table has dashes (or vice versa). */
  for (const candidate of candidates) {
    const squashed = squashId(tailOf(candidate))
    /** Upstream writes `mistral-large-4-0` where the catalogue says `mistral-large-4`. */
    const list = index.bySquash.get(squashed) ?? index.bySquash.get(`${squashed}0`)
    if (list === undefined || list.length === 0) continue
    return pickVendor(list, candidate)
  }

  return undefined
}

/** Same vendor first, then the alphabetically first key so the choice is stable. */
function pickVendor(keys, candidate) {
  if (keys.length === 1) return keys[0]
  const vendor = candidate.includes('/') ? candidate.slice(0, candidate.indexOf('/')) : ''
  const preferred = vendor === '' ? undefined : keys.find((key) => key.toLowerCase().startsWith(`${vendor}/`))
  return preferred ?? [...keys].sort()[0]
}

/**
 * Serving-profile suffixes: the same weights sold under another throughput or
 * access tier (`…-fast`, `…-highspeed`, `…-contributor`, `…-ultraspeed`).
 * Upstream rarely publishes a price or a score for these, so the parent's
 * numbers are inherited and the caller must mark the row as an estimate.
 */
const SERVING_SUFFIXES = Object.freeze([
  '-ultraspeed',
  '-highspeed',
  '-ultrafast',
  '-contributor',
  '-preview',
  '-fast',
  '-ultra',
  '-prime',
  '-exp',
  '-latest',
])

/**
 * Like {@link resolveKey}, but a serving-profile variant may fall back to its
 * parent model. `derived: true` means "same weights, inherited numbers".
 * @param {ReturnType<typeof createKeyIndex>} index
 * @param {string} modelId
 * @returns {{ key: string | undefined, derived: boolean }}
 */
export function resolveKeyWithVariant(index, modelId) {
  const direct = resolveKey(index, modelId)
  if (direct !== undefined) return { key: direct, derived: false }
  const normalized = baseModelId(normalizeModelId(modelId))
  for (const suffix of SERVING_SUFFIXES) {
    if (!normalized.endsWith(suffix)) continue
    const parent = normalized.slice(0, normalized.length - suffix.length)
    if (parent === '') continue
    const hit = resolveKey(index, parent)
    if (hit !== undefined) return { key: hit, derived: true }
  }
  return { key: undefined, derived: false }
}
