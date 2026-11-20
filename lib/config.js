/**
 * Plugin configuration for dsh-model-value.
 *
 * Two things matter here:
 *
 *   1. Every field is `.volatile()` so the ordinary Settings page renders a
 *      form for it. Harness projects that form from exactly the `meta.volatile`
 *      nodes and hands `apply()` a frozen `{ get() }` reference per field, which
 *      it updates in place and broadcasts as `loader/volatile-update`. A plain
 *      JSON Schema shows no form at all.
 *   2. The plugin must still load when `@deepseek-ai/schemastery` cannot be
 *      resolved. A bare import of that package does not resolve from a plugin
 *      linked in from outside the profile (the Harness packages live inside
 *      `app.asar`, which Node's ESM loader cannot read), so the MIT-licensed
 *      build ships in `vendor/`. When even that fails we fall back to a plain
 *      JSON Schema: every feature still works, only the form is gone.
 *
 * Reads always go through `normalizeConfig()` (which unwraps volatile
 * references) and `liveConfig()` (whose properties re-read the raw config on
 * every access, so a Settings edit is visible on the next request).
 */

/** The vendored Schemastery build. */
const SCHEMASTERY_URL = new URL('../vendor/schemastery.js', import.meta.url)

/**
 * Every configurable field.
 * @type {Array<{ name: string, kind: 'number'|'boolean'|'string', def: unknown,
 *   min?: number, max?: number, step?: number, desc: string }>}
 */
const FIELDS = [
  {
    name: 'weightInput',
    kind: 'number',
    def: 3,
    min: 0,
    max: 100,
    step: 1,
    desc: '输入 token 在加权单价里的权重。编码类会话输入远多于输出，默认 3:1。',
  },
  {
    name: 'weightOutput',
    kind: 'number',
    def: 1,
    min: 0,
    max: 100,
    step: 1,
    desc: '输出 token 在加权单价里的权重。两者都为 0 时按 1:1 处理。',
  },
  {
    name: 'cacheHitShare',
    kind: 'number',
    def: 0.5,
    min: 0,
    max: 1,
    step: 0.05,
    desc: '输入里按缓存命中价计费的比例（0–1）。只有收录了缓存价的模型受影响。',
  },
  {
    name: 'currency',
    kind: 'string',
    def: 'USD',
    desc: '显示货币：USD 或 CNY。价格表本身以美元/百万 token 存储。',
  },
  {
    name: 'fx',
    kind: 'number',
    def: 7.2,
    min: 0.01,
    max: 100,
    step: 0.01,
    desc: 'CNY 汇率（1 美元 = 多少人民币），仅在货币为 CNY 时使用。',
  },
  {
    name: 'includeFree',
    kind: 'boolean',
    def: true,
    desc: '把标价为零的免费模型单独成组显示（否则隐藏）。',
  },
  {
    name: 'onlineRefresh',
    kind: 'boolean',
    def: true,
    desc: '允许向 OpenRouter 拉取在线价格（只对能匹配上的模型生效，失败时静默回退到内置数据）。',
  },
  {
    name: 'overridesJson',
    kind: 'string',
    def: '',
    desc: '手工覆盖：JSON 文本，形如 {"models":{"vendor/model":{"input":0.3,"output":1.2}},"scores":{"vendor/model":48}}。留空则不覆盖。',
  },
]

const DEFAULTS = Object.freeze(Object.fromEntries(FIELDS.map((field) => [field.name, field.def])))

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

/** True for the frozen `{ get() }` object the loader substitutes for a volatile field. */
function isVolatileRef(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.isFrozen(value) &&
    typeof /** @type {{ get?: unknown }} */ (value).get === 'function'
  )
}

/** @param {unknown} value */
function readField(value) {
  return isVolatileRef(value) ? /** @type {{ get(): unknown }} */ (value).get() : value
}

const num = (value, fallback) => {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : fallback
}

const bool = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'boolean') return value
  const text = String(value).trim().toLowerCase()
  if (text === 'true' || text === '1' || text === 'yes' || text === 'on') return true
  if (text === 'false' || text === '0' || text === 'no' || text === 'off') return false
  return fallback
}

const text = (value, fallback = '') => (typeof value === 'string' ? value : fallback)

/**
 * Reads every field (unwrapping volatile references) and applies defaults.
 * @param {unknown} value
 */
