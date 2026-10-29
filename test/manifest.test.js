import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Config, inject, name, ROUTE_PATH, resolveConfig } from '../index.js'

test('the manifest exports the documented plugin identity', () => {
  assert.equal(name, 'magpie-channels')
  assert.equal(ROUTE_PATH, '/api/magpie-channels/report')
  assert.deepEqual(inject, ['webServer', 'tools'])
})

test('Config declares both fields with defaults the Loader applies', () => {
  const json = JSON.stringify(Config.toJSON ? Config.toJSON() : Config)
  assert.match(json, /gatewayUrl/)
  assert.match(json, /ledgerDir/)
  assert.match(json, /http:\/\/127\.0\.0\.1:3425/)
})

test('resolveConfig keeps a configured gateway and ledger directory', () => {
  const options = resolveConfig({ gatewayUrl: 'http://10.0.0.5:9000', ledgerDir: 'D:\\magpie' })
  assert.equal(options.gatewayUrl, 'http://10.0.0.5:9000')
  assert.equal(options.ledgerDir, 'D:\\magpie')
})

test('resolveConfig falls back to the documented gateway when config is absent', () => {
  // `apply` always receives Loader-defaulted config, but a direct caller may
  // pass nothing; the gateway default must survive that path.
  assert.equal(resolveConfig().gatewayUrl, 'http://127.0.0.1:3425')
  assert.equal(resolveConfig({}).gatewayUrl, 'http://127.0.0.1:3425')
})

test('resolveConfig treats an empty ledgerDir as "resolve the default location"', () => {
  // The empty string is the schema default: the real path needs the host
  // environment, so resolveConfig must hand back a concrete directory instead.
  const options = resolveConfig({ ledgerDir: '' })
  assert.equal(typeof options.ledgerDir, 'string')
  assert.notEqual(options.ledgerDir, '')
})

test('resolveConfig ignores an empty gateway string rather than fetching ""', () => {
  assert.equal(resolveConfig({ gatewayUrl: '' }).gatewayUrl, 'http://127.0.0.1:3425')
})

test('display metadata exists for both locales', async () => {
  const { readFile } = await import('node:fs/promises')
  for (const locale of ['en', 'zh']) {
    const raw = await readFile(new URL(`../locale/${locale}.json`, import.meta.url), 'utf8')
    const json = JSON.parse(raw)
    assert.equal(typeof json.meta?.title, 'string')
    assert.equal(typeof json.meta?.description, 'string')
    assert.ok(json.meta.title.length > 0, `${locale} title must not be empty`)
    assert.ok(json.meta.description.length > 0, `${locale} description must not be empty`)
  }
})

test('the package exports the icon and locale resources it ships', async () => {
  const { readFile } = await import('node:fs/promises')
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.exports['./icon'], './icon.svg')
  assert.equal(pkg.exports['./locale/*.json'], './locale/*.json')
  for (const entry of ['icon.svg', 'cordis.patch.yml', 'index.js', 'locale/*.json']) {
    assert.ok(pkg.files.includes(entry), `files must list ${entry}`)
  }
})

test('the icon is a real SVG image inside the size limit', async () => {
  const { readFile, stat } = await import('node:fs/promises')
  const path = new URL('../icon.svg', import.meta.url)
  const info = await stat(path)
  assert.ok(info.size < 256 * 1024, 'icon must stay under 256 KiB')
  const svg = await readFile(path, 'utf8')
  assert.match(svg, /^<svg[\s>]/)
  assert.match(svg, /viewBox="0 0 64 64"/)
})
