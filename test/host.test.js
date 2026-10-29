import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { apply, ROUTE_PATH, renderChannels } from '../index.js'

/** A fake catalog cache that never touches the network. */
function fakeCatalog(status = 'ok') {
  return {
    async read() {
      return { status, url: 'http://127.0.0.1:3425/v1/models', at: '2026-10-29T02:00:00Z', models: status === 'ok' ? [{ id: 'zcode/GLM-5.3', channel: 'zcode' }] : [] }
    },
  }
}

/** A ledger dir with one channel and one balance. */
async function ledgerFixture() {
  const dir = await mkdtemp(join(tmpdir(), 'magpie-channels-'))
  await writeFile(join(dir, 'quotas.json'), JSON.stringify({
    'deepseek/main': {
      at: '2026-10-29T01:46:01Z',
      quota: { provider: 'deepseek', name: 'DeepSeek', windows: [], balance: '¥891.45', readAt: '2026-10-29T01:46:01Z' },
    },
  }))
  return dir
}

/** Drive the plugin context and capture what it registers. */
function fakeContext() {
  const registered = { routes: [], tools: [] }
  const ctx = {
    fiber: { entry: { options: { config: { gatewayUrl: 'http://127.0.0.1:3425' } } } },
    effect(fn) {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    inject(_services, callback) {
      callback({
        effect: this.effect,
        webServer: {
          register(route) {
            registered.routes.push(route)
            return () => {}
          },
        },
        tools: {
          register(tool) {
            registered.tools.push(tool)
            return () => {}
          },
        },
      })
    },
  }
  return { ctx, registered }
}

/** A minimal node-style response recorder. */
function fakeResponse() {
  return {
    status: undefined,
    headers: {},
    body: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers ?? {}
    },
    end(chunk) {
      this.body += chunk ?? ''
    },
  }
}

test('apply contributes exactly one GET report route and one tool', () => {
  const { ctx, registered } = fakeContext()
  apply(ctx)
  assert.equal(registered.routes.length, 1)
  assert.equal(registered.routes[0].kind, 'exact')
  assert.equal(registered.routes[0].path, ROUTE_PATH)
  assert.equal(registered.tools.length, 1)
  assert.equal(registered.tools[0].name, 'magpie_channels')
})

test('the route rejects non-GET methods instead of answering them', async () => {
  const { ctx, registered } = fakeContext()
  apply(ctx)
  const response = fakeResponse()
  await registered.routes[0].handler({ method: 'POST', url: ROUTE_PATH }, response)
  assert.equal(response.status, 405)
  assert.equal(response.headers.allow, 'GET')
  assert.match(response.body, /method not allowed/)
})

test('the route answers the live report shape for GET', async () => {
  const dir = await ledgerFixture()
  const { catalog, ledgerDir } = { catalog: fakeCatalog(), ledgerDir: dir }
  const { handleReport } = await import('../index.js')
  const response = fakeResponse()
  await handleReport({ method: 'GET', url: ROUTE_PATH }, response, { catalog, ledgerDir })
  assert.equal(response.status, 200)
  assert.equal(response.headers['cache-control'], 'no-store')
  const report = JSON.parse(response.body)
  assert.equal(report.catalog.status, 'ok')
  assert.equal(report.totals.models, 1)
  const deepseek = report.channels.find((channel) => channel.id === 'deepseek')
  assert.equal(deepseek.accounts[0].balance, '¥891.45')
})

test('a broken gateway still answers 200 with an offline catalog', async () => {
  const dir = await ledgerFixture()
  const { handleReport } = await import('../index.js')
  const response = fakeResponse()
  await handleReport({ method: 'GET', url: ROUTE_PATH }, response, {
    catalog: { async read() { return { status: 'offline', url: 'http://127.0.0.1:3425/v1/models', at: '2026-10-29T02:00:00Z', models: [], error: 'ECONNREFUSED' } } },
    ledgerDir: dir,
  })
  assert.equal(response.status, 200)
  const report = JSON.parse(response.body)
  assert.equal(report.catalog.status, 'offline')
  assert.match(report.catalog.error, /ECONNREFUSED/)
})

test('the tool renders channels, balances and windows as text', async () => {
  // Drive the real tool value so the text and the value can never drift apart.
  const { toolValue } = await import('../host/tool-value.js')
  const text = renderChannels(toolValue({
    generatedAt: '2026-10-29T02:25:31Z',
    catalog: { status: 'ok', url: 'http://127.0.0.1:3425/v1/models', models: 3 },
    ledger: { dir: 'C:/Users/BW/.config/magpie', errors: [] },
    channels: [
      {
        id: 'zcode',
        name: 'ZCode',
        models: ['zcode/GLM-5.3'],
        signedIn: true,
        accounts: [{ windows: [{ name: 'Weekly', used: 80, usedAmount: 8000, remaining: 2000, limit: 10000, unit: 'credits', resetsAt: '2026-11-02' }] }],
        daily: [{ account: 'a', last: { used: 12, total: 6300 } }],
      },
    ],
  }, { now: Date.parse('2026-10-29T00:00:00Z') }))
  assert.match(text, /Magpie ok（3 个模型/)
  assert.match(text, /zcode\/GLM-5\.3/)
  assert.match(text, /Weekly：已用 8000 \/ 10000 credits，剩 2000（80\.0%，2026-11-02 重置）/)
  assert.match(text, /当日：已用 12 \/ 6300，剩 6288/)
})

test('channels missing from the ledger keep their catalog models, not silent empties', async () => {
  const dir = await ledgerFixture()
  const { handleReport } = await import('../index.js')
  const response = fakeResponse()
  await handleReport({ method: 'GET', url: ROUTE_PATH }, response, { catalog: fakeCatalog(), ledgerDir: dir })
  const report = JSON.parse(response.body)
  const zcode = report.channels.find((channel) => channel.id === 'zcode')
  assert.ok(zcode, 'catalog-only channel kept')
  assert.deepEqual(zcode.models, ['zcode/GLM-5.3'])
  assert.deepEqual(zcode.accounts, [])
  // The renderer states the absence instead of printing nothing.
  assert.match(renderChannels({ channels: [zcode] }), /网关未提供模型|ZCode（zcode）：zcode\/GLM-5\.3/)
})
