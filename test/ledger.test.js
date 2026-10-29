/**
 * Ledger projection tests. Fixtures are trimmed copies of the real Magpie
 * ledger shapes (see ~/.config/magpie/*.json), so a projection regression
 * shows up here before it reaches the panel.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  parseDisplayAmounts,
  parseExpiringPercent,
  parseWindowHours,
  isRollingWindow,
  normaliseWindow,
  splitLedgerKey,
  projectChannel,
  buildReport,
  labelsFromProviders,
  latestReadAt,
} from '../host/ledger.js'

const QUOTAS = {
  'codearts/iam::6d0a:user:user-000000000': {
    at: '2026-10-29T09:46:01+08:00',
    quota: {
      provider: 'codearts',
      name: 'CodeArts',
      plan: '体验版',
      user: 'user-000000000',
      windows: [
        { name: '总积分', used: 2.890151515151515, resetsAt: '2026-11-26T16:00:00Z', display: '191 / 6600 · 97 即将过期', amount: 190.75, limit: 6600, unit: 'credits' },
        { name: '基础积分包', used: 0, resetsAt: '2026-11-26T16:00:00Z', display: '0 / 500', limit: 500, unit: 'credits' },
        { name: '赠送积分包', used: 3.127049180327869, display: '191 / 6100 · 97 即将过期', amount: 190.75, limit: 6100, unit: 'credits' },
      ],
      readAt: '2026-10-29T09:46:01+08:00',
    },
  },
  'deepseek/balance 020b': {
    at: '2026-10-29T09:46:01+08:00',
    quota: { provider: 'deepseek', name: 'DeepSeek', windows: [], balance: '¥891.45', readAt: '2026-10-29T09:46:01+08:00' },
  },
  'qoder-cn/01a1': {
    at: '2026-10-27T22:38:19+08:00',
    quota: {
      provider: 'qoder-cn',
      name: 'Qoder CN',
      plan: 'personal_professional_trial',
      windows: [
        { name: 'Credits', used: 100, display: '300 / 300 credits' },
        { name: 'Add-on credits', used: 20, display: '100 / 500 credits' },
      ],
      until: '2026-11-06T08:27:59Z',
      readAt: '2026-10-27T22:38:19+08:00',
    },
  },
  'zcode/jhoxsnyg': {
    at: '2026-10-29T09:46:01+08:00',
    quota: {
      provider: 'zcode',
      name: 'ZCode',
      plan: 'GLM Coding Lite',
      user: 'jhoxsnyg',
      windows: [
        { name: '5 hours', used: 0, display: '0 / 2000', limit: 2000 },
        { name: 'Weekly', used: 20.03, resetsAt: '2026-11-04T10:03:22Z', display: '2003 / 10000', amount: 2003, limit: 10000 },
      ],
      resets: { count: 3, weekly: 3 },
      readAt: '2026-10-29T09:46:01+08:00',
    },
  },
}

const CREDIT_DAILY = {
  'workbuddy|杨·鹪鹩一枝': {
    since: '2026-10-26',
    last: { used: 6061.63, total: 6300, at: '2026-10-29T07:30:55+08:00' },
    days: { '2026-10-29': 10.42, '2026-10-26': 937.53, '2026-10-27': 37.52 },
  },
}

const QUOTA_HISTORY = {
  'zcode|jhoxsnyg': { Weekly: [{ at: '2026-10-28T00:00:00Z', left: 2500 }, { at: '2026-10-29T00:00:00Z', left: 2003 }] },
  'deepseek|balance 020b': {},
}

test('parseDisplayAmounts reads the used / limit pair past decorations', () => {
  assert.deepEqual(parseDisplayAmounts('191 / 6600 · 97 即将过期'), { used: 191, limit: 6600 })
  assert.deepEqual(parseDisplayAmounts('100 / 500 credits'), { used: 100, limit: 500 })
  assert.equal(parseDisplayAmounts('no numbers here'), undefined)
  assert.equal(parseDisplayAmounts(undefined), undefined)
})

test('parseExpiringPercent reads only the trailing expiring share, as a percentage', () => {
  // The two live codearts pools both print 97 while their remaining shares are
  // 97.11% and 96.87% — the figure tracks the remaining ratio and is rounded,
  // so it is a percent and never a credit count.
  assert.equal(parseExpiringPercent('191 / 6600 · 97 即将过期'), 97)
  assert.equal(parseExpiringPercent('191 / 6100 · 97 即将过期'), 97)
  assert.equal(parseExpiringPercent('191 / 6600 · 97% 即将过期'), 97)
  // No trailing segment: unknown, not "nothing expiring".
  assert.equal(parseExpiringPercent('0 / 500'), undefined)
  assert.equal(parseExpiringPercent('2003 / 10000'), undefined)
  assert.equal(parseExpiringPercent('97 即将过期'), undefined)
  assert.equal(parseExpiringPercent(undefined), undefined)
})

test('normaliseWindow treats amount as the consumed amount, so remaining is limit - amount', () => {
  const raw = QUOTAS['codearts/iam::6d0a:user:user-000000000'].quota.windows[0]
  const window = normaliseWindow(raw)
  assert.equal(window.name, '总积分')
  assert.equal(window.usedAmount, 190.75)
  assert.equal(window.limit, 6600)
  assert.equal(window.remaining, 6409.25)
  // 190.75 / 6600 = 2.890151515…, the ledger's own `used`.
  assert.ok(Math.abs(window.used - 2.890151515151515) < 1e-9)
  assert.equal(window.expiringPercent, 97)
  assert.equal(window.resetsAt, '2026-11-26T16:00:00Z')
})

test('a bonus pool with the same consumed amount keeps its own remaining total', () => {
  const window = normaliseWindow(QUOTAS['codearts/iam::6d0a:user:user-000000000'].quota.windows[2])
  assert.equal(window.limit, 6100)
  assert.equal(window.usedAmount, 190.75)
  assert.equal(window.remaining, 5909.25)
  assert.ok(Math.abs(window.used - 3.127049180327869) < 1e-9)
  assert.equal(window.expiringPercent, 97)
})

test('live zcode and minimax windows report their consumed share, not their left share', () => {
  const weekly = normaliseWindow({ name: 'Weekly', used: 20.03, display: '2003 / 10000', amount: 2003, limit: 10000 })
  assert.equal(weekly.remaining, 7997)
  assert.ok(Math.abs(weekly.used - 20.03) < 1e-9)
  assert.equal(weekly.expiringPercent, undefined)

  const credits = normaliseWindow({ name: 'Credits', used: 68.13395700636943, amount: 3423.05, limit: 5024, display: '3423.05 / 5024' })
  assert.ok(Math.abs(credits.remaining - 1600.95) < 1e-6)
  assert.ok(Math.abs(credits.used - 68.13395700636943) < 1e-9)
})

test('an untouched window with used 0 keeps its whole limit', () => {
  // Live zcode shape: `{ name: "5 hours", used: 0, display: "0 / 2000", limit: 2000 }`.
  const fresh = normaliseWindow({ name: '5 hours', used: 0, display: '0 / 2000', limit: 2000 })
  assert.equal(fresh.used, 0)
  assert.equal(fresh.usedAmount, 0)
  assert.equal(fresh.remaining, 2000)
  assert.equal(fresh.limit, 2000)
  assert.equal(fresh.expiringPercent, undefined)
})

test('normaliseWindow reads the display halves when no numeric fields exist', () => {
  const qoder = normaliseWindow({ name: 'Credits', display: '300 / 300 credits' })
  assert.equal(qoder.usedAmount, 300)
  assert.equal(qoder.remaining, 0)
  assert.equal(qoder.limit, 300)
  assert.equal(qoder.used, 100)
  assert.equal(qoder.display, '300 / 300 credits')

  const added = normaliseWindow({ name: 'Add-on credits', display: '100 / 600 credits' })
  assert.equal(added.usedAmount, 100)
  assert.equal(added.remaining, 500)
  assert.equal(added.limit, 600)
  assert.ok(Math.abs(added.used - 100 / 6) < 1e-9)
})

test('normaliseWindow uses a provider percent when no numbers exist at all', () => {
  const window = normaliseWindow({ name: '5 hours', used: 12.5, display: 'busy' })
  assert.equal(window.used, 12.5)
  assert.equal(window.remaining, undefined)
  assert.equal(window.display, 'busy')
})

test('splitLedgerKey splits on the first separator, whichever the ledger uses', () => {
  assert.deepEqual(splitLedgerKey('zcode/jhoxsnyg'), { provider: 'zcode', account: 'jhoxsnyg' })
  assert.deepEqual(splitLedgerKey('workbuddy|杨·鹪鹩一枝'), { provider: 'workbuddy', account: '杨·鹪鹩一枝' })
  assert.deepEqual(splitLedgerKey('iam::6d0a:user:user-000000000'), { provider: 'iam::6d0a:user:user-000000000', account: '' })
  assert.deepEqual(splitLedgerKey('codearts/iam::6d0a:user:user-000000000'), { provider: 'codearts', account: 'iam::6d0a:user:user-000000000' })
})

test('projectChannel collects accounts, daily consumption and history per channel', () => {
  const zcode = projectChannel({ quotas: QUOTAS, creditDaily: CREDIT_DAILY, quotaHistory: QUOTA_HISTORY }, 'zcode')
  assert.equal(zcode.id, 'zcode')
  assert.equal(zcode.name, 'ZCode')
  assert.equal(zcode.accounts.length, 1)
  assert.equal(zcode.accounts[0].plan, 'GLM Coding Lite')
  assert.equal(zcode.windowCount, 2)
  assert.deepEqual(zcode.accounts[0].resets, { count: 3, weekly: 3 })
  assert.equal(zcode.history.length, 1)
  assert.equal(zcode.history[0].window, 'Weekly')
  assert.equal(zcode.history[0].samples, 2)
  assert.equal(zcode.history[0].last.left, 2003)

  const workbuddy = projectChannel({ quotas: QUOTAS, creditDaily: CREDIT_DAILY }, 'workbuddy')
  assert.equal(workbuddy.accounts.length, 0)
  assert.equal(workbuddy.daily.length, 1)
  assert.equal(workbuddy.daily[0].last.used, 6061.63)
  assert.deepEqual(workbuddy.daily[0].days.map((entry) => entry.day), ['2026-10-26', '2026-10-27', '2026-10-29'])
})

test('projectChannel tolerates a missing or reshaped ledger', () => {
  const empty = projectChannel({}, 'deepseek')
  assert.deepEqual(empty.accounts, [])
  assert.deepEqual(empty.daily, [])
  assert.equal(empty.readAt, undefined)
  const malformed = projectChannel({ quotas: { 'deepseek/x': { quota: 'not-an-object' } } }, 'deepseek')
  assert.equal(malformed.accounts.length, 1)
  assert.deepEqual(malformed.accounts[0].windows, [])
})

test('labelsFromProviders lets providers.json override built-in names', () => {
  const labels = labelsFromProviders({ providers: [{ id: 'zcode', name: '智谱 ZCode' }, { id: 'workbuddy', name: '' }] })
  assert.equal(labels.zcode, '智谱 ZCode')
  assert.equal(labels.workbuddy, 'WorkBuddy')
  assert.equal(labels['qoder-cn'], 'Qoder CN')
})

test('buildReport merges catalog models with the ledger and orders served channels first', () => {
  const models = [
    { id: 'zcode/GLM-5.3', channel: 'zcode' },
    { id: 'auto/GLM-5.3-Flash', channel: 'zcode' },
    { id: 'deepseek/deepseek-flash', channel: 'deepseek' },
    { id: 'trae-cn/kimi-k2.6', channel: 'trae-cn' },
  ]
  const report = buildReport({
    models,
    quotas: QUOTAS,
    creditDaily: CREDIT_DAILY,
    pluginProviders: [{ id: 'trae-cn', signedIn: true }, { id: 'qwenwork', signedIn: false }],
  })
  // `workbuddy` has daily credit usage but no windowed quota: it must still be
  // listed, because that usage is the only place its remaining credits live.
  assert.deepEqual(report.map((channel) => channel.id), ['deepseek', 'trae-cn', 'zcode', 'codearts', 'qoder-cn', 'workbuddy'])
  const zcode = report.find((channel) => channel.id === 'zcode')
  assert.deepEqual(zcode.models, ['zcode/GLM-5.3', 'auto/GLM-5.3-Flash'])
  assert.equal(zcode.modelCount, 2)
  const trae = report.find((channel) => channel.id === 'trae-cn')
  assert.equal(trae.signedIn, true)
  assert.equal(trae.accountCount, 0)
  const qoder = report.find((channel) => channel.id === 'qoder-cn')
  assert.equal(qoder.modelCount, 0)
  assert.equal(qoder.signedIn, false)
})

test('latestReadAt picks the freshest ledger timestamp', () => {
  const channels = buildReport({ models: [], quotas: QUOTAS }).map((channel) => channel)
  assert.equal(latestReadAt(channels), '2026-10-29T09:46:01+08:00')
})

test('parseWindowHours reads the rolling window duration from its name', () => {
  assert.equal(parseWindowHours('5 hours'), 5)
  assert.equal(parseWindowHours('5h'), 5)
  assert.equal(parseWindowHours('5 小时'), 5)
  assert.equal(parseWindowHours('2 hours'), 2)
  assert.equal(parseWindowHours('Weekly'), undefined)
  assert.equal(parseWindowHours('总积分'), undefined)
  assert.equal(parseWindowHours(undefined), undefined)
})

test('a rolling window is flagged so the plan does not bank its unused quota', () => {
  // zcode's real 5-hour window: nothing used, 2000 left. Unused quota here is
  // spent rather than carried, so the plan has to schedule a burn inside it.
  const window = normaliseWindow({ name: '5 hours', used: 0, display: '0 / 2000', limit: 2000 })
  assert.equal(window.rolling, true)
  assert.equal(window.windowHours, 5)
  assert.equal(window.remaining, 2000)
  // The weekly pool is an upper gate, not a rolling one.
  const weekly = normaliseWindow({ name: 'Weekly', used: 20.03, amount: 2003, limit: 10000 })
  assert.equal(weekly.rolling, false)
  assert.equal(weekly.windowHours, undefined)
  // A multi-day window is not a "must burn before it rolls" window.
  assert.equal(isRollingWindow(normaliseWindow({ name: '24 hours', limit: 100 })), false)
})

test('a channel projects its rolling window beside its weekly gate', () => {
  const zcode = projectChannel({ models: [{ id: 'zcode/GLM-5.3-Flash', channel: 'zcode' }], quotas: QUOTAS }, 'zcode')
  const windows = zcode.accounts.flatMap((account) => account.windows)
  assert.deepEqual(windows.map((window) => window.name), ['5 hours', 'Weekly'])
  assert.deepEqual(windows.map((window) => window.rolling), [true, false])
  assert.equal(windows[0].windowHours, 5)
})
