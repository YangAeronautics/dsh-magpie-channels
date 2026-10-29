import test from 'node:test'
import assert from 'node:assert/strict'

import { channelsTool, renderChannels } from '../index.js'
import { buildReport } from '../host/ledger.js'
import { channelValue, condenseBalance, toolValue } from '../host/tool-value.js'

/** Stand-in for `@deepseek-ai/dsh-tools`'s defineTool: identity, so we can drive `execute`. */
const define = (tool) => tool

/**
 * The same lossless-JSON rule the Harness applies to a tool's return value
 * (`isJsonValue` in `@deepseek-ai/dsh-util-values`): `-0`, non-finite numbers,
 * sparse arrays and own enumerable keys holding `undefined` all fail.
 * Written independently of the host module so a regression is a red test.
 */
function isLosslessJson(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0)
  if (typeof value !== 'object' || ancestors.has(value)) return false
  if (Array.isArray(value)) {
    if (Reflect.ownKeys(value).length !== value.length + 1) return false
    ancestors.add(value)
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index) || !isLosslessJson(value[index], ancestors)) return false
    }
    ancestors.delete(value)
    return true
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return false
  ancestors.add(value)
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') return false
    if (!Object.prototype.propertyIsEnumerable.call(value, key)) return false
    if (!isLosslessJson(value[key], ancestors)) return false
  }
  ancestors.delete(value)
  return true
}

/** A report shaped like `collectReport()`: optional fields deliberately `undefined`. */
function report() {
  return {
    generatedAt: '2026-10-29T02:25:31.017Z',
    // `catalog.models` is a COUNT here, not a list — the shape the tool must read.
    catalog: { status: 'ok', url: 'http://127.0.0.1:3425/v1/models', at: '2026-10-29T02:25:31Z', models: 37 },
    ledger: { dir: 'C:/Users/BW/.config/magpie', readAt: undefined, errors: [] },
    totals: { channels: 2, channelsWithModels: 2, models: 37 },
    channels: [
      {
        id: 'zcode',
        name: 'ZCode',
        models: ['zcode/GLM-5.3'],
        modelCount: 1,
        signedIn: true,
        accountCount: 1,
        readAt: '2026-10-29T10:22:03+08:00',
        accounts: [
          {
            key: 'zcode/acc',
            account: 'acc',
            user: undefined,
            plan: 'Pro',
            balance: undefined,
            readAt: '2026-10-29T10:22:03+08:00',
            until: undefined,
            renew: undefined,
            windows: [
              { name: 'Weekly', used: 80.04, usedAmount: 8003.96, remaining: 1996.04, limit: 10000, unit: 'credits', display: '8003.96 / 10000 credits', resetsAt: undefined },
              { name: '5 hours', used: 0, usedAmount: 0, remaining: 2000, limit: 2000, unit: undefined, display: '0 / 2000', resetsAt: undefined },
            ],
            resets: { count: 3, until: '2026-11-26T16:00:00Z', byWindow: {}, weekly: '2026-11-03T00:00:00Z', each: [] },
          },
        ],
        daily: [],
        history: [],
        windowCount: 2,
      },
      {
        id: 'workbuddy',
        name: 'WorkBuddy',
        models: [],
        modelCount: 0,
        signedIn: true,
        accountCount: 0,
        readAt: undefined,
        accounts: [],
        daily: [
          {
            account: '杨·鹪鹩一枝',
            since: '2026-10-01',
            last: { used: 6061.63, total: 6300, at: '2026-10-29T01:00:00Z' },
            days: [
              { day: '2026-10-27', used: 5940.1 },
              { day: '2026-10-28', used: 6002.5 },
              { day: '2026-10-29', used: 6061.63 },
            ],
          },
        ],
        history: [{ key: 'workbuddy/杨·鹪鹩一枝', window: 'daily', samples: 4, last: { at: '2026-10-29T01:00:00Z', left: 238.37 } }],
        windowCount: 0,
      },
    ],
  }
}

function deps() {
  return {
    catalog: { async read() { return { status: 'ok', url: 'http://127.0.0.1:3425/v1/models', at: '2026-10-29T02:00:00Z', models: [] } } },
    ledgerDir: 'C:/nowhere',
  }
}

/**
 * A channel projection in the shape `buildReport` produces, so the projection
 * is exercised against the report the route really serves.
 */
