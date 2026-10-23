/**
 * Always-on-Top Floating Desktop Mini Player (`Document Picture-in-Picture API`).
 */

import { decodeHtml, fmt } from './format.js'
import { artistsOf, imgOf } from './song.js'

let pipWin = null
const pipListeners = new Set()

function notifyPip() {
  const open = Boolean(pipWin && !pipWin.closed)
  pipListeners.forEach((fn) => {
    try {
      fn(open)
    } catch {
      /* ignore */
    }
  })
}

export function isDocumentPipSupported() {
  return typeof window !== 'undefined' && 'documentPictureInPicture' in window
}

export const isPipSupported = isDocumentPipSupported

export function isPipOpen() {
  return Boolean(pipWin && !pipWin.closed)
}

export function subscribePipState(fn) {
  pipListeners.add(fn)
  return () => pipListeners.delete(fn)
}

export function closePipPlayer() {
  if (pipWin && !pipWin.closed) {
    try {
      pipWin.close()
    } catch {
      /* ignore */
    }
  }
  pipWin = null
  notifyPip()
}

export async function openOrTogglePipPlayer({ state, actions }) {
  if (!isDocumentPipSupported()) {
    throw new Error('Floating Mini Player requires Chrome or Edge desktop (Document PiP API).')
  }
  if (pipWin && !pipWin.closed) {
    closePipPlayer()
    return false
  }

  const win = await window.documentPictureInPicture.requestWindow({
    width: 360,
    height: 158,
  })
  pipWin = win

  win.document.head.innerHTML = `
    <style>
      * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
      body {
        margin: 0; padding: 14px; background: #0c0c12; color: #fff;
        display: flex; flex-direction: column; justify-content: space-between;
        height: 100vh; overflow: hidden; user-select: none;
      }
      .row { display: flex; align-items: center; gap: 12px; min-width: 0; }
      img { width: 58px; height: 58px; border-radius: 12px; object-fit: cover; background: #1c1c26; flex-shrink: 0; }
      .meta { min-width: 0; flex: 1; }
      .t { font-size: 14px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .a { font-size: 12px; color: rgba(255,255,255,0.66); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
      .bar { height: 4px; background: rgba(255,255,255,0.14); border-radius: 99px; overflow: hidden; cursor: pointer; margin: 10px 0 8px; }
      .fill { height: 100%; background: #ff4d6d; width: 0%; transition: width 0.2s linear; }
      .ctrls { display: flex; align-items: center; justify-content: space-between; }
      .btns { display: flex; align-items: center; gap: 8px; }
      button {
        border: 0; border-radius: 999px; background: rgba(255,255,255,0.1); color: #fff;
        padding: 6px 12px; font-size: 12px; font-weight: 700; cursor: pointer;
      }
      button.primary { background: #ff4d6d; color: #fff; padding: 6px 16px; }
      button:hover { opacity: 0.9; }
      .tm { font-size: 11px; color: rgba(255,255,255,0.6); font-variant-numeric: tabular-nums; }
    </style>
  `
  win.document.body.innerHTML = `
    <div class="row">
      <img id="pipArt" alt="" />
      <div class="meta">
        <div class="t" id="pipTitle">Nothing playing</div>
        <div class="a" id="pipArtist">VIBEX</div>
      </div>
    </div>
    <div>
      <div class="bar" id="pipBar"><div class="fill" id="pipFill"></div></div>
      <div class="ctrls">
        <span class="tm" id="pipTime">0:00 / 0:00</span>
        <div class="btns">
          <button id="pipPrev" aria-label="Previous">⏮</button>
          <button id="pipToggle" class="primary" aria-label="Play or Pause">▶</button>
          <button id="pipNext" aria-label="Next">⏭</button>
          <button id="pipLike" aria-label="Like">♡</button>
        </div>
      </div>
    </div>
  `

  win.document.getElementById('pipPrev')?.addEventListener('click', () => actions.prev?.())
  win.document.getElementById('pipToggle')?.addEventListener('click', () => actions.toggle?.())
  win.document.getElementById('pipNext')?.addEventListener('click', () => actions.next?.())
  win.document.getElementById('pipLike')?.addEventListener('click', () => actions.like?.())
  win.document.getElementById('pipBar')?.addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    actions.seekFrac?.(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)))
  })
  win.addEventListener('pagehide', () => {
    pipWin = null
    notifyPip()
  })

  notifyPip()
  updatePipPlayer(state || {})
  return true
}

export function openPipPlayer({
  current,
  isPlaying,
  progressFrac = 0,
  onTogglePlay,
  onPrev,
  onNext,
} = {}) {
  return openOrTogglePipPlayer({
    state: {
      current,
      isPlaying,
      clock: { cur: progressFrac * (Number(current?.duration) || 100), dur: Number(current?.duration) || 100 },
    },
    actions: {
      toggle: onTogglePlay,
      prev: onPrev,
      next: onNext,
    },
  })
}

export function updatePipPlayer({ current, isPlaying, clock, liked, dataSaver }) {
  if (!pipWin || pipWin.closed) return
  const doc = pipWin.document
  const art = doc.getElementById('pipArt')
  const title = doc.getElementById('pipTitle')
  const artist = doc.getElementById('pipArtist')
  const fill = doc.getElementById('pipFill')
  const time = doc.getElementById('pipTime')
  const toggle = doc.getElementById('pipToggle')
  const like = doc.getElementById('pipLike')

  if (art) art.src = current ? imgOf(current, dataSaver) : ''
  if (title) title.textContent = current ? decodeHtml(current.name) : 'Nothing playing'
  if (artist) artist.textContent = current ? decodeHtml(artistsOf(current)) : 'Pick a song'
  const pct = clock?.dur ? Math.min(100, (clock.cur / clock.dur) * 100) : 0
  if (fill) fill.style.width = `${pct}%`
  if (time) time.textContent = `${fmt(clock?.cur || 0)} / ${fmt(clock?.dur || 0)}`
  if (toggle) toggle.textContent = isPlaying ? '⏸' : '▶'
  if (like) like.textContent = liked ? '♥' : '♡'
}
