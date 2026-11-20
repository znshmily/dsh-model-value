/**
 * Unit tests for the pure parts: key matching, ranking arithmetic, payload join.
 * Run with `node --test test/` (Node 18+) or `node test/units.mjs`.
 */

import assert from 'node:assert/strict'
import { createKeyIndex, resolveKey, resolveKeyWithVariant, resolveByLabel, variantOf, baseModelId, normalizeModelName } from '../lib/keys.js'
import { blendedPrice, resolveWeights, scoreRows, valueOf, buildProviderGroups } from '../lib/rank.js'
import { buildMarket, displayName } from '../lib/market.js'
import { buildPayload, parseQuery } from '../lib/payload.js'
import { pickOpenRouterPrice, parseOverrides, createDataStore } from '../lib/data.js'
import { liveConfig } from '../lib/config.js'
import { createSelectHandler } from '../lib/select.js'
import { createPinsHandler } from '../lib/pins-route.js'
import { normalizePins, MAX_PINS } from '../lib/pins.js'
import { jsonSafe } from '../lib/tool.js'

const tests = []
const test = (name, fn) => tests.push({ name, fn })

const configOf = (overrides = {}) => ({
  weightInput: 3,
  weightOutput: 1,
  cacheHitShare: 0.5,
  currency: 'USD',
  fx: 7.2,
  includeFree: true,
  onlineRefresh: false,
  overridesJson: '',
  ...overrides,
})

const catalogOf = (groups) => ({ get: async () => ({ groups, failures: [] }) })

const dataOf = (prices, scores, online = { at: 0, errors: [] }) => ({
  view: () => ({
    prices,
    scores,
    index: { name: 'AA', version: 'v5.0.1', url: 'https://example.test' },
    pricesAsOf: '2026-11-16',
    scoresAsOf: '2026-11-16',
    online,
    overrides: { error: '', models: 0, scores: 0 },
  }),
})

test('matches provider-specific ids onto canonical keys', () => {
  const index = createKeyIndex(['deepseek/deepseek-v4.1-flash', 'tencent/hy3'])
  assert.equal(resolveKey(index, 'deepseek-ai/DeepSeek-V4.1-Flash'), 'deepseek/deepseek-v4.1-flash')
  assert.equal(resolveKey(index, 'deepseek/deepseek-v4.1-flash'), 'deepseek/deepseek-v4.1-flash')
  assert.equal(resolveKey(index, 'deepseek-v4.1-flash'), 'deepseek/deepseek-v4.1-flash')
  assert.equal(resolveKey(index, 'deepseek/deepseek-v4.1-flash:free'), 'deepseek/deepseek-v4.1-flash')
  assert.equal(resolveKey(index, 'tencent/hy3-free'), 'tencent/hy3')
  assert.equal(resolveKey(index, 'unknown/model'), undefined)
})

test('date-stamped revisions match either way round', () => {
  const index = createKeyIndex(['qwen/qwen3.8-max-0902', 'inclusionai/ling-3.1-flash', 'z-ai/glm-5'])
  assert.equal(resolveKey(index, 'Qwen/Qwen3.8-Max'), 'qwen/qwen3.8-max-0902')
  assert.equal(resolveKey(index, 'qwen/qwen3.8-max-0902'), 'qwen/qwen3.8-max-0902')
  assert.equal(resolveKey(index, 'inclusionai/ling-3.1-flash-1019'), 'inclusionai/ling-3.1-flash')
  // `glm-5` is a month-less model name: a bare trailing number is not a date.
  assert.equal(resolveKey(index, 'zai-org/GLM-5'), 'z-ai/glm-5')
})

test('an upstream -0 revision suffix still lands on the catalogue key', () => {
  const index = createKeyIndex(['mistralai/mistral-large-4-0', 'z-ai/glm-5.2'])
  assert.equal(resolveKey(index, 'mistral/mistral-large-4'), 'mistralai/mistral-large-4-0')
  assert.equal(resolveKey(index, 'mistralai/mistral-large-4-0'), 'mistralai/mistral-large-4-0')
  // A different model must not be swallowed by the fallback.
  assert.equal(resolveKey(index, 'z-ai/glm-5'), undefined)
})

test('matches ids that disagree about dashes, dots and vendor spelling', () => {
  const index = createKeyIndex(['z-ai/glm-5.2', 'minimax/minimax-m2.5', 'qwen/qwen3.7-flash'])
  assert.equal(resolveKey(index, 'zai-org/GLM-5.2'), 'z-ai/glm-5.2', 'vendor prefix differs')
  assert.equal(resolveKey(index, 'GLM5.2'), 'z-ai/glm-5.2', 'no separators at all')
  assert.equal(resolveKey(index, 'MiniMaxAI/MiniMax-M2.5'), 'minimax/minimax-m2.5')
  assert.equal(resolveKey(index, 'Qwen/Qwen3.7-Flash'), 'qwen/qwen3.7-flash')
})