function ledgerChannel() {
  return buildReport({
    models: [{ id: 'zcode/GLM-5.3', channel: 'zcode' }],
    quotas: {
      'zcode/acc': {
        at: '2026-10-29T10:00:00+08:00',
        quota: {
          provider: 'zcode',
          plan: 'Pro',
          windows: [
            { name: 'Weekly', used: 79.97, amount: 2003, limit: 10000, unit: 'credits', display: '2003 / 10000 credits', resetsAt: '2026-11-03T00:00:00Z' },
            { name: '5 hours', used: 0, display: '0 / 2000' },
          ],
          resets: { count: 3, until: '2026-11-26T16:00:00Z', weekly: '2026-11-03T00:00:00Z' },
        },
      },
      'deepseek/key': {
        at: '2026-10-29T09:00:00+08:00',
        quota: { provider: 'deepseek', balance: '¥891.45', windows: [] },
      },
    },
    creditDaily: {
      'workbuddy|杨·鹪鹩一枝': {
        since: '2026-10-01',
        last: { used: 6061.63, total: 6300 },
        days: { '2026-10-28': 6002.5, '2026-10-29': 6061.63 },
      },
    },
    quotaHistory: {},
    labels: { zcode: 'ZCode', deepseek: 'DeepSeek', workbuddy: 'WorkBuddy' },
    pluginProviders: [{ id: 'deepseek', signedIn: true }],
  })
}

test('a report built from the ledger is lossless JSON once projected for the tool', () => {
  const channels = ledgerChannel()
  assert.equal(isLosslessJson(channels), false, 'the panel report itself carries undefined fields')
  const value = toolValue({ generatedAt: '2026-10-29T02:25:31Z', catalog: { status: 'ok', url: 'u', models: [{}] }, ledger: { dir: 'C:/x', errors: [] }, channels })
  assert.equal(isLosslessJson(value), true)
  const zcode = value.channels.find((entry) => entry.id === 'zcode')
  assert.equal(zcode.plan, 'Pro')
  assert.equal(zcode.windows[0].display, '2003 / 10000 credits')
  assert.equal(zcode.windows[0].used, 2003)
  assert.equal(zcode.windows[0].remaining, 7997)
  assert.equal(zcode.windows[0].expiringPercent, undefined)
  assert.equal(zcode.resets.until, '2026-11-26T16:00:00Z')
  assert.equal(zcode.ledgerAccounts, 1)
  const deepseek = value.channels.find((entry) => entry.id === 'deepseek')
  assert.equal(deepseek.balance, '¥891.45')
  assert.equal(deepseek.signedIn, true)
  // A channel with daily usage but no models: `buildReport` lists it from the
  // ledger alone, which is the case that keeps a balance visible while Magpie
  // is offline.
  const workbuddy = value.channels.find((entry) => entry.id === 'workbuddy')
  assert.equal(workbuddy.daily[0].remaining, 238.37)
  assert.deepEqual(workbuddy.daily[0].recentDaily, [['2026-10-28', 6002.5], ['2026-10-29', 6061.63]])
})

test('a channel with daily usage but no models still reaches the tool value', () => {
  const channels = buildReport({
    models: [],
    quotas: {},
    creditDaily: {
      'workbuddy|杨·鹪鹩一枝': { since: '2026-10-01', last: { used: 6061.63, total: 6300 }, days: { '2026-10-29': 6061.63 } },
    },
    quotaHistory: {},
    labels: { workbuddy: 'WorkBuddy' },
    pluginProviders: [{ id: 'workbuddy', signedIn: true }],
  })
  const value = toolValue({ generatedAt: 't', catalog: { status: 'ok', url: 'u', models: [] }, ledger: { dir: 'd', errors: [] }, channels })
  const workbuddy = value.channels.find((entry) => entry.id === 'workbuddy')
  assert.equal(workbuddy.daily[0].used, 6061.63)
  assert.equal(isLosslessJson(value), true)
})

test('the tool value is lossless JSON even when the report carries undefined fields', () => {
  assert.equal(isLosslessJson(report()), false, 'fixture must actually contain undefined fields')
  const value = toolValue(report(), { now: Date.parse('2026-10-29T02:25:31Z') })
  assert.equal(isLosslessJson(value), true)
  assert.deepEqual(JSON.parse(JSON.stringify(value)), value)
})

test('the tool value keeps the numbers, models and balances of the report', () => {
  const value = toolValue(report(), { now: Date.parse('2026-10-29T02:25:31Z') })
  const [zcode, workbuddy] = value.channels
  assert.deepEqual(zcode.models, ['zcode/GLM-5.3'])
  assert.equal(zcode.plan, 'Pro')
  assert.equal(zcode.windows[0].name, 'Weekly')
  assert.equal(zcode.windows[0].used, 8003.96)
  assert.equal(zcode.windows[0].remaining, 1996.04)
  assert.equal(zcode.windows[0].limit, 10000)
  assert.equal(zcode.windows[0].percent, 80)
  assert.equal(zcode.windows[1].percent, 0)
  assert.equal(zcode.resets.until, '2026-11-26T16:00:00Z')
  assert.equal(workbuddy.daily[0].used, 6061.63)
  assert.equal(workbuddy.daily[0].remaining, 238.37)
  assert.deepEqual(workbuddy.daily[0].recentDaily, [
    ['2026-10-27', 5940.1],
    ['2026-10-28', 6002.5],
    ['2026-10-29', 6061.63],
  ])
  assert.equal(workbuddy.ledgerAccounts, 0)
  assert.equal(workbuddy.windows, undefined)
})

