#!/usr/bin/env node
/**
 * Fills price gaps for models this DSH already serves but no mirror lists yet.
 *
 * The mirrors lag a few days on brand-new slugs, while OpenRouter's live
 * `/endpoints` route answers for them immediately. This tool reads the plugin's
 * own rank payload, takes every row without a price, and asks OpenRouter for
 * `/<vendor>/<slug>/endpoints`, writing the standard tier into `data/prices.json`
 * with `source: "openrouter"` so the runtime refresh keeps it current.
 *
 *   node tools/fill-gaps.mjs [baseUrl] [--dry]
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PRICES_FILE = path.join(ROOT, 'data', 'prices.json')
const DRY = process.argv.includes('--dry')
const BASE = process.argv.slice(2).find((arg) => arg.startsWith('http')) ?? 'http://127.0.0.1:52404'

/** Catalogue ids drop the vendor (`gpt-6.2-sol`); OpenRouter needs it back. */
const VENDOR_BY_PREFIX = [
  [/^(gpt|o\d|chatgpt)-/, 'openai'],
  [/^claude-/, 'anthropic'],
  [/^(gemini|gemma)-/, 'google'],
  [/^glm-/, 'z-ai'],
  [/^qwen/, 'qwen'],
  [/^kimi-/, 'moonshotai'],
  [/^hy\d/, 'tencent'],
  [/^step-/, 'stepfun'],
  [/^longcat-/, 'meituan'],
  [/^mimo-/, 'xiaomi'],
  [/^minimax-/, 'minimax'],
  [/^deepseek-/, 'deepseek'],
  [/^grok-/, 'x-ai'],
  [/^muse-/, 'meta'],
  [/^inkling/, 'thinkingmachines'],
  [/^ling-/, 'inclusionai'],
  [/^ernie-/, 'baidu'],
  [/^nova-/, 'amazon'],
  [/^solar-/, 'upstage'],
  [/^command-/, 'cohere'],
  [/^nemotron-/, 'nvidia'],
]

const asSlug = (id) => {
  const lower = String(id).toLowerCase()
  if (lower.includes('/')) return lower
  for (const [pattern, vendor] of VENDOR_BY_PREFIX) if (pattern.test(lower)) return `${vendor}/${lower}`
  return ''
}

/** Endpoint sets mix a standard tier with flex/priority variants; the median is the list price. */
function standardTier(endpoints) {
  const priced = endpoints
    .map((endpoint) => endpoint.pricing ?? {})
    .map((pricing) => ({ input: Number(pricing.prompt) * 1e6, output: Number(pricing.completion) * 1e6 }))
    .filter((price) => Number.isFinite(price.input) && Number.isFinite(price.output) && price.input > 0 && price.output > 0)
    .sort((a, b) => a.input - b.input)
  if (priced.length === 0) return undefined
  return priced[Math.floor((priced.length - 1) / 2)]
}

async function main() {
  const response = await fetch(`${BASE}/dsh-model-value/api/rank?limit=500`, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`rank: HTTP ${response.status}`)
  const payload = await response.json()
  const missing = payload.rows.filter((row) => row.price === null)
  console.log(`rows without a price: ${missing.length} (of ${payload.rows.length})`)

  const doc = JSON.parse(fs.readFileSync(PRICES_FILE, 'utf8'))
  const models = doc.models ?? {}
  const asOf = new Date().toISOString().slice(0, 10)
  let added = 0

  for (const row of missing) {
    const slug = asSlug(row.model)
    if (slug === '') {
      console.log(`  skip   ${row.model}  (no vendor guess)`)
      continue
    }
    let endpoints = []
    try {
      const probe = await fetch(`https://openrouter.ai/api/v1/models/${slug}/endpoints`, {
        headers: { 'user-agent': 'dsh-model-value fill-gaps' },
        signal: AbortSignal.timeout(20_000),
      })
      if (probe.ok) endpoints = (await probe.json()).data?.endpoints ?? []
    } catch (error) {
      console.log(`  error  ${slug}  ${error.message}`)
      continue
    }
    const price = standardTier(endpoints)
    if (price === undefined) {
      console.log(`  miss   ${slug}  (${endpoints.length} endpoints, no usable price)`)
      continue
    }
    const key = slug
    if (models[key] !== undefined) {
      console.log(`  have   ${key}`)
      continue
    }
    models[key] = {
      input: Math.round(price.input * 1e3) / 1e3,
      output: Math.round(price.output * 1e3) / 1e3,
      cacheRead: 0,
      source: 'openrouter',
      url: `https://openrouter.ai/${slug}`,
      asOf,
      note: 'USD per 1M tokens; OpenRouter route（按目录 id 补齐）',
    }
    added += 1
    console.log(`  add    ${key}  ${models[key].input} / ${models[key].output}  (${endpoints.length} endpoints)`)
  }

  if (added === 0) {
    console.log('nothing to add')
    return
  }
  if (DRY) {
    console.log(`dry run — ${added} rows not written`)
    return
  }
  doc.models = Object.fromEntries(Object.entries(models).sort(([a], [b]) => a.localeCompare(b)))
  fs.writeFileSync(PRICES_FILE, `${JSON.stringify(doc, null, 2)}\n`)
  console.log(`added ${added} price rows → ${path.relative(ROOT, PRICES_FILE)}`)
}

await main()
