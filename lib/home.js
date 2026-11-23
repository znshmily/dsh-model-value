/**
 * Where this plugin may write on the user's machine.
 *
 * Everything lives under `<DSH_HOME>/plugin-data/dsh-model-value/`, next to the
 * other plugins' data: the pinned-model list and the online price/score cache.
 * `DSH_HOME` wins when set (that is how a test or a second profile isolates
 * itself); otherwise it is `~/.dsh`, the same default the Host uses.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

export function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
  return join(homedir(), '.dsh')
}

/** `<DSH_HOME>/plugin-data/dsh-model-value/<name>` */
export function pluginDataFile(name) {
  return join(dshHome(), 'plugin-data', 'dsh-model-value', name)
}
