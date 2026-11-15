// jsdom implements the DOM but not the media stack, and PlayerContext drives
// two real <audio> elements plus a Web Audio analyser. Rather than stub those
// per-spec, patch the prototypes once so any test can mount the player.
import '@testing-library/jest-dom/vitest'
import { vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Specs that opt into `// @vitest-environment node` (the tagger, the embedded
// API) still get this setup file, and there is no DOM there to patch.
const hasDom = typeof window !== 'undefined' && !!window.HTMLMediaElement

if (hasDom) {
  afterEach(() => {
    cleanup()
    try {
      window.history.replaceState(null, '', '/')
    } catch {
      /* ignore */
    }
  })
  patchMediaStack()
}

function patchMediaStack() {
  // --- <audio> -------------------------------------------------------------
  // jsdom throws "Not implemented" for these. Position and duration are faked
  // so the crossfade engine's clock has something to advance.
  const proto = window.HTMLMediaElement.prototype
  Object.defineProperties(proto, {
    paused: {
      get() { return this.__paused !== false },
      configurable: true,
    },
    currentTime: {
      get() { return this.__time || 0 },
      set(v) { this.__time = Number(v) || 0 },
      configurable: true,
    },
    duration: {
      get() { return this.__duration ?? Number.NaN },
      set(v) { this.__duration = v },
      configurable: true,
    },
  })
  proto.load = vi.fn()
  proto.canPlayType = () => ''
  proto.play = vi.fn(function () {
    this.__paused = false
    return Promise.resolve()
  })
  proto.pause = vi.fn(function () {
    this.__paused = true
  })

  // --- Web Audio -----------------------------------------------------------
  // The visualizer path must be constructible but must not need a real device.
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {} })
  class FakeAudioContext {
    constructor() {
      this.state = 'running'
      this.destination = { __sink: true }
      this.currentTime = 0
      this.sampleRate = 48000
    }
    createAnalyser() {
      return {
        fftSize: 2048,
        frequencyBinCount: 1024,
        smoothingTimeConstant: 0.8,
        connect() {},
        disconnect() {},
        getByteFrequencyData(a) { a.fill(0) },
        getByteTimeDomainData(a) { a.fill(128) },
      }
    }
    createMediaElementSource() { return { connect() {}, disconnect() {}, __src: true } }
    createGain() { return { gain: param(), connect() {}, disconnect() {} } }
    createBiquadFilter() {
      return { type: 'peaking', frequency: param(), Q: param(), gain: param(), connect() {}, disconnect() {} }
    }
    createDynamicsCompressor() {
      return {
        threshold: param(),
        knee: param(),
        ratio: param(),
        attack: param(),
        release: param(),
        connect() {},
        disconnect() {},
      }
    }
    createConvolver() { return { buffer: null, connect() {}, disconnect() {} } }
    createBuffer(channels, length, sampleRate) {
      return {
        numberOfChannels: channels,
        length,
        sampleRate,
        getChannelData: () => new Float32Array(length),
      }
    }
    resume() { this.state = 'running'; return Promise.resolve() }
    close() { this.state = 'closed'; return Promise.resolve() }
  }
  window.AudioContext = FakeAudioContext
  window.webkitAudioContext = FakeAudioContext

  // --- misc browser APIs the app touches -----------------------------------
  if (!window.matchMedia) {
    window.matchMedia = (query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    })
  }
  if (!window.URL.createObjectURL) window.URL.createObjectURL = () => 'blob:fake'
  if (!window.URL.revokeObjectURL) window.URL.revokeObjectURL = () => {}
  if (!window.scrollTo) window.scrollTo = () => {}
}
