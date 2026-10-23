/**
 * Zero-bloat Supabase Auth + RLS Cloud Sync Adapter (`AccountProvider`).
 *
 * Speaks directly to Supabase Auth (`/auth/v1/*`) + PostgREST (`/rest/v1/vibex_user_sync`)
 * with Row-Level Security (`auth.uid() = user_id`), supporting:
 *   1. Email + Password instant sign-up & sign-in
 *   2. Passwordless Email Magic Link (`signInWithOtp`) with automatic URL hash session capture
 *   3. Automatic JWT token refresh before expiration
 *   4. Bidirectional cross-device sync (`listLiked`, `listPlaylists`, `pushLibrary`)
 */

import { store } from './storage.js'
import { sanitizeTrackForPersistence } from './models.js'

const SESSION_STORAGE_KEY = 'svSupabaseSession'

export function readSupabaseConfig() {
  const env = (typeof import.meta !== 'undefined' && import.meta.env) || {}
  const url = String(env.VITE_SUPABASE_URL || globalThis.__VIBEX_SUPABASE_URL__ || '').trim()
  const anonKey = String(
    env.VITE_SUPABASE_ANON_KEY || globalThis.__VIBEX_SUPABASE_ANON_KEY__ || ''
  ).trim()
  return {
    url: url.replace(/\/+$/, ''),
    anonKey,
    configured: Boolean(url && anonKey),
  }
}

async function parseJsonSafe(res, fallback = null) {
  if (typeof res.json === 'function') {
    return res.json().catch(() => fallback)
  }
  if (typeof res.text === 'function') {
    const raw = await res.text().catch(() => '')
    try {
      return raw ? JSON.parse(raw) : fallback
    } catch {
      return fallback
    }
  }
  return fallback
}

