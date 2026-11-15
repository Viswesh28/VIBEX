import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  PLAYBACK_FAILURE,
  PLAYBACK_STATE,
  classifyPlaybackFailure,
  decideFailureAction,
  initialPlaybackMachine,
  transitionPlaybackState,
} from '../src/lib/playbackState.js'
import { ProviderError } from '../src/lib/providers.js'
import { LibraryProvider } from '../src/state/LibraryContext.jsx'
import { PlayerProvider, usePlayer } from '../src/state/PlayerContext.jsx'
import { SettingsProvider } from '../src/state/SettingsContext.jsx'
import { StatusProvider, useStatus } from '../src/state/StatusContext.jsx'

describe('playback state machine transitions & failure taxonomy', () => {
  it('walks Idle → Resolving → Ready → Buffering → Playing ↔ Paused → Ended', () => {
    let m = initialPlaybackMachine()
    expect(m.state).toBe(PLAYBACK_STATE.Idle)

    m = transitionPlaybackState(m, { type: 'RESOLVE_START', trackKey: 'jiosaavn:t1', mode: 'stream' })
    expect(m.state).toBe(PLAYBACK_STATE.Resolving)

    m = transitionPlaybackState(m, { type: 'RESOLVE_READY', mode: 'stream' })
    expect(m.state).toBe(PLAYBACK_STATE.Ready)

    m = transitionPlaybackState(m, { type: 'BUFFERING' })
    expect(m.state).toBe(PLAYBACK_STATE.Buffering)

    m = transitionPlaybackState(m, { type: 'PLAYING' })
    expect(m.state).toBe(PLAYBACK_STATE.Playing)

    m = transitionPlaybackState(m, { type: 'PAUSED' })
    expect(m.state).toBe(PLAYBACK_STATE.Paused)

    m = transitionPlaybackState(m, { type: 'PLAYING' })
    expect(m.state).toBe(PLAYBACK_STATE.Playing)

    m = transitionPlaybackState(m, { type: 'ENDED' })
    expect(m.state).toBe(PLAYBACK_STATE.Ended)
  })

  it('classifies all seven failure categories accurately and caps re-resolve at once', () => {
    expect(classifyPlaybackFailure({ status: 401 })).toBe(PLAYBACK_FAILURE.AuthorizationRequired)
    expect(classifyPlaybackFailure({ status: 451 })).toBe(PLAYBACK_FAILURE.NotAvailableInRegion)
    expect(classifyPlaybackFailure({ embedCode: 150 })).toBe(PLAYBACK_FAILURE.RightsOrDrm)
    expect(classifyPlaybackFailure({ code: 4 })).toBe(PLAYBACK_FAILURE.UnsupportedFormat)
    expect(classifyPlaybackFailure({ status: 503 })).toBe(PLAYBACK_FAILURE.ProviderUnavailable)
    expect(classifyPlaybackFailure({ code: 2 })).toBe(PLAYBACK_FAILURE.NetworkRetryable)
    expect(
      classifyPlaybackFailure(
        { status: 403 },
        { url: 'https://cdn.example.com/a.m4a?expire=1700000000', nowMs: 1700000500 * 1000 }
      )
    ).toBe(PLAYBACK_FAILURE.ExpiredPlaybackReference)

    // Expired reference: first time re-resolves, second time surfaces failure without looping.
    expect(
      decideFailureAction(PLAYBACK_FAILURE.ExpiredPlaybackReference, { reResolvedCount: 0 }).action
    ).toBe('re_resolve')
    expect(
      decideFailureAction(PLAYBACK_FAILURE.ExpiredPlaybackReference, { reResolvedCount: 1 }).action
    ).toBe('surface_error')

    // Entitlement / auth / region errors NEVER auto-retry.
    for (const nonRetryable of [
      PLAYBACK_FAILURE.AuthorizationRequired,
      PLAYBACK_FAILURE.NotAvailableInRegion,
      PLAYBACK_FAILURE.RightsOrDrm,
      PLAYBACK_FAILURE.UnsupportedFormat,
      PLAYBACK_FAILURE.ProviderUnavailable,
    ]) {
      expect(decideFailureAction(nonRetryable, { networkAttempts: 0 }).action).toBe('surface_error')
    }
  })
})

