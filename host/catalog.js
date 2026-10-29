/**
 * Read side of the plugin: the Magpie gateway catalog and the on-disk ledger.
 *
 * Nothing here writes anything. The gateway is queried with a short timeout so
 * a stopped Magpie shows as an explicit "offline" state instead of a hanging
 * panel, and the ledger is read with UTF-8 explicitly (Chinese account names).
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

/** Ledger files the panel reads; each is optional. */
const LEDGER_FILES = {
  quotas: 'quotas.json',
  creditDaily: 'credits-daily.json',
  quotaHistory: 'quota-history.json',
  providers: 'providers.json',
  pluginProviders: 'plugin-providers.json',
}

/**
 * Default ledger directory: `$MAGPIE_HOME`, else `%APPDATA%/magpie` on Windows
 * when it exists, else `~/.config/magpie`.
 */
export function defaultLedgerDir() {
  if (process.env.MAGPIE_HOME) return process.env.MAGPIE_HOME
  return join(homedir(), '.config', 'magpie')
}

async function readJson(path) {
  const text = await readFile(path, 'utf8')
  return JSON.parse(text)
}

/**
 * Read every ledger file; a missing or corrupt one is reported, not thrown.
 *
 * @param {string} dir - ledger directory.
 * @returns {Promise<{ data: object, errors: Array<{ file: string, message: string }> }>} parsed files.
 */
export async function readLedger(dir) {
  const data = {}
  const errors = []
  for (const [field, file] of Object.entries(LEDGER_FILES)) {
    try {
      data[field] = await readJson(join(dir, file))
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      errors.push({ file, message: error instanceof Error ? error.message : String(error) })
    }
  }
  return { data, errors }
}

/**
 * Per-route catalog read state shared by the HTTP route and the model tool.
 */
export class CatalogCache {
  constructor({ baseUrl, fetchImpl = globalThis.fetch, ttlMs = 10_000, timeoutMs = 2_500 }) {
    this.baseUrl = baseUrl
    this.fetchImpl = fetchImpl
    this.ttlMs = ttlMs
    this.timeoutMs = timeoutMs
    this.cached = undefined
    this.inflight = undefined
  }

  /** @returns {string} the catalog endpoint. */
  get url() {
    return `${this.baseUrl.replace(/\/+$/, '')}/v1/models`
  }

  /**
   * Read the gateway catalog, reusing a response younger than the TTL.
   *
   * @param {{ force?: boolean }} [options] - `force` bypasses the cache.
   * @returns {Promise<{ status: string, models?: Array<object>, error?: string, at?: string }>} catalog or failure.
   */
  async read(options = {}) {
    const now = Date.now()
    if (!options.force && this.cached !== undefined && now - this.cached.at < this.ttlMs) return this.cached.value
    if (this.inflight !== undefined) return this.inflight
    this.inflight = this.fetchCatalog().then((value) => {
      this.inflight = undefined
      if (value.status === 'ok') this.cached = { at: Date.now(), value }
      return value
    })
    return this.inflight
  }

  async fetchCatalog() {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(this.url, { signal: controller.signal, headers: { accept: 'application/json' } })
      if (!response.ok) return { status: 'error', error: `magpie gateway answered ${response.status}`, url: this.url }
      const body = await response.json()
      const rows = Array.isArray(body?.data) ? body.data : []
      return {
        status: 'ok',
        url: this.url,
        at: new Date().toISOString(),
        models: rows.filter(isObject).map(normalizeModel).filter((model) => typeof model.id === 'string'),
      }
    } catch (error) {
      const aborted = error?.name === 'AbortError'
      return {
        status: 'offline',
        url: this.url,
        error: aborted ? `magpie gateway did not answer within ${this.timeoutMs} ms` : error instanceof Error ? error.message : String(error),
      }
    } finally {
      clearTimeout(timer)
    }
  }
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Normalise one gateway model row into the fields the panel and the tool show.
 *
 * @param {object} row - one entry of `GET /v1/models` `data`.
 * @returns {object} `{ id, channel, name, label, contextWindow, maxOutput, reasoning, reasoningLevels, input, nativeEndpoints }`.
 */
export function normalizeModel(row) {
  const id = typeof row.id === 'string' ? row.id : ''
  const channel = typeof row.owned_by === 'string' && row.owned_by !== '' ? row.owned_by : id.split('/')[0]
  const levels = Array.isArray(row.reasoning_levels)
    ? row.reasoning_levels.filter((level) => typeof level === 'string')
    : []
  const inputs = Array.isArray(row.modalities?.input) ? row.modalities.input.filter((m) => typeof m === 'string') : []
  return {
    id,
    channel,
    name: typeof row.display_name === 'string' && row.display_name !== '' ? row.display_name : id,
    label: typeof row.magpie_label === 'string' ? row.magpie_label : undefined,
    contextWindow: numberOrUndefined(row.context_window ?? row.context_length),
    maxOutput: numberOrUndefined(row.max_output_tokens),
    reasoning: row.reasoning === true,
    reasoningLevels: levels,
    input: inputs,
    nativeEndpoints: Array.isArray(row.native_endpoints) ? row.native_endpoints.filter((e) => typeof e === 'string') : [],
  }
}

function numberOrUndefined(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
