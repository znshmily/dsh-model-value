/**
 * The agent-facing tool: `model_value_rank`.
 *
 * Same data as the panel, in a shape a model can read back in one screen, so a
 * turn can answer "which model should I use for this?" without the user opening
 * any UI.
 */

const TOOL_NAME = 'model_value_rank'
const DEFAULT_LIMIT = 12
const MAX_LIMIT = 50

/** @param {unknown} value */
const numberOf = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

/**
 * The tool result must survive a JSON round trip unchanged: no `undefined`
 * members (they vanish on stringify) and no `NaN`/`Infinity` (they become null).
 * @param {unknown} value
 * @returns {unknown}
 */
function jsonSafe(value) {
  if (Array.isArray(value)) return value.map(jsonSafe)
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (value === null || typeof value !== 'object') return value === undefined ? null : value
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue
    out[key] = jsonSafe(item)
  }
  return out
}

/**
 * @param {any} payload
 * @param {number} limit
 */
function compact(payload, limit) {
  const rows = (payload.rows ?? []).slice(0, limit).map((row) => ({
    rank: row.rank,
    groupRank: row.groupRank,
    /** Connected + market: the number the panel's merged table shows. */
    allRank: row.allRank,
    group: row.group,
    name: row.name,
    model: row.key,
    provider: row.providerId,
    inputPerM: row.price?.input ?? null,
    outputPerM: row.price?.output ?? null,
    blendedPerM: row.blended,
    intelligence: row.iq,
    intelligenceEstimated: row.iqEstimated,
    valuePerM: row.value,
    valueIndex: row.valueIndex,
    allValueIndex: row.allValueIndex,
  }))
  const market = (payload.market ?? []).slice(0, limit).map((row) => ({
    rank: row.rank,
    allRank: row.allRank,
    name: row.name,
    model: row.key,
    inputPerM: row.price?.input ?? null,
    outputPerM: row.price?.output ?? null,
    blendedPerM: row.blended,
    intelligence: row.iq,
    intelligenceEstimated: row.iqEstimated,
    valuePerM: row.value,
    valueIndex: row.valueIndex,
    allValueIndex: row.allValueIndex,
  }))
  return {
    currency: payload.currency,
    weights: payload.weights,
    sort: payload.sort,
    intelligenceIndex: payload.index,
    asOf: payload.asOf,
    counts: payload.counts,
    medianValue: payload.medianValue,
    medianValueAll: payload.medianValueAll,
    providers: payload.providers ?? [],
    selected: payload.selected ?? [],
    rows,
    market,
    warnings: payload.warnings ?? [],
    failures: payload.failures ?? [],
  }
}

/** Compact number for a markdown cell: 2 decimals, no trailing zeros. */
const fmt = (value, digits = 2) =>
  typeof value === 'number' && Number.isFinite(value) ? String(Number(value.toFixed(digits))) : '—'

/**
 * @param {any} value
 * @param {string} currencySymbol
 */
function renderTable(value, currencySymbol) {
  const lines = []
  const unit = `${currencySymbol}/M`
  lines.push(
    `Model value ranking (${value.currency.code}) — weights input:output = ${value.weights.rawInput}:${value.weights.rawOutput}, ` +
      `cache-hit share ${value.weights.cacheHitShare}`,
  )
  const indexLabel = [value.intelligenceIndex?.name, value.intelligenceIndex?.version].filter(Boolean).join(' ')
  lines.push(`Intelligence: ${indexLabel || 'n/a'}; prices as of ${value.asOf?.prices || 'n/a'}; scores as of ${value.asOf?.scores || 'n/a'}`)
  lines.push('')
  lines.push(`| # | model | provider | in ${unit} | out ${unit} | blended ${unit} | IQ | value (IQ per ${unit}) |`)
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const row of value.rows) {
    const iq = row.intelligence === null ? '—' : `${row.intelligenceEstimated ? '~' : ''}${row.intelligence}`
    const cells = [
      row.rank === null ? '—' : String(row.rank),
      row.name,
      row.provider,
      fmt(row.inputPerM),
      fmt(row.outputPerM),
      fmt(row.blendedPerM),
      iq,
      row.valuePerM === null ? `(${row.group})` : fmt(row.valuePerM, 1),
    ]
    lines.push(`| ${cells.join(' | ')} |`)
  }
  lines.push('')
  lines.push(
    `Ranked ${value.counts.ranked} of ${value.counts.models} models; ${value.counts.free} free, ` +
      `${value.counts.unscored} without an intelligence score, ${value.counts.unpriced} without a price.`,
  )
  lines.push(
    `# ranks the connected models; allRank (in the JSON result) ranks them against the market models as well ` +
      `— that is the number the panel's merged table shows.`,
  )
  const market = Array.isArray(value.market) ? value.market : []
  if (market.length > 0) {
    lines.push('')
    lines.push('### Market — priced and scored, not connected to this DSH')
    lines.push(`| # | model | in ${unit} | out ${unit} | blended ${unit} | IQ | value (IQ per ${unit}) |`)
    lines.push('| --- | --- | --- | --- | --- | --- | --- |')
    for (const row of market) {
      const iq = row.intelligence === null ? '—' : `${row.intelligenceEstimated ? '~' : ''}${row.intelligence}`
      const cells = [
        row.rank === null ? '—' : String(row.rank),
        row.name,
        fmt(row.inputPerM),
        fmt(row.outputPerM),
        fmt(row.blendedPerM),
        iq,
        row.valuePerM === null ? '—' : fmt(row.valuePerM, 1),
      ]
      lines.push(`| ${cells.join(' | ')} |`)
    }
  }
  if (value.warnings.length > 0) lines.push(`Warnings: ${value.warnings.join('; ')}`)
  return lines.join('\n')
}

