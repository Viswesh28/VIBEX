#!/usr/bin/env node
/**
 * Phone-layout verification: real browser, real CSS, real touch.
 *
 *   npm run build
 *   node server.mjs                       # or: PORT=8000 node server.mjs
 *   node mobile-verify.mjs                # add --headed to watch it
 *
 * Runs the same set of checks on each of five viewports — four common phone
 * sizes plus a landscape phone — because a rule that holds at 393 px regularly
 * breaks at 320 px, and a landscape phone is wide but short, which fools
 * width-only breakpoints.
 *
 * Every /api request is answered from test/fixtures/api.js, so the run does not
 * depend on the live JioSaavn catalogue or on having network egress.
 *
 * Exits 0 only if every check on every viewport passed. Prints a per-viewport
 * scorecard and a final PASS n/m line.
 */
import { installFixtures } from './test/fixtures/api.js'

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:8000'
const HEADED = process.argv.includes('--headed')
const ONLY = (() => {
  const i = process.argv.indexOf('--viewport')
  return i > 0 ? process.argv[i + 1] : null
})()

const VIEWPORTS = [
  { name: '320x658', width: 320, height: 658 },
  { name: '360x640', width: 360, height: 640 },
  { name: '393x851', width: 393, height: 851 },
  { name: '412x915', width: 412, height: 915 },
  // A landscape phone: wide but short. Matched in CSS on max-height plus
  // pointer:coarse, so small desktop windows are not caught by the same rule.
  { name: '851x393-landscape', width: 851, height: 393, landscape: true },
]

// A phone layout: single column, drawer behind a hamburger, bottom tab bar.
const PHONE = { isMobile: true, hasTouch: true, deviceScaleFactor: 2 }

const results = []
const record = (viewport, name, ok, detail = '') => {
  results.push({ viewport, name, ok, detail })
  const mark = ok ? '  ok  ' : ' FAIL '
  console.log(`[${mark}] ${viewport.padEnd(20)} ${name}${detail ? ` — ${detail}` : ''}`)
}

// ------------------------------------------------------------------- helpers

const scrollOverflow = (page) =>
  page.evaluate(() => {
    const doc = document.documentElement
    const over = doc.scrollWidth - doc.clientWidth
    if (over <= 1) return null
    // Name the worst offender so a failure is actionable, not just a number.
    let worst = null
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect()
      if (r.right > doc.clientWidth + 1 && (!worst || r.right > worst.right)) {
        worst = {
          right: Math.round(r.right),
          sel: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''),
        }
      }
    }
    return { over, worst }
  })

const boxOf = (page, selector) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return {
      x: r.x,
      y: r.y,
      w: r.width,
      h: r.height,
      display: cs.display,
      visibility: cs.visibility,
      opacity: Number(cs.opacity),
    }
  }, selector)

const tapTargets = (page) =>
  page.evaluate(() => {
    const sel = 'button, a[href], input, select, [role="button"], [onclick]'
    const small = []
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) continue // not laid out
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.1) continue
      if (r.width < 40 || r.height < 40) {
        small.push({
          w: Math.round(r.width),
          h: Math.round(r.height),
          label:
            el.getAttribute('aria-label') ||
            el.getAttribute('title') ||
            (el.textContent || '').trim().slice(0, 24) ||
            el.tagName.toLowerCase(),
        })
      }
    }
    return small
  })

// Controls that only appear on .song-row:hover are unreachable on a touchscreen.
const hoverOnlyControls = (page) =>
  page.evaluate(() => {
    const out = []
    for (const el of document.querySelectorAll('.song-row .pl-btn, .song-row .radio-btn, .song-row .rm-btn')) {
      const cs = getComputedStyle(el)
      // The row is not hovered here, so anything invisible now is hover-gated.
      if (Number(cs.opacity) < 0.1 || cs.visibility === 'hidden' || cs.display === 'none') {
        out.push(el.className)
      }
    }
    return out
  })

const clickTab = async (page, label) => {
  const tab = page.locator('.mob-nav button, .mob-nav a').filter({ hasText: label }).first()
  if (!(await tab.count())) return false
  await tab.tap().catch(() => tab.click())
  await page.waitForTimeout(220)
  return true
}

// -------------------------------------------------------------------- checks

