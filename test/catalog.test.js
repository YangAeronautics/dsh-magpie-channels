/**
 * Catalog + report tests. The gateway is always a local fake fetcher: the suite
 * never touches a real Magpie instance or the network.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CatalogCache, normalizeModel } from '../host/catalog.js'
import { collectReport } from '../host/report.js'

const ROW = {
  id: 'deepseek/deepseek-flash',
  display_name: 'DeepSeek-V4.1-Flash',
  owned_by: 'deepseek',
  magpie_label: 'DeepSeek-V4.1-Flash · DeepSeek',
  context_window: 1048576,
  max_output_tokens: 393216,
  reasoning: true,
  reasoning_levels: ['none', 'low', 'high', 'max'],
  modalities: { input: ['text', 'image'], output: ['text'] },
  native_endpoints: ['/v1/chat/completions'],
}

function fakeGateway(rows, { status = 200, throws } = {}) {
  return async () => {
    if (throws !== undefined) throw throws
    return { ok: status >= 200 && status < 300, status, json: async () => ({ data: rows }) }
  }
}

async function withLedger(files, run) {
  const dir = await mkdtemp(join(tmpdir(), 'magpie-ledger-'))
  try {
    for (const [name, value] of Object.entries(files)) {
      await writeFile(join(dir, name), typeof value === 'string' ? value : JSON.stringify(value), 'utf8')
    }
    return await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('normalizeModel maps a gateway row onto the panel projection', () => {
  const model = normalizeModel(ROW)
  assert.equal(model.id, 'deepseek/deepseek-flash')
  assert.equal(model.channel, 'deepseek')
  assert.equal(model.name, 'DeepSeek-V4.1-Flash')
  assert.equal(model.contextWindow, 1048576)
  assert.equal(model.maxOutput, 393216)
  assert.equal(model.reasoning, true)
  assert.deepEqual(model.reasoningLevels, ['none', 'low', 'high', 'max'])
  assert.deepEqual(model.input, ['text', 'image'])
})

test('normalizeModel derives the channel from the id when owned_by is absent', () => {
  assert.equal(normalizeModel({ id: 'zcode/GLM-5.3' }).channel, 'zcode')
  assert.equal(normalizeModel({ id: 'broken' }).name, 'broken')
})

test('CatalogCache reads once per TTL and reports a stopped gateway as offline', async () => {
  let calls = 0
  const cache = new CatalogCache({
    baseUrl: 'http://127.0.0.1:1/',
    fetchImpl: async () => {
      calls += 1
      return { ok: true, status: 200, json: async () => ({ data: [ROW] }) }
    },
  })
  const first = await cache.read()
  assert.equal(first.status, 'ok')
  assert.equal(first.url, 'http://127.0.0.1:1/v1/models')
  await cache.read()
  assert.equal(calls, 1)
  await cache.read({ force: true })
  assert.equal(calls, 2)

  const offline = new CatalogCache({ baseUrl: 'http://127.0.0.1:3425', fetchImpl: fakeGateway([], { throws: new Error('ECONNREFUSED') }) })
  const failed = await offline.read()
  assert.equal(failed.status, 'offline')
  assert.equal(failed.error, 'ECONNREFUSED')

  const refused = new CatalogCache({ baseUrl: 'http://127.0.0.1:3425', fetchImpl: fakeGateway([], { status: 503 }) })
  const answered = await refused.read()
  assert.equal(answered.status, 'error')
  assert.match(answered.error, /503/)
})

test('collectReport joins the gateway catalog with the on-disk ledger', async () => {
  await withLedger({
    'quotas.json': {
      'deepseek/balance 020b': { at: '2026-10-29T09:46:01+08:00', quota: { provider: 'deepseek', windows: [], balance: '¥891.45', readAt: '2026-10-29T09:46:01+08:00' } },
      'zcode/jhoxsnyg': { at: '2026-10-29T09:46:01+08:00', quota: { provider: 'zcode', windows: [{ name: 'Weekly', used: 20.03, amount: 2003, limit: 10000, display: '2003 / 10000' }] } },
    },
    'credits-daily.json': {},
    'providers.json': { providers: [{ id: 'zcode', name: '智谱 ZCode' }] },
    'plugin-providers.json': [{ id: 'zcode', signedIn: true }],
  }, async (dir) => {
    const report = await collectReport({
      catalog: new CatalogCache({ baseUrl: 'http://127.0.0.1:3425', fetchImpl: fakeGateway([ROW]) }),
      ledgerDir: dir,
    })
    assert.equal(report.catalog.status, 'ok')
    assert.equal(report.totals.models, 1)
    assert.equal(report.totals.channels, 2)
    assert.equal(report.totals.channelsWithModels, 1)
    assert.equal(report.ledger.dir, dir)
    assert.deepEqual(report.ledger.errors, [])
    const zcode = report.channels.find((channel) => channel.id === 'zcode')
    assert.equal(zcode.name, '智谱 ZCode')
    assert.equal(zcode.signedIn, true)
    const deepseek = report.channels.find((channel) => channel.id === 'deepseek')
    assert.equal(deepseek.accounts[0].balance, '¥891.45')
  })
})

test('collectReport degrades honestly when Magpie is down and a ledger file is corrupt', async () => {
  await withLedger({ 'quotas.json': '{ not json' }, async (dir) => {
    const report = await collectReport({
      catalog: new CatalogCache({ baseUrl: 'http://127.0.0.1:3425', fetchImpl: fakeGateway([], { throws: new Error('fetch failed') }) }),
      ledgerDir: dir,
    })
    assert.equal(report.catalog.status, 'offline')
    assert.equal(report.totals.models, 0)
    assert.deepEqual(report.channels, [])
    assert.equal(report.ledger.errors.length, 1)
    assert.equal(report.ledger.errors[0].file, 'quotas.json')
  })
})
