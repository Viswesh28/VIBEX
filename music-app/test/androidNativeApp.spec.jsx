import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import apkHandler, { APK_FILENAME, APK_PACKAGE_ID, APK_VERSION } from '../../api/apk.mjs'
import { useAndroidBack } from '../src/hooks/useAndroidBack.js'
import { useMediaSession } from '../src/hooks/useMediaSession.js'
import { hasAndroidBridge, isNative, isNativeApp } from '../src/lib/config.js'
import { downloadSongNative } from '../src/lib/download.js'
import { subscribeNativeShare } from '../src/lib/native.js'
import { isNativeShell } from '../src/lib/platform.js'
import { inspectCrossDeviceShareSupport } from '../src/lib/shareTarget.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BUILT_APK_PATH = path.resolve(__dirname, '../public/downloads', APK_FILENAME)

afterEach(() => {
  delete window.VibexAndroid
  delete window.__VIBEX_NATIVE
  vi.restoreAllMocks()
})

describe('VIBEX Native Android App (dev.viswesh.vibex v3.2.0)', () => {
  it('detects window.VibexAndroid native shell without perturbing embedded unit-test mode', () => {
    expect(hasAndroidBridge()).toBe(false)
    expect(isNative()).toBe(false)
    expect(isNativeApp()).toBe(false)
    expect(isNativeShell()).toBe(false)

    window.VibexAndroid = { getVersion: () => '3.2.0' }
    expect(hasAndroidBridge()).toBe(true)
    expect(isNative()).toBe(false)
    expect(isNativeApp()).toBe(true)
    expect(isNativeShell()).toBe(true)

    const caps = inspectCrossDeviceShareSupport(window)
    expect(caps.native).toBe(true)
    expect(caps.tier).toBe('native-android')
  })

  it('syncs track metadata, lock-screen scrubber & two-way Bluetooth/Notification actions via VibexAndroid', () => {
    const updateMetadata = vi.fn()
    const updatePlaybackState = vi.fn()
    window.VibexAndroid = { updateMetadata, updatePlaybackState }

    const actions = {
      play: vi.fn(),
      pause: vi.fn(),
      toggle: vi.fn(),
      next: vi.fn(),
      prev: vi.fn(),
      seekBy: vi.fn(),
      seekTo: vi.fn(),
      setDucking: vi.fn(),
    }

    const song = {
      id: 'song-99',
      name: 'Veezha Veera',
      duration: 214,
      album: { name: 'Studio Single' },
      artists: { primary: [{ name: 'Sai Abhyankkar' }] },
      image: [{ quality: '500x500', url: 'https://c.saavncdn.com/cover_500x500.jpg' }],
    }

    const { rerender } = renderHook(
      ({ current, isPlaying, clock }) =>
        useMediaSession({ current, isPlaying, clock, dataSaver: false, actions }),
      {
        initialProps: {
          current: song,
          isPlaying: true,
          clock: { cur: 12.4, dur: 214 },
        },
      }
    )

    expect(updateMetadata).toHaveBeenCalledWith(
      'Veezha Veera',
      'Sai Abhyankkar',
      'Studio Single',
      'https://c.saavncdn.com/cover_500x500.jpg',
      214000
    )
    expect(updatePlaybackState).toHaveBeenCalledWith(true, 12400, 214000)

    // Dispatch hardware / lock-screen / Bluetooth / AudioFocus events from Java -> JS
    act(() => {
      window.dispatchEvent(
        new CustomEvent('vibex:native-media-action', { detail: { action: 'pause' } })
      )
      window.dispatchEvent(
        new CustomEvent('vibex:native-media-action', { detail: { action: 'next' } })
      )
      window.dispatchEvent(
        new CustomEvent('vibex:native-media-action', { detail: { action: 'prev' } })
      )
      window.dispatchEvent(
        new CustomEvent('vibex:native-media-action', {
          detail: { action: 'seekto', positionMs: 65000 },
        })
      )
      window.dispatchEvent(
        new CustomEvent('vibex:native-media-action', { detail: { action: 'duck' } })
      )
      window.dispatchEvent(
        new CustomEvent('vibex:native-media-action', { detail: { action: 'unduck' } })
      )
      window.dispatchEvent(
        new CustomEvent('vibex:native-media-action', { detail: { action: 'play' } })
      )
    })

    expect(actions.pause).toHaveBeenCalledTimes(1)
    expect(actions.next).toHaveBeenCalledTimes(1)
    expect(actions.prev).toHaveBeenCalledTimes(1)
    expect(actions.seekTo).toHaveBeenCalledWith(65)
    expect(actions.setDucking).toHaveBeenNthCalledWith(1, true)
    expect(actions.setDucking).toHaveBeenNthCalledWith(2, false)
    expect(actions.play).toHaveBeenCalledTimes(1)

    rerender({ current: null, isPlaying: false, clock: { cur: 0, dur: 0 } })
    expect(updateMetadata).toHaveBeenLastCalledWith('', '', '', '', 0)
  })

  it('unwinds layered modals on Android Back gesture and minimizes instead of killing playback at root', async () => {
    const minimizeApp = vi.fn()
    window.VibexAndroid = { minimizeApp }

    const actions = {
      closeDrawer: vi.fn(),
      closeCmd: vi.fn(),
      closeShare: vi.fn(),
      closeDsp: vi.fn(),
      closeImport: vi.fn(),
      closePlaylistModal: vi.fn(),
      setLyricsOpen: vi.fn(),
      setFullOpen: vi.fn(),
      back: vi.fn(),
    }

    const { rerender } = renderHook((props) => useAndroidBack(props), {
      initialProps: {
        drawer: true,
        cmdOpen: false,
        shareOpen: false,
        dspOpen: false,
        importModalOpen: false,
        plModal: null,
        lyricsOpen: false,
        fullOpen: true,
        canGoBack: () => false,
        actions,
      },
    })

    // Allow async onBackButton registration microtask
    await act(async () => {})

    await act(async () => {
      window.dispatchEvent(new CustomEvent('vibex:native-back'))
    })
    expect(actions.closeDrawer).toHaveBeenCalledTimes(1)
    expect(minimizeApp).not.toHaveBeenCalled()

    rerender({
      drawer: false,
      cmdOpen: false,
      shareOpen: false,
      dspOpen: false,
      importModalOpen: false,
      plModal: null,
      lyricsOpen: false,
      fullOpen: true,
      canGoBack: () => false,
      actions,
    })

    await act(async () => {
      window.dispatchEvent(new CustomEvent('vibex:native-back'))
    })
    expect(actions.setFullOpen).toHaveBeenCalledWith(false)
    expect(minimizeApp).not.toHaveBeenCalled()

    rerender({
      drawer: false,
      cmdOpen: false,
      shareOpen: false,
      dspOpen: false,
      importModalOpen: false,
      plModal: null,
      lyricsOpen: false,
      fullOpen: false,
      canGoBack: () => false,
      actions,
    })

    await act(async () => {
      window.dispatchEvent(new CustomEvent('vibex:native-back'))
    })
    expect(minimizeApp).toHaveBeenCalledTimes(1)
  })

  it('delivers cold-start and warm-resume Android Share Sheet intents to subscribeNativeShare', async () => {
    window.VibexAndroid = {
      consumeInitialShare: () =>
        JSON.stringify({
          url: '',
          text: 'Check out this track https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
          title: 'Spotify',
        }),
    }

    const received = []
    const unsub = await subscribeNativeShare((payload) => received.push(payload))

    expect(received).toHaveLength(1)
    expect(received[0].text).toContain('open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT')

    act(() => {
      window.dispatchEvent(
        new CustomEvent('vibex:native-share', {
          detail: {
            url: 'https://music.youtube.com/watch?v=lYBUbBu4W08',
            text: '',
            title: 'YouTube Music',
          },
        })
      )
    })

    expect(received).toHaveLength(2)
    expect(received[1].url).toBe('https://music.youtube.com/watch?v=lYBUbBu4W08')
    unsub()
  })

  it('saves downloaded JioSaavn & YT Music audio straight into Android Music/VIBEX storage', async () => {
    const saveAudioBase64 = vi.fn(() => 'content://media/external/audio/media/901')
    window.VibexAndroid = { saveAudioBase64 }

    const fakeM4a = new Uint8Array(2048).fill(0x41)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(fakeM4a, {
        status: 200,
        headers: { 'content-type': 'audio/mp4' },
      })
    )

    const ytResult = await downloadSongNative(
      { id: 'yt:lYBUbBu4W08', name: 'Never Gonna Give You Up' },
      '320kbps'
    )
    expect(ytResult.folder).toBe('Music/VIBEX')
    expect(ytResult.name).toBe('Never Gonna Give You Up.m4a')
    expect(ytResult.bytes).toBeGreaterThanOrEqual(2048)
    expect(saveAudioBase64).toHaveBeenCalledTimes(1)
  })

  it('ships a valid, 4-byte aligned, v1+v2+v3 cryptographically signed VIBEX universal APK & serves it on /api/apk', async () => {
    expect(fs.existsSync(BUILT_APK_PATH)).toBe(true)
    const raw = fs.readFileSync(BUILT_APK_PATH)

    // 1. Valid ZIP/APK container header & size (> 500 KB, < 25 MB)
    expect(raw.subarray(0, 4).toString('binary')).toBe('PK\x03\x04')
    expect(raw.length).toBeGreaterThan(500_000)
    expect(raw.length).toBeLessThan(25_000_000)

    // 2. Contains compiled AndroidManifest.xml, ART classes.dex, bundled web UI, and APK Sig Block 42 (v2/v3)
    const latin = raw.toString('latin1')
    expect(latin).toContain('AndroidManifest.xml')
    expect(latin).toContain('classes.dex')
    expect(latin).toContain('assets/www/index.html')
    expect(latin).toContain('META-INF/MANIFEST.MF')
    expect(latin).toContain('APK Sig Block 42')

    // 3. Verify `resources.arsc` is uncompressed (`ZIP_STORED` == 0) AND 4-byte aligned for Android 11–16 (`targetSdk=34`)
    const marker = Buffer.from('resources.arsc', 'utf8')
    let foundArscHeader = false
    let pos = 0
    while ((pos = raw.indexOf(marker, pos)) !== -1) {
      const hdrStart = pos - 30
      if (hdrStart >= 0 && raw.readUInt32LE(hdrStart) === 0x04034b50) {
        const compressionMethod = raw.readUInt16LE(hdrStart + 8)
        const fileNameLen = raw.readUInt16LE(hdrStart + 26)
        const extraLen = raw.readUInt16LE(hdrStart + 28)
        const dataOffset = hdrStart + 30 + fileNameLen + extraLen
        expect(compressionMethod).toBe(0) // ZIP_STORED
        expect(dataOffset % 4).toBe(0) // 4-byte aligned
        foundArscHeader = true
        break
      }
      pos += marker.length
    }
    expect(foundArscHeader).toBe(true)

    // 4. Verify `/api/apk?meta=1` & `HEAD /api/apk`
    const headers = {}
    let bodyBuf = Buffer.alloc(0)
    const mockRes = {
      statusCode: 200,
      setHeader: (k, v) => {
        headers[k.toLowerCase()] = v
      },
      end: (chunk) => {
        bodyBuf = chunk ? Buffer.from(chunk) : Buffer.alloc(0)
      },
    }
    await apkHandler({ method: 'GET', url: '/api/apk?meta=1' }, mockRes)
    const metaJson = JSON.parse(bodyBuf.toString('utf8'))
    expect(metaJson.success).toBe(true)
    expect(metaJson.data.packageId).toBe(APK_PACKAGE_ID)
    expect(metaJson.data.version).toBe(APK_VERSION)
    expect(metaJson.data.bytes).toBe(raw.length)

    const dlHeaders = {}
    const dlRes = {
      statusCode: 200,
      setHeader: (k, v) => {
        dlHeaders[k.toLowerCase()] = v
      },
      end: () => {},
    }
    await apkHandler({ method: 'HEAD', url: '/download/vibex.apk' }, dlRes)
    expect(dlRes.statusCode).toBe(200)
    expect(dlHeaders['content-type']).toBe('application/vnd.android.package-archive')
    expect(Number(dlHeaders['content-length'])).toBe(raw.length)
  })
})