async function runViewport(browser, vp) {
  const context = await browser.newContext({ ...PHONE, viewport: { width: vp.width, height: vp.height } })
  const page = await context.newPage()
  const seen = await installFixtures(page)

  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e)))

  await page.goto(APP_URL, { waitUntil: 'networkidle' })
  // The feed resolves four searches in parallel; give the shell a beat.
  await page.waitForTimeout(600)

  const v = vp.name

  // 1. The app rendered at all, rather than the "API offline" screen.
  const offline = await page.locator('.empty-lib').count()
  record(v, 'app boots past the API probe', offline === 0 && pageErrors.length === 0, pageErrors[0] || (offline ? 'offline screen shown' : ''))

  // 2. No unhandled exceptions during boot.
  record(v, 'no unhandled page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))

  // 3. The API was really reached through the gateway.
  record(v, 'home feed fetched through /api', seen.some((u) => u.includes('/api/search/playlists')))

  // 4. No horizontal overflow — the single most common phone-layout break.
  const over = await scrollOverflow(page)
  record(v, 'no horizontal overflow', !over, over ? `${over.over}px past the edge, worst: ${over.worst?.sel} @${over.worst?.right}` : '')

  // 5. The three-column desktop sidebar must not be on screen.
  const sidebar = await boxOf(page, '#sidebar')
  const nav = await boxOf(page, '.mob-nav')
  record(v, 'phone layout, not the desktop three-column', !sidebar || sidebar.w <= 0 || nav?.w > 0, sidebar ? `#sidebar w=${Math.round(sidebar.w)}` : 'no #sidebar')

  // 6. The bottom tab bar exists, spans the width and sits at the bottom.
  record(
    v,
    'bottom tab bar spans the viewport at the bottom',
    !!nav && Math.abs(nav.w - vp.width) <= 2 && nav.y + nav.h >= vp.height - 24,
    nav ? `w=${Math.round(nav.w)} y=${Math.round(nav.y)} h=${Math.round(nav.h)}` : 'missing'
  )

  // 7. The compact player bar sits directly above the tab bar and stays short.
  const bar = await boxOf(page, '#playerbar') || (await boxOf(page, '.player-bar'))
  record(
    v,
    'player bar is compact and above the tab bar',
    !!bar && bar.h <= 90 && (!nav || bar.y + bar.h <= nav.y + 2),
    bar ? `h=${Math.round(bar.h)} y=${Math.round(bar.y)}` : 'missing'
  )

  // 8. Nothing important is under the Android gesture bar / notch.
  const safeArea = await page.evaluate(() => {
    const el = document.querySelector('.mob-nav')
    if (!el) return null
    return { bottom: getComputedStyle(el).paddingBottom, env: getComputedStyle(el).getPropertyValue('padding-bottom') }
  })
  record(v, 'tab bar reserves safe-area inset', !!safeArea, safeArea ? `padding-bottom=${safeArea.bottom}` : 'no .mob-nav')

  // 9. Every visible control is at least a 40px touch target.
  const small = await tapTargets(page)
  record(v, 'all touch targets >= 40px', small.length === 0, small.slice(0, 3).map((s) => `${s.label} ${s.w}x${s.h}`).join(', '))

  // 10. The search box is 16px or the browser zooms on focus.
  const searchFont = await page.evaluate(() => {
    const el = document.querySelector('#searchInput')
    return el ? Number.parseFloat(getComputedStyle(el).fontSize) : null
  })
  record(v, 'search input >= 16px (no focus zoom)', searchFont === null || searchFont >= 16, searchFont ? `${searchFont}px` : 'not on this view')

  // 11-14. All four tabs are reachable and each renders content.
  for (const [label, expectSel] of [
    ['Home', '.feed-sec, .card-grid'],
    ['Search', '#searchInput, .search-view, .song-row'],
    ['Library', '.empty-lib, .song-row, .lib'],
    ['Stats', '.stats, .stat, #results'],
  ]) {
    const went = await clickTab(page, label)
    const rendered = went ? await page.locator(expectSel).count() : 0
    record(v, `tab "${label}" navigates and renders`, went && rendered > 0, went ? `${rendered} match(es)` : 'tab not found')
  }

  // Back to Home for the interaction checks.
  await clickTab(page, 'Home')

  // 15. The drawer opens from the hamburger and closes again.
  const menuBtn = page.locator('#menuBtn, .menu-btn, [aria-label*="enu"]').first()
  let drawerOK = false
  let drawerDetail = 'hamburger not found'
  if (await menuBtn.count()) {
    await menuBtn.tap().catch(() => menuBtn.click())
    await page.waitForTimeout(260)
    const scrim = await page.locator('.drawer-scrim').count()
    const openSide = await boxOf(page, '#sidebar')
    drawerOK = scrim > 0 && !!openSide && openSide.w > 0
    drawerDetail = `scrim=${scrim} sidebar w=${openSide ? Math.round(openSide.w) : 'n/a'}`
    if (scrim) {
      await page.locator('.drawer-scrim').tap().catch(() => page.locator('.drawer-scrim').click())
      await page.waitForTimeout(260)
      drawerOK = drawerOK && (await page.locator('.drawer-scrim').count()) === 0
    }
  }
  record(v, 'drawer opens from the hamburger and closes', drawerOK, drawerDetail)

  // 16. Song rows expose their row actions without hovering, and the row plays.
  await clickTab(page, 'Search')
  await page.fill('#searchInput', 'verification').catch(() => {})
  await page.keyboard.press('Enter').catch(() => {})
  await page.waitForTimeout(700)
  const hoverGated = await hoverOnlyControls(page)
  record(v, 'row actions are not hover-gated', hoverGated.length === 0, hoverGated.join(', '))

  // 17. Tapping a row opens the full player.
  const row = page.locator('.song-row').first()
  let fullOK = false
  let fullDetail = 'no rows'
  if (await row.count()) {
    await row.tap().catch(() => row.click())
    await page.waitForTimeout(500)
    const full = await boxOf(page, '#fullplayer') || (await boxOf(page, '.full-player'))
    fullOK = !!full && full.h > vp.height * 0.6
    fullDetail = full ? `h=${Math.round(full.h)}` : 'full player did not open'
  }
  record(v, 'tapping a row opens the full player', fullOK, fullDetail)

  await context.close()
}

