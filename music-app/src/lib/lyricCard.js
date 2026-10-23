/**
 * Shareable Lyric Card Generator (`1080x1350` retina poster).
 *
 * Renders a blurred-artwork editorial poster featuring the song cover, active
 * lyric lines, track metadata, and a subtle VIBEX footer badge, then invokes
 * native Web Share (`navigator.share({ files })`) or downloads a PNG file.
 */

import { decodeHtml } from './format.js'
import { artistsOf, imgOf } from './song.js'

function wrapText(ctx, text, maxWidth) {
  const words = String(text || '').split(/\s+/).filter(Boolean)
  const lines = []
  let cur = ''
  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word
    if (ctx.measureText(test).width > maxWidth && cur) {
      lines.push(cur)
      cur = word
    } else {
      cur = test
    }
  }
  if (cur) lines.push(cur)
  return lines
}

function loadCorsImage(url) {
  if (!url) return Promise.resolve(null)
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    const timer = setTimeout(() => resolve(null), 3500)
    img.onload = () => {
      clearTimeout(timer)
      resolve(img)
    }
    img.onerror = () => {
      clearTimeout(timer)
      resolve(null)
    }
    img.src = url
  })
}

export async function generateLyricCardBlob({ song, track, lines = [] }) {
  const targetSong = song || track
  const W = 1080
  const H = 1350
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas rendering is not supported in this browser.')

  // Rich atmospheric gradient background
  const grad = ctx.createLinearGradient(0, 0, W, H)
  grad.addColorStop(0, '#1a1026')
  grad.addColorStop(0.5, '#131629')
  grad.addColorStop(1, '#09090b')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)

  const coverImg = await loadCorsImage(imgOf(targetSong, false))
  if (coverImg) {
    ctx.save()
    ctx.globalAlpha = 0.28
    ctx.drawImage(coverImg, -120, -120, W + 240, H + 240)
    ctx.restore()
  }

  // Dark glass card container
  ctx.fillStyle = 'rgba(12, 12, 18, 0.76)'
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') ctx.roundRect(72, 84, W - 144, H - 168, 44)
  else if (typeof ctx.rect === 'function') ctx.rect(72, 84, W - 144, H - 168)
  ctx.fill()

  // Header song badge
  if (coverImg) {
    ctx.save()
    ctx.beginPath()
    if (typeof ctx.roundRect === 'function') ctx.roundRect(136, 152, 132, 132, 24)
    else if (typeof ctx.rect === 'function') ctx.rect(136, 152, 132, 132)
    ctx.clip()
    ctx.drawImage(coverImg, 136, 152, 132, 132)
    ctx.restore()
  }

  const title = decodeHtml(targetSong?.name || 'Unknown Track')
  const artist = decodeHtml(artistsOf(targetSong) || '')

  ctx.fillStyle = '#ffffff'
  ctx.font = '700 42px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  ctx.fillText(title.slice(0, 34), coverImg ? 300 : 136, 210)

  ctx.fillStyle = 'rgba(255, 255, 255, 0.68)'
  ctx.font = '500 31px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  ctx.fillText(artist.slice(0, 42), coverImg ? 300 : 136, 260)

  // Lyric lines
  ctx.fillStyle = '#ff4d6d'
  ctx.font = '800 92px Georgia, serif'
  ctx.fillText('“', 132, 410)

  ctx.fillStyle = '#ffffff'
  ctx.font = '700 50px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  let y = 480
  const chosenLines = lines.filter(Boolean).slice(0, 5)
  for (const rawLine of chosenLines) {
    const wrapped = wrapText(ctx, rawLine, W - 272)
    for (const seg of wrapped) {
      if (y > H - 230) break
      ctx.fillText(seg, 136, y)
      y += 68
    }
    y += 18
  }

  // Footer watermark
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)'
  ctx.font = '700 26px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  ctx.fillText('VIBEX MUSIC  •  vibex-music-pi.vercel.app', 136, H - 140)

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Failed to encode lyric card image.'))
    }, 'image/png')
  })
}

export const renderLyricCardBlob = generateLyricCardBlob

export async function shareOrDownloadLyricCard({ song, track, lines = [] }) {
  const targetSong = song || track
  const blob = await generateLyricCardBlob({ song: targetSong, lines })
  const safeTitle = decodeHtml(targetSong?.name || 'lyrics')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .slice(0, 40)
  const fileName = `vibex-lyrics-${safeTitle || 'card'}.png`

  if (typeof File === 'function' && typeof navigator !== 'undefined' && navigator.canShare) {
    try {
      const file = new File([blob], fileName, { type: 'image/png' })
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: `${decodeHtml(targetSong?.name || 'Song')} — Lyrics`,
          files: [file],
        })
        return { shared: true, downloaded: false }
      }
    } catch {
      /* user cancelled or share unsupported — fall through to download */
    }
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
  return { shared: false, downloaded: true }
}
