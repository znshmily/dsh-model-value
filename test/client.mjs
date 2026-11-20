/**
 * Headless render of the real client bundle.
 *
 * The client half cannot be unit-tested in a browser, so this harness fakes the
 * only two things it touches — `window.__ModuleLoader__` and `react` — then
 * renders every registered slot component with the props the shipped owners
 * pass, and drives a model switch through the menu row click.
 *
 * Run: node test/client.mjs
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

/* --------------------------------------------------------------- stylesheet */

/**
 * The panel's layout lives in the stylesheet, not in the tree, so the tree
 * alone cannot catch a broken table: v0.4.1 shipped `.dmv-grid` markup with no
 * `display:grid` rule and all eight cells collapsed into one line. These
 * helpers let the render assertions check the CSS contract too.
 */
const CSS = (() => {
  const match = /const CSS = `([\s\S]*?)`\n/.exec(source)
  assert.ok(match !== null, 'the bundle ships one stylesheet')
  return match[1]
})()

const ruleOf = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|\\n)${escaped}\\{([^}]*)\\}`).exec(CSS)
  return match === null ? '' : match[1]
}

/** Counts top-level `grid-template-columns` tracks, so `minmax(0,1fr)` is one. */
function trackCount(value) {
  let depth = 0
  let current = ''
  let count = 0
  for (const char of value.trim()) {
    if (char === '(') depth += 1
    else if (char === ')') depth -= 1
    if (/\s/.test(char) && depth === 0) {
      if (current !== '') count += 1
      current = ''
      continue
    }
    current += char
  }
  if (current !== '') count += 1
  return count
}

/* ------------------------------------------------------------------ react */

let hookIndex = 0
let hookState = []

function createElement(type, props, ...children) {
  const flat = children.flat(Infinity)
  const next = { ...(props || {}) }
  if (flat.length > 0) next.children = flat
  return { type, props: next }
}

const React = {
  Fragment: 'Fragment',
  createElement,
  useState(initial) {
    const index = hookIndex++
    if (!(index in hookState)) hookState[index] = typeof initial === 'function' ? initial() : initial
    return [hookState[index], (value) => { hookState[index] = value }]
  },
  useEffect(effect) {
    hookIndex += 1
    // Real React runs this after commit; the harness runs it inline, which is
    // enough because every effect here only kicks off a cached fetch.
    try {
      effect()
    } catch {
      /* effects must not break the render pass */
    }
  },
}

const resetHooks = () => {
  hookIndex = 0
  hookState = []
}

/* ------------------------------------------------------------- translation */

let dictionary = {}

function t(key, params) {
  const template = dictionary[key]
  if (typeof template !== 'string') return key
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
}

/* ----------------------------------------------------------------- bundle */

const documentStub = {
  createElement() { return { dataset: {}, textContent: '', remove() {} } },
  head: { appendChild() {} },
}

function loadBundle() {
  let captured = null
  const windowStub = { __ModuleLoader__: { load(config) { captured = config } } }
  const requireStub = (id) => {
    if (id === 'react') return React
    throw new Error(`unexpected require(${id})`)
  }
  new Function('window', 'require', 'document', source)(windowStub, requireStub, documentStub)
  assert.ok(captured !== null, 'the bundle called window.__ModuleLoader__.load')
  const exported = captured.factory(requireStub)
  assert.ok(exported && typeof exported === 'object', 'the factory returned its exports')
  return { id: captured.id, exports: exported }
}

/* ---------------------------------------------------------------- fixture */

/**
 * Mirrors `buildProviderGroups` on the Host: the panel renders exactly what the
 * payload says, so the fixture has to describe the same two-level structure
 * (channel → rows) the Host computes.
 */
function groupsOf(rows) {
  const byProvider = new Map()
  for (const row of rows) {
    if (row.group !== 'ranked') continue
    const entry = byProvider.get(row.provider) ?? {
      id: row.provider,
      name: row.providerName,
      models: new Set(),
      ranked: 0,
      bestValue: null,
      bestIq: null,
    }
    entry.models.add(row.key)
    entry.ranked += 1
    if (row.value !== null && (entry.bestValue === null || row.value > entry.bestValue)) entry.bestValue = row.value
    if (row.iq !== null && (entry.bestIq === null || row.iq > entry.bestIq)) entry.bestIq = row.iq
    byProvider.set(row.provider, entry)
  }
  return [...byProvider.values()]
    .map((entry) => ({ ...entry, models: entry.models.size }))
    .sort((a, b) => (b.bestValue ?? -Infinity) - (a.bestValue ?? -Infinity) || String(a.name).localeCompare(String(b.name)))
}

const payload = {
  ok: true,
  generatedAt: '2026-11-16T12:00:00.000Z',
  asOf: { prices: '2026-11-16', scores: '2026-11-16', online: null },
  index: { name: 'Artificial Analysis', version: 'v5.0.1', url: 'https://artificialanalysis.ai/leaderboards/models' },
  currency: { code: 'USD', symbol: '$', rate: 1 },
  weights: { input: 0.75, output: 0.25, rawInput: 3, rawOutput: 1, cacheHitShare: 0.5 },
  sort: 'value',
  counts: {
    models: 5, ranked: 3, distinct: 3,
    free: 1, unscored: 0, unpriced: 1, providers: 2, failures: 1,
    market: { models: 2, ranked: 1, unscored: 1 },
    all: { models: 7, ranked: 4, distinct: 4 },
  },
  medianValue: 16.73,
  marketMedianValue: 2.5,
  medianValueAll: 15.28,
  rows: [
    {
      provider: 'commandcode', providerName: 'Command Code', providerId: 'commandcode', model: 'anthropic/claude-haiku-5.5', name: 'Claude Haiku 5.5',
      key: 'anthropic/claude-haiku-5.5', group: 'ranked', rank: 1, groupRank: 1, variant: 'standard', keyCount: 2,
      price: { input: 0.15, output: 0.75, cacheRead: 0.015 }, blended: 0.166,
      iq: 36, iqEstimated: false, iqNote: '', iqUrl: '',
      value: 216.87, valueIndex: 12.96, allRank: 1, allValueIndex: 14.19,
      priceSource: 'openrouter', priceAsOf: '2026-11-16', priceUrl: 'https://openrouter.ai/api/v1/models/anthropic/claude-haiku-5.5/endpoints',
    },
    {
      provider: 'commandcode', providerName: 'Command Code', providerId: 'commandcode', model: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5',
      key: 'anthropic/claude-sonnet-5.5', group: 'ranked', rank: 2, groupRank: 2, variant: 'standard', keyCount: 1,
      price: { input: 3, output: 15, cacheRead: 0.3 }, blended: 3.2875,
      iq: 55, iqEstimated: false, iqNote: '', iqUrl: '',
      value: 16.73, valueIndex: 1, allRank: 2, allValueIndex: 1.09,
      priceSource: 'openrouter', priceAsOf: '2026-11-16', priceUrl: 'https://openrouter.ai/api/v1/models/anthropic/claude-sonnet-5.5/endpoints',
    },
    {
      provider: 'orcarouter', providerName: 'OrcaRouter', providerId: 'orcarouter', model: 'moonshotai/kimi-k3.1-pro', name: 'Kimi K3.1 Pro',
      key: 'moonshotai/kimi-k3.1-pro', group: 'ranked', rank: 3, groupRank: 1, variant: 'standard', keyCount: 1,
      price: { input: 3, output: 15, cacheRead: 0.6 }, blended: 3.325,
      iq: 46, iqEstimated: false, iqNote: '', iqUrl: '',
      value: 13.83, valueIndex: 0.83, allRank: 3, allValueIndex: 0.9,
      priceSource: 'openrouter', priceAsOf: '2026-11-16', priceUrl: 'https://openrouter.ai/api/v1/models/moonshotai/kimi-k3.1-pro/endpoints',
    },
    {
      provider: 'orcarouter', providerName: 'OrcaRouter', providerId: 'orcarouter', model: 'z-ai/glm-5.3-flash-free', name: 'GLM 5.3 Flash (free)',
      key: 'z-ai/glm-5.3-flash', group: 'free', rank: null, groupRank: null, variant: 'free', keyCount: 1,
      price: { input: 0, output: 0, cacheRead: 0 }, blended: 0,
      iq: 28, iqEstimated: false, iqNote: '', iqUrl: '', value: null, valueIndex: null, allRank: null, allValueIndex: null,
      priceSource: 'free', priceAsOf: '2026-11-16', priceUrl: 'https://openrouter.ai/api/v1/models/z-ai/glm-5.3-flash/endpoints',
    },
    {
      provider: 'siliconflow', providerName: 'SiliconFlow', providerId: 'siliconflow', model: 'deepseek-ai/DeepSeek-V4.1-Flash', name: 'DeepSeek V4.1 Flash',
      key: 'deepseek/deepseek-v4.1-flash', group: 'unpriced', rank: null, groupRank: null, variant: 'standard', keyCount: 1,
      price: null, blended: null,
      iq: 33, iqEstimated: true, iqNote: 'score taken from the 2026-10 successor', iqUrl: '', value: null, valueIndex: null, allRank: null, allValueIndex: null,
      priceSource: '', priceAsOf: '', priceUrl: '',
    },
  ],
  providers: [],
  market: [
    {
      model: 'anthropic/claude-fable-5.2', name: 'Claude Fable 5.2', key: 'anthropic/claude-fable-5.2', group: 'market',
      rank: 1, price: { input: 8, output: 40, cacheRead: 0.2 }, blended: 16, iq: 51, iqEstimated: false, iqNote: '', iqUrl: '',
      value: 3.19, valueIndex: 1.28, allRank: 4, allValueIndex: 0.21, priceSource: 'openrouter', priceAsOf: '2026-11-17',
      priceUrl: 'https://openrouter.ai/api/v1/models/anthropic/claude-fable-5.2/endpoints',
    },
    {
      model: 'cohere/command-a', name: 'Command A', key: 'cohere/command-a', group: 'market-unscored',
      rank: null, price: { input: 2, output: 10, cacheRead: null }, blended: 4, iq: null, iqEstimated: false, iqNote: '', iqUrl: '',
      value: null, valueIndex: null, allRank: null, allValueIndex: null, priceSource: 'openrouter', priceAsOf: '2026-11-17',
      priceUrl: 'https://openrouter.ai/api/v1/models/cohere/command-a/endpoints',
    },
  ],
  selected: [],
  failures: [{ id: 'pi-ai', name: 'Pi AI', message: 'provider timed out' }],
  warnings: ['在线价格 anthropic/claude-sonnet-5.5：404'],
}
payload.providers = groupsOf(payload.rows)

/* ------------------------------------------------------------- fake host */

function makeHost(options = {}) {
  const state = {
    registrations: [],
    selectedPanel: null,
    switched: null,
    selectCalls: [],
    dismisses: 0,
    failures: [],
    fetches: [],
  }
  const selectImpl = options.select ?? (async (request) => {
    state.switched = request
    return { ok: true, value: undefined }
  })
  const fetchImpl = options.fetch ?? (async (url, init) => {
    if (typeof url === 'string' && url.startsWith('/dsh-model-value/api/select')) {
      state.selectCalls.push({ url, init })
      const request = JSON.parse(init.body)
      return { ok: true, status: 200, json: async () => selectImpl(request) }
    }
    state.fetches.push(url)
    return { ok: true, status: 200, json: async () => payload }
  })
  const ctx = {
    locale: {
      register(namespace, dictionaries) {
        assert.equal(namespace, 'modelValue')
        dictionary = dictionaries.zh
      },
      bind() { return t },
    },
    effect(effect) { effect() },
    // Deliberately no `remote`: a workspace bundle cannot read that namespace,
    // which is why the switch goes through the Host route instead.
    inject(_deps, callback) {
      return callback({
        layout: { selectPanel: (id) => { state.selectedPanel = id } },
        sessions: { subagentAddress: () => undefined },
      })
    },
    get() { return undefined },
    slots: {
      inject(_name, callback) { return callback() },
      register(registration, component) {
        state.registrations.push({ options: registration, component })
        return () => {}
      },
    },
    logger: { info() {} },
  }
  return { state, ctx, fetchImpl }
}

/* ---------------------------------------------------------------- render */

function render(node) {
  if (node === null || node === undefined || node === true || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(render).join('')
  const props = node.props || {}
  if (typeof node.type === 'function') {
    resetHooks()
    return render(node.type(props))
  }
  if (node.type === 'Fragment') return render(props.children)
  return render(props.children)
}

function flatten(node, out = []) {
  if (Array.isArray(node)) {
    for (const item of node) flatten(item, out)
    return out
  }
  if (node === null || node === undefined || typeof node !== 'object') return out
  // Function components are expanded so assertions can see what the browser
  // would see: the chart, the cards and the segmented controls are components.
  if (typeof node.type === 'function') {
    resetHooks()
    flatten(node.type(node.props || {}), out)
    return out
  }
  out.push(node)
  flatten((node.props || {}).children, out)
  return out
}

const hasClass = (node, name) => String((node.props || {}).className || '').split(/\s+/).includes(name)

async function mount(name, ownerProps = {}, sessionId = 'session-1') {
  const entry = hostOf.state.registrations.filter((item) => item.options.name === name)[0]
  assert.ok(entry, `slot ${name} is registered`)
  const rootScope = name === 'main'
  const face = typeof entry.options.inject === 'function'
    ? entry.options.inject(rootScope ? undefined : sessionId)
    : {}
  const props = { ...(entry.options.locale === 'modelValue' ? { t } : {}), ...face, ...ownerProps }
  resetHooks()
  render(entry.component(props))
  await new Promise((resolve) => setTimeout(resolve, 0))
  resetHooks()
  const tree = entry.component(props)
  return { tree, text: render(tree), entry, props }
}

/* ------------------------------------------------------------- scenario 1 */

let hostOf = makeHost()
globalThis.fetch = hostOf.fetchImpl
const bundle = loadBundle()
assert.equal(bundle.id, 'dsh-model-value')
assert.deepEqual(bundle.exports.inject, ['slots', 'locale'])
bundle.exports.apply(hostOf.ctx)

const registered = hostOf.state.registrations.map((item) => item.options.name).sort()
assert.deepEqual(registered, ['conversation.input.model.options', 'main'])
const byName = (name) => hostOf.state.registrations.filter((item) => item.options.name === name)[0]
assert.equal(byName('conversation.input.model.options').options.id, 'model-value-top')
assert.equal(byName('main').options.key, 'model-value-ranking')

const menu = await mount('conversation.input.model.options', {
  locked: false,
  dismiss: () => { hostOf.state.dismisses += 1 },
  reportFailure: (message) => hostOf.state.failures.push(message),
})
assert.ok(hostOf.state.fetches.some((url) => url.startsWith('/dsh-model-value/api/rank')), 'the menu fetches the ranking route')
assert.ok(menu.text.includes('★ 性价比 Top 3'), menu.text.slice(0, 200))
assert.ok(menu.text.includes('Claude Haiku 5.5'))
assert.ok(menu.text.includes('Claude Sonnet 5.5'))
assert.ok(menu.text.includes('Kimi K3.1 Pro'))
assert.equal(
  flatten(menu.tree).filter((node) => node.type === 'button' && node.props.className === 'dmv-menu-row').length,
  3,
  'the menu offers the top three ranked models',
)
assert.ok(menu.text.includes('#1') && menu.text.includes('#2') && menu.text.includes('#3'), 'rank badges')
assert.ok(
  !menu.text.includes('$') && !menu.text.includes('IQ '),
  'the menu row is name + provider only: price and IQ belong to the panel',
)
assert.ok(menu.text.includes('查看完整排行'))
/*
 * Nothing on the menu hides in a tooltip any more: the row shows the model name
 * and its channel, and the name wraps instead of truncating, so there is nothing
 * left to hover for.
 */
const menuRows = flatten(menu.tree).filter((node) => node.type === 'button' && node.props.className === 'dmv-menu-row')
assert.equal(menuRows[0].props.title, undefined, 'the row carries no tooltip')
const menuChips = flatten(menu.tree).filter((node) => hasClass(node, 'dmv-menu-provider'))
assert.deepEqual(
  menuChips.map((node) => render(node.props.children)),
  ['commandcode ×2', 'commandcode', 'orcarouter'],
  'every menu row names its provider, and a multi-key channel counts the keys',
)
assert.equal(menuChips[0].props.title, undefined, 'the provider chip carries no tooltip either')
const firstName = flatten(menu.tree).find((node) => hasClass(node, 'dmv-menu-name'))
assert.equal(render(firstName.props.children), 'Claude Haiku 5.5', 'the whole name is on the row')

/* a click really posts the switch to the Host route */
const firstRow = flatten(menu.tree).find((node) => node.type === 'button' && node.props.className === 'dmv-menu-row')
await firstRow.props.onClick()
assert.equal(hostOf.state.selectCalls.length, 1, 'the click posts to the select route')
const posted = hostOf.state.selectCalls[0]
assert.equal(posted.url, '/dsh-model-value/api/select')
assert.equal(posted.init.method, 'POST')
assert.equal(posted.init.headers['x-dsh-model-value'], '1')
const postedBody = JSON.parse(posted.init.body)
assert.equal(postedBody.sessionId, 'session-1')
assert.ok(typeof postedBody.provider === 'string' && postedBody.provider !== '')
assert.ok(typeof postedBody.model === 'string' && postedBody.model !== '')
assert.equal(hostOf.state.dismisses, 1, 'a successful switch closes the menu')

const panel = await mount('main')
assert.ok(panel.text.includes('模型性价比排行'))
assert.ok(panel.text.includes('Claude Haiku 5.5') && panel.text.includes('Claude Sonnet 5.5') && panel.text.includes('Kimi K3.1 Pro'))
/* two blocks in one scroll container: everything, then the provider groups */
const blocks = flatten(panel.tree).filter((node) => hasClass(node, 'dmv-scroll'))[0].props.children
assert.equal(blocks.length, 2, 'the market block is merged into the first one')
assert.deepEqual(blocks.map((block) => block.props.key), ['all', 'grouped'])
const splits = flatten(panel.tree).filter((node) => hasClass(node, 'dmv-split'))
assert.equal(splits.length, 2, 'one sticky split title per block')
assert.ok(render(blocks[0]).includes('全部模型（5）'), 'the default scope lists connected and market models together')
assert.ok(render(blocks[1]).includes('按提供方分组排名'), 'the grouped ranking is still there')
/* each block has its own sticky table header */
const headers = flatten(panel.tree).filter((node) => hasClass(node, 'dmv-th'))
assert.equal(headers.length, 2, 'one sticky header per block')
/* rows are grouped by provider only in block 2 */
const groupHeads = flatten(panel.tree).filter((node) => hasClass(node, 'dmv-group-head'))
assert.equal(groupHeads.length, 2, 'one group head per provider with ranked rows')
assert.ok(render(groupHeads[0]).includes('Command Code'), render(groupHeads[0]))
assert.ok(render(groupHeads[1]).includes('OrcaRouter'), render(groupHeads[1]))
assert.ok(!panel.text.includes('GLM 5.3 Flash (free)'), 'free models are hidden')
assert.ok(!panel.text.includes('DeepSeek V4.1 Flash'), 'unpriced models are hidden')
assert.ok(!panel.text.includes('免费模型（1）') && !panel.text.includes('未参与排名（1）'), 'the old separators are gone')
assert.ok(
  panel.text.includes('已隐藏 1 个免费模型 · 0 个无智力评分 · 1 个无价格'),
  'the hidden rows are still accounted for',
)
/* the merged block numbers every row on one scale; the grouped block keeps its own */
const badges = flatten(panel.tree).filter((node) => hasClass(node, 'dmv-badge-rank'))
assert.deepEqual(
  badges.map((node) => render(node.props.children)),
  ['#1', '#2', '#3', '#4', '—', '#1', '#2', '#1'],
  'merged ranks, then per-channel ranks',
)
/* both numberings are on screen — a hover-only number was too easy to miss */
const rankChips = flatten(panel.tree).filter((node) => hasClass(node, 'dmv-rank-chip'))
assert.deepEqual(
  rankChips.map((node) => render(node.props.children)),
  ['已接入第 1', '已接入第 2', '已接入第 3', '全部第 1', '全部第 2', '全部第 3'],
  'the merged table spells out the connected rank, the groups spell out the merged rank',
)
assert.ok(render(headers[0]).includes('全部排名'), 'the header names the numbering of its own column')
assert.ok(render(headers[1]).includes('组内排名'))
/*
 * The raw 提供方/模型ID is a visible line, not a tooltip: it can be read in a
 * screenshot and selected for copying. A market row has no channel, so it shows
 * the model slug it would resolve to.
 */
const keyCells = flatten(panel.tree).filter((node) => hasClass(node, 'dmv-key'))
assert.deepEqual(
  keyCells.map((node) => render(node.props.children)),
  [
    'commandcode/anthropic/claude-haiku-5.5 ×2',
    'commandcode/anthropic/claude-sonnet-5.5',
    'orcarouter/moonshotai/kimi-k3.1-pro',
    'anthropic/claude-fable-5.2',
    'cohere/command-a',
    'commandcode/anthropic/claude-haiku-5.5 ×2',
    'commandcode/anthropic/claude-sonnet-5.5',
    'orcarouter/moonshotai/kimi-k3.1-pro',
  ],
  'every row spells out its provider and model id',
)
for (const node of flatten(panel.tree).filter((cell) => hasClass(cell, 'dmv-row'))) {
  assert.equal(node.props.title, undefined, 'a row hides nothing in a tooltip')
}
/* market rows join the same table, with a pill and without a checkbox */
assert.ok(panel.text.includes('Claude Fable 5.2') && panel.text.includes('Command A'))
assert.equal(
  flatten(blocks[0]).filter((node) => hasClass(node, 'dmv-badge-market')).length,
  2,
  'in the mixed table the market rows are labelled',
)
assert.ok(!panel.text.includes('市面模型（未接入）'), 'the separate market block is gone')
assert.ok(panel.text.includes('未接入的模型价格与智力都已核实'), 'the market rows still explain themselves')
const panelCheckboxes = flatten(panel.tree).filter((node) => node.type === 'input' && node.props.type === 'checkbox')
assert.equal(panelCheckboxes.length, 6, 'three channel rows in each block, and no checkbox on a market row')
/* the scope chips live on the first block's title bar */
const scopeButtons = flatten(blocks[0]).filter((node) => node.type === 'button' && node.props['aria-pressed'] !== undefined)
assert.deepEqual(scopeButtons.map((node) => render(node.props.children)), ['全部', '已接入', '未接入'])
assert.equal(scopeButtons[0].props['aria-pressed'], 'true', 'the default scope is everything')
assert.ok(panel.text.includes('Artificial Analysis v5.0.1'))
assert.ok(panel.text.includes('数据时间 2026-11-16'))
assert.ok(panel.text.includes('1 个提供方的模型目录获取失败'))
assert.ok(panel.text.includes('openrouter.ai'), 'price source host in the footer')
assert.ok(panel.text.includes('性价比') && panel.text.includes('单价') && panel.text.includes('智力'), 'sort controls')
assert.ok(!panel.text.includes('达标优先'), 'the smart sort belongs to 0.3 and is gone')
assert.ok(panel.text.includes('刷新') && panel.text.includes('USD') && panel.text.includes('CNY'))
assert.ok(panel.text.includes('勾选后会加到输入框菜单里'), 'the pin column says what it does')

/* 未接入: only the market rows, no pin hint, and the grouped block stays */
scopeButtons[2].props.onClick()
const marketOnly = await mount('main')
const marketOnlyBlocks = flatten(marketOnly.tree).filter((node) => hasClass(node, 'dmv-scroll'))[0].props.children
assert.ok(marketOnly.text.includes('未接入模型（2）'), marketOnly.text.slice(0, 400))
assert.ok(!render(marketOnlyBlocks[0]).includes('Claude Haiku 5.5'), 'the merged block drops the connected rows')
assert.deepEqual(
  flatten(marketOnlyBlocks[0]).filter((node) => hasClass(node, 'dmv-badge-rank')).map((node) => render(node.props.children)),
  ['#4', '—'],
  'the market rows keep their merged rank and the unscored one keeps its dash',
)
assert.ok(marketOnly.text.includes('Claude Fable 5.2'))
/* the scope already says 未接入, so a pill on every row would only repeat the title */
assert.equal(
  flatten(marketOnlyBlocks[0]).filter((node) => hasClass(node, 'dmv-badge-market')).length,
  0,
  'the market pill is dropped when every visible row is a market row',
)
assert.ok(!marketOnly.text.includes('勾选后会加到输入框菜单里'), 'no checkboxes on screen means no pin hint')
assert.ok(marketOnly.text.includes('按提供方分组排名'), 'the grouped block is a separate question and stays')
const marketOnlyBoxes = flatten(marketOnly.tree).filter((node) => node.type === 'input' && node.props.type === 'checkbox')
assert.equal(marketOnlyBoxes.length, 3, 'only the grouped block still offers checkboxes')

/* 已接入: only the channel rows */
const connectedButton = flatten(marketOnly.tree).find(
  (node) => node.type === 'button' && node.props['aria-pressed'] !== undefined && render(node.props.children) === '已接入',
)
connectedButton.props.onClick()
const connectedOnly = await mount('main')
assert.ok(connectedOnly.text.includes('已接入模型（3）'), connectedOnly.text.slice(0, 400))
assert.ok(!connectedOnly.text.includes('Claude Fable 5.2'), 'market rows are filtered out')

/* back to everything, so the later scenarios start from the default view */
const allButton = flatten(connectedOnly.tree).find(
  (node) => node.type === 'button' && node.props['aria-pressed'] !== undefined && render(node.props.children) === '全部',
)
allButton.props.onClick()
const restored = await mount('main')
assert.ok(restored.text.includes('全部模型（5）'))

/* the table is a real grid: the panel declares the tracks once, and every
   header and row has exactly one cell per track */
const declared = /--dmv-cols:([^;]+);/.exec(ruleOf('.dmv-panel'))
assert.ok(declared !== null, 'the panel declares the column template')
const columns = trackCount(declared[1])
assert.equal(columns, 8, 'eight columns: pin, rank, model, three prices, IQ, value')
assert.ok(/display:grid/.test(ruleOf('.dmv-grid')), 'table rows are laid out as a grid')
assert.ok(
  /grid-template-columns:var\(--dmv-cols\)/.test(ruleOf('.dmv-grid')),
  'header and rows share the one column template',
)
const gridNodes = flatten(panel.tree).filter((node) => node.props !== undefined && hasClass(node, 'dmv-grid'))
assert.ok(gridNodes.length > 3, 'the headers and the rows are grid nodes')
for (const node of gridNodes) {
  assert.equal(node.props.children.length, columns, `${node.props.className} has one cell per column`)
}
/* sticky chrome: the block title, the column header and the channel head */
for (const selector of ['.dmv-split', '.dmv-th', '.dmv-group-head']) {
  assert.ok(/position:sticky/.test(ruleOf(selector)), `${selector} sticks while scrolling`)
}
assert.ok(/top:var\(--dmv-split-h\)/.test(ruleOf('.dmv-th')), 'the header parks under the block title')
/*
 * The model cell is two lines: the name with its pills, then the raw
 * 提供方/模型ID. The second line is what replaced the channel-chip tooltip, so
 * the cell must stack, not stretch, and the id must not wrap the row apart.
 */
assert.ok(/flex-direction:column/.test(ruleOf('.dmv-name')), 'the model cell stacks its two lines')
assert.ok(/white-space:nowrap/.test(ruleOf('.dmv-key')), 'the id line is one line, ellipsised if long')

/*
 * The model cell keeps the name and everything that belongs to it together at
 * the left. A growing `strong` pushed the channel chip to the column's right
 * edge, where it ran into the input price ("commandcode0.100"); that is the
 * layout the user reported twice, so the contract is a rule, not a comment.
 */
const nameRule = ruleOf('.dmv-name strong')
assert.ok(/flex:0 1 auto/.test(nameRule), 'the name never grows away from its chips')
assert.ok(/min-width:0/.test(nameRule), 'a long name shrinks instead of overflowing the column')
assert.ok(/text-overflow:ellipsis/.test(nameRule), 'and it truncates rather than pushing the chips out')
assert.ok(/overflow:hidden/.test(ruleOf('.dmv-name')), 'the cell clips instead of bleeding into the price column')

/*
 * Dark-theme contract. Some themes ship a light `--dsw-alias-brand-primary`;
 * a solid brand fill behind our own text then renders white on white (that is
 * exactly how the `#1` rank badge disappeared). Brand may only tint a
 * background, never replace it, and no rule may hard-code white text.
 */