test('display labels match past capacity markers and translated prefixes', () => {
  const index = createKeyIndex(['deepseek/deepseek-v4-flash', 'z-ai/glm-5.2'])
  assert.equal(resolveByLabel(index, '数科私域-Deepseek-V4-Flash（256K）'), 'deepseek/deepseek-v4-flash')
  assert.equal(resolveByLabel(index, '数科公域-行业智能-GLM5.2'), 'z-ai/glm-5.2')
})

test('a serving-profile variant inherits its parent and says so', () => {
  const index = createKeyIndex(['deepseek/deepseek-v4.1-flash', 'z-ai/glm-5.2'])
  assert.deepEqual(resolveKeyWithVariant(index, 'deepseek/deepseek-v4.1-flash-fast'), {
    key: 'deepseek/deepseek-v4.1-flash',
    derived: true,
  })
  assert.deepEqual(resolveKeyWithVariant(index, 'zai-org/GLM-5.2-Fast'), { key: 'z-ai/glm-5.2', derived: true })
  assert.deepEqual(resolveKeyWithVariant(index, 'deepseek/deepseek-v4.1-flash'), {
    key: 'deepseek/deepseek-v4.1-flash',
    derived: false,
  })
  assert.deepEqual(resolveKeyWithVariant(index, 'nobody/unknown-fast'), { key: undefined, derived: false })
})

test('separates free variants from their base id', () => {
  assert.equal(variantOf('tencent/hy3-free'), 'free')
  assert.equal(variantOf('deepseek/x:free'), 'free')
  assert.equal(variantOf('deepseek/x'), 'standard')
  assert.equal(baseModelId('deepseek/x:free'), 'deepseek/x')
})

test('weights normalise and blend input with cached reads', () => {
  const weights = resolveWeights(3, 1)
  assert.equal(weights.input, 0.75)
  assert.equal(weights.output, 0.25)
  const price = { input: 0.3, output: 1.2, cacheRead: 0.006 }
  const half = blendedPrice(price, weights, 0.5)
  const expected = (0.3 * 0.5 + 0.006 * 0.5) * 0.75 + 1.2 * 0.25
  assert.ok(Math.abs(half - expected) < 1e-9)
  // No cache price published: full input price applies.
  const noCache = blendedPrice({ input: 0.3, output: 1.2 }, weights, 0.5)
  assert.ok(Math.abs(noCache - (0.3 * 0.75 + 1.2 * 0.25)) < 1e-9)
  assert.equal(blendedPrice(null, weights, 0), null)
  assert.equal(valueOf(null, 1), null)
  assert.equal(valueOf(40, 0), null)
})

test('ranks by value, groups free and unpriced out of the ranking', () => {
  const rows = [
    { provider: 'p', id: 'a', name: 'A', price: { input: 10, output: 10 }, iq: 50 },
    { provider: 'p', id: 'b', name: 'B', price: { input: 1, output: 1 }, iq: 40 },
    { provider: 'p', id: 'c', name: 'C', price: { input: 0, output: 0 }, iq: 30 },
    { provider: 'p', id: 'd', name: 'D', price: null, iq: 60 },
    { provider: 'p', id: 'e', name: 'E', price: { input: 2, output: 2 }, iq: null },
  ]
  const result = scoreRows(rows, {
    weights: resolveWeights(1, 1),
    cacheHitShare: 0,
    sort: 'value',
    includeFree: true,
  })
  assert.deepEqual(
    result.rows.map((row) => row.id),
    ['b', 'a', 'c', 'd', 'e'],
  )
  assert.equal(result.rows[0].rank, 1)
  assert.equal(result.rows[1].rank, 2)
  assert.equal(result.rows[2].rank, null)
  assert.equal(result.rows[0].group, 'ranked')
  assert.equal(result.rows[2].group, 'free')
  assert.equal(result.rows[3].group, 'unpriced')
  assert.equal(result.rows[4].group, 'unscored')
  assert.equal(result.counts.ranked, 2)
  // Values are 5 (A) and 40 (B) per unit; median 22.5 makes B ×1.78 and A ×0.22.
  assert.equal(result.medianValue, 22.5)
  assert.ok(Math.abs(result.rows[0].valueIndex - 40 / 22.5) < 1e-9)
  assert.ok(Math.abs(result.rows[1].valueIndex - 5 / 22.5) < 1e-9)
})

test('one model offered by two providers shares a rank', () => {
  const rows = [
    { provider: 'p', id: 'a1', name: 'A', key: 'a', price: { input: 10, output: 10 }, iq: 50 },
    { provider: 'q', id: 'a2', name: 'A', key: 'a', price: { input: 10, output: 10 }, iq: 50 },
    { provider: 'p', id: 'b1', name: 'B', key: 'b', price: { input: 1, output: 1 }, iq: 10 },
  ]
  const result = scoreRows(rows, {
    weights: resolveWeights(1, 1),
    cacheHitShare: 0,
    sort: 'value',
    includeFree: true,
  })
  assert.deepEqual(
    result.rows.map((row) => [row.id, row.rank]),
    [
      ['b1', 1],
      ['a1', 2],
      ['a2', 2],
    ],
  )
  assert.equal(result.counts.ranked, 3)
  assert.equal(result.counts.distinct, 2)
})

