/**
 * One-off generator for the market rows of `data/prices.json` and
 * `data/intelligence.json`.
 *
 * Sources (both dated, both keyed by the vendor's own model name):
 *   - https://aiapiindex.com/prices.json — CC BY 4.0, `generated 2026-09-25`,
 *     `asOf.llm 2026-09-24`, USD per 1M tokens standard list price, and
 *     `bench.aa` (Artificial Analysis Intelligence Index) on the same rows.
 *   - https://openrouter.ai/api/v1/models/<vendor>/<slug>/endpoints — the
 *     standard (non-flex, non-priority) tier, read 2026-11-17. Only used for
 *     models the first source does not carry.
 *
 * Run with the bundled Node: `node tools/seed-market.mjs`.
 */

import { readFileSync, writeFileSync } from 'node:fs'

const DIR = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

const AII = { source: 'aiapiindex', url: 'https://aiapiindex.com/prices.json', asOf: '2026-09-24' }
const OR = (slug) => ({
  source: 'openrouter',
  url: `https://openrouter.ai/api/v1/models/${slug}/endpoints`,
  asOf: '2026-11-17',
})

/**
 * `[key, input, output, cacheRead, iq, source]` — `iq` null when the source has
 * no score for that model, `cacheRead` null when the vendor charges no cached
 * input rate. `source` is `'aii'` (default) or `'or'` (OpenRouter verified).
 */
const ROWS = [
  // ---- OpenAI
  ['openai/gpt-6-sol', 2, 10, 0.2, 47.5],
  ['openai/gpt-6.1-sol', 2, 10, 0.1, null, 'or'],
  ['openai/gpt-6.1-terra', 1, 5, 0.05, null, 'or'],
  ['openai/gpt-5.6-terra', 2, 12, 0.2, 42.1],
  ['openai/gpt-5.5', 5, 30, 0.5, 38.4],
  ['openai/gpt-5.5-pro', 30, 180, null, null],
  ['openai/gpt-5.4', 2.5, 15, 0.25, 39],
  ['openai/gpt-5.4-pro', 30, 180, null, null],
  ['openai/gpt-5.4-mini', 0.75, 4.5, 0.075, 24.1],
  ['openai/gpt-5.4-nano', 0.2, 1.25, 0.02, 20.7],
  ['openai/gpt-5.3-codex', 1.75, 14, 0.175, 32.5],
  ['openai/gpt-4.1', 2, 8, 0.5, 12.7],
  ['openai/gpt-4.1-mini', 0.4, 1.6, 0.1, 10.2],
  ['openai/gpt-4.1-nano', 0.1, 0.4, 0.025, 7.8],
  ['openai/gpt-4o', 2.5, 10, 1.25, 9],
  ['openai/gpt-4o-mini', 0.15, 0.6, 0.075, 6.7],

  // ---- Anthropic
  ['anthropic/claude-fable-5.2', 8, 40, 0.2, null, 'or'],
  ['anthropic/claude-fable-5.1', 10, 50, 0.25, 53.4],
  ['anthropic/claude-opus-5.5', 4, 20, 0.2, 57.6],
  ['anthropic/claude-opus-5', 5, 25, 0.5, 50.8],
  ['anthropic/claude-fable-5', 10, 50, 1, 49.6],
  ['anthropic/claude-opus-4.8', 5, 25, 0.5, 41.8],
  ['anthropic/claude-sonnet-5', 2, 10, 0.2, 38.2],
  ['anthropic/claude-haiku-4.5', 1, 5, 0.1, null],
  ['anthropic/claude-opus-4.7', 5, 25, 0.5, 40.7],
  ['anthropic/claude-opus-4.6', 5, 25, 0.5, 31.9],
  ['anthropic/claude-sonnet-4.6', 3, 15, 0.3, 30.1],
  ['anthropic/claude-opus-4.5', 5, 25, 0.5, 29.1],
  ['anthropic/claude-sonnet-4.5', 3, 15, 0.3, null],

  // ---- Google
  ['google/gemini-4-carbon', 2, 10, 0.1, null, 'or'],
  ['google/gemini-4-hydrogen', 1.5, 7.5, 0.075, null, 'or'],
  ['google/gemini-4-argon', 2, 10, 0.1, null, 'or'],
  ['google/gemini-3.1-pro-preview', 2, 12, 0.2, 29.7],
  ['google/gemini-3.6-flash', 0.75, 3.75, 0.075, 34],
  ['google/gemini-3.5-flash', 1.5, 9, 0.15, 33.6],
  ['google/gemini-3.5-flash-lite', 0.3, 2.5, 0.03, 22.2],
  ['google/gemini-3.1-flash-lite', 0.25, 1.5, 0.025, 15.6],
  ['google/gemini-2.5-pro', 1.25, 10, 0.125, 16.1],
  ['google/gemini-2.5-flash', 0.3, 2.5, 0.03, 15.5],
  ['google/gemini-2.0-flash', 0.1, 0.4, 0.025, 8.9],
  ['google/gemini-2.0-flash-lite', 0.075, 0.3, null, 7.4],

  // ---- xAI
  ['x-ai/grok-4.3', 1.25, 2.5, 0.2, 24.9],
  ['x-ai/grok-build-0.1', 1, 2, 0.2, null],
  ['x-ai/grok-4.20', 1.25, 2.5, 0.2, null],

  // ---- Qwen
  ['qwen/qwen3.8-max', 2, 6, 0.25, 45.4],
  ['qwen/qwen4-max', 1.425, 4.275, 0.07125, null, 'or'],
  ['qwen/qwen3.7-plus', 0.4, 1.6, null, 25.2],
  ['qwen/qwen3.6-flash', 0.25, 1.5, null, null],

  // ---- Mistral
  ['mistralai/mistral-medium-3-5', 1.5, 7.5, null, 14.2],
  ['mistralai/mistral-large-3', 0.5, 1.5, null, 9.3],
  ['mistralai/magistral-medium', 2, 5, null, null],
  ['mistralai/codestral-25.08', 0.3, 0.9, null, null],
  ['mistralai/mistral-small-4', 0.15, 0.6, null, 11.3],

  // ---- Z.ai
  ['z-ai/glm-4.7', 0.6, 2.2, 0.11, 22.2],
  ['z-ai/glm-4.5-air', 0.2, 1.1, 0.03, 11.1],

  // ---- Baidu / Amazon / Cohere / Naver / Upstage / LG
  ['baidu/ernie-5.1', 0.59, 2.65, null, null],
  ['baidu/ernie-5.0', 0.6, 2.1, null, 14.3],
  ['amazon/nova-2-pro', 1.25, 10, 0.31, 14.2],
  ['amazon/nova-2-omni', 0.3, 2.5, null, 13.6],
  ['amazon/nova-2-lite', 0.3, 2.5, 0.075, 13.4],
  ['amazon/nova-micro', 0.035, 0.14, null, 5.9],
  ['cohere/command-a', 2.5, 10, null, 7],
  ['cohere/command-r7b', 0.0375, 0.15, null, null],
  ['naver/hyperclova-x-hcx-007', 0.84, 3.37, null, null],
  ['upstage/solar-pro-4', 0.3, 1.2, 0.06, 28.2],
  ['upstage/solar-pro-3', 0.15, 0.6, 0.015, 7.8],
  ['upstage/solar-pro-2', 0.15, 0.6, 0.015, 9.1],
  ['lg/k-exaone-236b', 0.2, 0.8, 0.1, null],

  // ---- Meta / NVIDIA / Tencent / Thinking Machines
  ['meta/muse-wonder', 4, 20, 0.2, null, 'or'],
  ['meta/muse-ember', 0.1, 0.5, 0.004, null, 'or'],
  ['meta/muse-spark-open', 1.25, 4.25, 0.15, null, 'or'],
  ['meta/muse-spark-1.2', 1.25, 4.25, 0.15, 39.6],
  ['meta/muse-spark-1.1', 1.25, 4.25, null, 33.7],
  ['nvidia/nemotron-3.5-super-vl', 0.15, 0.5, 0.02, null, 'or'],
  ['tencent/hy4', 0.417, 1.2505, 0.021, null, 'or'],
  ['thinkingmachines/inkling-2-small', 0.3, 1, 0.03, null, 'or'],
]