for (const declaration of CSS.matchAll(/background(?:-color)?\s*:\s*([^;}]+)/g)) {
  const value = declaration[1].trim()
  if (!value.includes('--dsw-alias-brand-primary')) continue
  assert.ok(
    value.includes('color-mix('),
    `brand may tint a background through color-mix, not fill it: ${value}`,
  )
}
assert.ok(
  !/(?:^|[;{\s])color\s*:\s*(?:#fff\b|#ffffff\b|white\b)/i.test(CSS),
  'no hard-coded white text: the surface colour may be light',
)
/* a native checkbox paints a white square in a dark theme with no color-scheme */
assert.ok(/appearance:none/.test(ruleOf('.dmv-pin input')), 'the pin checkbox is drawn by us')
/* sticky layers must stay ordered: block title above column header above group head */
const zIndexOf = (selector) => {
  const match = /z-index:\s*(\d+)/.exec(ruleOf(selector))
  assert.ok(match !== null, `${selector} declares a z-index`)
  return Number(match[1])
}
assert.ok(
  zIndexOf('.dmv-split') > zIndexOf('.dmv-th') && zIndexOf('.dmv-th') > zIndexOf('.dmv-group-head'),
  'sticky layers are ordered: split > th > group head',
)

/* switching the sort re-requests with the matching parameter */
const iqButton = flatten(panel.tree).find(
  (node) => node.type === 'button' && render(node.props.children) === '智力',
)
iqButton.props.onClick()
await new Promise((resolve) => setTimeout(resolve, 0))
assert.ok(
  hostOf.state.fetches.some((url) => url.includes('sort=iq')),
  hostOf.state.fetches.join('\n'),
  'the sort control sends its value to the Host'
)

/* the menu's last row is now the only way into the full table */
const moreButton = flatten(menu.tree).find((node) => node.type === 'button' && node.props.className === 'dmv-menu-more')
moreButton.props.onClick()
assert.equal(hostOf.state.selectedPanel, 'model-value-ranking')

/* locked sessions cannot switch */
const lockedMenu = await mount('conversation.input.model.options', { locked: true, dismiss() {}, reportFailure() {} })
const lockedRows = flatten(lockedMenu.tree).filter((node) => node.type === 'button' && node.props.className === 'dmv-menu-row')
assert.equal(lockedRows.length, 3)
assert.ok(lockedRows.every((row) => row.props.disabled === true))

/* ------------------------------------------------------------- scenario 2 */

hostOf = makeHost({
  select: async () => ({ ok: false, error: { code: 'session/writer-held', message: 'held by another instance' } }),
})
globalThis.fetch = hostOf.fetchImpl
loadBundle().exports.apply(hostOf.ctx)

const heldMenu = await mount('conversation.input.model.options', {
  locked: false,
  dismiss: () => { hostOf.state.dismisses += 1 },
  reportFailure: (message) => hostOf.state.failures.push(message),
})
const row = flatten(heldMenu.tree).find((node) => node.type === 'button' && node.props.className === 'dmv-menu-row')
await row.props.onClick()
assert.equal(hostOf.state.dismisses, 0, 'a failed switch keeps the menu open')
assert.deepEqual(hostOf.state.failures, ['另一个 DSH 实例正在使用该会话'])

/* ------------------------------------------------------------- scenario 3 */

hostOf = makeHost({ fetch: async () => { throw new Error('connection refused') } })
globalThis.fetch = hostOf.fetchImpl
loadBundle().exports.apply(hostOf.ctx)
const broken = await mount('main')
assert.ok(broken.text.includes('排行接口不可用'), broken.text.slice(0, 200))
assert.ok(broken.text.includes('connection refused'))

/* the menu hides itself when the endpoint is down, rather than showing an error */
const quietMenu = await mount('conversation.input.model.options', { locked: false, dismiss() {}, reportFailure() {} })
assert.equal(quietMenu.text, '')

/* ------------------------------------------------------------- scenario 4 */

hostOf = makeHost({ fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, rows: [], counts: {} }) }) })
globalThis.fetch = hostOf.fetchImpl
loadBundle().exports.apply(hostOf.ctx)
const empty = await mount('main')
assert.ok(empty.text.includes('还没有价格数据'))