test('free models disappear when includeFree is off', () => {
  const rows = [{ provider: 'p', id: 'c', name: 'C', price: { input: 0, output: 0 }, iq: 30 }]
  const result = scoreRows(rows, { weights: resolveWeights(1, 1), cacheHitShare: 0, sort: 'value', includeFree: false })
  assert.equal(result.rows.length, 0)
})

test('group rank counts within one provider, shared by same-key rows', () => {
  const rows = [
    { provider: 'p', id: 'a1', name: 'A', key: 'a', price: { input: 10, output: 10 }, iq: 50 },
    { provider: 'p', id: 'b1', name: 'B', key: 'b', price: { input: 1, output: 1 }, iq: 10 },
    { provider: 'q', id: 'a2', name: 'A', key: 'a', price: { input: 10, output: 10 }, iq: 50 },
    { provider: 'q', id: 'c2', name: 'C', key: 'c', price: { input: 5, output: 5 }, iq: 20 },
    { provider: 'q', id: 'd2', name: 'D', key: 'd', price: null, iq: 20 },
  ]
  const result = scoreRows(rows, { weights: resolveWeights(1, 1), cacheHitShare: 0, sort: 'value', includeFree: true })
  const byId = Object.fromEntries(result.rows.map((row) => [row.id, row]))
  // provider p: b1 (value 10) then a1 (value 5)
  assert.equal(byId.b1.groupRank, 1)
  assert.equal(byId.a1.groupRank, 2)
  // provider q: a2 (value 5) then c2 (value 4)
  assert.equal(byId.a2.groupRank, 1)
  assert.equal(byId.c2.groupRank, 2)
  // unpriced rows are not in the ranking at all
  assert.equal(byId.d2.groupRank, null)
  // global ranks stay provider-agnostic: b1 1, a1 2, c2 3
  assert.deepEqual([byId.b1.rank, byId.a1.rank, byId.c2.rank, byId.a2.rank], [1, 2, 3, 2])
})

test('provider groups order by best value and count distinct models', () => {
  const rows = [
    { provider: 'p', providerName: 'P', group: 'ranked', key: 'a', value: 5, iq: 20 },
    { provider: 'p', providerName: 'P', group: 'ranked', key: 'a', value: 5, iq: 20 },
    { provider: 'p', providerName: 'P', group: 'ranked', key: 'b', value: 9, iq: 30 },
    { provider: 'q', providerName: 'Q', group: 'ranked', key: 'c', value: 1, iq: 10 },
    { provider: 'q', providerName: 'Q', group: 'free', key: 'd', value: null, iq: 10 },
    { provider: 'r', providerName: 'R', group: 'unpriced', key: 'e', value: null, iq: 40 },
  ]
  const groups = buildProviderGroups(rows)
  assert.deepEqual(groups.map((group) => group.id), ['p', 'q'], 'groups without a ranked row are dropped')
  assert.deepEqual(groups[0], { id: 'p', name: 'P', models: 2, ranked: 3, bestValue: 9, bestIq: 30 })
  assert.equal(groups[1].models, 1)
})

test('market holds priced models this DSH does not offer, scored on its own median', () => {
  const prices = {
    'a/one': { input: 1, output: 1, source: 'openrouter', asOf: '2026-11-17' },
    'b/two': { input: 10, output: 10, source: 'openrouter', asOf: '2026-11-17' },
    'c/three': { input: 5, output: 5, source: 'openrouter', asOf: '2026-11-17' },
    'mounted/model': { input: 1, output: 1, source: 'openrouter', asOf: '2026-11-17' },
  }
  const scores = {
    'a/one': { index: 40 },
    'b/two': { index: 40 },
    'c/three': { index: 20 },
    'mounted/model': { index: 50 },
  }
  const market = buildMarket({
    prices,
    scores,
    mountedKeys: new Set(['mounted/model']),
    weights: resolveWeights(1, 1),
    cacheHitShare: 0,
    sort: 'value',
  })
  assert.equal(market.counts.models, 3)
  // b/two and c/three both sit at value 4, so the tie breaks on the display name
  assert.deepEqual(market.rows.map((row) => row.key), ['a/one', 'b/two', 'c/three'])
  assert.ok(market.rows.every((row) => row.group === 'market'), 'all three have a score')
  // market value = iq / blended price; median of 40/1, 20/5, 40/10 = median(40, 4, 4) = 4
  assert.equal(market.medianValue, 4)
  assert.equal(market.rows[0].value, 40)
  assert.equal(market.rows[0].valueIndex, 10)
  assert.equal(market.rows[0].groupRank, market.rows[0].rank, 'market rows reuse the global rank')
})

test('a market row without a score is counted, not listed', () => {
  const market = buildMarket({
    prices: {
      'a/one': { input: 1, output: 1 },
      'b/two': { input: 2, output: 2 },
    },
    scores: { 'a/one': { index: 40 } },
    mountedKeys: new Set(),
    weights: resolveWeights(1, 1),
    cacheHitShare: 0,
    sort: 'value',
  })
  assert.deepEqual(market.rows.map((row) => [row.key, row.group]), [['a/one', 'market']])
  assert.equal(market.counts.ranked, 1)
  assert.equal(market.counts.unscored, 1, 'the price-only model is counted so the UI can say how many are hidden')
})

