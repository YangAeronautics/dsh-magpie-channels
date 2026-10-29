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

/*__BODY__*/

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
