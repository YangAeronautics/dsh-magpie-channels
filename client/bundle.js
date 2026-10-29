/**
 * Browser bundle body of dsh-magpie-channels.
 *
 * The Harness web client does not load plugin ES modules directly: it calls
 * `window.__ModuleLoader__.load({ id, factory })` and takes the factory's
 * returned object as the plugin exports. This wrapper supplies the two runtime
 * imports (React hooks and the jsx runtime) plus the key-hoisting `jsx` helper
 * that keeps generated lists warning-free.
 *
 * The helpers are inlined because the loader resolves bare module names only,
 * never relative files.
 */

(function () {
  'use strict'

  const define = (globalThis.window && globalThis.window.__ModuleLoader__) ?? window.__ModuleLoader__
  if (!define || typeof define.load !== 'function') throw new Error('dsh-magpie-channels: __ModuleLoader__ is not available')

  define.load({
    id: 'dsh-magpie-channels',
    factory: (require) => {
      const react = require('react')
      const runtime = require('react/jsx-runtime')
      const createElement = react.createElement
      const useCallback = react.useCallback
      const useEffect = react.useEffect
      const useState = react.useState

      const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)

      /**
       * Create an element while hoisting the React `key` out of the props
       * object: React 19 warns and drops keys passed inside props.
       * @param type - element type.
       * @param props - props, possibly carrying `key`.
       * @param key - explicit key, wins over `props.key`.
       * @returns the React element.
       */
      function jsx(type, props, key) {
        const source = isObj(props) ? props : {}
        const propKey = source.key
        const rest = { ...source }
        delete rest.key
        const finalKey = key === undefined ? propKey : key
        if (finalKey === undefined) return runtime.jsx(type, rest)
        return runtime.jsx(type, rest, finalKey)
      }

/**
 * Browser half of dsh-magpie-channels.
 *
 * One sidebar entry ("Magpie Channels") opening a main panel that lists every
 * Magpie channel with the LLM models it currently serves and its remaining
 * quota.
 *
 * Registration follows `@deepseek-ai/dsh-client-ui-plugin-manager`:
 * - a `sidebar.panellist` list entry `{ id, order, label }` draws the glyph;
 * - the matching `main` keyed registration renders the page, and receives
 *   `{ t }` from the registration's `locale` namespace.
 *
 * The page reads the host route through the page origin only: nothing here
 * imports host code or touches the ledger directly.
 */


/** Dictionary namespace owned by this plugin. */
const NS = 'magpieChannels'

/** The id shared by the sidebar entry and the main panel it opens. */
const PANEL_ID = 'magpie-channels'

/** Host route the page reads. */
const REPORT_PATH = '/api/magpie-channels/report'

const inject = ['slots', 'locale', 'layout']

const DICTIONARIES = {
  zh: {
    panel: 'Magpie 渠道',
    subtitle: '{channels} 个渠道 · {models} 个可用模型',
    subtitleEmpty: '正在读取网关与额度账本…',
    loading: '正在读取 Magpie 网关与额度账本…',
    empty: '没有读到任何渠道。请确认 Magpie 正在运行，且额度账本存在。',
    refresh: '刷新',
    refreshing: '刷新中…',
    loadFailed: '读取失败：{message}',
    catalogDown: '网关不可用（{message}）。下列额度来自本地账本，模型清单暂缺。',
    modelsOnline: '{count} 个模型',
    modelsOffline: '当前无模型',
    signedIn: '已登录',
    noLedger: '账本无记录',
    balance: '余额',
    daily: '今日消耗',
    resetsAt: '{time} 重置',
    expiring: '{percent}% 即将过期',
    rolling: '{hours} 小时滚动 · 不刷即废',
    windowLine: '已用 {used}，剩 {left}',
    usedPercent: '已用 {percent}%',
    until: '有效期至 {time}',
    readAt: '读取于 {time}',
  },
  en: {
    panel: 'Magpie Channels',
    subtitle: '{channels} channels · {models} models',
    subtitleEmpty: 'Reading the gateway and the quota ledger…',
    loading: 'Reading the Magpie gateway and the quota ledger…',
    empty: 'No channel found. Check that Magpie is running and its ledger exists.',
    refresh: 'Refresh',
    refreshing: 'Refreshing…',
    loadFailed: 'Load failed: {message}',
    catalogDown: 'Gateway unavailable ({message}). Balances below come from the local ledger; the model list is missing.',
    modelsOnline: '{count} models',
    modelsOffline: 'no models now',
    signedIn: 'signed in',
    noLedger: 'not in ledger',
    balance: 'Balance',
    daily: 'Today',
    resetsAt: 'resets {time}',
    expiring: '{percent}% expiring',
    rolling: '{hours}h rolling · unused is lost',
    windowLine: 'used {used}, {left} left',
    usedPercent: '{percent}% used',
    until: 'valid until {time}',
    readAt: 'read {time}',
  },
}

const CSS = `
.mgc-page{box-sizing:border-box;height:100%;display:flex;flex-direction:column;gap:16px;padding:24px clamp(16px,3vw,32px) 40px;overflow:auto;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);}
.mgc-head{display:flex;flex-wrap:wrap;align-items:flex-end;gap:12px;justify-content:space-between;max-width:1100px;width:100%;margin:0 auto;}
.mgc-title{margin:0;font-size:18px;font-weight:600;}
.mgc-sub{margin:2px 0 0;font-size:12px;color:var(--dsw-alias-label-secondary);}
.mgc-actions{display:flex;align-items:center;gap:8px;}
.mgc-btn{appearance:none;border:1px solid var(--dsw-alias-border-l3);background:transparent;color:inherit;border-radius:8px;padding:5px 12px;font-size:12px;cursor:pointer;}
.mgc-btn:hover{background:var(--dsw-alias-interactive-bg-hover);}
.mgc-btn[disabled]{opacity:.5;cursor:default;}
.mgc-banner{max-width:1100px;width:100%;margin:0 auto;border:1px solid var(--dsw-alias-border-l3);border-radius:10px;padding:10px 14px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary);}
.mgc-banner[data-tone="warn"]{border-color:#c98a2e;}
.mgc-banner[data-tone="bad"]{border-color:#c85a4a;}
.mgc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px;max-width:1100px;width:100%;margin:0 auto;}
.mgc-card{border:1px solid var(--dsw-alias-border-l3);border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:10px;min-width:0;}
.mgc-card[data-muted="true"]{opacity:.65;}
.mgc-cardHead{display:flex;align-items:baseline;gap:8px;justify-content:space-between;}
.mgc-name{font-size:14px;font-weight:600;}
.mgc-id{font-size:11px;color:var(--dsw-alias-label-secondary);font-family:ui-monospace,Consolas,monospace;}
.mgc-pill{font-size:11px;border-radius:999px;padding:1px 8px;border:1px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary);white-space:nowrap;}
.mgc-pill[data-ok="true"]{color:var(--dsw-alias-state-business-primary);border-color:currentColor;}
.mgc-window{display:flex;flex-direction:column;gap:4px;}
.mgc-windowRow{display:flex;justify-content:space-between;gap:8px;font-size:12px;}
.mgc-bar{height:6px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);overflow:hidden;}
.mgc-barFill{height:100%;border-radius:999px;background:var(--dsw-alias-state-business-primary);}
.mgc-barFill[data-hot="true"]{background:#c98a2e;}
.mgc-meta{font-size:11px;color:var(--dsw-alias-label-secondary);display:flex;flex-wrap:wrap;gap:10px;}
.mgc-models{display:flex;flex-direction:column;gap:3px;}
.mgc-model{font-size:12px;display:flex;justify-content:space-between;gap:8px;}
.mgc-model code{font-family:ui-monospace,Consolas,monospace;overflow-wrap:anywhere;}
.mgc-note{font-size:11px;color:var(--dsw-alias-label-secondary);}
.mgc-empty{max-width:1100px;width:100%;margin:0 auto;font-size:13px;color:var(--dsw-alias-label-secondary);}
`

/** Inline the sheet once: the page unmounts on every panel switch. */
function styleOnce() {
  const doc = globalThis.document
  if (doc === undefined || doc.getElementById('dsh-magpie-channels') !== null) return
  const element = doc.createElement('style')
  element.id = 'dsh-magpie-channels'
  element.textContent = CSS
  doc.head.appendChild(element)
}

function formatAmount(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

function formatTime(value) {
  if (typeof value !== 'string' || value === '') return ''
  const at = new Date(value)
  return Number.isNaN(at.getTime()) ? value : at.toLocaleString()
}


/** Sidebar glyph: three channel lines drawn from the inherited current colour. */
function ChannelsPanelIcon({ size }) {
  const edge = typeof size === 'number' ? size : 18
  return jsx('svg', {
    width: edge,
    height: edge,
    viewBox: '0 0 16 16',
    fill: 'none',
    'aria-hidden': 'true',
    children: jsx('path', {
      d: 'M2.5 4.5h6M2.5 8h11M7.5 11.5h6',
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeLinecap: 'round',
    }),
  })
}


/** One quota window: a name/value line, a consumption bar, and the meta line. */
function QuotaWindow({ entry, t }) {
  const percent = Math.max(0, Math.min(100, Number.isFinite(entry.used) ? entry.used : 0))
  const remaining = entry.remaining !== undefined && entry.limit !== undefined
    ? `${formatAmount(entry.remaining)} / ${formatAmount(entry.limit)}`
    : entry.display ?? '—'
  return jsx('div', {
    className: 'mgc-windowRow',
    children: jsx('span', {
      className: 'mgc-windowValue',
      children: jsx('span', {
        className: 'mgc-windowName',
        children: [entry.name ?? '—', ' ', remaining].join(' '),
      }),
    }),
  }, 'mgc-window-line')
}

/** The percentage / expiring share / unit / reset residue line under a bar. */
function windowMeta(entry, percent, t) {
  const parts = [jsx('span', { key: 'percent', children: t('usedPercent', { percent: percent.toFixed(1) }) })]
  if (entry.unit !== undefined) parts.push(jsx('span', { key: 'unit', children: entry.unit }))
  if (entry.resetsAt !== undefined) parts.push(jsx('span', { key: 'resets', children: t('resetsAt', { time: formatTime(entry.resetsAt) }) }))
  if (Number.isFinite(entry.expiringPercent)) {
    parts.push(jsx('span', { key: 'expiring', className: 'mgc-pill', 'data-tone': 'warn', children: t('expiring', { percent: formatAmount(entry.expiringPercent) }) }))
  }
  if (entry.rolling === true) {
    parts.push(jsx('span', { key: 'rolling', className: 'mgc-pill', 'data-tone': 'warn', children: t('rolling', { hours: formatAmount(entry.windowHours) }) }))
  }
  return jsx('div', { className: 'mgc-meta', children: parts }, 'mgc-window-meta')
}

/** One quota window rendered inside a channel card. */
function WindowBlock({ entry, t }) {
  const percent = Math.max(0, Math.min(100, Number.isFinite(entry.used) ? entry.used : 0))
  const used = entry.usedAmount !== undefined && entry.limit !== undefined
    ? `${formatAmount(entry.usedAmount)} / ${formatAmount(entry.limit)}`
    : entry.display ?? '—'
  const left = entry.remaining !== undefined ? formatAmount(entry.remaining) : '?'
  return jsx('div', {
    className: 'mgc-window',
    children: [
      jsx('div', {
        key: 'line',
        className: 'mgc-windowRow',
        children: [
          jsx('span', { key: 'name', children: entry.name ?? '—' }),
          jsx('span', { key: 'remaining', children: t('windowLine', { used, left }) }),
        ],
      }),
      jsx('div', {
        key: 'bar',
        className: 'mgc-bar',
        role: 'img',
        'aria-label': `${entry.name ?? ''} ${percent.toFixed(1)}%`,
        children: jsx('div', { className: 'mgc-barFill', 'data-hot': percent >= 90, style: { width: `${percent}%` } }),
      }),
      windowMeta(entry, percent, t),
    ],
  }, 'mgc-window-block')
}

/** A single "label on the left, value on the right" ledger line. */
function LedgerLine({ label, value }) {
  return jsx('div', {
    className: 'mgc-windowRow',
    children: [
      jsx('span', { key: 'label', children: label }),
      jsx('span', { key: 'value', children: value }),
    ],
  }, 'mgc-ledger-line')
}

/** One account: its balance line plus its quota windows and stamps. */
function AccountBlock({ account, t }) {
  return jsx('div', {
    className: 'mgc-account',
    children: [
      account.balance === undefined
        ? null
        : jsx(LedgerLine, { key: 'balance', label: t('balance'), value: account.balance }),
      ...(account.windows ?? []).map((entry, index) => jsx(WindowBlock, { key: `window-${index}`, entry, t })),
      jsx('div', {
        key: 'stamps',
        className: 'mgc-meta',
        children: [
          account.plan === undefined ? null : jsx('span', { key: 'plan', children: account.plan }),
          account.until === undefined ? null : jsx('span', { key: 'until', children: t('until', { time: formatTime(account.until) }) }),
          account.readAt === undefined ? null : jsx('span', { key: 'readAt', children: t('readAt', { time: formatTime(account.readAt) }) }),
        ],
      }),
    ],
  }, 'mgc-account')
}

/** A daily-credit line, e.g. workbuddy's rolling ceiling. */
function DailyRow({ entry, t }) {
  const used = entry.last?.used
  const total = entry.last?.total
  return jsx('div', {
    className: 'mgc-windowRow',
    children: [
      jsx('span', { key: 'label', children: t('daily') }),
      jsx('span', {
        key: 'value',
        children: used !== undefined && total !== undefined ? `${formatAmount(used)} / ${formatAmount(total)}` : '—',
      }),
    ],
  }, 'mgc-daily')
}

/** One selectable model id under a channel card. */
function ModelRow({ id }) {
  return jsx('div', { className: 'mgc-model', children: jsx('code', { children: id }) }, `model-${id}`)
}

/** The pill row: how many models, whether signed in, whether a ledger exists. */
function cardPills({ models, accounts, daily, signedIn, t }) {
  const children = [
    jsx('span', {
      key: 'models',
      className: 'mgc-pill',
      'data-ok': models.length > 0,
      children: models.length > 0 ? t('modelsOnline', { count: models.length }) : t('modelsOffline'),
    }),
  ]
  if (signedIn === true) children.push(jsx('span', { key: 'signedIn', className: 'mgc-pill', children: t('signedIn') }))
  if (accounts.length === 0 && daily.length === 0) children.push(jsx('span', { key: 'noLedger', className: 'mgc-note', children: t('noLedger') }))
  return jsx('div', { className: 'mgc-meta', children })
}

/** One channel: what it serves and what is left on it. */
function ChannelCard({ channel, t }) {
  const models = Array.isArray(channel.models) ? channel.models : []
  const accounts = Array.isArray(channel.accounts) ? channel.accounts : []
  const daily = Array.isArray(channel.daily) ? channel.daily : []
  return jsx('section', {
    className: 'mgc-card',
    'data-muted': models.length === 0,
    children: [
      jsx('div', {
        key: 'head',
        className: 'mgc-cardHead',
        children: [
          jsx('span', { key: 'name', className: 'mgc-name', children: channel.name ?? channel.id }),
          jsx('span', { key: 'id', className: 'mgc-id', children: channel.id }),
        ],
      }),
      jsx('div', {
        key: 'pills',
        children: cardPills({ models, accounts, daily, signedIn: channel.signedIn, t }),
      }),
      ...accounts.map((account, index) => jsx(AccountBlock, { key: `account-${index}`, account, t })),
      ...daily.map((entry, index) => jsx(DailyRow, { key: `daily-${index}`, entry, t })),
      jsx('div', {
        key: 'models',
        className: 'mgc-models',
        children: models.map((id) => jsx(ModelRow, { key: id, id })),
      }),
    ],
  }, `channel-${channel.id}`)
}


/** The page: header, banners, and one card per channel. */
function ChannelsPage(props) {
  const t = props.t
  const [state, setState] = useState({ status: 'loading' })
  const load = useCallback(async (force) => {
    setState((previous) => ({ ...previous, status: 'loading', error: undefined }))
    try {
      const response = await fetch(force === true ? `${REPORT_PATH}?refresh=1` : REPORT_PATH, { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setState({ status: 'ready', report: await response.json() })
    } catch (error) {
      setState({ status: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  }, [])
  useEffect(() => {
    void load(false)
  }, [load])

  const report = state.report
  const channels = Array.isArray(report?.channels) ? report.channels : []
  const catalog = report?.catalog
  const busy = state.status === 'loading'
  let banner
  if (state.status === 'error') banner = { tone: 'bad', text: t('loadFailed', { message: state.error ?? '' }) }
  else if (catalog !== undefined && catalog.status !== 'ok') banner = { tone: 'warn', text: t('catalogDown', { message: catalog.error ?? catalog.status }) }

  return jsx('div', {
    className: 'mgc-page',
    children: [
      jsx('header', {
        key: 'head',
        className: 'mgc-head',
        children: createElement(HeadRow, { t, report, channels, busy, onRefresh: () => void load(true) }),
      }),
      banner === undefined
        ? null
        : jsx('div', { key: 'banner', className: 'mgc-banner', 'data-tone': banner.tone, children: banner.text }),
      report === undefined && busy
        ? jsx('p', { key: 'loading', className: 'mgc-empty', children: t('loading') })
        : null,
      report !== undefined && channels.length === 0
        ? jsx('p', { key: 'empty', className: 'mgc-empty', children: t('empty') })
        : null,
      jsx('div', {
        key: 'grid',
        className: 'mgc-grid',
        children: channels.map((channel) => jsx(ChannelCard, { key: channel.id, channel, t })),
      }),
    ],
  })
}

/** Title, summary line, and the refresh button. */
function HeadRow({ t, report, channels, busy, onRefresh }) {
  return [
    jsx('div', {
      key: 'titles',
      children: [
        jsx('h1', { key: 'title', className: 'mgc-title', children: t('panel') }),
        jsx('p', {
          key: 'sub',
          className: 'mgc-sub',
          children: report === undefined
            ? t('subtitleEmpty')
            : t('subtitle', { channels: report.totals?.channels ?? channels.length, models: report.totals?.models ?? 0 }),
        }),
      ],
    }),
    jsx('div', {
      key: 'actions',
      className: 'mgc-actions',
      children: createElement('button', {
        type: 'button',
        className: 'mgc-btn',
        disabled: busy,
        onClick: onRefresh,
      }, busy ? t('refreshing') : t('refresh')),
    }),
  ]
}

/**
 * Contribute the sidebar entry and the page it opens.
 * @param ctx - the browser plugin context.
 */
function apply(ctx) {
  styleOnce()
  ctx.effect(() => ctx.locale.register(NS, DICTIONARIES), 'magpie-channels: dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.slots.inject('main', function* () {
    yield ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, ChannelsPage)
  })

  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 40,
    label: () => t('panel'),
    locale: NS,
  }, ChannelsPanelIcon))
}



      return {
        apply,
        inject,
        NS,
        PANEL_ID,
        REPORT_PATH,
        ChannelsPage,
        ChannelsPanelIcon,
        ChannelCard,
        AccountBlock,
        WindowBlock,
        HeadRow,
      }
    },
  })
})()