test('market labels come from the slug tail, with acronyms intact', () => {
  assert.equal(displayName('anthropic/claude-opus-5.5'), 'Claude Opus 5.5')
  assert.equal(displayName('openai/gpt-6.1-sol'), 'GPT 6.1 Sol')
  assert.equal(displayName('z-ai/glm-4.7'), 'GLM 4.7')
  assert.equal(displayName('nvidia/nemotron-3.5-super-vl'), 'Nemotron 3.5 Super VL')
  assert.equal(displayName('bare-model'), 'Bare Model')
})

test('builds a payload from a fake catalog in CNY', async () => {
  const catalog = {
    async get() {
      return {
        groups: [
          {
            id: 'siliconflow',
            name: 'SiliconFlow',
            models: [{ id: 'deepseek-ai/DeepSeek-V4.1-Flash', name: 'DeepSeek V4.1 Flash' }],
          },
        ],
        failures: [],
      }
    },
  }
  const data = {
    view() {
      return {
        prices: {
          'deepseek/deepseek-v4.1-flash': { input: 0.3, output: 1.2, cacheRead: 0.006, source: 'openrouter', asOf: '2026-11-16' },
        },
        scores: { 'deepseek/deepseek-v4.1-flash': { index: 33, estimated: true } },
        index: { name: 'AA', version: 'v5.0.1', url: 'https://example.test' },
        pricesAsOf: '2026-11-16',
        scoresAsOf: '2026-11-16',
        online: { at: 0, errors: [] },
        overrides: { error: '', models: 0, scores: 0 },
      }
    },
  }
  const config = {
    weightInput: 3,
    weightOutput: 1,
    cacheHitShare: 0.5,
    currency: 'CNY',
    fx: 7.2,
    includeFree: true,
    onlineRefresh: false,
    overridesJson: '',
  }
  const payload = await buildPayload({
    catalog, data, config,
    query: new URL('http://x/?weights=3:1'),
    selected: ['deepseek/deepseek-v4.1-flash', 'deepseek/deepseek-v4.1-flash', '', 42],
  })
  assert.equal(payload.ok, true)
  assert.deepEqual(payload.selected, ['deepseek/deepseek-v4.1-flash'], 'selected keys are de-duplicated and sanitized')
  assert.equal(payload.currency.code, 'CNY')
  assert.equal(payload.counts.ranked, 1)
  const row = payload.rows[0]
  assert.equal(row.key, 'deepseek/deepseek-v4.1-flash')
  assert.equal(row.iq, 33)
  assert.equal(row.iqEstimated, true)
  assert.equal(row.price.input, 2.16) // 0.3 USD × 7.2
  // blended in CNY: ((0.3*0.5 + 0.006*0.5)*0.75 + 1.2*0.25) × 7.2
  assert.ok(Math.abs(row.blended - ((0.3 * 0.5 + 0.006 * 0.5) * 0.75 + 1.2 * 0.25) * 7.2) < 1e-4)
})

test('payload carries provider groups and a market block, and ?market=0 drops it', async () => {
  const catalog = catalogOf([
    { id: 'p', name: 'P', models: [{ id: 'a/one', name: 'One' }, { id: 'a/two', name: 'Two' }] },
  ])
  const data = dataOf(
    {
      'a/one': { input: 1, output: 1, source: 'openrouter', asOf: '2026-11-17' },
      'a/two': { input: 5, output: 5, source: 'openrouter', asOf: '2026-11-17' },
      'b/ext': { input: 2, output: 2, source: 'openrouter', asOf: '2026-11-17' },
    },
    { 'a/one': { index: 40 }, 'a/two': { index: 20 }, 'b/ext': { index: 30 } },
  )
  const withMarket = await buildPayload({ catalog, data, config: configOf(), query: new URL('http://x/') })
  assert.equal(withMarket.providers.length, 1)
  assert.equal(withMarket.providers[0].models, 2)
  assert.deepEqual(withMarket.providers[0].id, 'p')
  assert.deepEqual(withMarket.rows.map((row) => row.groupRank), [1, 2], 'group ranks are on the rows too')
  assert.deepEqual(withMarket.market.map((row) => row.key), ['b/ext'], 'only the unconnected model is in the market')
  assert.equal(withMarket.market[0].group, 'market')
  assert.equal(withMarket.counts.market.models, 1)
  assert.ok(withMarket.marketMedianValue > 0)

  const withoutMarket = await buildPayload({ catalog, data, config: configOf(), query: new URL('http://x/?market=0') })
  assert.deepEqual(withoutMarket.market, [])
  assert.deepEqual(withoutMarket.counts.market, { models: 0, ranked: 0, unscored: 0 })
  assert.equal(withoutMarket.marketMedianValue, null)
  assert.equal(withoutMarket.providers.length, 1, 'grouping is not affected by the market switch')
})