export function normalizeConfig(value) {
  const source = value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
  /** @type {Record<string, unknown>} */
  const raw = {}
  for (const field of FIELDS) raw[field.name] = readField(/** @type {any} */ (source)[field.name])

  const currency = text(raw.currency, 'USD').trim().toUpperCase()
  return {
    weightInput: clamp(num(raw.weightInput, DEFAULTS.weightInput), 0, 100),
    weightOutput: clamp(num(raw.weightOutput, DEFAULTS.weightOutput), 0, 100),
    cacheHitShare: clamp(num(raw.cacheHitShare, DEFAULTS.cacheHitShare), 0, 1),
    currency: currency === 'CNY' || currency === 'RMB' ? 'CNY' : 'USD',
    fx: clamp(num(raw.fx, DEFAULTS.fx), 0.01, 100),
    includeFree: bool(raw.includeFree, DEFAULTS.includeFree),
    onlineRefresh: bool(raw.onlineRefresh, DEFAULTS.onlineRefresh),
  
    overridesJson: text(raw.overridesJson, ''),
  }
}

/**
 * Fingerprint of every field's current value. Volatile refs are frozen
 * `{ get() }` wrappers whose inner value the Settings form mutates in place, so
 * calling `readField` is what observes an edit. `liveConfig` compares this
 * signature instead of re-normalizing all eight fields on every property read.
 * @param {unknown} raw
 */
function configSignature(raw) {
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  return JSON.stringify(FIELDS.map((field) => readField(/** @type {any} */ (source)[field.name])))
}

/**
 * A view whose properties resolve on each access, so a field edited in place by
 * the Settings form is picked up by the next ranking request. The normalized
 * object is cached until the signature above changes: within one ranking
 * request the eight getters now share a single normalization, while a Settings
 * edit still invalidates it on the next read.
 * @param {unknown} raw
 */
export function liveConfig(raw) {
  /** @type {Record<string, unknown>} */
  const view = {}
  let normalized = normalizeConfig(raw)
  let signature = configSignature(raw)
  const current = () => {
    const next = configSignature(raw)
    if (next !== signature) {
      signature = next
      normalized = normalizeConfig(raw)
    }
    return normalized
  }
  for (const field of FIELDS) {
    Object.defineProperty(view, field.name, {
      enumerable: true,
      get: () => current()[field.name],
    })
  }
  return /** @type {ReturnType<typeof normalizeConfig>} */ (view)
}

/** @type {any} */
let z
/** Why the vendored Schemastery import failed; empty when it worked. */
export let configImportError = ''

try {
  const mod = await import(SCHEMASTERY_URL.href)
  const candidate = /** @type {any} */ (mod).default ?? mod
  const usable =
    candidate !== null &&
    (typeof candidate === 'object' || typeof candidate === 'function') &&
    typeof candidate.object === 'function'
  if (usable) z = candidate
  else configImportError = 'vendor/schemastery.js → unexpected module shape'
} catch (error) {
  configImportError = `vendor/schemastery.js → ${error instanceof Error ? error.message : String(error)}`
}

/** @param {any} schema @param {string} description */
function describeField(schema, description) {
  try {
    return typeof schema?.description === 'function' ? schema.description(description) : schema
  } catch {
    return schema
  }
}

/** The Schemastery schema: every field volatile, so the Settings form contains it. */
function schemasteryConfig() {
  /** @type {Record<string, unknown>} */
  const fields = {}
  for (const field of FIELDS) {
    /** @type {any} */
    let schema
    if (field.kind === 'boolean') schema = z.boolean()
    else if (field.kind === 'number') {
      schema = z.number()
      if (typeof field.min === 'number') schema = schema.min(field.min)
      if (typeof field.max === 'number') schema = schema.max(field.max)
      if (typeof field.step === 'number' && typeof schema.step === 'function') schema = schema.step(field.step)
    } else schema = z.string()
    schema = describeField(schema, field.desc)
    if (typeof schema.default === 'function') schema = schema.default(field.def)
    if (typeof schema.volatile === 'function') schema = schema.volatile()
    fields[field.name] = schema
  }
  return z.object(fields)
}

/** Plain JSON Schema, used for the fallback and for plugin detail pages. */
const CONFIG_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  default: {},
  additionalProperties: true,
  properties: Object.fromEntries(
    FIELDS.map((field) => [
      field.name,
      {
        type: field.kind,
        default: field.def,
        description: field.desc,
        ...(field.kind === 'number' && typeof field.min === 'number' ? { minimum: field.min } : {}),
        ...(field.kind === 'number' && typeof field.max === 'number' ? { maximum: field.max } : {}),
      },
    ]),
  ),
}

/** Standard-Schema-shaped fallback; also keeps Cordis' entry validation working. */
const FALLBACK_CONFIG = {
  type: 'object',
  default: {},
  additionalProperties: true,
  properties: CONFIG_SCHEMA.properties,
  toJSON() {
    return CONFIG_SCHEMA
  },
  '~standard': {
    version: 1,
    vendor: 'dsh-model-value',
    validate(value) {
      return { value: normalizeConfig(value) }
    },
  },
}

/** @type {any} */
export const Config = z === undefined ? FALLBACK_CONFIG : schemasteryConfig()
/** Whether the Settings page can render a form for this plugin. */
export const configHasForm = z !== undefined