describe('queue persistence hygiene, expiry re-resolution, and entitlement surfacing', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.mocked(window.HTMLMediaElement.prototype.play).mockClear()
  })

  function StateProbe({ tracks = [] }) {
    const {
      current,
      playbackState,
      playbackFailure,
      reResolvedCount,
      togglePlay,
      playFromList,
    } = usePlayer()
    const { status } = useStatus()
    return (
      <div>
        <span data-testid="state">{playbackState}</span>
        <span data-testid="current">{current?.name || 'none'}</span>
        <span data-testid="failure">{playbackFailure?.category || 'none'}</span>
        <span data-testid="reresolves">{String(reResolvedCount)}</span>
        <span data-testid="status">{status.msg}</span>
        <button type="button" onClick={togglePlay}>
          Toggle Play
        </button>
        <button type="button" onClick={() => playFromList(tracks, 0)}>
          Start Queue
        </button>
      </div>
    )
  }

  it('strips expiring signed URLs from persisted session and re-resolves on restore', async () => {
    const signedSong = {
      id: 'signed_track_1',
      name: 'Ephemeral Stream Song',
      duration: 215,
      downloadUrl: [
        {
          quality: '320kbps',
          url: 'https://cdn.example.com/signed.m4a?expire=1700000100&sig=SECRET',
        },
      ],
      artists: { primary: [{ name: 'Artist' }] },
    }

    const resolver = {
      resolve: vi.fn(async () => ({
        mode: 'stream',
        uri: 'https://cdn.example.com/fresh_restored.m4a',
        mimeType: 'audio/mp4',
        expiresAtEpochMs: null,
      })),
    }

    const firstMount = render(
      <StatusProvider>
        <SettingsProvider>
          <LibraryProvider>
            <PlayerProvider streamResolver={resolver}>
              <StateProbe tracks={[signedSong]} />
            </PlayerProvider>
          </LibraryProvider>
        </SettingsProvider>
      </StatusProvider>
    )

    await userEvent.click(screen.getByRole('button', { name: 'Start Queue' }))
    await waitFor(() => expect(resolver.resolve).toHaveBeenCalledTimes(1))

    // Verify localStorage NEVER persisted the raw expiring stream URL or secret!
    const rawSaved = localStorage.getItem('svSession')
    expect(rawSaved).toBeTruthy()
    expect(rawSaved).not.toContain('signed.m4a')
    expect(rawSaved).not.toContain('SECRET')
    const parsedSaved = JSON.parse(rawSaved)
    expect(parsedSaved.queue[0].downloadUrl).toEqual([])

    firstMount.unmount()
    resolver.resolve.mockClear()

    // Remount fresh app session from `svSession` and press Toggle Play:
    // re-resolves fresh stream cleanly through `StreamResolver`!
    render(
      <StatusProvider>
        <SettingsProvider>
          <LibraryProvider>
            <PlayerProvider streamResolver={resolver}>
              <StateProbe />
            </PlayerProvider>
          </LibraryProvider>
        </SettingsProvider>
      </StatusProvider>
    )

    expect(screen.getByTestId('current')).toHaveTextContent('Ephemeral Stream Song')
    await userEvent.click(screen.getByRole('button', { name: 'Toggle Play' }))
    await waitFor(() => expect(resolver.resolve).toHaveBeenCalledTimes(1))
    expect(document.querySelector('audio').getAttribute('src')).toBe(
      'https://cdn.example.com/fresh_restored.m4a'
    )
  })

  it('re-resolves an expired playback URL strictly ONCE and halts if the second attempt also fails', async () => {
    let calls = 0
    const resolver = {
      resolve: vi.fn(async () => {
        calls += 1
        return {
          mode: 'stream',
          // Already expired timestamp so runtime error triggers ExpiredPlaybackReference
          uri: `https://cdn.example.com/attempt_${calls}.m4a?expire=1600000000`,
          mimeType: 'audio/mp4',
          expiresAtEpochMs: 1600000000 * 1000,
        }
      }),
    }

    const track = {
      id: 'exp_track',
      name: 'Expiring Track',
      duration: 180,
      downloadUrl: [],
      artists: { primary: [{ name: 'Artist' }] },
    }

    render(
      <StatusProvider>
        <SettingsProvider>
          <LibraryProvider>
            <PlayerProvider streamResolver={resolver}>
              <StateProbe tracks={[track]} />
            </PlayerProvider>
          </LibraryProvider>
        </SettingsProvider>
      </StatusProvider>
    )

    await userEvent.click(screen.getByRole('button', { name: 'Start Queue' }))
    await waitFor(() => expect(resolver.resolve).toHaveBeenCalledTimes(1))

    const audio = document.querySelector('audio')
    // First runtime failure on expired URL -> triggers 1 re-resolve
    await act(async () => {
      audio.dispatchEvent(new Event('error'))
    })
    await waitFor(() => expect(resolver.resolve).toHaveBeenCalledTimes(2))
    expect(screen.getByTestId('reresolves')).toHaveTextContent('1')

    // Second runtime failure -> MUST NOT loop a third time; enters Failed state!
    await act(async () => {
      audio.dispatchEvent(new Event('error'))
    })
    expect(resolver.resolve).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('state')).toHaveTextContent(PLAYBACK_STATE.Failed)
    expect(screen.getByTestId('failure')).toHaveTextContent(PLAYBACK_FAILURE.ExpiredPlaybackReference)
  })

  it.each([
    [PLAYBACK_FAILURE.AuthorizationRequired, 'Sign-in required by partner provider.'],
    [PLAYBACK_FAILURE.NotAvailableInRegion, 'Track unavailable in IN territory.'],
    [PLAYBACK_FAILURE.RightsOrDrm, 'Widevine license required for playback.'],
  ])(
    'surfaces %s honestly without looping or substituting another queue item',
    async (category, message) => {
      const resolver = {
        resolve: vi.fn(async () => {
          throw new ProviderError(message, { category })
        }),
      }
      const queueTracks = [
        { id: 't_blocked', name: 'Restricted Song', duration: 200, downloadUrl: [] },
        { id: 't_next', name: 'Other Song', duration: 200, downloadUrl: [] },
      ]

      const view = render(
        <StatusProvider>
          <SettingsProvider>
            <LibraryProvider>
              <PlayerProvider streamResolver={resolver}>
                <StateProbe tracks={queueTracks} />
              </PlayerProvider>
            </LibraryProvider>
          </SettingsProvider>
        </StatusProvider>
      )

      await userEvent.click(screen.getByRole('button', { name: 'Start Queue' }))
      await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent(PLAYBACK_STATE.Failed))

      expect(resolver.resolve).toHaveBeenCalledTimes(1)
      expect(screen.getByTestId('failure')).toHaveTextContent(category)
      expect(screen.getByTestId('status')).toHaveTextContent(message)
      // Must stay on the track the user picked instead of silently playing a substitute!
      expect(screen.getByTestId('current')).toHaveTextContent('Restricted Song')

      view.unmount()
    }
  )
})
