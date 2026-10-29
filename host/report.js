/**
 * One report assembly shared by the HTTP route and the model-facing tool, so
 * the panel and the model can never disagree about a channel's balance.
 */

import { readLedger, defaultLedgerDir } from './catalog.js'
import { buildReport, labelsFromProviders, latestReadAt } from './ledger.js'

/**
 * Read catalog + ledger and project every channel.
 *
 * @param {object} deps - `{ catalog: CatalogCache, ledgerDir?: string, force?: boolean }`.
 * @returns {Promise<object>} the report; `status` is `ok` whenever the ledger
 *   answered, `error`/`offline` when the catalog could not be read.
 */
export async function collectReport(deps) {
  const ledgerDir = deps.ledgerDir ?? defaultLedgerDir()
  const [catalog, ledger] = await Promise.all([
    deps.catalog.read({ force: deps.force === true }),
    readLedger(ledgerDir),
  ])
  const labels = labelsFromProviders(ledger.data.providers)
  const channels = buildReport({
    models: catalog.status === 'ok' ? catalog.models : [],
    quotas: ledger.data.quotas,
    pluginProviders: ledger.data.pluginProviders,
    creditDaily: ledger.data.creditDaily,
    quotaHistory: ledger.data.quotaHistory,
    labels,
  })
  const withModels = channels.filter((channel) => channel.modelCount > 0).length
  return {
    generatedAt: new Date().toISOString(),
    catalog: {
      status: catalog.status,
      url: catalog.url,
      at: catalog.at,
      models: catalog.status === 'ok' ? catalog.models.length : 0,
      ...(catalog.error === undefined ? {} : { error: catalog.error }),
    },
    ledger: {
      dir: ledgerDir,
      readAt: latestReadAt(channels),
      errors: ledger.errors,
    },
    totals: {
      channels: channels.length,
      channelsWithModels: withModels,
      models: catalog.status === 'ok' ? catalog.models.length : 0,
    },
    channels,
  }
}