const PRICE_NOTE = 'USD per 1M tokens; standard list price'
const AII_SCORE_NOTE = 'aiapiindex.com 汇总的 Artificial Analysis Intelligence Index（CC BY 4.0）'

const pricesPath = `${DIR}/data/prices.json`
const scoresPath = `${DIR}/data/intelligence.json`
const prices = JSON.parse(readFileSync(pricesPath, 'utf8'))
const scores = JSON.parse(readFileSync(scoresPath, 'utf8'))

let addedPrices = 0
let addedScores = 0
for (const [key, input, output, cacheRead, iq, src] of ROWS) {
  if (prices.models[key] !== undefined) continue
  const origin = src === 'or' ? OR(key) : AII
  prices.models[key] = {
    input,
    output,
    ...(cacheRead === null ? {} : { cacheRead }),
    source: origin.source,
    url: origin.url,
    asOf: origin.asOf,
    note: PRICE_NOTE,
  }
  addedPrices += 1
  if (iq !== null && scores.scores[key] === undefined) {
    scores.scores[key] = {
      index: iq,
      url: src === 'or' ? origin.url : AII.url,
      asOf: AII.asOf,
      note: AII_SCORE_NOTE,
    }
    addedScores += 1
  }
}

const sortKeys = (object) =>
  Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)))

prices.models = sortKeys(prices.models)
scores.scores = sortKeys(scores.scores)
prices.asOf = '2026-11-17'
scores.asOf = '2026-11-17'

writeFileSync(pricesPath, `${JSON.stringify(prices, null, 2)}\n`, 'utf8')
writeFileSync(scoresPath, `${JSON.stringify(scores, null, 2)}\n`, 'utf8')

console.log(`prices: +${addedPrices} (${Object.keys(prices.models).length} total)`)
console.log(`scores: +${addedScores} (${Object.keys(scores.scores).length} total)`)
