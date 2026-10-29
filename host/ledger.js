/**
 * Magpie ledger readers.
 *
 * Magpie (the local LLM gateway on 127.0.0.1:3425) keeps a quota ledger in
 * `~/.config/magpie/` and rewrites it after every upstream call:
 *
 * - `quotas.json`          `{ "<provider>/<accountKey>": { at, quota, spans } }`
 * - `credit-daily.json` / `credits-daily.json` aggregated daily consumption
 * - `quota-history.json`   per-window sample series
 * - `providers.json`       channel display names / icons
 * - `plugin-providers.json` signed-in channel accounts (fallback only)
 *
 * Shapes differ per provider: some windows carry numeric `amount`/`limit`,
 * others only a human `display` string, and some channels report a free-form
 * `balance` line instead of windows. Everything here is defensive — a ledger
 * that a future Magpie version reshapes must degrade to "unknown", never throw
 * into the panel.
 */

const PROVIDER_LABELS = {
  zcode: 'ZCode',
  workbuddy: 'WorkBuddy',
  deepseek: 'DeepSeek',
  'qoder-cn': 'Qoder CN',
  qwenwork: 'QwenWork',
  'trae-cn': 'Trae CN',
  codearts: 'CodeArts',
  'minimax-code': 'MiniMax Code',
}

/** 即将过期 / about to expire markers Magpie appends to a window display line. */
const EXPIRING = /即将过期|\bexpiring\b/i

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * Windows under this many hours are rolling quotas that refill inside the day.
 * `zcode`'s 5-hour window is the reason this exists: its quota does not carry
 * over for longer than five hours, so an idle window is spent, not saved.
 */
export const ROLLING_WINDOW_MAX_HOURS = 24

/** `"5 hours"`, `"5h"`, `"5 小时"` → 5. Windows without a duration return undefined. */
export function parseWindowHours(name) {
  const match = /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h|小时|時|时)/i.exec(String(name ?? ''))
  if (match === null) return undefined
  const hours = Number(match[1])
  return Number.isFinite(hours) && hours > 0 ? hours : undefined
}

/**
 * Rolling windows expire faster than their `resetsAt` says, so they sort ahead
 * of everything else regardless of how much quota is left.
 * @returns {boolean} true for windows that refill within a day.
 */
export function isRollingWindow(window) {
  const hours = parseWindowHours(window?.name)
  return hours !== undefined && hours < ROLLING_WINDOW_MAX_HOURS
}

/**
 * Pull the `a / b` pair out of a display string such as
 * `"191 / 6600 · 97 即将过期"` or `"100 / 500 credits"`.
 *
 * Both halves are CREDITS, not percentages: the trailing `· 97 即将过期`
 * segment is a different unit and is read separately by `parseExpiringPercent`.
 *
 * @param {unknown} display - the human readable window line.
 * @returns {{ used: number, limit: number } | undefined} the pair, unless absent.
 */
export function parseDisplayAmounts(display) {
  if (typeof display !== 'string') return undefined
  const match = /(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)/.exec(display)
  if (match === null) return undefined
  const used = toNumber(match[1])
  const limit = toNumber(match[2])
  if (used === undefined || limit === undefined) return undefined
  return { used, limit }
}

/**
 * Read the trailing expiring percentage: the share of the window's REMAINING
 * credits that lapses at `runsOutAt`, e.g. the `97%` of
 * `"191 / 6600 · 97 即将过期"`.
 *
 * The figure is the vendor's own rounded integer, derived from the remaining
 * share — codearts' total pool reports 97 for `(6600-190.75)/6600 = 97.11%`
 * and its bonus pool the same 97 for `(6100-190.75)/6100 = 96.87%`. It is a
 * PERCENT, never a credit count (97 credits against a 6600 pool would not
 * track the remaining ratio). Only a trailing `· N 即将过期` segment counts, so
 * a window whose display merely mentions the words keeps `undefined`.
 *
 * @param {unknown} display - the human readable window line.
 * @returns {number | undefined} the percentage, clamped to 0-100.
 */
export function parseExpiringPercent(display) {
  if (typeof display !== 'string') return undefined
  const match = /·\s*(\d+(?:\.\d+)?)\s*(?:%|％)?\s*(?:即将过期|expiring)\s*$/i.exec(display.trim())
  if (match === null) return undefined
  const value = toNumber(match[1])
  return value === undefined ? undefined : clampPercent(value)
}

/**
 * Normalise one quota window into the numbers the panel renders.
 * * Field semantics, settled against Magpie's own source
 * (`~/.config/magpie/plugins/node_modules/@magpie-community/opencode-codearts-auth/index.mjs`):
 *
 * ```js
 * const used = Math.max(0, limit - remain)          // :2188
 * used: clamp(limit > 0 ? (used / limit) * 100 : 0) // :2191
 * display: `${formatCredit(used)} / ${formatCredit(limit)}…`, amount: used // :2192-2193
 * ```
 *
 * So `amount` is the CONSUMED amount — `remaining = limit - amount` — and the
 * percentage is `amount / limit * 100`. Reading `amount` as the remaining
 * figure inverts every window (live minimax 3423.05: 68% used, not 68% left).
 * A window that carries only `display` uses its first half as the consumed
 * amount. `expiring` is the trailing share from `parseExpiringPercent`, and
 * stays `undefined` when Magpie did not report one — unknown, never "none".
 *
 * @param {object} window - one entry of `quota.windows`.
 * @returns {object} `{ name, used, usedAmount, remaining, limit, unit, display, expiringPercent, resetsAt, windowHours, rolling }`.
 */
