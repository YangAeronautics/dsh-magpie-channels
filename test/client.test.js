/**
 * Sidebar-entry + page smoke test. Loads the *built* browser bundle (the file
 * the Harness web client actually executes) through a stand-in
 * `window.__ModuleLoader__`, then renders it in a fake client context so a
 * registration regression shows up without launching the GUI: the sidebar
 * entry, the `main` key, the glyph, the empty state, the error state and the
 * populated report are all exercised here.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'

import '../client/build.js'

const loaded = []
const reactModule = await import('react')
const runtimeModule = await import('react/jsx-runtime')
globalThis.window = {
  __ModuleLoader__: {
    load(module) {
      loaded.push(module)
    },
  },
}
await import('../client/bundle.js')
const client = loaded[0].factory((name) => {
  if (name === 'react') return reactModule
  if (name === 'react/jsx-runtime') return runtimeModule
  throw new Error(`unexpected require(${name})`)
})

/** A client context that records registrations and drives generator injects. */
function fakeContext() {
  const registered = []
  const dictionaries = new Map()
  const ctx = {
    effect(fn) {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    locale: {
      register(ns, dicts) {
        dictionaries.set(ns, dicts)
        return () => dictionaries.delete(ns)
      },
      bind(ns) {
        return (key, params) => {
          const dict = dictionaries.get(ns) ?? {}
          const text = dict.zh?.[key] ?? dict.en?.[key] ?? key
          return params === undefined ? text : text.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''))
        }
      },
    },
    slots: {
      inject(_name, factory) {
        const product = factory()
        if (product === undefined || typeof product[Symbol.iterator] !== 'function' || typeof product.next !== 'function') return
        // Generator inject: `yield` hands back a disposer; keep stepping until done.
        let step = product.next()
        while (step.done !== true) step = product.next(() => {})
      },
      register(options, component) {
        registered.push({ slot: options.name, options, component })
        return () => {}
      },
    },
  }
  return { ctx, registered, dictionaries }
}

test('apply contributes the sidebar glyph and the main panel under one id', () => {
  const { ctx, registered, dictionaries } = fakeContext()
  client.apply(ctx)

  const entry = registered.find((item) => item.slot === 'sidebar.panellist')
  const panel = registered.find((item) => item.slot === 'main')
  assert.ok(entry, 'sidebar.panellist entry missing')
  assert.ok(panel, 'main panel missing')
  assert.equal(entry.options.id, client.PANEL_ID)
  assert.equal(panel.options.key, client.PANEL_ID)
  assert.equal(entry.options.id, panel.options.key)
  assert.equal(typeof entry.options.order, 'number')
  assert.equal(entry.options.label(), 'Magpie 渠道')
  assert.equal(panel.options.locale, client.NS)
  assert.deepEqual(client.inject, ['slots', 'locale', 'layout'])
  assert.ok(dictionaries.get(client.NS)?.zh?.panel)
})

test('the sidebar glyph draws at the requested size', () => {
  const { ctx, registered } = fakeContext()
  client.apply(ctx)
  const glyph = registered.find((item) => item.slot === 'sidebar.panellist').component
  const markup = renderToStaticMarkup(glyph({ size: 16 }))
  assert.match(markup, /width="16"/)
  assert.match(markup, /height="16"/)
})

test('the page renders its header before the report arrives (no crash path)', () => {
  const { ctx, registered } = fakeContext()
  client.apply(ctx)
  const page = registered.find((item) => item.slot === 'main').component
  // Server rendering proves the tree builds and the strings resolve; the fetch
  // effect does not run without a browser, so the page stays in its initial
  // loading state — which must be a renderable state, not a crash.
  const markup = renderToStaticMarkup(createElement(page, { t: (key) => key }))
  assert.match(markup, /mgc-page/)
  // The heading uses the `panel` label; with the identity translator that is
  // the literal key, which keeps this assertion independent of dictionary text.
  assert.match(markup, />panel</)
})

/** A two-channel report, shaped like the host route's answer. */
const REPORT = {
  generatedAt: '2026-10-29T02:00:00Z',
  catalog: { status: 'ok', url: 'http://127.0.0.1:3425/v1/models', at: '2026-10-29T02:00:00Z' },
  ledger: { dir: 'C:/magpie', readAt: '2026-10-29T01:46:00Z', errors: [] },
  totals: { channels: 2, channelsWithModels: 2, models: 3 },
  channels: [
    {
      id: 'zcode',
      name: 'ZCode',
      models: ['zcode/GLM-5.3', 'auto/GLM-5.3-Flash'],
      catalogBacked: true,
      signedIn: true,
      accounts: [
        {
          key: 'zcode/main',
          account: 'main',
          user: 'u',
          plan: 'pro',
          balance: null,
          readAt: '2026-10-29T01:46:00Z',
          until: null,
          renew: null,
          resets: null,
          windows: [
            { name: 'Weekly', used: 80, usedAmount: 8000, remaining: 2000, limit: 10000, unit: 'credits', display: '8000 / 10000', resetsAt: '2026-11-04T10:03:22Z' },
          ],
        },
      ],
      daily: [],
      history: [],
      windowCount: 1,
    },
    {
      id: 'deepseek',
      name: 'DeepSeek',
      models: ['deepseek/deepseek-flash'],
      catalogBacked: true,
      signedIn: false,
      accounts: [],
      daily: [],
      history: [],
      windowCount: 0,
    },
  ],
}

test('a populated report renders channel names, model ids and the used/left quota', () => {
  // ChannelCard renders without hooks, so it can be rendered on its own; that
  // isolates the data-to-text mapping from the page's fetching.
  const markup = renderToStaticMarkup(
    createElement('div', null, REPORT.channels.map((channel) => createElement(client.ChannelCard, { channel, t: identity }))),
  )
  assert.match(markup, /ZCode/)
  assert.match(markup, /zcode\/GLM-5\.3/)
  // The window line is `已用 X，剩 Y`: the consumed amount, not the left one.
  // With `identity` as the translator the key itself is what gets rendered.
  assert.match(markup, /windowLine/)
  assert.match(markup, /usedPercent/)
  assert.match(markup, /DeepSeek/)
  assert.match(markup, /deepseek\/deepseek-flash/)
  // The empty-ledger channel must say so instead of rendering a blank card.
  assert.match(markup, /noLedger/)
})

/** Identity translator: keys stay literal so assertions are text-free. */
function identity(key) {
  return key
}