test('the merged table numbers connected and market models on one scale', async () => {
  const catalog = catalogOf([{ id: 'p', name: 'P', models: [{ id: 'a/one', name: 'One' }] }])
  const data = dataOf(
    {
      'a/one': { input: 10, output: 30, source: 'openrouter', asOf: '2026-11-17' },
      'b/ext': { input: 1, output: 1, source: 'openrouter', asOf: '2026-11-17' },
    },
    { 'a/one': { index: 40 }, 'b/ext': { index: 30 } },
  )
  const payload = await buildPayload({ catalog, data, config: configOf(), query: new URL('http://x/') })
  const channel = payload.rows[0]
  const market = payload.market[0]
  /* the two existing numberings must not move: the menu and the tool use them */
  assert.equal(channel.rank, 1, 'the connected rank still counts connected models only')
  assert.equal(market.rank, 1, 'the market rank still counts market models only')
  /* a/one blended 15 → value 2.67; b/ext blended 1 → value 30 */
  assert.equal(market.allRank, 1, 'the cheaper market model tops the merged table')
  assert.equal(channel.allRank, 2, 'the connected model keeps its own place in the merged table')
  assert.equal(payload.counts.all.ranked, 2)
  assert.equal(payload.counts.all.models, 2)
  assert.ok(payload.medianValueAll > 0)
  assert.ok(
    Math.abs(market.allValueIndex - Math.round((market.value / payload.medianValueAll) * 100) / 100) < 1e-6,
    'the merged bar is normalised on the merged median',
  )
})

test('?market=0 leaves the merged rank equal to the connected rank', async () => {
  const catalog = catalogOf([{ id: 'p', name: 'P', models: [{ id: 'a/one', name: 'One' }, { id: 'a/two', name: 'Two' }] }])
  const data = dataOf(
    {
      'a/one': { input: 1, output: 1, source: 'openrouter', asOf: '2026-11-17' },
      'a/two': { input: 5, output: 5, source: 'openrouter', asOf: '2026-11-17' },
      'b/ext': { input: 0.1, output: 0.1, source: 'openrouter', asOf: '2026-11-17' },
    },
    { 'a/one': { index: 40 }, 'a/two': { index: 20 }, 'b/ext': { index: 60 } },
  )
  const payload = await buildPayload({ catalog, data, config: configOf(), query: new URL('http://x/?market=0') })
  assert.deepEqual(payload.rows.map((row) => [row.rank, row.allRank]), [[1, 1], [2, 2]])
  assert.equal(payload.counts.all.ranked, 2, 'without the market there is nothing extra to rank')
})

test('a model mounted only as a free replica is not advertised as unconnected', async () => {
  const catalog = catalogOf([
    { id: 'p', name: 'P', models: [{ id: 'z-ai/glm-5.3-flash:free', name: 'GLM 5.3 Flash (free)' }] },
  ])
  const data = dataOf(
    { 'z-ai/glm-5.3-flash': { input: 0.2, output: 0.8, source: 'openrouter', asOf: '2026-11-17' } },
    { 'z-ai/glm-5.3-flash': { index: 28 } },
  )
  const payload = await buildPayload({ catalog, data, config: configOf(), query: new URL('http://x/') })
  assert.equal(payload.rows[0].group, 'free', 'the free replica is the row that gets hidden')
  assert.deepEqual(payload.market.map((row) => row.key), [], 'the paid key is mounted, so the market must not claim it')
  assert.equal(payload.counts.market.models, 0)
})

test('picks the modal OpenRouter endpoint price', () => {
  const price = pickOpenRouterPrice({
    data: {
      endpoints: [
        { pricing: { prompt: '0.0000003', completion: '0.0000012', input_cache_read: '0.000000006' } },
        { pricing: { prompt: '0.0000003', completion: '0.0000012', input_cache_read: '0.000000006' } },
        { pricing: { prompt: '0.00000005', completion: '0.0000005' } },
      ],
    },
  })
  assert.deepEqual(price, { input: 0.3, output: 1.2, cacheRead: 0.006 })
})

test('overrides parse leniently', () => {
  assert.equal(parseOverrides('').error, '')
  const parsed = parseOverrides('{"models":{"a/b":{"input":1,"output":2}},"scores":{"a/b":42}}')
  assert.equal(parsed.prices['a/b'].input, 1)
  assert.equal(parsed.scores['a/b'].index, 42)
  assert.notEqual(parseOverrides('{oops').error, '')
})