test('modelsOnly keeps the channel and its models and drops the ledger detail', () => {
  const value = toolValue(report(), { modelsOnly: true })
  for (const channel of value.channels) {
    assert.deepEqual(Object.keys(channel), ['id', 'name', 'models', 'ledgerAccounts'])
  }
  assert.deepEqual(value.channels[0].models, ['zcode/GLM-5.3'])
})

test('a window reports the expiring share Magpie printed, and none when it printed none', () => {
  const now = Date.parse('2026-10-29T00:00:00Z')
  const soon = channelValue(
    { id: 'codearts', name: 'CodeArts', models: [], accounts: [{ windows: [{ name: '总积分', usedAmount: 190.75, used: 2.890151515151515, remaining: 6409.25, limit: 6600, unit: 'credits', display: '191 / 6600 · 97 即将过期', expiringPercent: 97, resetsAt: '2026-11-26T16:00:00Z' }] }] },
    { now },
  )
  assert.equal(soon.windows[0].expiringPercent, 97)
  assert.equal(soon.windows[0].remaining, 6409.25)
  const later = channelValue(
    { id: 'zcode', name: 'ZCode', models: [], accounts: [{ windows: [{ name: 'Weekly', usedAmount: 2003, used: 20.03, remaining: 7997, limit: 10000, display: '2003 / 10000', resetsAt: '2026-12-31T00:00:00Z' }] }] },
    { now },
  )
  // No `· N 即将过期` segment: unknown, so the field is omitted rather than false.
  assert.equal('expiringPercent' in later.windows[0], false)
})

test('a multi-line balance is condensed to its long-term total', () => {
  assert.equal(condenseBalance('2100 credits (daily 100 · long-term 2000)'), '2100 credits long-term 2000')
  assert.equal(condenseBalance('1600.95 credits'), '1600.95 credits')
  assert.equal(condenseBalance('¥891.45'), '¥891.45')
  assert.equal(condenseBalance(undefined), undefined)
})

test('the rendered text states each channel, its models and what is left', () => {
  const text = renderChannels(toolValue(report(), { now: Date.parse('2026-10-29T02:25:31Z') }))
  assert.match(text, /Magpie ok（37 个模型/)
  assert.match(text, /ZCode（zcode）：zcode\/GLM-5\.3/)
  assert.match(text, /Weekly：已用 8003\.96 \/ 10000 credits，剩 1996\.04（80\.0%）/)
  assert.match(text, /当日：已用 6061\.63 \/ 6300，剩 238\.37/)
})

test('an offline gateway is text the model can act on, not an empty success', () => {
  const value = toolValue(
    { generatedAt: '2026-10-29T02:25:31Z', catalog: { status: 'offline', url: 'http://127.0.0.1:3425/v1/models', error: 'fetch failed' }, ledger: { dir: 'C:/x', errors: [] }, channels: [] },
    {},
  )
  const text = renderChannels(value)
  assert.match(text, /Magpie offline/)
  assert.match(text, /网关错误：fetch failed/)
})

test('the tool refuses an unknown channel by throwing, not by returning empty', async () => {
  const tool = channelsTool({ ...deps(), define })
  await assert.rejects(() => tool.execute({ channel: 'nope' }, { signal: undefined }), /未知渠道 nope/)
})

test('the tool returns a lossless JSON value from a real report shape', async () => {
  const fixture = report()
  const tool = channelsTool({
    catalog: { async read() { return fixture.catalog } },
    ledgerDir: 'C:/nowhere',
    define,
  })
  const value = await tool.execute({}, { signal: undefined })
  assert.equal(isLosslessJson(value), true)
  assert.equal(value.catalog.status, 'ok')
  // `report()` has no ledger files under C:/nowhere, so the catalog's
  // `owned_by`/`channel` is the only source of channels here.
  assert.deepEqual(value.channels, [])
  const offline = channelsTool({ catalog: { async read() { return { status: 'offline', url: 'u', error: 'fetch failed' } } }, ledgerDir: 'C:/nowhere', define })
  const value2 = await offline.execute({}, { signal: undefined })
  assert.equal(isLosslessJson(value2), true)
  assert.match(renderChannels(value2), /网关错误：fetch failed/)
})

test('modelsOnly drops the ledger details but keeps the model list', async () => {
  const tool = channelsTool({ ...deps(), define })
  const value = await tool.execute({ modelsOnly: true }, { signal: undefined })
  for (const channel of value.channels) {
    assert.deepEqual(Object.keys(channel).sort(), ['id', 'ledgerAccounts', 'models', 'name'])
  }
})

test('an aborted execution fails instead of returning stale data', async () => {
  const tool = channelsTool({ ...deps(), define })
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(() => tool.execute({}, { signal: controller.signal }), /aborted/)
})
