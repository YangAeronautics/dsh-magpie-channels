/**
 * Build the model-facing value of the `magpie_channels` tool.
 *
 * The Harness snapshots a tool's return value with a strict lossless-JSON walk
 * (`isJsonValue` in `@deepseek-ai/dsh-util-values`): an own enumerable key whose
 * value is `undefined` fails that walk exactly like a sparse array or `-0`
 * does, and the tool then fails with `returned invalid output: value is not
 * lossless JSON`. The panel report is built from optional fields and therefore
 * carries plenty of `undefined`, so the tool value is built field by field here
 * and every optional field is omitted instead of set to `undefined`.
 *
 * Field order is fixed by construction, which keeps the model's view stable
 * between calls and keeps the snapshot and the render in agreement.
 */

import { parseDisplayAmounts } from './ledger.js'

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)
}

function round2(value) {
  return Math.round(value * 100) / 100
}

function text(value) {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Assign `key` only when the value survives the lossless-JSON walk. */
function put(target, key, value) {
  if (value === undefined) return
  target[key] = value
}

/**
 * Condense a free-form balance line such as
 * `"2100 credits (daily 100 · long-term 2000)"` to `2100 credits long-term 2000`.
 *
 * @param {unknown} balance - the ledger balance line.
 * @returns {string | undefined} the condensed line, or the balance unchanged when it holds no long term.
 */
export function condenseBalance(balance) {
  const source = text(balance)
  if (source === undefined) return undefined
  const parenthesised = /^(.*?)\s*\(\s*daily\s+[0-9.]+\s*[·•,，]\s*long-term\s+([0-9.]+)\s*\)\s*$/i.exec(source.trim())
  if (parenthesised !== null) return `${parenthesised[1]} long-term ${parenthesised[2]}`
  const comma = /^(.*?\s+)[0-9.]+\s*[·•,，]\s*([0-9.]+)$/i.exec(source.trim())
  return comma === null ? source : `${comma[1]}long-term ${comma[2]}`
}

/**
 * Project the reusable `"a / b[ unit]"` line of a quota window.
 *
 * @param {string} display - the window's human readable line.
 * @returns {string | undefined} `"191 / 6600 credits"`.
 */
function splitDisplay(display) {
  const source = text(display)
  const amounts = parseDisplayAmounts(source)
  if (source === undefined || amounts === undefined) return undefined
  const tail = source
    .replace(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/, '')
    .replace(/^[\s·]+|[\s·]+$/g, '')
    .split(/[·(（]/)[0]
    .trim()
  return `${amounts.used} / ${amounts.limit}${tail === '' ? '' : ` ${tail}`}`
}

function expiresWithinDays(resetsAt, days, now) {
  const when = Date.parse(resetsAt)
  if (!Number.isFinite(when)) return false
  const delta = when - now
  return delta > 0 && delta <= days * 86_400_000
}

/**
 * One quota window.
 *
 * @param {object} entry - a window already normalised by `normaliseWindow`.
 * @param {number} now - clock used for the "expires soon" test.
 * @returns {object} `{ name, used?, remaining?, limit?, unit?, percent?, display?, expiringPercent?, resetsAt? }`.
 */
function toolWindow(entry, now) {
  const window = {}
  // Credit amounts are decimal in the vendor API, so `limit - amount` lands on
  // float tails (`5024 - 3423.05` → 1600.9499999999998). Two decimals is the
  // ledger's own precision.
  put(window, 'name', text(entry?.name))
  put(window, 'used', finite(entry?.usedAmount) ? round2(entry.usedAmount) : undefined)
  put(window, 'remaining', finite(entry?.remaining) ? round2(entry.remaining) : undefined)
  put(window, 'limit', finite(entry?.limit) ? entry.limit : undefined)
  put(window, 'unit', text(entry?.unit))
  put(window, 'percent', finite(entry?.used) ? Math.round(entry.used * 10) / 10 : undefined)
  put(window, 'display', splitDisplay(entry?.display))
  put(window, 'expiringPercent', finite(entry?.expiringPercent) ? entry.expiringPercent : undefined)
  put(window, 'resetsAt', text(entry?.resetsAt))
  // A rolling window refills inside the day, so its unused quota is spent rather
  // than banked: the plan has to schedule it, not wait for it.
  put(window, 'windowHours', finite(entry?.windowHours) ? entry.windowHours : undefined)
  if (entry?.rolling === true) put(window, 'rolling', true)
  return window
}

function toolResets(resets) {
  if (!isObject(resets)) return undefined
  const projection = {}
  put(projection, 'until', text(resets.until))
  put(projection, 'weekly', text(resets.weekly))
  return Object.keys(projection).length > 0 ? projection : undefined
}

/**
 * Number of extra ledger accounts beyond the one shown in full.
 * @param {Array<object>} accounts - the channel's ledger accounts.
 */
function extraAccounts(accounts) {
  return Array.isArray(accounts) ? Math.max(0, accounts.length - 1) : 0
}

/**
 * One channel: what it serves, what is left, and freshness.
 *
 * @param {object} channel - a channel projection from `buildReport`.
 * @param {{ modelsOnly?: boolean, now: number }} options - projection switches.
 * @returns {object} the JSON-safe channel value.
 */
export function channelValue(channel, { modelsOnly = false, now = Date.now() } = {}) {
  const value = {}
  put(value, 'id', text(channel?.id) ?? '?')
  put(value, 'name', text(channel?.name) ?? text(channel?.id) ?? '?')
  const models = Array.isArray(channel?.models) ? channel.models.filter((entry) => typeof entry === 'string') : []
  value.models = models
  if (modelsOnly || channel?.id === undefined) {
    put(value, 'ledgerAccounts', extraAccounts(channel?.accounts))
    return value
  }

  const accounts = Array.isArray(channel.accounts) ? channel.accounts : []
  put(value, 'signedIn', channel.signedIn === true)
  put(value, 'ledgerAccounts', accounts.length)
  const account = accounts[0]
  if (isObject(account)) {
    put(value, 'account', text(account.account))
    put(value, 'user', text(account.user))
    put(value, 'plan', text(account.plan))
    put(value, 'balance', condenseBalance(account.balance))
    put(value, 'until', text(account.until))
    put(value, 'renew', text(account.renew))
    const windows = Array.isArray(account.windows) ? account.windows.map((entry) => toolWindow(entry, now)) : []
    if (windows.length > 0) value.windows = windows
    put(value, 'resets', toolResets(account.resets))
    put(value, 'readAt', text(account.readAt) ?? text(channel.readAt))
  }

  const daily = []
  for (const entry of Array.isArray(channel.daily) ? channel.daily : []) {
    if (!isObject(entry)) continue
    const day = {}
    put(day, 'account', text(entry.account))
    const last = isObject(entry.last) ? entry.last : {}
    const used = finite(last.used) ? last.used : undefined
    const total = finite(last.total) ? last.total : undefined
    put(day, 'used', used)
    put(day, 'total', total)
    put(day, 'remaining', used !== undefined && total !== undefined ? Math.max(0, Math.round((total - used) * 100) / 100) : undefined)
    put(day, 'at', text(last.at))
    const days = []
    for (const sample of Array.isArray(entry.days) ? entry.days : []) {
      if (!isObject(sample) || typeof sample.day !== 'string' || !finite(sample.used)) continue
      days.push([sample.day, sample.used])
    }
    if (days.length > 0) day.recentDaily = days.slice(-3)
    daily.push(day)
  }
  if (daily.length > 0) value.daily = daily

  const history = []
  for (const entry of Array.isArray(channel.history) ? channel.history : []) {
    if (!isObject(entry) || typeof entry.window !== 'string') continue
    const sample = {}
    sample.window = entry.window
    put(sample, 'samples', finite(entry.samples) ? entry.samples : undefined)
    const last = isObject(entry.last) ? entry.last : {}
    put(sample, 'lastLeft', finite(last.left) ? last.left : undefined)
    put(sample, 'lastAt', text(last.at))
    history.push(sample)
  }
  if (history.length > 0) value.history = history
  return value
}

/**
 * The whole tool value.
 *
 * @param {object} report - `collectReport()` output; note `report.catalog.models`
 *   is a COUNT there, while a channel's `models` is the id list.
 * @param {{ channel?: string, modelsOnly?: boolean, now?: number }} options - request switches.
 * @returns {object} `{ generatedAt, catalog, ledgerDir, channels }` containing only lossless JSON.
 */
export function toolValue(report, { channel, modelsOnly = false, now = Date.now() } = {}) {
  const catalogModels = typeof report?.catalog?.models === 'number' && Number.isInteger(report.catalog.models) && report.catalog.models >= 0
    ? report.catalog.models
    : 0
  const value = {}
  put(value, 'generatedAt', text(report?.generatedAt))
  value.catalog = {}
  put(value.catalog, 'status', text(report?.catalog?.status) ?? 'unknown')
  put(value.catalog, 'url', text(report?.catalog?.url))
  value.catalog.models = catalogModels
  put(value.catalog, 'error', text(report?.catalog?.error))
  put(value, 'ledgerDir', text(report?.ledger?.dir))
  const ledgerErrors = []
  for (const entry of Array.isArray(report?.ledger?.errors) ? report.ledger.errors : []) {
    if (!isObject(entry) || typeof entry.file !== 'string') continue
    ledgerErrors.push({ file: entry.file, message: typeof entry.message === 'string' ? entry.message : '' })
  }
  if (ledgerErrors.length > 0) value.ledgerErrors = ledgerErrors
  const channels = Array.isArray(report?.channels) ? report.channels : []
  value.channels = (channel === undefined ? channels : channels.filter((entry) => entry.id === channel))
    .map((entry) => channelValue(entry, { modelsOnly, now }))
  return value
}
