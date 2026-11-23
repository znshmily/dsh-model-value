/**
 * Global pinned-model list for dsh-model-value.
 *
 * A small JSON file under `<DSH_HOME>/plugin-data/dsh-model-value/state.json`,
 * mirroring dsh-comate's state store: the user checks models in the ranking
 * panel, and the pins survive plugin reloads, page refreshes and browser
 * switches. Stored as canonical `row.key` strings (e.g.
 * `anthropic/claude-haiku-5.5`) rather than provider/model ids, so a pin keeps
 * working when the same model is re-exposed by a different provider.
 */

import { mkdirSync, readFileSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pluginDataFile } from './home.js'

/** Maximum number of pins — a safety cap, not a UI restriction. */
export const MAX_PINS = 100

function stateFile() {
  return pluginDataFile('state.json')
}

/**
 * Coerces an arbitrary value into a clean, de-duplicated, capped key array.
 * Pure function so the route and the store share exactly one validation path.
 * @param {unknown} value
 */
export function normalizePins(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const item of value) {
    if (typeof item !== 'string' || item === '') continue
    if (out.includes(item)) continue
    out.push(item)
    if (out.length >= MAX_PINS) break
  }
  return out
}

/** @returns {string[]} */
function readStateSync() {
  try {
    const parsed = JSON.parse(readFileSync(stateFile(), 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return []
    return normalizePins(parsed.pinnedKeys)
  } catch {
    return []
  }
}

/**
 * In-memory pins with serialized atomic writes, so overlapping toggle clicks
 * cannot interleave two snapshots. A read-only home degrades to memory-only.
 */
export class PinStore {
  /** @param {string[]} [initial] */
  constructor(initial = []) {
    this.keys = normalizePins(initial)
    this.path = stateFile()
    this.pending = Promise.resolve()
  }

  static open() {
    return new PinStore(readStateSync())
  }

  /** @returns {string[]} a copy, so callers cannot mutate the stored list. */
  get() {
    return [...this.keys]
  }

  /** @param {unknown} value @returns {string[]} */
  set(value) {
    this.keys = normalizePins(value)
    this.pending = this.pending.then(() => this.#flush()).catch(() => {})
    return this.get()
  }

  async #flush() {
    const target = this.path
    const body = `${JSON.stringify({ pinnedKeys: this.keys }, null, 2)}\n`
    try {
      mkdirSync(dirname(target), { recursive: true })
      const temporary = `${target}.${process.pid}.tmp`
      await writeFile(temporary, body, 'utf8')
      await rename(temporary, target)
    } catch {
      // A read-only home must not break ranking or model switching.
    }
  }
}

export function openPins() {
  return PinStore.open()
}