/* ------------------------------------------------------------- scenario 5 */

/**
 * The switch route lives in the Host half. When that half is not mounted (the
 * plugin disabled mid-session, a stale page), the POST 404s and the click must
 * say what happened instead of doing nothing.
 */
hostOf = makeHost({
  fetch: async (url) => {
    if (typeof url === 'string' && url.startsWith('/dsh-model-value/api/select')) {
      return { ok: false, status: 404, json: async () => { throw new Error('not json') } }
    }
    return { ok: true, status: 200, json: async () => payload }
  },
})
globalThis.fetch = hostOf.fetchImpl
loadBundle().exports.apply(hostOf.ctx)

const orphanMenu = await mount('conversation.input.model.options', {
  locked: false,
  dismiss: () => { hostOf.state.dismisses += 1 },
  reportFailure: (message) => hostOf.state.failures.push(message),
})
const orphanRow = flatten(orphanMenu.tree).find((node) => node.type === 'button' && node.props.className === 'dmv-menu-row')
await orphanRow.props.onClick()
assert.equal(hostOf.state.dismisses, 0, 'the menu stays open when the switch route is missing')
assert.deepEqual(hostOf.state.failures, ['切换失败：HTTP 404'])

/* ------------------------------------------------------------- scenario 6 */

/**
 * Pins are per (provider, model), not per canonical key. Two channels offering
 * the SAME key must be independently selectable: pinning one must not tick the
 * other. The menu keeps its Top 3 and appends the pinned channel as a ★ row.
 */
