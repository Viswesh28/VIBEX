import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsPanel } from '../src/components/SettingsPanel.jsx'
import {
  CONFLICT_POLICY,
  SYNC_STATUS,
  emptyRemoteMirror,
  exportLibrarySnapshot,
  importLibrarySnapshot,
  mergeLibraryViews,
  runLibrarySync,
} from '../src/lib/sync.js'
import { LibraryProvider, useLibrary } from '../src/state/LibraryContext.jsx'
import { PlayerProvider } from '../src/state/PlayerContext.jsx'
import { SettingsProvider } from '../src/state/SettingsContext.jsx'
import { StatusProvider } from '../src/state/StatusContext.jsx'

function memoryStorage(initialMirror = emptyRemoteMirror(), initialState = null) {
  let mirror = initialMirror
  let state = initialState
  return {
    readMirror: () => mirror,
    writeMirror: (next) => {
      mirror = next
    },
    readSyncState: () => state,
    writeSyncState: (next) => {
      state = next
    },
  }
}

const validAccount = {
  provider: 'partner',
  providerAccountId: 'acct_1',
  displayName: 'Test Listener',
  scopes: ['library.read'],
  authStateRef: 'securestore:acct_1',
}

const validConsent = {
  granted: true,
  collections: ['liked', 'playlists'],
}

const makeSong = (provider, id, name, extraUrl = null) => ({
  id: `${provider}:${id}`,
  provider,
  providerTrackId: id,
  name,
  duration: 200,
  artists: { primary: [{ name: 'Artist' }] },
  downloadUrl: extraUrl ? [{ quality: '320kbps', url: extraUrl }] : [],
})

