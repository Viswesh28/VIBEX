/**
 * Thin wrapper over the Capacitor plugins.
 *
 * Dynamically imported so the plugin code never lands in the web bundle's
 * main chunk, and every call no-ops off-device.
 */
import { isNative } from './config.js'

let appMod = null

/**
 * Returns the *module namespace*, never the plugin object itself.
 *
 * Capacitor plugin proxies answer every property access with a function —
 * including `then` — so a plugin object is thenable. Returning one from an
 * async function makes `await` call `App.then()`, which throws
 * `"App.then()" is not implemented on web`. Handing back the module and
 * destructuring at the call site sidesteps that entirely.
 */
async function loadApp() {
  if (!appMod) appMod = await import('@capacitor/app')
  return appMod
}

/**
 * Register a hardware back-button handler.
 *
 * Returns an unsubscribe function, or a no-op off-device. The handler should
 * return `true` if it consumed the press; if it returns false we minimise the
 * app, which is what Android users expect at the root of the navigation stack
 * (exiting outright would kill playback).
 */
export async function onBackButton(handler) {
  if (!isNative()) return () => {}
  try {
    const { App } = await loadApp()
    const sub = await App.addListener('backButton', async () => {
      const consumed = await handler()
      if (!consumed) App.minimizeApp()
    })
    return () => sub.remove()
  } catch {
    return () => {}
  }
}
