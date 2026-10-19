#!/usr/bin/env node
/**
 * Accessibility audit for things a layout assertion cannot see.
 *
 *   npm run build
 *   node server.mjs
 *   node ux-audit.mjs                     # add --headed to watch it
 *
 * Checks, on a phone viewport and in both themes:
 *
 *   1. WCAG 2.1 AA contrast for every visible text node against its own
 *      computed background — 4.5:1 for body text, 3:1 for text >= 24px
 *      (or >= 18.66px bold).
 *   2. An accessible name on every interactive element. `title` alone is not
 *      enough: TalkBack does not reliably announce it and touch users never
 *      see it, so it must not be the *only* source.
 *   3. Spacing between adjacent tap targets, to catch controls so close
 *      together they cause mis-taps.
 *   4. Clipping in the compact player bar, where there is no room to grow.
 *   5. The layout still holds at 1.3x system text (Android's largest
 *      non-display font scale).
 *
 * Exits 0 only with zero findings. Like mobile-verify.mjs it needs Playwright
 * and a running gateway, and says so plainly rather than passing silently.
 */
import { installFixtures } from './test/fixtures/api.js'

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:8000'
const HEADED = process.argv.includes('--headed')
const VIEWPORT = { width: 393, height: 851 }
const MIN_GAP_PX = 8

const findings = []
const note = (check, message) => {
  findings.push({ check, message })
  console.log(`  [finding] ${check}: ${message}`)
}
const ok = (check, detail = '') => console.log(`  [  ok  ] ${check}${detail ? ` — ${detail}` : ''}`)

// ------------------------------------------------------------- contrast math

/** WCAG relative luminance from linearised sRGB channels. */
function luminance([r, g, b]) {
  const lin = (c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const parseColor = (s) => {
  const m = /rgba?\(([^)]+)\)/.exec(s || '')
  if (!m) return null
  const [r, g, b, a] = m[1].split(/[\s,/]+/).map(Number)
  if ([r, g, b].some((n) => Number.isNaN(n))) return null
  return { rgb: [r, g, b], alpha: a === undefined ? 1 : a }
}

/** Flatten `fg` over `bg` at the given alpha, the way a compositor would. */
const over = (fg, bg, alpha) =>
  fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)))

// ------------------------------------------------------- in-page collectors

/**
 * Runs in the page. Returns every visible run of text with its computed colour,
 * size, weight and the first opaque background behind it.
 */
function collectText() {
  const out = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let node
  while ((node = walker.nextNode())) {
    const text = (node.nodeValue || '').trim()
    if (!text) continue
    const el = node.parentElement
    if (!el) continue

    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.1) continue

    const range = document.createRange()
    range.selectNodeContents(node)
    const rect = range.getBoundingClientRect()
    if (!rect.width || !rect.height) continue // not laid out

    const fg = cs.color
    const size = Number.parseFloat(cs.fontSize)
    const weight = Number.parseInt(cs.fontWeight, 10) || 400

    // Nearest ancestor with a non-transparent background.
    let bg = 'rgb(255, 255, 255)'
    for (let p = el; p; p = p.parentElement) {
      const c = getComputedStyle(p).backgroundColor
      const a = /rgba?\([^)]+,\s*([\d.]+)\)/.exec(c)
      if (c && c !== 'transparent' && (!a || Number(a[1]) > 0)) {
        bg = c
        break
      }
    }

    out.push({
      text: text.slice(0, 40),
      selector:
        el.tagName.toLowerCase() +
        (el.id ? '#' + el.id : '') +
        (typeof el.className === 'string' && el.className.trim()
          ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
          : ''),
      fg,
      bg,
      size,
      weight,
    })
  }
  return out
}

