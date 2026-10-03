import { useEffect, useRef } from 'react'
import { usePlayer } from '../state/PlayerContext.jsx'
import { useSettings } from '../state/SettingsContext.jsx'

const NB = 56

/**
 * Canvas visualiser. Runs entirely on refs and a rAF loop — none of this
 * belongs in React state, since it repaints 60 times a second.
 */
export function useVisualizer(canvasRef, enabled) {
  const { analyserRef, freqDataRef, audioRef, currentIndex } = usePlayer()
  const { viz, liveOK } = useSettings()

  const raf = useRef(null)
  const level = useRef(0)
  const bars = useRef(new Array(NB).fill(0))
  const targets = useRef(new Array(NB).fill(0))
  const lastT = useRef(0)
  const cfg = useRef({ viz, liveOK, currentIndex })
  cfg.current = { viz, liveOK, currentIndex }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !enabled) {
      if (raf.current) cancelAnimationFrame(raf.current)
      raf.current = null
      return undefined
    }
    const ctx = canvas.getContext('2d')

    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const r = canvas.getBoundingClientRect()
      if (r.width < 2) return
      canvas.width = Math.round(r.width * dpr)
      canvas.height = Math.round(r.height * dpr)
    }
    size()
    window.addEventListener('resize', size)

    const gradient = (H) => {
      const g = ctx.createLinearGradient(0, H, 0, 0)
      g.addColorStop(0, '#1ed760')
      g.addColorStop(1, '#4d7cff')
      return g
    }
    const roundBar = (x, y, w, h) => {
      ctx.beginPath()
      if (ctx.roundRect) ctx.roundRect(x, y, w, h, w / 2)
      else ctx.rect(x, y, w, h)
      ctx.fill()
    }

    const drawSpectrum = (W, H) => {
      const data = freqDataRef.current
      const bw = W / NB
      ctx.fillStyle = gradient(H)
      for (let i = 0; i < NB; i++) {
        const v = data[Math.floor((i / NB) * 96)] / 255
        const h = Math.max(2, v * H * 0.96)
        roundBar(i * bw + bw * 0.18, H - h, bw * 0.64, h)
      }
    }
    const drawBars = (W, H, sec, lvl) => {
      if (sec - lastT.current > 0.14) {
        lastT.current = sec
        for (let i = 0; i < NB; i++) targets.current[i] = 0.15 + Math.random() * 0.85
      }
      const bw = W / NB
      ctx.fillStyle = gradient(H)
      for (let i = 0; i < NB; i++) {
        bars.current[i] += (targets.current[i] - bars.current[i]) * 0.25
        const sway = 0.85 + 0.15 * Math.sin(sec * 2.4 + i * 0.55)
        const h = Math.max(2, bars.current[i] * sway * lvl * H * 0.92)
        roundBar(i * bw + bw * 0.18, H - h, bw * 0.64, h)
      }
    }
    const drawWave = (W, H, sec, lvl) => {
      const layers = [
        { f: 0.012, sp: 2.2, a: 0.3, c: 'rgba(30,215,96,0.85)' },
        { f: 0.02, sp: -1.6, a: 0.2, c: 'rgba(77,124,255,0.7)' },
        { f: 0.031, sp: 3.1, a: 0.12, c: 'rgba(124,255,178,0.5)' },
      ]
      const mid = H * 0.55
      layers.forEach((L, li) => {
        ctx.beginPath()
        for (let x = 0; x <= W; x += 4) {
          const y =
            mid +
            Math.sin(x * L.f + sec * L.sp) * H * L.a * lvl +
            Math.sin(x * L.f * 2.7 + sec * L.sp * 1.4) * H * L.a * 0.35 * lvl
          if (x === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.strokeStyle = L.c
        ctx.lineWidth = li === 0 ? 3 : 2
        ctx.stroke()
        if (li === 0) {
          ctx.lineTo(W, H)
          ctx.lineTo(0, H)
          ctx.closePath()
          ctx.fillStyle = 'rgba(30,215,96,0.12)'
          ctx.fill()
        }
      })
    }
    const drawOrbit = (W, H, sec, lvl) => {
      const cx = W / 2
      const cy = H / 2
      const R = Math.min(W, H) * 0.42
      ctx.beginPath()
      ctx.arc(cx, cy, R * 0.16 * (1 + lvl * 0.35), 0, Math.PI * 2)
      ctx.fillStyle = '#1ed760'
      ctx.fill()
      ctx.beginPath()
      ctx.arc(cx, cy, R * 0.16 * (1 + lvl * 0.35) + 6, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(30,215,96,0.35)'
      ctx.lineWidth = 2
      ctx.stroke()
      const N = 46
      for (let i = 0; i < N; i++) {
        const ang = (i / N) * Math.PI * 2 + sec * (0.5 + (i % 5) * 0.07)
        const rad = R * (0.55 + 0.32 * Math.sin(sec * 1.8 + i * 1.37)) * (0.35 + 0.65 * lvl)
        const x = cx + Math.cos(ang) * rad * (W / Math.max(W, H * 1.6))
        const y = cy + Math.sin(ang) * rad
        const r = 2.5 + 2.5 * (((i * 7919) % 10) / 10) * lvl
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fillStyle = i % 3 === 0 ? 'rgba(77,124,255,0.9)' : 'rgba(30,215,96,0.85)'
        ctx.fill()
      }
    }

    const loop = () => {
      raf.current = requestAnimationFrame(loop)
      const sec = performance.now() / 1000
      const W = canvas.width
      const H = canvas.height
      if (W < 10 || H < 10) return
      const { viz: v, liveOK: ok, currentIndex: ci } = cfg.current
      const el = audioRef.current
      const playing = ci >= 0 && el && !el.paused
      level.current += ((playing ? 1 : 0.12) - level.current) * 0.06
      const beat = Math.pow(Math.max(0, Math.sin(sec * Math.PI * 2 * 2.1)), 6) * 0.25
      const lvl = Math.min(1.2, level.current + (playing ? beat : 0))
      const live = v.style === 'spectrum' && ok && analyserRef.current && freqDataRef.current
      if (live) {
        try {
          analyserRef.current.getByteFrequencyData(freqDataRef.current)
        } catch {
          /* graph torn down mid-frame */
        }
      }
      ctx.clearRect(0, 0, W, H)
      if (v.style === 'wave') drawWave(W, H, sec, lvl)
      else if (v.style === 'orbit') drawOrbit(W, H, sec, lvl)
      else if (live) drawSpectrum(W, H)
      else drawBars(W, H, sec, lvl)
    }
    raf.current = requestAnimationFrame(loop)

    return () => {
      window.removeEventListener('resize', size)
      if (raf.current) cancelAnimationFrame(raf.current)
      raf.current = null
    }
  }, [canvasRef, enabled, analyserRef, freqDataRef, audioRef])
}