const dualRows = [
  { ...payload.rows[0], provider: 'commandcode', providerId: 'commandcode', model: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash (CC)', key: 'deepseek/deepseek-v4.1-flash', rank: 1, groupRank: 1 },
  { ...payload.rows[0], provider: 'comate', providerName: 'Comate', providerId: 'comate', model: 'proxy_c8cdb', name: 'DeepSeek V4.1 Flash (Comate)', key: 'deepseek/deepseek-v4.1-flash', rank: 2, groupRank: 1 },
  payload.rows[1],
  payload.rows[2],
]
const dualPayload = { ...payload, rows: dualRows, providers: groupsOf(dualRows) }
const selectedKeys = ['comate/proxy_c8cdb']
const pinCalls = []
hostOf = makeHost({
  fetch: async (url, init) => {
    const str = String(url)
    if (str.startsWith('/dsh-model-value/api/pins')) {
      pinCalls.push({ url, init })
      const keys = JSON.parse(init.body).keys
      selectedKeys.splice(0, selectedKeys.length, ...keys)
      return { ok: true, status: 200, json: async () => ({ ok: true, selected: [...selectedKeys] }) }
    }
    return { ok: true, status: 200, json: async () => ({ ...dualPayload, selected: [...selectedKeys] }) }
  },
})
globalThis.fetch = hostOf.fetchImpl
loadBundle().exports.apply(hostOf.ctx)

const pinned = await mount('conversation.input.model.options', { locked: false, dismiss() {}, reportFailure() {} })
assert.ok(pinned.text.includes('★ 性价比 Top 3'), pinned.text.slice(0, 200))
assert.ok(pinned.text.includes('DeepSeek V4.1 Flash (Comate)'), 'the pinned channel instance is appended')
assert.ok(pinned.text.includes('DeepSeek V4.1 Flash (CC)'), 'the recommendation list survives a pin')
assert.ok(pinned.text.includes('Claude Sonnet 5.5'), 'recommendations are not filtered away')
const pinnedRows = flatten(pinned.tree).filter((node) => node.type === 'button' && node.props.className === 'dmv-menu-row')
assert.equal(pinnedRows.length, 4, 'top three plus the pinned channel')
const starBadges = flatten(pinned.tree).filter((node) => node.type === 'span' && hasClass(node, 'dmv-rank-star'))
assert.equal(starBadges.length, 1, 'only the pinned row carries the star')
assert.equal(render(starBadges[0].props.children), '★')

/* the panel ticks the pinned channel but not its same-key sibling */
const dualPanel = await mount('main')
const dualBoxes = flatten(dualPanel.tree).filter((node) => node.type === 'input' && node.props.type === 'checkbox')
assert.equal(dualBoxes.length, 8, 'every ranked row appears in both the global and the grouped blocks')
const ticked = dualBoxes.filter((node) => node.props.checked === true)
assert.equal(ticked.length, 2, 'the pinned channel is ticked in both blocks')
assert.ok(ticked.every((node) => String(node.props['aria-label']).includes('comate')), ticked[0].props['aria-label'])
assert.ok(
  dualBoxes.some((node) => String(node.props['aria-label']).includes('commandcode · DeepSeek V4.1 Flash (CC)')),
  'the same-key CC channel is listed but not ticked',
)

/* ------------------------------------------------------------- scenario 7 */

/**
 * Ticking a checkbox POSTs (provider, model) ids; "Clear" writes an empty list.
 * A pin that is already in the Top 3 adds no row — the menu stays at three.
 */
selectedKeys.splice(0, selectedKeys.length, 'commandcode/anthropic/claude-sonnet-5.5')
hostOf = makeHost({
  fetch: async (url, init) => {
    const str = String(url)
    if (str.startsWith('/dsh-model-value/api/pins')) {
      pinCalls.push({ url, init })
      const keys = JSON.parse(init.body).keys
      selectedKeys.splice(0, selectedKeys.length, ...keys)
      return { ok: true, status: 200, json: async () => ({ ok: true, selected: [...selectedKeys] }) }
    }
    return { ok: true, status: 200, json: async () => ({ ...payload, selected: [...selectedKeys] }) }
  },
})
globalThis.fetch = hostOf.fetchImpl
loadBundle().exports.apply(hostOf.ctx)

const pinPanel = await mount('main')
assert.ok(pinPanel.text.includes('已选 1'), pinPanel.text.slice(0, 200))
const checkboxes = flatten(pinPanel.tree).filter((node) => node.type === 'input' && node.props.type === 'checkbox')
assert.equal(checkboxes.length, 6, 'each ranked row appears in the global and grouped blocks')
assert.equal(checkboxes[0].props.checked, false, 'an unpinned row is not ticked')
assert.equal(checkboxes[1].props.checked, true, 'the pinned row is ticked')
assert.equal(checkboxes[3].props.checked, false, 'the same row in the grouped block follows the same pin state')
assert.equal(checkboxes[4].props.checked, true, 'a pin is reflected in both blocks')

/* uncheck the pinned row → empty list; pins now carry provider/model ids */
await checkboxes[1].props.onChange()
await new Promise((resolve) => setTimeout(resolve, 0))
const afterToggle = await mount('main')
const toggled = JSON.parse(pinCalls[pinCalls.length - 1].init.body)
assert.deepEqual(toggled.keys, [], 'unchecking the only pin writes an empty list')
assert.equal(pinCalls[pinCalls.length - 1].init.headers['x-dsh-model-value'], '1', 'pins carry the local guard header')
assert.ok(afterToggle.text.includes('已选 0'), 'the counter follows the pins')

/* check a different row → its (provider, model) id is posted */
const kimiBox = flatten(afterToggle.tree).filter((node) => node.type === 'input' && node.props.type === 'checkbox')[2]
await kimiBox.props.onChange()
await new Promise((resolve) => setTimeout(resolve, 0))
const afterCheck = await mount('main')
assert.deepEqual(JSON.parse(pinCalls[pinCalls.length - 1].init.body).keys, ['orcarouter/moonshotai/kimi-k3.1-pro'])
assert.ok(afterCheck.text.includes('已选 1'))

/* clear resets everything and the menu falls back to the three recommendations */
const clearButton = flatten(afterCheck.tree).find(
  (node) => node.type === 'button' && render(node.props.children) === '清空选择',
)
assert.ok(clearButton, 'the clear button exists')
await clearButton.props.onClick()
await new Promise((resolve) => setTimeout(resolve, 0))
assert.deepEqual(JSON.parse(pinCalls[pinCalls.length - 1].init.body).keys, [], 'clear writes an empty id list')
const clearedMenu = await mount('conversation.input.model.options', { locked: false, dismiss() {}, reportFailure() {} })
assert.ok(clearedMenu.text.includes('★ 性价比 Top 3'), 'the menu always leads with the recommendations')
assert.equal(flatten(clearedMenu.tree).filter((node) => node.type === 'button' && node.props.className === 'dmv-menu-row').length, 3)
assert.equal(
  flatten(clearedMenu.tree).filter((node) => node.type === 'span' && hasClass(node, 'dmv-rank-star')).length,
  0,
  'no pins means no star rows',
)

/* ------------------------------------------------------------- scenario 8 */

/**
 * Every pin is shown. A cap would silently drop a row the user just ticked:
 * four pins must produce three recommendations plus four star rows, not five
 * rows in total.
 */
const manyRows = Array.from({ length: 8 }, (_, index) => ({
  provider: 'commandcode',
  providerName: 'Command Code',
  providerId: 'commandcode',
  model: `vendor/model-${index}`,
  name: `Model ${index}`,
  key: `vendor/model-${index}`,
  matchedBy: 'id',
  group: 'ranked',
  rank: index + 1,
  price: { input: 0.1, output: 0.5, cacheRead: 0.01 },
  blended: Number((0.1 + index * 0.1).toFixed(4)),
  iq: 40 - index,
  iqEstimated: false,
  iqNote: '',
  iqUrl: '',
  value: Number((100 - index * 5).toFixed(4)),
  valueIndex: 2,
  priceSource: 'openrouter',
  priceAsOf: '2026-11-17',
  priceUrl: '',
  keyCount: 1,
}))
const fourPins = ['commandcode/vendor/model-3', 'commandcode/vendor/model-4', 'commandcode/vendor/model-5', 'commandcode/vendor/model-6']
hostOf = makeHost({
  fetch: async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ...payload, rows: manyRows, selected: [...fourPins] }),
  }),
})
globalThis.fetch = hostOf.fetchImpl
loadBundle().exports.apply(hostOf.ctx)

