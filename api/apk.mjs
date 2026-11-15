// Serves / redirects to the signed universal Android package (`dev.viswesh.vibex`).
// If bundled alongside the server (`public/downloads/VIBEX-v3.2.0-universal.apk`), streams
// the APK directly with `application/vnd.android.package-archive`; otherwise issues a clean
// 302 redirect to the verified GitHub Release asset so mobile browsers download in 1 tap.
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const APK_FILENAME = 'VIBEX-v3.2.0-universal.apk'
export const APK_VERSION = '3.2.0'
export const APK_PACKAGE_ID = 'dev.viswesh.vibex'
export const GITHUB_RELEASE_APK_URL =
  process.env.VIBEX_APK_URL ||
  `https://vibex-music-pi.vercel.app/downloads/${APK_FILENAME}`

const CANDIDATE_PATHS = [
  path.resolve(__dirname, '_assets', APK_FILENAME),
  path.resolve(__dirname, '../VIBEX.apk'),
  path.resolve(__dirname, '../music-app/dist/downloads', APK_FILENAME),
  path.resolve(__dirname, '../music-app/public/downloads', APK_FILENAME),
  path.resolve(process.cwd(), 'api/_assets', APK_FILENAME),
  path.resolve(process.cwd(), 'music-app/dist/downloads', APK_FILENAME),
  path.resolve(process.cwd(), 'music-app/public/downloads', APK_FILENAME),
]

export default async function handler(req, res) {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-methods', 'GET, HEAD, OPTIONS')

  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }

  const url = new URL(req.url || '/api/apk', 'https://vibex-music-pi.vercel.app')
  if (url.searchParams.get('meta') === '1') {
    let localBytes = null
    for (const candidate of CANDIDATE_PATHS) {
      try {
        const st = await fs.stat(candidate)
        if (st.isFile() && st.size > 10_000) {
          localBytes = st.size
          break
        }
      } catch {
        /* continue */
      }
    }
    res.statusCode = 200
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'public, max-age=60')
    res.end(
      JSON.stringify({
        success: true,
        data: {
          packageId: APK_PACKAGE_ID,
          version: APK_VERSION,
          filename: APK_FILENAME,
          minSdk: 26,
          targetSdk: 34,
          bytes: localBytes,
          downloadPath: '/api/apk',
          releaseUrl: GITHUB_RELEASE_APK_URL,
        },
      })
    )
    return
  }

  for (const candidate of CANDIDATE_PATHS) {
    try {
      const buf = await fs.readFile(candidate)
      if (buf.length > 10_000) {
        res.statusCode = 200
        res.setHeader('content-type', 'application/vnd.android.package-archive')
        res.setHeader('content-disposition', `attachment; filename="${APK_FILENAME}"`)
        res.setHeader('content-length', String(buf.length))
        res.setHeader('cache-control', 'public, max-age=300')
        if (req.method === 'HEAD') {
          res.end()
          return
        }
        res.end(buf)
        return
      }
    } catch {
      /* fall through to next candidate or GitHub Release redirect */
    }
  }

  res.statusCode = 302
  res.setHeader('location', GITHUB_RELEASE_APK_URL)
  res.setHeader('cache-control', 'no-store')
  res.end()
}