export function createSupabaseSyncService({
  url,
  anonKey,
  fetchFn,
  fetchImpl,
  storage = store,
} = {}) {
  const effectiveFetch = fetchFn || fetchImpl || ((...args) => globalThis.fetch(...args))
  const cfg =
    url && anonKey
      ? { url: url.replace(/\/+$/, ''), anonKey, configured: true }
      : readSupabaseConfig()
  if (!cfg.configured) return null

  const readSession = () => storage.getJSON(SESSION_STORAGE_KEY, null)
  const writeSession = (raw) => {
    if (!raw?.access_token) {
      storage.remove(SESSION_STORAGE_KEY)
      return null
    }
    const expiresAt = raw.expires_at
      ? Number(raw.expires_at) * 1000
      : Date.now() + (Number(raw.expires_in) || 3600) * 1000
    const normalized = {
      access_token: raw.access_token,
      refresh_token: raw.refresh_token || null,
      expires_at: expiresAt,
      user: raw.user || null,
    }
    storage.setJSON(SESSION_STORAGE_KEY, normalized)
    return normalized
  }

  const toAccountShape = (session) => {
    if (!session?.access_token || !session?.user?.id) return null
    return {
      provider: 'supabase',
      accountId: session.user.id,
      email: session.user.email || '',
      displayName:
        session.user.user_metadata?.display_name || session.user.email || 'VIBEX Listener',
      scopes: ['library:read', 'library:write', 'preferences:sync'],
      tokenRef: `sb:${session.user.id.slice(0, 12)}`,
      expiresAtEpochMs: session.expires_at || Date.now() + 3600_000,
    }
  }

  const captureMagicLinkCallback = async () => {
    if (!cfg.configured || typeof window === 'undefined') return null
    const hash = String(window.location.hash || '')
    if (!hash.includes('access_token=')) return null
    const params = new URLSearchParams(hash.replace(/^#/, ''))
    const accessToken = params.get('access_token')
    const refreshToken = params.get('refresh_token')
    const expiresIn = Number(params.get('expires_in')) || 3600
    if (!accessToken) return null

    const userRes = await effectiveFetch(`${cfg.url}/auth/v1/user`, {
      headers: {
        apikey: cfg.anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
    })
    if (!userRes.ok) return null
    const user = await parseJsonSafe(userRes, null)
    const saved = writeSession({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: expiresIn,
      user,
    })
    try {
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    } catch {
      /* ignore */
    }
    return toAccountShape(saved)
  }

  const ensureFreshSession = async () => {
    const current = readSession()
    if (!current?.access_token) return null
    if (current.expires_at && current.expires_at - Date.now() > 60_000) {
      return current
    }
    if (!current.refresh_token) return current
    const res = await effectiveFetch(`${cfg.url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        apikey: cfg.anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refresh_token: current.refresh_token }),
    })
    if (!res.ok) return null
    const refreshed = await parseJsonSafe(res, null)
    return writeSession(refreshed)
  }

  const signInWithPassword = async (email, password) => {
    const res = await effectiveFetch(`${cfg.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: cfg.anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: String(email || '').trim(), password }),
    })
    const body = await parseJsonSafe(res, {})
    if (!res.ok) {
      throw new Error(
        body?.msg || body?.error_description || body?.message || 'Invalid email or password.'
      )
    }
    const saved = writeSession(body)
    return { session: saved, account: toAccountShape(saved), confirmationSent: false }
  }

  const signUpWithPassword = async (email, password) => {
    const res = await effectiveFetch(`${cfg.url}/auth/v1/signup`, {
      method: 'POST',
      headers: {
        apikey: cfg.anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: String(email || '').trim(), password }),
    })
    const body = await parseJsonSafe(res, {})
    if (!res.ok) {
      throw new Error(body?.msg || body?.error_description || body?.message || 'Sign-up failed.')
    }
    if (body?.access_token) {
      const saved = writeSession(body)
      return { session: saved, account: toAccountShape(saved), confirmationSent: false }
    }
    return signInWithPassword(email, password)
  }

  const sendMagicLink = async (email) => {
    const redirectTo =
      typeof window !== 'undefined' ? window.location.origin : 'https://vibex-music-pi.vercel.app'
    const res = await effectiveFetch(`${cfg.url}/auth/v1/otp`, {
      method: 'POST',
      headers: {
        apikey: cfg.anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: String(email || '').trim(),
        create_user: true,
        options: { emailRedirectTo: redirectTo },
      }),
    })
    const body = await parseJsonSafe(res, {})
    if (!res.ok) {
      throw new Error(body?.msg || body?.error_description || body?.message || 'Failed to send Magic Link.')
    }
    return { sent: true }
  }

  const pullCloudState = async () => {
    const session = await ensureFreshSession()
    if (!session?.access_token || !session?.user?.id) return null
    const res = await effectiveFetch(
      `${cfg.url}/rest/v1/vibex_user_sync?user_id=eq.${encodeURIComponent(session.user.id)}&select=*`,
      {
        headers: {
          apikey: cfg.anonKey,
          Authorization: `Bearer ${session.access_token}`,
          Accept: 'application/json',
        },
      }
    )
    if (!res.ok) {
      const err = await parseJsonSafe(res, {})
      const outErr = new Error(err?.message || `Cloud read failed (${res.status}).`)
      outErr.status = res.status
      throw outErr
    }
    const rows = await parseJsonSafe(res, [])
    return Array.isArray(rows) && rows[0] ? rows[0] : null
  }

  const pushCloudState = async ({ liked = [], playlists = [], stats = null, preferences = null }) => {
    const session = await ensureFreshSession()
    if (!session?.access_token || !session?.user?.id) return null
    const payload = {
      user_id: session.user.id,
      liked: (liked || []).map(sanitizeTrackForPersistence).filter(Boolean),
      playlists: (playlists || []).map((p) => ({
        id: p.id,
        name: p.name,
        songs: (p.songs || []).map(sanitizeTrackForPersistence).filter(Boolean),
      })),
      ...(stats ? { stats } : {}),
      ...(preferences ? { preferences } : {}),
      updated_at: new Date().toISOString(),
    }

    const res = await effectiveFetch(`${cfg.url}/rest/v1/vibex_user_sync?on_conflict=user_id`, {
      method: 'POST',
      headers: {
        apikey: cfg.anonKey,
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const err = await parseJsonSafe(res, {})
      throw new Error(err?.message || `Cloud sync upload failed (${res.status}).`)
    }
    const rows = await parseJsonSafe(res, [])
    return Array.isArray(rows) && rows[0] ? rows[0] : payload
  }

  let pendingCredentials = null

  return {
    isSupabase: true,
    isConfigured: true,
    setPendingCredentials(creds) {
      pendingCredentials = creds
    },
    async restoreSession() {
      const fromMagic = await captureMagicLinkCallback().catch(() => null)
      if (fromMagic) return fromMagic
      const session = await ensureFreshSession().catch(() => null)
      return toAccountShape(session)
    },
    async signIn() {
      if (pendingCredentials?.mode === 'magic') {
        await sendMagicLink(pendingCredentials.email)
        throw new Error('Magic Link sent — check your inbox and click the sign-in link!')
      }
      if (pendingCredentials?.email && pendingCredentials?.password) {
        const out =
          pendingCredentials.mode === 'signup'
            ? await signUpWithPassword(pendingCredentials.email, pendingCredentials.password)
            : await signInWithPassword(pendingCredentials.email, pendingCredentials.password)
        pendingCredentials = null
        return out.account
      }
      const existing = await ensureFreshSession()
      if (existing) return toAccountShape(existing)
      throw new Error('Enter your email and password above to connect Cloud Sync.')
    },
    async listLiked() {
      const row = await pullCloudState()
      return {
        items: Array.isArray(row?.liked) ? row.liked : [],
        nextCursor: null,
        syncToken: row?.updated_at || new Date().toISOString(),
      }
    },
    async listPlaylists() {
      const row = await pullCloudState()
      return {
        items: Array.isArray(row?.playlists) ? row.playlists : [],
        nextCursor: null,
        syncToken: row?.updated_at || new Date().toISOString(),
      }
    },
    async pushLibrary(data) {
      return pushCloudState(data)
    },
    async deleteAccountData() {
      const session = await ensureFreshSession()
      if (!session?.access_token || !session?.user?.id) return
      await effectiveFetch(
        `${cfg.url}/rest/v1/vibex_user_sync?user_id=eq.${encodeURIComponent(session.user.id)}`,
        {
          method: 'DELETE',
          headers: {
            apikey: cfg.anonKey,
            Authorization: `Bearer ${session.access_token}`,
          },
        }
      ).catch(() => {})
    },
    async signOut() {
      const session = readSession()
      storage.remove(SESSION_STORAGE_KEY)
      if (session?.access_token) {
        await effectiveFetch(`${cfg.url}/auth/v1/logout`, {
          method: 'POST',
          headers: {
            apikey: cfg.anonKey,
            Authorization: `Bearer ${session.access_token}`,
          },
        }).catch(() => {})
      }
    },
    sendMagicLink,
    signUpWithPassword,
    signInWithPassword,
  }
}