const manyMenu = await mount('conversation.input.model.options', { locked: false, dismiss() {}, reportFailure() {} })
const manyRowsRendered = flatten(manyMenu.tree).filter((node) => node.type === 'button' && node.props.className === 'dmv-menu-row')
assert.equal(manyRowsRendered.length, 7, 'three recommendations plus all four pins')
assert.equal(
  flatten(manyMenu.tree).filter((node) => node.type === 'span' && hasClass(node, 'dmv-rank-star')).length,
  4,
  'every pinned row carries a star',
)
for (let index = 3; index <= 6; index += 1) {
  assert.ok(manyMenu.text.includes(`Model ${index}`), `pinned model ${index} is in the menu`)
}
assert.ok(manyMenu.text.includes('已勾选 4'), 'the title counts the pins it shows')

/* ------------------------------------------------------------- scenario 9 */

/**
 * A failed pin write must roll the optimistic tick back. Without the rollback
 * the checkbox stays ticked until a reload silently unticks it — the UI claims
 * a save that never happened.
 */
let failWrites = true
const canonicalSelected = ['commandcode/anthropic/claude-sonnet-5.5']
hostOf = makeHost({
  fetch: async (url, init) => {
    if (typeof url === 'string' && url.startsWith('/dsh-model-value/api/pins')) {
      if (failWrites) throw new Error('disk full')
      return { ok: true, status: 200, json: async () => ({ ok: true, selected: JSON.parse(init.body).keys }) }
    }
    return { ok: true, status: 200, json: async () => ({ ...payload, selected: [...canonicalSelected] }) }
  },
})
globalThis.fetch = hostOf.fetchImpl
loadBundle().exports.apply(hostOf.ctx)

