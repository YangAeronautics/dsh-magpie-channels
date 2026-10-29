/**
 * Host half of dsh-magpie-channels.
 *
 * Contributes one HTTP route the browser panel reads, and one model-facing tool
 * that reports the same numbers inside a conversation. Everything is derived
 * from Magpie's local gateway catalog and its quota ledger; this plugin never
 * writes to either, never holds a credential, and never starts a process.
 *
 * Wiring sources:
 * - `ctx.inject(['webServer', 'tools'], …)` — neither service may exist yet at
 *   apply time; the scoped callback runs once both are available.
 * - `ctx.webServer.register({ kind: 'exact', path, handler })` — same shape as
 *   the locally installed `dsh-our-free-model` bundle.
 * - `Config` (Schemastery) — the documented Config contract: the Loader
 *   validates and defaults the row's `config` before `apply` runs, so `apply`
 *   receives a complete config instead of reading `ctx.fiber` itself.
 */

import { createRequire } from 'node:module'

import { CatalogCache, defaultLedgerDir } from './host/catalog.js'
import { collectReport } from './host/report.js'
import { toolValue } from './host/tool-value.js'

/** Package name; also the bundle row name the client half binds to. */
export const name = 'magpie-channels'

/** Route the browser panel fetches. */
export const ROUTE_PATH = '/api/magpie-channels/report'

/** Services needed before anything can be contributed. */
export const inject = ['webServer', 'tools']

/** Load Schemastery from the Harness process (served, not bundled by this package). */
function loadSchema() {
  const mod = createRequire(import.meta.url)('@deepseek-ai/schemastery')
  return mod.default ?? mod
}

/**
 * Config schema for this bundle row.
 *
 * Declared through Schemastery so Plugin Manager and Settings can render the
 * fields and a malformed `config` fails activation instead of silently falling
 * back. `ledgerDir` defaults to the empty string, meaning "resolve from
 * `$MAGPIE_HOME` or `~/.config/magpie`": that resolution needs the host
 * environment, so it stays in `defaultLedgerDir()` at apply time.
 *
 * @type {unknown}
 */
export const Config = (() => {
  const z = loadSchema()
  return z.object({
    gatewayUrl: z.string()
      .default('http://127.0.0.1:3425')
      .description('Magpie 网关地址，例如 http://127.0.0.1:3425'),
    ledgerDir: z.string()
      .default('')
      .description('Magpie 账本目录；留空则用 $MAGPIE_HOME 或 ~/.config/magpie'),
  })
})()

/**
 * Resolve the runtime options from the validated row config.
 *
 * `apply` passes the Loader-validated `config`, but tests and any direct caller
 * may pass nothing, so this still applies the documented defaults.
 *
 * @param config - the row config, already defaulted by the Loader.
 */
export function resolveConfig(config) {
  const source = config ?? {}
  return {
    gatewayUrl: typeof source.gatewayUrl === 'string' && source.gatewayUrl !== '' ? source.gatewayUrl : 'http://127.0.0.1:3425',
    ledgerDir: typeof source.ledgerDir === 'string' && source.ledgerDir !== '' ? source.ledgerDir : defaultLedgerDir(),
  }
}

/**
 * Answer the report route.
 * @param request - the node request.
 * @param response - the node response.
 * @param deps - catalog cache, ledger dir, and logger.
 */
export async function handleReport(request, response, { catalog, ledgerDir, logger }) {
  if (request.method !== 'GET') {
    response.writeHead(405, { 'content-type': 'application/json; charset=utf-8', allow: 'GET' })
    response.end(JSON.stringify({ error: 'method not allowed' }))
    return
  }
  try {
    const url = new URL(request.url ?? ROUTE_PATH, 'http://localhost')
    const report = await collectReport({ catalog, ledgerDir, force: url.searchParams.get('refresh') === '1' })
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    response.end(JSON.stringify(report))
  } catch (error) {
    logger?.warn?.('magpie-channels: report failed', error)
    response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
  }
}

/**
 * The model-facing tool: what each Magpie channel serves and what is left.
 * @param deps - catalog cache and ledger dir.
 */