export function normaliseWindow(window) {
  const name = typeof window?.name === 'string' && window.name !== '' ? window.name : 'window'
  const display = typeof window?.display === 'string' ? window.display : undefined
  const parsed = parseDisplayAmounts(display)
  const limit = toNumber(window?.limit) ?? parsed?.limit
  const amount = toNumber(window?.amount) ?? parsed?.used
  const unit = typeof window?.unit === 'string' ? window.unit : undefined

  let percent
  if (amount !== undefined && limit !== undefined && limit > 0) percent = clampPercent((amount / limit) * 100)
  else {
    const reported = toNumber(window?.used)
    if (reported !== undefined) percent = clampPercent(reported)
  }

  const remaining = amount !== undefined && limit !== undefined && limit >= 0 ? Math.max(0, limit - amount) : undefined
  const windowHours = parseWindowHours(name)
  const rolling = windowHours !== undefined && windowHours < ROLLING_WINDOW_MAX_HOURS

  return {
    name,
    used: percent,
    usedAmount: amount,
    remaining,
    limit,
    unit,
    display: display ?? (amount !== undefined && limit !== undefined ? `${formatAmount(amount)} / ${formatAmount(limit)}${unit ? ` ${unit}` : ''}` : undefined),
    expiringPercent: parseExpiringPercent(display),
    resetsAt: typeof window?.resetsAt === 'string' ? window.resetsAt : undefined,
    windowHours,
    rolling,
  }
}

function clampPercent(value) {
  return Math.min(100, Math.max(0, value))
}

function formatAmount(value) {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100)
}

/**
 * Split a ledger key `<provider>/<accountKey>`.
 *
 * `quotas.json` and `quota-history.json` use `/`; `credits-daily.json` uses `|`.
 * Account keys may themselves contain `/` (API keys) and `:` (`iam::…`), so
 * only the first segment is the provider.
 *
 * @param {string} key - the raw ledger key.
 * @returns {{ provider: string, account: string }} the split halves.
 */
export function splitLedgerKey(key) {
  const slashes = key.indexOf('/')
  const pipes = key.indexOf('|')
  let cut = -1
  if (slashes >= 0 && pipes >= 0) cut = Math.min(slashes, pipes)
  else cut = Math.max(slashes, pipes)
  if (cut < 0) return { provider: key, account: '' }
  return { provider: key.slice(0, cut), account: key.slice(cut + 1) }
}

/**
 * Collect one channel from every ledger the panel reads.
 *
 * @param {object} input - raw parsed ledger files (any of them may be missing).
 * @param {string} provider - the channel id (`zcode`, `deepseek`, …).
 * @param {object} [options] - `labels` maps provider → display name.
 * @returns {object} the channel projection used by the panel and the tool.
 */
export function projectChannel(input, provider, options = {}) {
  const quotas = isObject(input.quotas) ? input.quotas : {}
  const accounts = []
  for (const [key, entry] of Object.entries(quotas)) {
    const split = splitLedgerKey(key)
    if (split.provider !== provider || !isObject(entry)) continue
    const quota = isObject(entry.quota) ? entry.quota : {}
    const windows = Array.isArray(quota.windows) ? quota.windows.filter(isObject) : []
    accounts.push({
      key,
      account: split.account,
      user: typeof quota.user === 'string' ? quota.user : undefined,
      plan: typeof quota.plan === 'string' ? quota.plan : undefined,
      balance: typeof quota.balance === 'string' ? quota.balance : undefined,
      readAt: typeof quota.readAt === 'string' ? quota.readAt : (typeof entry.at === 'string' ? entry.at : undefined),
      until: typeof quota.until === 'string' ? quota.until : undefined,
      renew: typeof quota.renew === 'string' ? quota.renew : undefined,
      windows: windows.map(normaliseWindow),
      resets: isObject(quota.resets) ? quota.resets : undefined,
    })
  }

  const daily = []
  const creditDaily = isObject(input.creditDaily) ? input.creditDaily : {}
  for (const [key, entry] of Object.entries(creditDaily)) {
    const { provider: owner, account } = splitLedgerKey(key)
    if (owner !== provider || !isObject(entry)) continue
    const days = isObject(entry.days) ? entry.days : {}
    const ordered = Object.entries(days)
      .map(([day, value]) => [day, toNumber(value)])
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    const last = isObject(entry.last) ? entry.last : {}
    daily.push({
      account,
      since: typeof entry.since === 'string' ? entry.since : undefined,
      last: {
        used: toNumber(last.used),
        total: toNumber(last.total),
        at: typeof last.at === 'string' ? last.at : undefined,
      },
      days: ordered.map(([day, value]) => ({ day, used: value })),
    })
  }

  const history = []
  const quotaHistory = isObject(input.quotaHistory) ? input.quotaHistory : {}
  for (const [key, entry] of Object.entries(quotaHistory)) {
    const split = splitLedgerKey(key)
    if (split.provider !== provider || !isObject(entry)) continue
    for (const [windowName, samples] of Object.entries(entry)) {
      if (!Array.isArray(samples) || samples.length === 0) continue
      const last = samples[samples.length - 1]
      history.push({
        key,
        window: windowName,
        samples: samples.length,
        last: isObject(last) ? { at: last.at, left: toNumber(last.left) } : undefined,
      })
    }
  }

  const labels = isObject(options.labels) ? options.labels : PROVIDER_LABELS
  const accountsListed = accounts.flatMap((account) => account.windows)

  return {
    id: provider,
    name: labels[provider] ?? provider,
    accounts: accounts.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    daily: daily.sort((a, b) => (a.account < b.account ? -1 : 1)),
    history: history.sort((a, b) => (a.window < b.window ? -1 : a.window > b.window ? 1 : 0)),
    windowCount: accountsListed.length,
    readAt: accounts.map((account) => account.readAt).filter(Boolean).sort().pop(),
  }
}