const failPanel = await mount('main')
const failBoxes = flatten(failPanel.tree).filter((node) => node.type === 'input' && node.props.type === 'checkbox')
// Tick an unpinned row (the first one) → the optimistic draft adds it, then the write fails.
await failBoxes[0].props.onChange()
await new Promise((resolve) => setTimeout(resolve, 0))
const rolledBack = await mount('main')
const rolledBoxes = flatten(rolledBack.tree).filter((node) => node.type === 'input' && node.props.type === 'checkbox')
assert.equal(rolledBoxes[0].props.checked, false, 'a failed write unticks the optimistic checkbox')
assert.equal(rolledBoxes[1].props.checked, true, 'the canonical pin list is intact after rollback')
assert.ok(rolledBack.text.includes('已选 1'), 'the counter returns to the saved list, not the failed draft')

/* ------------------------------------------------------------ scenario 10 */

/**
 * A market model can outrank every connected one. The merged badge must then be
 * its number, and the connected row has to explain the other numbering on
 * hover — otherwise the panel's `#2` and the composer menu's `#1` for the same
 * model look like a contradiction.
 */
const shifted = new Map([
  ['anthropic/claude-fable-5.2', 1],
  ['anthropic/claude-haiku-5.5', 2],
  ['anthropic/claude-sonnet-5.5', 3],
  ['moonshotai/kimi-k3.1-pro', 4],
])
const withMarketFirst = (row) => (shifted.has(row.key) ? { ...row, allRank: shifted.get(row.key) } : row)
hostOf = makeHost({
  fetch: async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      ...payload,
      rows: payload.rows.map(withMarketFirst),
      market: payload.market.map(withMarketFirst),
    }),
  }),
})
globalThis.fetch = hostOf.fetchImpl
loadBundle().exports.apply(hostOf.ctx)