test('a dozen failed online lookups collapse into one warning line', async () => {
  const catalog = catalogOf([{ id: 'p', name: 'P', models: [{ id: 'a/one', name: 'One' }] }])
  const errors = ['amazon/nova-micro', 'baidu/ernie-5.0', 'cohere/command-r7b', 'google/gemini-2.0-flash'].map((key) => ({
    key,
    message: 'HTTP 404',
  }))
  const payload = await buildPayload({
    catalog,
    data: dataOf(
      { 'a/one': { input: 1, output: 1, source: 'openrouter' } },
      { 'a/one': { index: 40 } },
      { at: Date.now(), errors },
    ),
    config: configOf(),
  })
  assert.equal(payload.warnings.length, 1, 'one line, not one per key')
  assert.match(payload.warnings[0], /4 个模型刷新失败/)
  assert.match(payload.warnings[0], /amazon\/nova-micro/)

  const single = await buildPayload({
    catalog,
    data: dataOf(
      { 'a/one': { input: 1, output: 1, source: 'openrouter' } },
      { 'a/one': { index: 40 } },
      { at: Date.now(), errors: [{ key: 'a/one', message: 'HTTP 500' }] },
    ),
    config: configOf(),
  })
  assert.deepEqual(single.warnings, ['在线价格 a/one：HTTP 500'], 'a single failure keeps its detail')
})

test('refresh only asks OpenRouter for keys it actually prices', async () => {
  const store = createDataStore({ logger: { info() {}, warn() {} } }, () => configOf({ onlineRefresh: true }))
  const requested = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    requested.push(String(url))
    return { ok: false, status: 404, json: async () => ({}) }
  }
  try {
    await store.ensureFresh(true)
  } finally {
    globalThis.fetch = realFetch
  }
  assert.ok(requested.length > 20, 'the online-priced keys are still refreshed')
  // Prices that came from aiapiindex have no OpenRouter page; asking 404s every time.
  assert.equal(
    requested.some((url) => url.includes('/baidu/ernie-5.0/')),
    false,
    'a key sourced from another index is not requested',
  )
  assert.equal(
    requested.some((url) => url.includes('/anthropic/claude-haiku-5.5/')),
    true,
    'an OpenRouter-sourced key is requested',
  )
  const errors = store.status().onlineErrors
  assert.equal(errors.length, requested.length, 'every failed request is still reported')
  assert.ok(store.status().onlineAt > 0, 'a forced refresh records its timestamp')
})

test('free replicas are billed at zero and keep their intelligence score', async () => {
  const payload = await buildPayload({
    catalog: catalogOf([
      { id: 'orcarouter', name: 'OrcaRouter', models: [{ id: 'z-ai/glm-5.3-flash-free', name: 'GLM 5.3 Flash (Free)' }] },
    ]),
    data: dataOf(
      { 'z-ai/glm-5.3-flash': { input: 0.15, output: 0.5, cacheRead: 0.03, source: 'openrouter' } },
      { 'z-ai/glm-5.3-flash': { index: 28 } },
    ),
    config: configOf(),
  })
  const row = payload.rows[0]
  assert.equal(row.group, 'free')
  assert.equal(row.price.input, 0)
  assert.equal(row.blended, 0)
  assert.equal(row.iq, 28)
  assert.equal(row.priceSource, 'free')
  assert.equal(payload.counts.free, 1)
  assert.equal(payload.counts.ranked, 0)
})

test('an unknown free model is still free', async () => {
  const payload = await buildPayload({
    catalog: catalogOf([
      { id: 'commandcode', name: 'Command Code', models: [{ id: 'stealth/glyph-cluster:free', name: 'Glyph Cluster (free)' }] },
    ]),
    data: dataOf({}, {}),
    config: configOf(),
  })
  const row = payload.rows[0]
  assert.equal(row.group, 'free')
  assert.equal(row.price.input, 0)
  assert.equal(row.priceSource, 'free')
  assert.equal(payload.counts.unpriced, 0)
})

test('opaque proxy ids fall back to the display name', async () => {
  const payload = await buildPayload({
    catalog: catalogOf([
      { id: 'comate', name: 'Comate', models: [{ id: 'proxy_95ebc5db0e9347cd87538fa504624802', name: 'GLM-5.3 Flash' }] },
    ]),
    data: dataOf(
      { 'z-ai/glm-5.3-flash': { input: 0.15, output: 0.5, cacheRead: 0.03, source: 'openrouter' } },
      { 'z-ai/glm-5.3-flash': { index: 28 } },
    ),
    config: configOf(),
  })
  const row = payload.rows[0]
  assert.equal(row.key, 'z-ai/glm-5.3-flash')
  assert.equal(row.matchedBy, 'name')
  assert.equal(row.rank, 1)
  assert.equal(row.iq, 28)
})

test('a serving-tier variant inherits both numbers and flags them as estimates', async () => {
  const payload = await buildPayload({
    catalog: catalogOf([
      {
        id: 'commandcode',
        name: 'Command Code',
        models: [{ id: 'deepseek/deepseek-v4.1-flash-fast', name: 'DeepSeek V4.1 Flash Fast' }],
      },
    ]),
    data: dataOf(
      { 'deepseek/deepseek-v4.1-flash': { input: 0.3, output: 1.2, cacheRead: 0.006, source: 'openrouter' } },
      { 'deepseek/deepseek-v4.1-flash': { index: 32.6 } },
    ),
    config: configOf(),
  })
  const row = payload.rows[0]
  assert.equal(row.key, 'deepseek/deepseek-v4.1-flash')
  assert.equal(row.iq, 32.6)
  assert.equal(row.iqEstimated, true, 'the score came from the parent model')
  assert.equal(row.priceEstimated, true, 'the price came from the parent model')
  assert.match(row.iqNote, /推算/)
  assert.equal(row.rank, 1, 'with both numbers the row still ranks')
})