/** Highest freshness across channels, for the panel header. */
export function latestReadAt(channels) {
  let best
  for (const channel of channels) {
    if (typeof channel.readAt === 'string' && (best === undefined || channel.readAt > best)) best = channel.readAt
  }
  return best
}

/**
 * Display names for channels: `providers.json` first, then the built-in map.
 *
 * @param {object} providers - parsed `providers.json`.
 * @returns {Record<string, string>} provider id → label.
 */
export function labelsFromProviders(providers) {
  const labels = { ...PROVIDER_LABELS }
  const list = Array.isArray(providers?.providers) ? providers.providers : []
  for (const entry of list) {
    if (!isObject(entry) || typeof entry.id !== 'string' || typeof entry.name !== 'string') continue
    if (entry.name !== '') labels[entry.id] = entry.name
  }
  return labels
}

/**
 * Channels seen in the gateway model catalog: `owned_by` is the channel id.
 *
 * @param {Array<object>} models - normalized models from the gateway.
 * @returns {Array<{ id: string, models: number }>} channel ids with model counts.
 */
export function channelsFromModels(models) {
  const counts = new Map()
  for (const model of models) {
    const id = model.channel
    if (typeof id !== 'string' || id === '') continue
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return [...counts].map(([id, models]) => ({ id, models })).sort((a, b) => (a.id < b.id ? -1 : 1))
}

/**
 * Merge the three sources of "which channels exist": the gateway catalog, the
 * quota ledger and the signed-in accounts in `plugin-providers.json`.
 *
 * The gateway catalog is authoritative for a channel's model list; a channel
 * present only in the ledger still shows up so its balance stays visible.
 *
 * @param {object} input - `{ models, quotas, pluginProviders, labels }`.
 * @returns {Array<object>} channel projections in catalog order, then ledger-only channels.
 */
export function buildReport(input) {
  const models = Array.isArray(input.models) ? input.models : []
  const fromModels = channelsFromModels(models)
  const quotas = isObject(input.quotas) ? input.quotas : {}
  const ledgerProviders = new Map()
  for (const key of Object.keys(quotas)) {
    const { provider } = splitLedgerKey(key)
    ledgerProviders.set(provider, (ledgerProviders.get(provider) ?? 0) + 1)
  }

  // A channel can have daily credit usage and no windowed quota at all (Magpie
  // records those under `credits-daily.json`), so that ledger also names channels.
  const dailyProviders = new Set()
  for (const key of Object.keys(isObject(input.creditDaily) ? input.creditDaily : {})) {
    dailyProviders.add(splitLedgerKey(key).provider)
  }

  const signedIn = new Set()
  const pluginProviders = Array.isArray(input.pluginProviders) ? input.pluginProviders : []
  for (const entry of pluginProviders) {
    if (isObject(entry) && entry.signedIn === true && typeof entry.id === 'string') signedIn.add(entry.id)
  }

  const ids = new Set([...fromModels.map((entry) => entry.id), ...ledgerProviders.keys(), ...dailyProviders])
  const labels = isObject(input.labels) ? input.labels : PROVIDER_LABELS
  const channels = []
  for (const id of ids) {
    const catalog = models.filter((model) => model.channel === id)
    const channel = projectChannel({ ...input, models }, id, { labels })
    channels.push({
      ...channel,
      modelCount: catalog.length,
      models: catalog.map((model) => model.id),
      signedIn: signedIn.has(id),
      accountCount: ledgerProviders.get(id) ?? 0,
    })
  }
  // Channels that the gateway serves come first (they are usable right now),
  // then ledger-only channels, each group in stable id order.
  return channels.sort((a, b) => {
    const byModels = Number(b.modelCount > 0) - Number(a.modelCount > 0)
    if (byModels !== 0) return byModels
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}