/** Interactive elements and how they are named. */
function collectControls() {
  const out = []
  for (const el of document.querySelectorAll('button, a[href], input, select, textarea, [role="button"]')) {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) continue

    const label = el.getAttribute('aria-label')
    const labelledBy = el.getAttribute('aria-labelledby')
    const text = (el.textContent || '').trim()
    const title = el.getAttribute('title')
    const alt = el.getAttribute('alt')
    const placeholder = el.getAttribute('placeholder')
    const value = el.getAttribute('value')

    out.push({
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      cls: typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : '',
      hasAriaLabel: !!label,
      hasLabelledBy: !!labelledBy,
      hasText: !!text,
      hasAlt: !!alt,
      hasPlaceholder: !!placeholder,
      hasValue: !!value,
      hasTitle: !!title,
      // Emoji-only buttons: no words, so a screen reader has nothing unless
      // aria-label supplies it.
      emojiOnly: !text || !/[A-Za-z0-9]/.test(text),
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
    })
  }
  return out
}

/** Elements whose text is being cut off by their own box. */
function collectClipping() {
  const out = []
  for (const el of document.querySelectorAll('#playerbar *, .player-bar *, .mob-nav *')) {
    const cs = getComputedStyle(el)
    if (cs.overflow !== 'hidden' && cs.textOverflow !== 'ellipsis') continue
    if (el.scrollWidth <= el.clientWidth + 1) continue
    const text = (el.textContent || '').trim()
    if (!text) continue
    out.push({
      selector: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + '.' + (el.className || ''),
      text: text.slice(0, 30),
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    })
  }
  return out
}

// ------------------------------------------------------------------- checks

function checkContrast(label, texts) {
  let bad = 0
  for (const t of texts) {
    const fg = parseColor(t.fg)
    const bg = parseColor(t.bg)
    if (!fg || !bg) continue
    const fgFlat = over(fg.rgb, bg.rgb, fg.alpha)
    const r = ratio(fgFlat, bg.rgb)
    const large = t.size >= 24 || (t.size >= 18.66 && t.weight >= 700)
    const min = large ? 3 : 4.5
    if (r < min) {
      bad++
      note(
        label,
        `${r.toFixed(2)}:1 on "${t.text}" (${t.selector}) — needs ${min}:1 ` +
          `[${t.fg} on ${t.bg}, ${t.size}px/${t.weight}]`
      )
    }
  }
  if (!bad) ok(label, `${texts.length} text runs, all at AA`)
}

function checkNames(label, controls) {
  let bad = 0
  for (const c of controls) {
    const named = c.hasAriaLabel || c.hasLabelledBy || c.hasText || c.hasAlt || c.hasPlaceholder || c.hasValue
    if (named) continue
    bad++
    note(
      label,
      `no accessible name on <${c.tag}${c.id ? '#' + c.id : ''}${c.cls ? '.' + c.cls : ''}>` +
        (c.hasTitle ? ' — it has only a title, which TalkBack may not announce' : '')
    )
  }
  if (!bad) ok(label, `${controls.length} interactive elements, all named`)
}

function checkSpacing(label, controls) {
  let bad = 0
  for (let i = 0; i < controls.length; i++) {
    for (let j = i + 1; j < controls.length; j++) {
      const a = controls[i].rect
      const b = controls[j].rect
      // Only controls that share a row or column can realistically be mis-tapped.
      const verticalGap = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h))
      const horizontalGap = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w))
      if (verticalGap > 4 || horizontalGap > 24) continue // not adjacent
      const gap = Math.max(verticalGap, horizontalGap)
      if (gap >= MIN_GAP_PX) continue
      bad++
      note(
        label,
        `${Math.round(gap)}px between <${controls[i].tag}${controls[i].id ? '#' + controls[i].id : ''}> ` +
          `and <${controls[j].tag}${controls[j].id ? '#' + controls[j].id : ''}> — want >= ${MIN_GAP_PX}px`
      )
    }
  }
  if (!bad) ok(label, `${controls.length} controls, none closer than ${MIN_GAP_PX}px`)
}