describe('library synchronization algorithm', () => {
  it('requires explicit opt-in before calling the provider', async () => {
    const syncLibrary = vi.fn()
    await expect(
      runLibrarySync({
        accountProvider: { signIn: vi.fn(), syncLibrary, signOut: vi.fn() },
        account: validAccount,
        consent: { granted: false, collections: ['liked'] },
        storage: memoryStorage(),
      })
    ).rejects.toThrow(/explicit user opt-in/i)
    expect(syncLibrary).not.toHaveBeenCalled()
  })

  it('paginates via cursor, upserts idempotently, and strips expiring stream URLs', async () => {
    const pages = {
      initial: {
        liked: [
          makeSong('partner', 's1', 'Track One', 'https://cdn.example/s1.m4a?expire=1700000500'),
          makeSong('partner', 's2', 'Track Two'),
        ],
        playlists: [{ id: 'pl_a', provider: 'partner', name: 'Morning Mix', songs: [makeSong('partner', 's1', 'Track One')] }],
        nextCursor: 'cur_2',
      },
      cur_2: {
        liked: [
          // Duplicate s2 on second page must be idempotent
          makeSong('partner', 's2', 'Track Two'),
          makeSong('partner', 's3', 'Track Three'),
        ],
        playlists: [],
        nextCursor: null,
        authoritativeComplete: true,
      },
    }

    const storage = memoryStorage()
    const syncLibrary = vi.fn(async ({ cursor }) => pages[cursor || 'initial'])

    const firstRun = await runLibrarySync({
      accountProvider: { signIn: vi.fn(), syncLibrary, signOut: vi.fn() },
      account: validAccount,
      consent: validConsent,
      storage,
    })

    expect(firstRun.status).toBe(SYNC_STATUS.synced)
    expect(firstRun.pagesProcessed).toBe(2)
    expect(firstRun.mirror.liked.map((s) => s.key)).toEqual([
      'partner:s1',
      'partner:s2',
      'partner:s3',
    ])
    // Expiring URL was stripped before persistence.
    expect(firstRun.mirror.liked[0].downloadUrl).toEqual([])

    // Re-running the full sync produces identical mirror contents (idempotent).
    const secondRun = await runLibrarySync({
      accountProvider: { signIn: vi.fn(), syncLibrary, signOut: vi.fn() },
      account: validAccount,
      consent: validConsent,
      storage,
    })
    expect(secondRun.mirror.liked).toHaveLength(3)
    expect(secondRun.mirror.playlists).toHaveLength(1)
  })

  it('recovers from a mid-sync failure from the last committed cursor without deleting local items', async () => {
    const localLiked = [makeSong('jiosaavn', 'local_only_1', 'My Local Favorite')]
    const localPlaylists = [{ id: 'pl_local', name: 'Offline Gems', songs: localLiked }]
    const storage = memoryStorage()

    let failPageTwo = true
    const syncLibrary = vi.fn(async ({ cursor }) => {
      if (!cursor) {
        return {
          liked: [makeSong('partner', 'r1', 'Remote 1')],
          playlists: [],
          nextCursor: 'page_2_token',
        }
      }
      if (cursor === 'page_2_token' && failPageTwo) {
        const err = new Error('Gateway 503')
        err.status = 503
        throw err
      }
      return {
        liked: [makeSong('partner', 'r2', 'Remote 2')],
        playlists: [],
        nextCursor: null,
        authoritativeComplete: true,
      }
    })

    const partial = await runLibrarySync({
      accountProvider: { signIn: vi.fn(), syncLibrary, signOut: vi.fn() },
      account: validAccount,
      consent: validConsent,
      storage,
      maxRetriesPerPage: 1,
      sleep: async () => {},
    })

    expect(partial.status).toBe(SYNC_STATUS.error)
    // Page 1 cursor committed; page 2 will resume cleanly on the next run.
    expect(storage.readSyncState().cursor).toBe('page_2_token')
    expect(storage.readMirror().liked.map((s) => s.key)).toEqual(['partner:r1'])

    // Local items remain 100% intact even during a failed/partial sync!
    const mergedAfterFailure = mergeLibraryViews({
      localLiked,
      localPlaylists,
      remoteMirror: storage.readMirror(),
    })
    expect(mergedAfterFailure.liked.map((s) => s.key)).toEqual([
      'jiosaavn:local_only_1',
      'partner:r1',
    ])
    expect(mergedAfterFailure.playlists.map((p) => p.name)).toContain('Offline Gems')

    // Now heal upstream and resume: starts straight at `page_2_token`!
    failPageTwo = false
    syncLibrary.mockClear()
    const resumed = await runLibrarySync({
      accountProvider: { signIn: vi.fn(), syncLibrary, signOut: vi.fn() },
      account: validAccount,
      consent: validConsent,
      storage,
    })
    expect(syncLibrary).toHaveBeenCalledTimes(1)
    expect(syncLibrary).toHaveBeenCalledWith({
      cursor: 'page_2_token',
      collections: ['liked', 'playlists'],
    })
    expect(resumed.status).toBe(SYNC_STATUS.synced)
    // Because resumed scan did not start at cursor=null, r1 was NOT pruned!
    expect(resumed.mirror.liked.map((s) => s.key)).toEqual(['partner:r1', 'partner:r2'])
  })

  it('honours Retry-After on 429 and halts immediately without retrying on 401 auth revocation', async () => {
    const waits = []
    let calls = 0
    const rateLimited = {
      signIn: vi.fn(),
      signOut: vi.fn(),
      syncLibrary: vi.fn(async () => {
        calls += 1
        if (calls === 1) {
          const e = new Error('Too Many Requests')
          e.status = 429
          e.retryAfterMs = 750
          throw e
        }
        return { liked: [makeSong('partner', 'ok1', 'Recovered')], playlists: [], nextCursor: null }
      }),
    }

    const res429 = await runLibrarySync({
      accountProvider: rateLimited,
      account: validAccount,
      consent: validConsent,
      storage: memoryStorage(),
      sleep: async (ms) => waits.push(ms),
    })
    expect(res429.status).toBe(SYNC_STATUS.synced)
    expect(waits).toEqual([750])

    const revokedProvider = {
      signIn: vi.fn(),
      signOut: vi.fn(),
      syncLibrary: vi.fn(async () => {
        const e = new Error('Token revoked')
        e.status = 401
        throw e
      }),
    }
    const res401 = await runLibrarySync({
      accountProvider: revokedProvider,
      account: validAccount,
      consent: validConsent,
      storage: memoryStorage(),
      sleep: async (ms) => waits.push(ms),
    })
    expect(revokedProvider.syncLibrary).toHaveBeenCalledTimes(1)
    expect(res401.status).toBe(SYNC_STATUS.authRequired)
    expect(res401.syncState.errorCategory).toBe('AuthorizationRequired')
  })

  it('resolves playlist edit conflicts non-destructively and exports/imports clean snapshots', () => {
    const localPlaylists = [
      { id: 'pl_1', name: 'Workout', songs: [makeSong('jiosaavn', 'a', 'Local Edit')] },
    ]
    const remoteMirror = {
      liked: [],
      playlists: [
        { id: 'partner:pl_1', name: 'Workout', songs: [makeSong('partner', 'b', 'Remote Edit')] },
      ],
    }

    const keepBoth = mergeLibraryViews({
      localPlaylists,
      remoteMirror,
      conflictPolicy: CONFLICT_POLICY.keepBoth,
    })
    expect(keepBoth.conflicts).toHaveLength(1)
    expect(keepBoth.playlists.map((p) => p.name)).toEqual(['Workout', 'Workout (Synced)'])

    const exported = exportLibrarySnapshot({
      liked: [makeSong('jiosaavn', 'a', 'Local Edit', 'https://cdn.example/a.m4a?expire=1700000100')],
      playlists: localPlaylists,
    })
    expect(exported.liked[0].downloadUrl).toEqual([])
    const reimported = importLibrarySnapshot(exported, {
      existingLiked: exported.liked,
      existingPlaylists: localPlaylists,
    })
    expect(reimported.liked).toHaveLength(1)
    expect(reimported.playlists).toHaveLength(1)
  })
})