const marketFirst = await mount('main')
const firstBlock = flatten(marketFirst.tree).filter((node) => hasClass(node, 'dmv-scroll'))[0].props.children[0]
const firstRows = flatten(firstBlock).filter((node) => hasClass(node, 'dmv-row'))
assert.ok(render(firstRows[0]).includes('Claude Fable 5.2'), 'the list is ordered by the merged rank')
assert.ok(render(firstRows[0]).includes('#1'))
assert.ok(render(firstRows[1]).includes('Claude Haiku 5.5'))
const mergedBadges = flatten(firstBlock).filter((node) => hasClass(node, 'dmv-badge-rank'))
assert.deepEqual(mergedBadges.map((node) => render(node.props.children)), ['#1', '#2', '#3', '#4', '—'])
/* the connected row is #2 in the merged table and says #1 among the connected, visibly */
const mergedChips = flatten(firstBlock).filter((node) => hasClass(node, 'dmv-rank-chip'))
assert.deepEqual(
  mergedChips.map((node) => render(node.props.children)),
  ['已接入第 1', '已接入第 2', '已接入第 3'],
  'the second numbering is a pill, not a tooltip',
)
assert.equal(render(firstRows[0]).includes('已接入'), false, 'a market row has no connected rank to show')

/* ------------------------------------------------------------ scenario 11 */