test('a longer name tail wins over a shorter one, and paid suffixes are ignored', async () => {
  const index = createKeyIndex(['tencent/hy3', 'tencent/hy3-preview'])
  assert.equal(resolveByLabel(index, 'Tencent Hy3 Preview'), 'tencent/hy3-preview')
  assert.equal(resolveByLabel(index, 'Tencent Hy3'), 'tencent/hy3')
  assert.equal(resolveByLabel(index, 'Something Else'), undefined)
  assert.equal(baseModelId('tencent/hy3-paid'), 'tencent/hy3')
  assert.equal(variantOf('tencent/hy3-paid'), 'standard')
  assert.equal(normalizeModelName('Z.ai: GLM 5.3 Flash (CC)'), 'glm-5.3-flash')
})

test('tool output survives a JSON round trip', () => {
  const value = jsonSafe({
    a: 1,
    gone: undefined,
    bad: Number.POSITIVE_INFINITY,
    rows: [{ rank: null, nested: { skip: undefined, keep: 'x' } }, { n: Number.NaN }],
  })
  assert.deepEqual(JSON.parse(JSON.stringify(value)), value)
  assert.equal('gone' in value, false)
  assert.equal(value.bad, null)
  assert.equal(value.rows[1].n, null)
})

const selectRequest = (body, headers = {}, method = 'POST') =>
  new Request('http://127.0.0.1:65529/dsh-model-value/api/select', {
    method,
    headers: { 'content-type': 'application/json', 'x-dsh-model-value': '1', ...headers },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  })

const selectingController = (calls) => ({
  async selectModel(request) {
    calls.push(request)
    return { selected: request }
  },
})

test('select route switches a model and echoes the selection', async () => {
  const calls = []
  const handle = createSelectHandler({ controller: () => selectingController(calls), origin: () => 'http://127.0.0.1:65529' })
  const response = await handle(
    selectRequest({ sessionId: 's1', provider: 'orcarouter', model: 'z-ai/glm-5.3-flash', reasoningEffort: 'high' }),
  )
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.ok, true)
  assert.deepEqual(calls, [{ sessionId: 's1', provider: 'orcarouter', model: 'z-ai/glm-5.3-flash', reasoningEffort: 'high' }])
})

test('select route omits an absent reasoning effort', async () => {
  const calls = []
  const handle = createSelectHandler({ controller: () => selectingController(calls), origin: () => '' })
  await handle(selectRequest({ sessionId: 's1', provider: 'p', model: 'm' }))
  assert.deepEqual(calls, [{ sessionId: 's1', provider: 'p', model: 'm' }])
})

test('select route refuses a request without the client header', async () => {
  const handle = createSelectHandler({ controller: () => selectingController([]), origin: () => '' })
  const request = new Request('http://127.0.0.1:65529/dsh-model-value/api/select', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 's1', provider: 'p', model: 'm' }),
  })
  const response = await handle(request)
  assert.equal(response.status, 403)
  assert.equal((await response.json()).error.code, 'local/forbidden')
})

test('select route refuses another origin', async () => {
  const handle = createSelectHandler({ controller: () => selectingController([]), origin: () => 'http://127.0.0.1:65529' })
  const response = await handle(
    selectRequest({ sessionId: 's1', provider: 'p', model: 'm' }, { origin: 'http://evil.example' }),
  )
  assert.equal(response.status, 403)
  assert.equal((await response.json()).error.code, 'local/forbidden')
})

test('select route validates the body and the method', async () => {
  const handle = createSelectHandler({ controller: () => selectingController([]), origin: () => '' })
  const missing = await handle(selectRequest({ sessionId: 's1', provider: 'p' }))
  assert.equal(missing.status, 400)
  assert.equal((await missing.json()).error.code, 'local/bad-request')

  const wrongMethod = await handle(selectRequest(null, {}, 'GET'))
  assert.equal(wrongMethod.status, 405)
  assert.equal((await wrongMethod.json()).error.code, 'local/method')
})

test('select route reports an unmounted controller and controller failures', async () => {
  const detached = createSelectHandler({ controller: () => undefined, origin: () => '' })
  const unavailable = await detached(selectRequest({ sessionId: 's1', provider: 'p', model: 'm' }))
  assert.equal(unavailable.status, 503)
  assert.equal((await unavailable.json()).error.code, 'local/unavailable')

  const failing = createSelectHandler({
    controller: () => ({
      async selectModel() {
        throw Object.assign(new Error('held by another DSH instance'), { code: 'session/writer-held' })
      },
    }),
    origin: () => '',
  })
  const held = await failing(selectRequest({ sessionId: 's1', provider: 'p', model: 'm' }))
  const body = await held.json()
  assert.equal(body.ok, false)
  assert.equal(body.error.code, 'session/writer-held')
  assert.equal(body.error.message, 'held by another DSH instance')
})