function checkClipping(label, clipped) {
  for (const c of clipped) {
    note(label, `"${c.text}" is clipped (${c.scrollWidth}px in a ${c.clientWidth}px box) at ${c.selector}`)
  }
  if (!clipped.length) ok(label, 'no truncated text in the player or tab bar')
}

// --------------------------------------------------------------------- main

async function main() {
  let chromium
  try {
    ;({ chromium } = await import('playwright'))
  } catch {
    console.error(
      '\nPlaywright is not installed, so this audit cannot run.\n' +
        '  npm i -D playwright && npx playwright install chromium\n' +
        'Nothing was audited — this is not a pass.\n'
    )
    process.exit(2)
  }

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
    console.error('Nothing was audited — this is not a pass.\n')
    process.exit(2)
  }
  try {
    for (const theme of ['dark', 'light']) {
      console.log(`\n=== ${theme} theme, ${VIEWPORT.width}x${VIEWPORT.height} ===`)
      const context = await browser.newContext({
        isMobile: true,
        hasTouch: true,
        viewport: VIEWPORT,
        deviceScaleFactor: 2,
      })
      const page = await context.newPage()
      await installFixtures(page)

      const pageErrors = []
      page.on('pageerror', (e) => pageErrors.push(String(e)))

      await page.goto(APP_URL, { waitUntil: 'networkidle' })
      await page.waitForTimeout(500)

      // Flip the theme the way the UI does, then let the styles settle.
      if (theme === 'light') {
        await page.evaluate(() => {
          localStorage.setItem('svTheme', 'light')
          document.body.classList.add('light')
        })
        await page.reload({ waitUntil: 'networkidle' })
        await page.waitForTimeout(500)
      }
      const isLight = await page.evaluate(() => document.body.classList.contains('light'))
      if (isLight !== (theme === 'light')) {
        note('theme', `asked for ${theme} but the body class says otherwise`)
      }

      checkContrast(`${theme}: WCAG AA contrast`, await page.evaluate(collectText))
      const controls = await page.evaluate(collectControls)
      checkNames(`${theme}: accessible names`, controls)
      checkSpacing(`${theme}: tap-target spacing`, controls)
      checkClipping(`${theme}: compact player bar`, await page.evaluate(collectClipping))

      if (pageErrors.length) note(`${theme}: page errors`, pageErrors.slice(0, 2).join(' | '))
      else ok(`${theme}: no unhandled page errors`)

      await context.close()
    }

    // 1.3x system text: Android's largest non-display font scale.
    console.log(`\n=== ${VIEWPORT.width}x${VIEWPORT.height} at 1.3x system text ===`)
    const context = await browser.newContext({
      isMobile: true,
      hasTouch: true,
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
    })
    const page = await context.newPage()
    await installFixtures(page)
    await page.addInitScript(() => {
      const el = document.createElement('style')
      el.textContent = 'html { font-size: 130% !important; }'
      document.documentElement.appendChild(el)
    })
    await page.goto(APP_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(600)

    const over = await page.evaluate(() => {
      const doc = document.documentElement
      const px = doc.scrollWidth - doc.clientWidth
      if (px <= 1) return null
      let worst = null
      for (const el of document.querySelectorAll('*')) {
        const r = el.getBoundingClientRect()
        if (r.right > doc.clientWidth + 1 && (!worst || r.right > worst.right)) {
          worst = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '')
        }
      }
      return { px, worst }
    })
    if (over) note('1.3x text', `horizontal overflow of ${over.px}px, worst offender ${over.worst}`)
    else ok('1.3x text', 'no horizontal overflow')

    const clipped = await page.evaluate(collectClipping)
    checkClipping('1.3x text: player bar', clipped)

    await context.close()
  } finally {
    await browser.close()
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log(findings.length ? `FAIL ${findings.length} finding(s)` : 'PASS 0 findings')
  process.exit(findings.length ? 1 : 0)
}

main().catch((e) => {
  console.error('\nAudit crashed:', e)
  process.exit(2)
})