describe('Settings & LibraryProvider sync controls integration', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('drives opt-in connect, pause, resume, disconnect, and local library deletion in the UI', async () => {
    const mockAccountProvider = {
      signIn: vi.fn(async () => validAccount),
      syncLibrary: vi.fn(async () => ({
        liked: [makeSong('partner', 'synced_1', 'Synced Sunrise')],
        playlists: [],
        nextCursor: null,
        authoritativeComplete: true,
      })),
      signOut: vi.fn(async () => {}),
    }

    function LibraryProbe() {
      const { liked, toggleLike } = useLibrary()
      return (
        <div>
          <span data-testid="likedCount">{liked.length}</span>
          <button
            type="button"
            onClick={() => toggleLike(makeSong('jiosaavn', 'local_1', 'Local Sunset'))}
          >
            Add local song
          </button>
          <SettingsPanel open sleep={{ minutes: 0, left: 0, setMinutes: () => {} }} />
        </div>
      )
    }

    render(
      <StatusProvider>
        <SettingsProvider>
          <LibraryProvider accountProvider={mockAccountProvider}>
            <PlayerProvider>
              <LibraryProbe />
            </PlayerProvider>
          </LibraryProvider>
        </SettingsProvider>
      </StatusProvider>
    )

    await userEvent.click(screen.getByRole('button', { name: 'Add local song' }))
    expect(screen.getByTestId('likedCount')).toHaveTextContent('1')

    await userEvent.click(screen.getByRole('button', { name: /Opt in & connect/i }))
    await waitFor(() => expect(screen.getByTestId('likedCount')).toHaveTextContent('2'))

    await userEvent.click(screen.getByRole('button', { name: 'Pause sync' }))
    expect(screen.getByRole('button', { name: 'Resume sync' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Disconnect account' }))
    expect(mockAccountProvider.signOut).toHaveBeenCalledTimes(1)
    // Local favorite was preserved across disconnect!
    expect(screen.getByTestId('likedCount')).toHaveTextContent('2')

    // Two-step local library deletion clears everything cleanly.
    await userEvent.click(screen.getByRole('button', { name: 'Delete library copy' }))
    await userEvent.click(screen.getByRole('button', { name: 'Tap again to delete library' }))
    expect(screen.getByTestId('likedCount')).toHaveTextContent('0')
  })
})
