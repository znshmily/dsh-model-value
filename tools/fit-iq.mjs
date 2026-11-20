#!/usr/bin/env node
/**
 * Re-derives the HLE → Artificial Analysis index coefficients used by
 * `tools/sync-sources.mjs` (`IQ_FROM_HLE`).
 *
 * The newest models have no AA score, but aiapiindex measures many of them on
 * HLE, which correlates tightly with the index. The fit is quadratic because the
 * relation is not linear at the top of the range. Leave-one-out error is printed
 * so the "±5" claim in the generated notes stays honest.
 *
 *   node tools/fit-iq.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const squash = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
const tail = (key) => (key.includes('/') ? key.slice(key.lastIndexOf('/') + 1) : key)

const scores = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'intelligence.json'), 'utf8')).scores ?? {}
const response = await fetch('https://aiapiindex.com/prices.json', {
  headers: { 'user-agent': 'dsh-model-value fit-iq' },
  signal: AbortSignal.timeout(60_000),
})
if (!response.ok) throw new Error(`HTTP ${response.status}`)
const rows = (await response.json()).llm ?? []

/** Our own AA scores, keyed by the name form aiapiindex uses. */
const ours = new Map()
for (const [key, entry] of Object.entries(scores)) {
  if (entry?.estimated === true) continue
  ours.set(squash(tail(key)), Number(entry.index))
}

const pairs = []
for (const row of rows) {
  const bench = row.bench ?? {}
  if (typeof bench.hle !== 'number' || !Number.isFinite(bench.hle)) continue
  const known = ours.get(squash(row.name))
  if (known === undefined || !Number.isFinite(known)) continue
  pairs.push({ name: row.name, x: bench.hle, y: known })
}
if (pairs.length < 8) throw new Error(`only ${pairs.length} overlapping models — not enough to fit`)

/** Least squares for `y = a + b·x + c·x²` via the normal equations (Cramer's rule, 3×3). */
const features = (x) => [1, x, x * x]
const width = 3
const ata = Array.from({ length: width }, () => new Array(width).fill(0))
const aty = new Array(width).fill(0)
for (const { x, y } of pairs) {
  const f = features(x)
  for (let i = 0; i < width; i += 1) {
    aty[i] += f[i] * y
    for (let j = 0; j < width; j += 1) ata[i][j] += f[i] * f[j]
  }
}
const det3 = (m) =>
  m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
  m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
  m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
const det = det3(ata)
const beta = [0, 1, 2].map((column) => det3(ata.map((row, i) => row.map((v, j) => (j === column ? aty[i] : v)))) / det)
const predict = (x) => beta[0] + beta[1] * x + beta[2] * x * x

const resid = pairs.map(({ x, y }) => y - predict(x))
const mean = pairs.reduce((sum, pair) => sum + pair.y, 0) / pairs.length
const ssTot = pairs.reduce((sum, pair) => sum + (pair.y - mean) ** 2, 0)
const ssRes = resid.reduce((sum, r) => sum + r * r, 0)
/** Leave-one-out with a full refit keeps the printed error from flattering itself. */
const loo = pairs.map((_, skip) => {
  const kept = pairs.filter((__, i) => i !== skip)
  const a = Array.from({ length: width }, () => new Array(width).fill(0))
  const b = new Array(width).fill(0)
  for (const { x, y } of kept) {
    const f = features(x)
    for (let i = 0; i < width; i += 1) {
      b[i] += f[i] * y
      for (let j = 0; j < width; j += 1) a[i][j] += f[i] * f[j]
    }
  }
  const d = det3(a)
  const fit = [0, 1, 2].map((column) => det3(a.map((row, i) => row.map((v, j) => (j === column ? b[i] : v)))) / d)
  const { x, y } = pairs[skip]
  return y - (fit[0] + fit[1] * x + fit[2] * x * x)
})
const rms = (values) => Math.sqrt(values.reduce((sum, v) => sum + v * v, 0) / values.length)

console.log(`n=${pairs.length}  R2=${(1 - ssRes / ssTot).toFixed(3)}  rmse=${rms(resid).toFixed(2)}  loo=${rms(loo).toFixed(2)}`)
console.log(`IQ_FROM_HLE = { a: ${beta[0].toFixed(4)}, b: ${beta[1].toFixed(4)}, c: ${beta[2].toFixed(4)} }`)
for (const hle of [20, 30, 40, 50, 60]) console.log(`  HLE ${hle}% → ${predict(hle).toFixed(1)}`)