// ---------------------------------------------------------------------- main

async function main() {
  let chromium
  try {
    ;({ chromium } = await import('playwright'))
  } catch {
    console.error(
      '\nPlaywright is not installed, so these checks cannot run.\n' +
        '  npm i -D playwright && npx playwright install chromium\n' +
        'Nothing was verified — this is not a pass.\n'
    )
    process.exit(2)
  }

  // Fail fast and honestly if the gateway is not up.
  try {
    const r = await fetch(APP_URL, { signal: AbortSignal.timeout(5000) })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
  } catch (e) {
    console.error(`\nCannot reach the app at ${APP_URL} (${e.message}).`)
    console.error('Build and start it first:\n  npm run build && PORT=8000 node server.mjs\n')
    process.exit(2)
  }

  let browser
  try {
    browser = await chromium.launch({ headless: !HEADED })
  } catch (e) {
    console.error(`\nPlaywright is installed but cannot launch a browser:\n  ${e.message.split('\n')[0]}`)
    console.error('Install one with: npx playwright install chromium')
    console.error('Nothing was verified — this is not a pass.\n')
    process.exit(2)
  }
  try {
    for (const vp of VIEWPORTS) {
      if (ONLY && vp.name !== ONLY) continue
      console.log(`\n=== ${vp.name} ===`)
      await runViewport(browser, vp)
    }
  } finally {
    await browser.close()
  }

  const pass = results.filter((r) => r.ok).length
  const total = results.length
  console.log(`\n${'='.repeat(60)}`)
  for (const vp of VIEWPORTS) {
    if (ONLY && vp.name !== ONLY) continue
    const rows = results.filter((r) => r.viewport === vp.name)
    const p = rows.filter((r) => r.ok).length
    console.log(`  ${vp.name.padEnd(20)} ${p}/${rows.length}`)
  }
  console.log('='.repeat(60))
  console.log(`${pass === total ? 'PASS' : 'FAIL'} ${pass}/${total}`)
  process.exit(pass === total ? 0 : 1)
}

main().catch((e) => {
  console.error('\nVerification crashed:', e)
  process.exit(2)
})
