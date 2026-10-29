/**
 * Wrap the readable `client/index.js` body into the Harness `__ModuleLoader__`
 * bundle the web client can execute. Run after editing `client/index.js`:
 *
 *   node client/build.js
 *
 * The source keeps plain ESM `import`/`export` for readability and tests; the
 * emitted bundle carries the same code inside a factory closure.
 */

import { readFileSync, writeFileSync } from 'node:fs'

const body = readFileSync(new URL('./index.js', import.meta.url), 'utf8')
  .replace(/^import .*\r?\n/gm, '')
  .replace(/^export \{[^}]*\}\r?\n/gm, '')

const template = readFileSync(new URL('./bundle.template.js', import.meta.url), 'utf8')
if (!template.includes('/*__BODY__*/')) throw new Error('bundle.template.js lost its /*__BODY__*/ marker')

writeFileSync(new URL('./bundle.js', import.meta.url), template.replace('/*__BODY__*/', body))