/* ---------------------------------------------------------------- pins */

test('normalizePins sanitizes, de-duplicates and caps the list', () => {
  assert.deepEqual(normalizePins(null), [])
  assert.deepEqual(normalizePins('not an array'), [])
  const many = Array.from({ length: MAX_PINS + 20 }, (_, i) => `k/${i}`)
  const result = normalizePins([...many, ...many, '', 42, null, 'k/0'])
  assert.equal(result.length, MAX_PINS)
  assert.equal(new Set(result).size, MAX_PINS)
  assert.deepEqual(normalizePins(['a', 'a', 'b']), ['a', 'b'])
})

const pinsRequest = (body, headers = {}, method = 'POST') =>
  new Request('http://127.0.0.1:65529/dsh-model-value/api/pins', {
    method,
    headers: { 'content-type': 'application/json', 'x-dsh-model-value': '1', ...headers },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  })

const memoryPins = (initial = []) => {
  let keys = normalizePins(initial)
  return { get: () => [...keys], set: (v) => { keys = normalizePins(v); return [...keys] } }
}

test('pins route writes a sanitized list and echoes it back', async () => {
  const store = memoryPins()
  const handle = createPinsHandler({ pins: store, origin: () => 'http://127.0.0.1:65529' })
  const response = await handle(pinsRequest({ keys: ['a', 'a', 'b', '', 7] }))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true, selected: ['a', 'b'] })
  assert.deepEqual(store.get(), ['a', 'b'])

  const cleared = await handle(pinsRequest({ keys: [] }))
  assert.deepEqual(await cleared.json(), { ok: true, selected: [] })
  assert.deepEqual(store.get(), [])
})

test('pins route shares the local-only guards with select', async () => {
  const handle = createPinsHandler({ pins: memoryPins(), origin: () => 'http://127.0.0.1:65529' })
  const missingHeader = await handle(new Request('http://127.0.0.1:65529/api/pins', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  }))
  assert.equal(missingHeader.status, 403)
  const crossOrigin = await handle(pinsRequest({ keys: [] }, { origin: 'http://evil.example' }))
  assert.equal(crossOrigin.status, 403)
  const wrongOrigin = await handle(pinsRequest({ keys: [] }, { origin: 'http://127.0.0.1:9' }))
  assert.equal(wrongOrigin.status, 403)
  const badBody = await handle(pinsRequest({ keys: 'a' }))
  assert.equal(badBody.status, 400)
  const wrongMethod = await handle(pinsRequest(null, {}, 'GET'))
  assert.equal(wrongMethod.status, 405)
})

test('liveConfig reflects a volatile Settings edit without re-normalizing every field', () => {
  // A frozen {get()} ref is exactly what the loader substitutes for a volatile field.
  let weight = 3
  const weightRef = Object.freeze({ get: () => weight })
  const raw = { weightInput: weightRef, weightOutput: 1, currency: 'USD' }
  const config = liveConfig(raw)
  assert.equal(config.weightInput, 3)
  assert.equal(config.weightOutput, 1)
  assert.equal(config.currency, 'USD')
  // Settings mutates the value behind the ref; the very next read sees it.
  weight = 9
  assert.equal(config.weightInput, 9, 'a volatile edit is picked up on the next access')
  // A plain object (no volatile refs) still normalizes with defaults.
  assert.deepEqual(
    { ...liveConfig({}) },
    {
      weightInput: 3, weightOutput: 1, cacheHitShare: 0.5, currency: 'USD', fx: 7.2,
      includeFree: true, onlineRefresh: true, overridesJson: '',
    },
  )
})

test('malformed asOf values never enter the sanitized tables', () => {
  const parsed = parseOverrides(JSON.stringify({
    models: {
      'a/good': { input: 1, output: 2, asOf: '2026-11-17' },
      'b/bad': { input: 1, output: 2, asOf: 'recently' },
      'c/empty': { input: 1, output: 2, asOf: '' },
    },
    scores: {
      'a/good': { index: 40, asOf: '2026-11-17' },
      'b/bad': { index: 40, asOf: 'v5 last week' },
    },
  }))
  assert.equal(parsed.prices['a/good'].asOf, '2026-11-17')
  assert.equal('asOf' in parsed.prices['b/bad'], false, 'free-form date is dropped')
  assert.equal('asOf' in parsed.prices['c/empty'], false, 'empty date is dropped')
  assert.equal(parsed.scores['a/good'].asOf, '2026-11-17')
  assert.equal('asOf' in parsed.scores['b/bad'], false, 'free-form score date is dropped')
  // The row itself survives; only the bad provenance is discarded.
  assert.equal(parsed.prices['b/bad'].input, 1)
  assert.equal(parsed.scores['b/bad'].index, 40)
})

let failed = 0
for (const { name, fn } of tests) {
  try {
    await fn()
    console.log(`ok  ${name}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL ${name}`)
    console.log(error instanceof Error ? error.stack : String(error))
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`)
if (failed > 0) process.exitCode = 1