/**
 * @param {import('cordis').Context} ctx
 * @param {(query: any) => Promise<any>} rank
 */
export function registerTool(ctx, rank) {
  return ctx.inject(['tools'], (scope) => {
    const tools = scope.tools
    if (tools === undefined || typeof tools.register !== 'function') return undefined

    /** @param {any} args */
    async function run(args) {
      const limit = Math.min(MAX_LIMIT, Math.max(1, numberOf(args?.limit) ?? DEFAULT_LIMIT))
      // Go through the same query parser the HTTP route uses, so Settings
      // defaults (weights, cache share, currency) apply to the tool too.
      const params = new URLSearchParams()
      if (['value', 'price', 'iq'].includes(args?.sort)) params.set('sort', args.sort)
      if (String(args?.currency ?? '').toUpperCase() === 'CNY') params.set('currency', 'CNY')
      if (typeof args?.weights === 'string' && args.weights !== '') params.set('weights', args.weights)
      if (args?.includeFree === false) params.set('free', '0')
      if (args?.market === false) params.set('market', '0')
      if (args?.refresh === true) params.set('refresh', '1')
      const payload = await rank(new URL(`http://localhost/?${params.toString()}`))
      return jsonSafe(compact(payload, limit))
    }

    return tools.register({
      name: TOOL_NAME,
      description:
        'Rank every model connected to this DSH by unit price (USD or CNY per 1M tokens, blended input/output), ' +
        'intelligence (Artificial Analysis Intelligence Index, 0-100) and value for money (intelligence per ' +
        'currency unit of blended price). Use it when the user asks which model to pick, which is cheapest, ' +
        'smartest or best value. Prices and scores come from ' +
        'a dated snapshot plus optional OpenRouter refresh; models without trusted data are grouped out rather ' +
        'than guessed.',
      parameters: {
        type: 'object',
        properties: {
          sort: {
            type: 'string',
            enum: ['value', 'price', 'iq'],
            description:
              'value = intelligence-per-price (default), price = cheapest first, iq = smartest first.',
          },
          limit: { type: 'number', description: `Rows to return, 1-${MAX_LIMIT} (default ${DEFAULT_LIMIT}).` },
          currency: { type: 'string', enum: ['USD', 'CNY'], description: 'Display currency (default from Settings).' },
          weights: { type: 'string', description: 'Input:output weight mix, e.g. "3:1" for coding or "1:1" for chat.' },
          includeFree: { type: 'boolean', description: 'Include zero-price models in a separate group (default true).' },
          market: {
            type: 'boolean',
            description:
              'Include a second table of models that are priced and scored but not connected to this DSH (default true).',
          },
          refresh: { type: 'boolean', description: 'Ignore the 60s model-catalog cache and re-read providers.' },
        },
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            currency: { type: 'object', additionalProperties: true },
            weights: { type: 'object', additionalProperties: true },
            rows: { type: 'array', items: { type: 'object', additionalProperties: true } },
            providers: { type: 'array', items: { type: 'object', additionalProperties: true } },
            market: { type: 'array', items: { type: 'object', additionalProperties: true } },
            counts: { type: 'object', additionalProperties: true },
            warnings: { type: 'array', items: { type: 'string' } },
          },
        },
        render(args, value) {
          const symbol = value?.currency?.symbol ?? '$'
          return [{ type: 'text', text: renderTable(value, symbol) }]
        },
      },
      timeoutMs: 30_000,
      isConcurrencySafe() {
        return true
      },
      execute(args) {
        return run(args)
      },
    })
  })
}

export { TOOL_NAME, jsonSafe }