/**
 * A provider that hides its models behind `proxy_<hash>` leaves the id line
 * unreadable, and both surfaces truncate the name with an ellipsis. The tooltip
 * must therefore start with the full name, then say which channel and id.
 */
const proxiedRows = [
  {
    provider: 'comate',
    providerName: 'Comate 私有云 Agent',
    providerId: 'comate',
    model: 'proxy_9f2c41ab7e',
    name: '数科私域-Deepseek-V4-Flash（256K）',
    key: 'deepseek/deepseek-v4.1-flash',
    group: 'ranked',
    rank: 1,
    groupRank: 1,
    allRank: 1,
    allValueIndex: 1,
    valueIndex: 1,
    price: { input: 0.3, output: 1.2, cacheRead: null },
    blended: 0.415,
    iq: 33,
    iqEstimated: false,
    iqNote: '',
    iqUrl: '',
    value: 79.5,
    priceSource: 'openrouter',
    priceAsOf: '2026-11-17',
    priceUrl: '',
    keyCount: 1,
  },
]
hostOf = makeHost({
  fetch: async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      ...payload,
      rows: proxiedRows,
      providers: groupsOf(proxiedRows),
      market: [],
      selected: [],
      counts: { ...payload.counts, models: 1, ranked: 1, distinct: 1, all: { models: 1, ranked: 1, distinct: 1 } },
    }),
  }),
})
globalThis.fetch = hostOf.fetchImpl
loadBundle().exports.apply(hostOf.ctx)

const proxiedMenu = await mount('conversation.input.model.options', { locked: false, dismiss() {}, reportFailure() {} })
const proxiedMenuRow = flatten(proxiedMenu.tree).find(
  (node) => node.type === 'button' && node.props.className === 'dmv-menu-row',
)
assert.equal(proxiedMenuRow.props.title, undefined, 'the picker has no tooltip to read')
assert.equal(
  render(flatten(proxiedMenuRow).find((node) => hasClass(node, 'dmv-menu-name')).props.children),
  '数科私域-Deepseek-V4-Flash（256K）',
  'the whole name is on the row instead',
)
assert.equal(
  render(flatten(proxiedMenuRow).find((node) => hasClass(node, 'dmv-menu-provider')).props.children),
  'comate',
  'and its channel next to it',
)

const proxiedPanel = await mount('main')
const proxiedPanelRow = flatten(proxiedPanel.tree).find((node) => hasClass(node, 'dmv-row'))
assert.equal(proxiedPanelRow.props.title, undefined, 'the panel row carries no tooltip')
/* the opaque id is now a line of its own: readable, selectable, copyable */
const proxiedKey = flatten(proxiedPanelRow).find((node) => hasClass(node, 'dmv-key'))
assert.equal(render(proxiedKey.props.children), 'comate/proxy_9f2c41ab7e')

/* ------------------------------------------------------------ scenario 12 */

/**
 * The search finds, it does not filter: the rows keep their order, their rank
 * and their checkbox, only the matched text is marked. Copying a name yields
 * exactly the string the search matches, so a paste always lands.
 */
hostOf = makeHost()
globalThis.fetch = hostOf.fetchImpl
loadBundle().exports.apply(hostOf.ctx)

let clipboard = ''
Object.defineProperty(globalThis, 'navigator', {
  value: { clipboard: { writeText: async (text) => { clipboard = text } } },
  configurable: true,
})

const searchPanel = await mount('main')
const searchBox = flatten(searchPanel.tree).find((node) => node.type === 'input' && node.props.type === 'text')
assert.ok(searchBox, 'the panel offers a name search')
assert.equal(searchBox.props.value, '', 'and starts empty')
const rowsBefore = flatten(searchPanel.tree).filter((node) => hasClass(node, 'dmv-row')).length
assert.ok(searchBox.props.placeholder.includes('搜索模型名'), 'the placeholder says what it searches')
assert.ok(searchBox.props.placeholder.includes('不过滤'), 'and that it does not filter')

searchBox.props.onChange({ target: { value: 'claude' } })
const searched = await mount('main')
const rowsAfter = flatten(searched.tree).filter((node) => hasClass(node, 'dmv-row')).length
assert.equal(rowsAfter, rowsBefore, 'searching never removes a row')
const marks = flatten(searched.tree).filter((node) => hasClass(node, 'dmv-mark'))
assert.deepEqual(
  marks.map((node) => render(node.props.children)),
  ['Claude', 'Claude', 'Claude', 'Claude', 'Claude'],
  'both tables mark the match: three rows in the merged table, two in the provider groups',
)
assert.ok(searched.text.includes('匹配 3 行'), searched.text.slice(0, 400))

/* regex metacharacters are matched literally, and a miss is reported as 0 */
const metacharBox = flatten(searched.tree).find((node) => node.type === 'input' && node.props.type === 'text')
metacharBox.props.onChange({ target: { value: '5.5' } })
const dotted = await mount('main')
assert.equal(flatten(dotted.tree).filter((node) => hasClass(node, 'dmv-mark')).length, 4, '5.5 matches by literal text (two rows, each drawn twice)')
const dottedBox = flatten(dotted.tree).find((node) => node.type === 'input' && node.props.type === 'text')
dottedBox.props.onChange({ target: { value: 'nope-model' } })
const missed = await mount('main')
assert.equal(flatten(missed.tree).filter((node) => hasClass(node, 'dmv-mark')).length, 0, 'a miss marks nothing')
assert.ok(missed.text.includes('匹配 0 行'), 'and the count says so')
assert.equal(
  flatten(missed.tree).filter((node) => hasClass(node, 'dmv-row')).length,
  rowsBefore,
  'still no filtering',
)

/* the per-row copy button hands over the name the search matches on */
const copyReset = flatten(missed.tree).find((node) => node.type === 'input' && node.props.type === 'text')
copyReset.props.onChange({ target: { value: '' } })
const ready = await mount('main')
const copyButton = flatten(ready.tree).find((node) => node.type === 'button' && hasClass(node, 'dmv-copy'))
assert.ok(copyButton, 'every row offers a copy button')
assert.equal(copyButton.props.title, '复制模型名')
assert.equal(render(copyButton.props.children), '', 'the idle icon is drawn in CSS, not as a font glyph')
assert.ok(copyButton.props['aria-label'].includes('Claude Haiku 5.5'), 'and says which name it copies')
await copyButton.props.onClick()
assert.equal(clipboard, 'Claude Haiku 5.5', 'it copies exactly the model name — the string the search matches')

console.log('client harness: 12 scenarios passed')