export function channelsTool({ catalog, ledgerDir, define }) {
  return define({
    name: 'magpie_channels',
    description:
      '报告本机 Magpie 网关各渠道（zcode、workbuddy、deepseek、qoder-cn、qwenwork、trae-cn、codearts、minimax-code）当前可用的 LLM 模型及其余额/额度：每个渠道的模型清单、各额度窗口的剩余量与重置时间、每日消耗与最近读取时间。用于挑选额度充足且该渠道确实在线的模型。只读，不改变任何状态。',
    parameters: {
      channel: { type: 'string', description: '只看某个渠道，例如 zcode、deepseek。省略返回全部渠道。' },
      modelsOnly: { type: 'boolean', description: '只返回渠道与模型清单，不返回额度明细。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: renderChannels(value) }],
    },
    async execute(args, exec) {
      const report = await collectReport({ catalog, ledgerDir })
      if (exec?.signal?.aborted === true) throw new Error('magpie-channels: aborted')
      if (args.channel !== undefined && !report.channels.some((entry) => entry.id === args.channel)) {
        throw new Error(`未知渠道 ${args.channel}；现有渠道：${report.channels.map((entry) => entry.id).join(', ')}`)
      }
      // The Harness rejects any returned value that is not lossless JSON, so the
      // projection in host/tool-value.js drops absent fields instead of leaving
      // `undefined` behind (see that module's header).
      return toolValue(report, { channel: args.channel, modelsOnly: args.modelsOnly === true })
    },
  })
}

/** Turn the tool value into the text the model reads. */
export function renderChannels(value) {
  const lines = []
  const catalog = value?.catalog ?? {}
  lines.push(`Magpie ${catalog.status ?? 'unknown'}（${catalog.models ?? 0} 个模型，${catalog.url ?? '?'}），账本 ${value?.ledgerDir ?? '?'}`)
  if (catalog.error !== undefined) lines.push(`网关错误：${catalog.error}`)
  for (const entry of value?.ledgerErrors ?? []) lines.push(`账本错误：${entry.file} — ${entry.message}`)
  for (const channel of value?.channels ?? []) {
    const models = Array.isArray(channel.models) ? channel.models : []
    lines.push('')
    lines.push(`${channel.name ?? channel.id}（${channel.id}）：${models.length > 0 ? models.join(', ') : '网关未提供模型'}`)
    if (channel.balance !== undefined) lines.push(`  余额：${channel.balance}`)
    for (const window of channel.windows ?? []) {
      const used = window.used !== undefined && window.limit !== undefined
        ? `${window.used} / ${window.limit}${window.unit === undefined ? '' : ` ${window.unit}`}`
        : window.display ?? '—'
      const left = window.remaining === undefined ? '?' : window.remaining
      const percent = Number.isFinite(window.percent) ? `${window.percent.toFixed(1)}%` : '?'
      const reset = window.resetsAt === undefined ? '' : `，${window.resetsAt} 重置`
      const soon = Number.isFinite(window.expiringPercent) ? ` ⚠ ${window.expiringPercent}% 即将过期` : ''
      const rolling = window.rolling === true ? ` ⏳ ${window.windowHours} 小时滚动，不刷即作废` : ''
      lines.push(`  ${window.name ?? '额度'}：已用 ${used}，剩 ${left}（${percent}${reset}）${soon}${rolling}`)
    }
    if (channel.resets?.until !== undefined) lines.push(`  到期：${channel.resets.until}`)
    for (const daily of channel.daily ?? []) {
      const left = daily.remaining === undefined ? '?' : daily.remaining
      lines.push(`  当日：已用 ${daily.used ?? '?'} / ${daily.total ?? '?'}，剩 ${left}`)
    }
    if (channel.ledgerAccounts > 1) lines.push(`  另有 ${channel.ledgerAccounts - 1} 个账本账户未列出`)
    if (channel.windows === undefined && channel.daily === undefined && channel.balance === undefined && channel.signedIn === true) {
      lines.push('  额度：账本暂无该渠道的额度记录')
    }
    if (channel.readAt !== undefined) lines.push(`  最近读取：${channel.readAt}`)
  }
  return lines.join('\n')
}

/**
 * Contribute the report route and the model-facing tool.
 * @param ctx - the plugin context.
 * @param config - this row's config, validated and defaulted by `Config`.
 */
export function apply(ctx, config) {
  const options = resolveConfig(config)
  const catalog = new CatalogCache({ baseUrl: options.gatewayUrl })
  const ledgerDir = options.ledgerDir

  ctx.inject(['webServer', 'tools'], (scoped) => {
    scoped.effect(() => scoped.webServer.register({
      kind: 'exact',
      path: ROUTE_PATH,
      handler: (request, response) => handleReport(request, response, { catalog, ledgerDir, logger: ctx.logger }),
    }), 'magpie-channels: report route')

    scoped.effect(
      () => scoped.tools.register(channelsTool({ catalog, ledgerDir, define: loadDefineTool() })),
      'magpie-channels: channels tool',
    )
  })
}

/**
 * Load `defineTool` from the host's own `@deepseek-ai/dsh-tools`.
 *
 * That package is a peer dependency served by the Harness process rather than
 * by this bundle's node_modules, so the import is resolved at mount time.
 * @returns the `defineTool` function.
 */
export function loadDefineTool() {
  return createRequire(import.meta.url)('@deepseek-ai/dsh-tools').defineTool
}